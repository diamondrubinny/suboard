import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/index.js';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'Correct-Horse-Battery-1';

export interface TestCtx {
  app: FastifyInstance;
  db: DB;
}

export async function setup(env: Record<string, string> = {}): Promise<TestCtx> {
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: ORIGIN,
    LOGIN_MAX_PER_WINDOW: '1000',
    STATIC_DIR: '/nonexistent',
    ...env,
  });
  const db = openDatabase(':memory:');
  const app = await buildApp(config, db);
  await app.ready();
  return { app, db };
}

/** Minimal HTTP client that keeps the session cookie and adds the CSRF header. */
export class Client {
  token: string | null = null;
  constructor(private readonly app: FastifyInstance) {}

  async req(method: InjectOptions['method'], url: string, body?: unknown, extra: Partial<InjectOptions> = {}) {
    const res = await this.app.inject({
      method,
      url,
      ...(body !== undefined ? { payload: body as InjectOptions['payload'] } : {}),
      headers: { 'x-requested-with': 'suboard', origin: ORIGIN, ...(extra.headers ?? {}) },
      cookies: this.token ? { sb_session: this.token } : {},
    });
    const set = res.cookies.find((c) => c.name === 'sb_session');
    if (set) this.token = set.value || null;
    return res;
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown) => this.req('POST', url, body ?? {});
  patch = (url: string, body: unknown) => this.req('PATCH', url, body);
  put = (url: string, body: unknown) => this.req('PUT', url, body);
  del = (url: string) => this.req('DELETE', url);

  async login(email: string, password = PASSWORD) {
    const res = await this.post('/api/auth/login', { email, password });
    if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.body}`);
    return res;
  }
}

/** Creates a user directly via the service layer (no forced password change). */
export async function createUser(ctx: TestCtx, email: string, role: 'admin' | 'manager' | 'member', name = email.split('@')[0]!) {
  const u = await ctx.app.services.users.create(null, { email, name, role, password: PASSWORD }, { mustChangePassword: false });
  return u;
}

export async function loggedIn(ctx: TestCtx, email: string, role: 'admin' | 'manager' | 'member') {
  const user = await createUser(ctx, email, role);
  const client = new Client(ctx.app);
  await client.login(email);
  return { user, client };
}
