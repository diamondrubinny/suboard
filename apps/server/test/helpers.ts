import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/index.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import type { ServiceOverrides } from '../src/services/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'Correct-Horse-Battery-1';

export interface TestCtx {
  app: FastifyInstance;
  db: DB;
  mailer: MemoryMailer;
  uploadDir: string;
  /** Closes the app and DB and removes the temp upload directory. */
  close: () => Promise<void>;
}

export async function setup(env: Record<string, string> = {}, overrides: ServiceOverrides = {}): Promise<TestCtx> {
  const uploadDir = mkdtempSync(join(tmpdir(), 'suboard-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: ORIGIN,
    LOGIN_MAX_PER_WINDOW: '1000',
    STATIC_DIR: '/nonexistent',
    MFA_REQUIRED_ROLES: '',
    UPLOAD_DIR: uploadDir,
    ...env,
  });
  const db = openDatabase(':memory:');
  const mailer = new MemoryMailer();
  const app = await buildApp(config, db, { mailer, scanner: null, ...overrides });
  await app.ready();
  return {
    app,
    db,
    mailer,
    uploadDir,
    close: async () => {
      await app.close();
      db.close();
      rmSync(uploadDir, { recursive: true, force: true });
    },
  };
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
      headers: { 'x-requested-with': 'suboard', origin: ORIGIN, ...((extra.headers as Record<string, string>) ?? {}) },
      cookies: this.token ? { sb_session: this.token } : {},
    });
    const set = res.cookies.find((c) => c.name === 'sb_session');
    if (set) this.token = set.value || null;
    return res;
  }
  /** multipart/form-data upload of a single file field. */
  async upload(url: string, filename: string, data: Buffer) {
    const boundary = '----suboardtest' + Math.random().toString(16).slice(2);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return this.req('POST', url, Buffer.concat([head, data, tail]), {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
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
