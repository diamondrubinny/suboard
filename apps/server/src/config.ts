import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_PATH: z.string().default('./data/suboard.db'),
    /** Comma-separated list of allowed browser origins (used for the CSRF Origin check). */
    APP_ORIGIN: z.string().default('http://localhost:5173,http://localhost:3000'),
    COOKIE_SECURE: bool.optional(),
    SESSION_TTL_HOURS: z.coerce.number().min(1).max(24 * 30).default(12),
    SESSION_IDLE_MINUTES: z.coerce.number().min(5).max(24 * 60).default(120),
    /** Secret used to HMAC client IPs before they are written to the audit log. */
    AUDIT_IP_SECRET: z.string().optional(),
    /** Number of trusted reverse-proxy hops (0 = do not trust X-Forwarded-For). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    TIME_ZONE: z.string().default('Asia/Jerusalem'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    LOGIN_MAX_PER_WINDOW: z.coerce.number().int().min(1).default(10),
    LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
    LOCKOUT_THRESHOLD: z.coerce.number().int().min(1).default(5),
    LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
    STATIC_DIR: z.string().optional(),
    /** 32-byte key (64 hex chars) that encrypts TOTP secrets at rest. */
    MFA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters').optional(),
    /** Comma-separated global roles that must enrol MFA ('' = optional for everyone). */
    MFA_REQUIRED_ROLES: z.string().default('admin'),
    MFA_ISSUER: z.string().min(1).max(40).default('SUBoard'),
    PUBLIC_URL: z.string().url().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: bool.optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default('SUBoard <no-reply@localhost>'),
    DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(7),
    NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
    UPLOAD_DIR: z.string().default('./data/uploads'),
    MAX_UPLOAD_MB: z.coerce.number().min(1).max(50).default(10),
    CLAMAV_HOST: z.string().optional(),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    CLAMAV_SOCKET: z.string().optional(),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
    /** DEVELOPMENT ONLY: mark uploads clean without scanning. Rejected in production. */
    CLAMAV_SCAN_DISABLED_UNSAFE: bool.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && (!env.AUDIT_IP_SECRET || env.AUDIT_IP_SECRET.length < 32)) {
      ctx.addIssue({ code: 'custom', path: ['AUDIT_IP_SECRET'], message: 'required in production (min 32 chars)' });
    }
    if (env.NODE_ENV === 'production' && !env.MFA_ENCRYPTION_KEY) {
      ctx.addIssue({ code: 'custom', path: ['MFA_ENCRYPTION_KEY'], message: 'required in production (64 hex chars)' });
    }
    if (env.NODE_ENV === 'production' && env.CLAMAV_SCAN_DISABLED_UNSAFE) {
      ctx.addIssue({ code: 'custom', path: ['CLAMAV_SCAN_DISABLED_UNSAFE'], message: 'not allowed in production' });
    }
    if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === false) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must not be false in production' });
    }
  });

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  databasePath: string;
  allowedOrigins: string[];
  cookieSecure: boolean;
  sessionTtlMs: number;
  sessionIdleMs: number;
  auditIpSecret: string;
  trustProxyHops: number;
  timeZone: string;
  logLevel: string;
  loginMaxPerWindow: number;
  loginWindowMs: number;
  lockoutThreshold: number;
  lockoutMs: number;
  staticDir: string | undefined;
  mfaKey: Buffer;
  mfaRequiredRoles: string[];
  mfaIssuer: string;
  publicUrl: string;
  smtp: { host: string; port: number; secure: boolean; user?: string; password?: string } | null;
  mailFrom: string;
  digestHour: number;
  notificationRetentionDays: number;
  uploadDir: string;
  maxUploadBytes: number;
  clamav: { host?: string; port: number; socket?: string; timeoutMs: number } | null;
  scanDisabledUnsafe: boolean;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    allowedOrigins: e.APP_ORIGIN.split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean),
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    sessionTtlMs: e.SESSION_TTL_HOURS * 3600_000,
    sessionIdleMs: e.SESSION_IDLE_MINUTES * 60_000,
    auditIpSecret: e.AUDIT_IP_SECRET ?? 'dev-only-insecure-audit-secret-change-me',
    trustProxyHops: e.TRUST_PROXY_HOPS,
    timeZone: e.TIME_ZONE,
    logLevel: e.LOG_LEVEL,
    loginMaxPerWindow: e.LOGIN_MAX_PER_WINDOW,
    loginWindowMs: e.LOGIN_WINDOW_MINUTES * 60_000,
    lockoutThreshold: e.LOCKOUT_THRESHOLD,
    lockoutMs: e.LOCKOUT_MINUTES * 60_000,
    staticDir: e.STATIC_DIR,
    // Development fallback key is deterministic and insecure; production requires a real key.
    mfaKey: Buffer.from(e.MFA_ENCRYPTION_KEY ?? '00'.repeat(32), 'hex'),
    mfaRequiredRoles: e.MFA_REQUIRED_ROLES.split(',').map((r) => r.trim()).filter(Boolean),
    mfaIssuer: e.MFA_ISSUER,
    publicUrl: (e.PUBLIC_URL ?? e.APP_ORIGIN.split(',')[0] ?? '').replace(/\/$/, ''),
    smtp: e.SMTP_HOST
      ? { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE ?? e.SMTP_PORT === 465, user: e.SMTP_USER, password: e.SMTP_PASSWORD }
      : null,
    mailFrom: e.MAIL_FROM,
    digestHour: e.DIGEST_HOUR,
    notificationRetentionDays: e.NOTIFICATION_RETENTION_DAYS,
    uploadDir: e.UPLOAD_DIR,
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
    clamav: e.CLAMAV_HOST || e.CLAMAV_SOCKET ? { host: e.CLAMAV_HOST, port: e.CLAMAV_PORT, socket: e.CLAMAV_SOCKET, timeoutMs: e.CLAMAV_TIMEOUT_MS } : null,
    scanDisabledUnsafe: e.CLAMAV_SCAN_DISABLED_UNSAFE ?? false,
  };
}
