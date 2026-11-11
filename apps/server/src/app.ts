import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import type { DB } from './db/index.js';
import { AppError } from './lib/errors.js';
import { authPlugin } from './plugins/auth.js';
import { csrfPlugin } from './plugins/csrf.js';
import { authRoutes } from './routes/auth.js';
import { boardRoutes } from './routes/boards.js';
import { operationsRoutes } from './routes/operations.js';
import { userRoutes } from './routes/users.js';
import { workflowRoutes } from './routes/workflow.js';
import { automationRoutes } from './routes/automations.js';
import { fieldRoutes } from './routes/field.js';
import { planningRoutes } from './routes/planning.js';
import { moduleRoutes } from './routes/modules.js';
import { scimRoutes } from './routes/scim.js';
import { createServices, type ServiceOverrides, type Services } from './services/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}

const GENERIC_BY_STATUS: Record<number, string> = {
  400: 'הבקשה אינה תקינה',
  404: 'המשאב לא נמצא',
  405: 'פעולה לא נתמכת',
  413: 'הבקשה גדולה מדי',
  415: 'סוג תוכן לא נתמך',
  429: 'יותר מדי בקשות. נסו שוב בעוד מספר דקות.',
};

export async function buildApp(config: AppConfig, db: DB, overrides: ServiceOverrides = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.logLevel,
            // Never log credentials or session material.
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          },
    // Trust exactly N reverse-proxy hops for req.ip (rate limiting / audit); never trust by default.
    trustProxy: config.trustProxyHops > 0 ? (_addr: string, hop: number) => hop < config.trustProxyHops : false,
    bodyLimit: 100 * 1024,
    // Under a folder (PUBLIC_URL https://example.org/test), accept both "/test/…" and proxies that
    // already stripped the prefix; routes are always registered at the root.
    rewriteUrl: config.basePath
      ? (req) => {
          const url = req.url ?? '/';
          return url === config.basePath ? '/' : url.startsWith(`${config.basePath}/`) ? url.slice(config.basePath.length) : url;
        }
      : undefined,
    disableRequestLogging: config.env === 'production' ? false : undefined,
  });

  const services = createServices(db, config, overrides);
  services.notifications.setLogger(app.log);
  services.attachments.setLogger(app.log);
  services.automations.setLogger(app.log);
  services.recurrences.setLogger(app.log);
  services.reports.setLogger(app.log);
  services.investigations.setLogger(app.log);
  services.monthly.setLogger(app.log);
  services.trainings.setLogger(app.log);
  services.permits.setLogger(app.log);
  services.sso.setLogger(app.log);
  app.decorate('services', services);

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    hsts: config.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
  });
  await app.register(cookie);
  // Multipart only for attachment uploads: one file, no extra fields, bounded size.
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1, fields: 0, parts: 1, headerPairs: 50 } });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: 60_000,
    errorResponseBuilder: (_req, ctx) => {
      const err = new AppError(429, 'RATE_LIMITED', GENERIC_BY_STATUS[429]!);
      (err as AppError & { retryAfter?: string }).retryAfter = ctx.after;
      return err;
    },
  });
  await app.register(csrfPlugin, { allowedOrigins: config.allowedOrigins });
  await app.register(authPlugin, { auth: services.auth, config });

  app.addHook('onSend', async (req, reply) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    // Test / staging sites: keep every response out of search engines.
    if (config.noIndex) reply.header('X-Robots-Tag', 'noindex, nofollow');
  });

  app.setErrorHandler((err: FastifyError | AppError | ZodError, req, reply) => {
    if (err instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = issue.path.join('.') || '_';
        fields[key] ??= issue.message;
      }
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'יש לתקן את השדות המסומנים', fields } });
    }
    if (err instanceof AppError) {
      if (err.statusCode === 403 && req.user) {
        services.audit.log('access_denied', { userId: req.user.id, ip: req.ip, meta: { method: req.method, route: req.routeOptions.url ?? null, code: err.code } });
      }
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } });
    }
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) {
      req.log.error({ err }, 'unhandled error');
      return reply.code(500).send({ error: { code: 'INTERNAL', message: 'אירעה שגיאה בלתי צפויה. נסו שוב מאוחר יותר.' } });
    }
    return reply.code(status).send({ error: { code: err.code ?? 'BAD_REQUEST', message: GENERIC_BY_STATUS[status] ?? 'הבקשה נכשלה' } });
  });

  // ---- SCIM 2.0 provisioning (bearer token; registered only when SCIM_TOKEN is set)
  if (services.scim.enabled) await app.register(scimRoutes, { prefix: '/scim/v2', scim: services.scim });

  // ---- API
  await app.register(
    async (api) => {
      api.get('/health', { config: { public: true } }, async () => {
        db.prepare('SELECT 1').get();
        return { status: 'ok' };
      });
      await api.register(authRoutes, { services, config });
      await api.register(userRoutes, { services });
      await api.register(boardRoutes, { services });
      await api.register(operationsRoutes, { services, config });
      await api.register(workflowRoutes, { services });
      await api.register(automationRoutes, { services });
      await api.register(fieldRoutes, { services });
      await api.register(planningRoutes, { services });
      await api.register(moduleRoutes, { services });
    },
    { prefix: '/api' },
  );

  // ---- SPA (production build)
  const staticDir = resolve(config.staticDir ?? resolve(process.cwd(), '../web/dist'));
  const hasSpa = existsSync(resolve(staticDir, 'index.html'));
  if (hasSpa) {
    await app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      index: false,
      setHeaders: (reply, path) => {
        reply.header('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    // Only extension-less page routes fall back to the SPA. Missing files/assets get a real 404
    // (never index.html served as JS/CSS). Note: static files are indexed at startup, so restart
    // the server after deploying a new web build.
    const isPageRoute = !/\.[a-z0-9]+$/i.test(path) && !path.startsWith('/assets/');
    if (req.url.startsWith('/api/') || req.method !== 'GET' || !hasSpa || !isPageRoute) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: GENERIC_BY_STATUS[404] } });
    }
    // Client-side routes are rendered by the SPA (including its own 404 page).
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile('index.html');
  });

  return app;
}
