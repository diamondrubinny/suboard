import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, createUser, ORIGIN, PASSWORD, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

/** A software authenticator: ES256 key pair, "none" attestation, user verification performed. */
class SoftAuthenticator {
  readonly credId = randomBytes(32);
  private readonly key: KeyObject;
  private readonly cose: Uint8Array;
  counter = 0;
  constructor(private readonly rpId = 'localhost', private readonly origin = ORIGIN) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
        [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))],
      ]),
    );
  }
  private authData(flags: number, attested: boolean): Buffer {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const parts = [sha(this.rpId), Buffer.from([flags]), count];
    if (attested) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credId.length);
      parts.push(Buffer.alloc(16), len, this.credId, Buffer.from(this.cose));
    }
    return Buffer.concat(parts);
  }
  create(challenge: string, opts: { uv?: boolean; origin?: string } = {}) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: opts.origin ?? this.origin, crossOrigin: false }));
    const authData = this.authData(0x41 | (opts.uv === false ? 0 : 0x04), true);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]) as never);
    return {
      id: b64u(this.credId),
      rawId: b64u(this.credId),
      type: 'public-key',
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
  get(challenge: string, userHandle: string, opts: { uv?: boolean; origin?: string; counter?: number } = {}) {
    this.counter = opts.counter ?? this.counter + 1;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: opts.origin ?? this.origin, crossOrigin: false }));
    const authData = this.authData(0x01 | (opts.uv === false ? 0 : 0x04), false);
    const signature = createSign('SHA256').update(Buffer.concat([authData, sha(clientDataJSON)])).sign(this.key);
    return {
      id: b64u(this.credId),
      rawId: b64u(this.credId),
      type: 'public-key',
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: b64u(Buffer.from(userHandle)) },
      clientExtensionResults: {},
    };
  }
}

async function enrol(c: Client, device: SoftAuthenticator, name?: string) {
  const o = (await c.post('/api/auth/passkeys/register/options', { password: PASSWORD })).json();
  return c.post('/api/auth/passkeys/register/verify', { challengeId: o.challengeId, name, response: device.create(o.options.challenge) });
}
async function signIn(c: Client, device: SoftAuthenticator, userId: string, opts: Parameters<SoftAuthenticator['get']>[2] = {}) {
  const o = (await c.post('/api/auth/passkey/login/options')).json();
  return c.post('/api/auth/passkey/login/verify', { challengeId: o.challengeId, response: device.get(o.options.challenge, userId, opts) });
}

describe('passkeys', () => {
  it('registers after confirming the password, signs in without one, and can be removed', async () => {
    ctx = await setup();
    const noa = await createUser(ctx, 'noa@x.org', 'member', 'נועה');
    const c = new Client(ctx.app);
    await c.login('noa@x.org');
    expect((await c.get('/api/auth/sso/config')).json().passkeys).toBe(true);

    // re-authentication: no / wrong password → no challenge at all
    expect((await c.post('/api/auth/passkeys/register/options', {})).statusCode).toBe(400);
    expect((await c.post('/api/auth/passkeys/register/options', { password: 'wrong-password-123' })).statusCode).toBe(400);
    const opts = (await c.post('/api/auth/passkeys/register/options', { password: PASSWORD })).json();
    expect(opts.options.rp.id).toBe('localhost');
    expect(opts.options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    expect(opts.options.attestation).toBe('none');

    const phone = new SoftAuthenticator();
    const made = await c.post('/api/auth/passkeys/register/verify', { challengeId: opts.challengeId, name: 'האייפון שלי', response: phone.create(opts.options.challenge) });
    expect(made.statusCode).toBe(200);
    expect(made.json().passkey).toMatchObject({ name: 'האייפון שלי', lastUsedAt: null });
    expect(JSON.stringify(made.json())).not.toMatch(/public|credential/i);
    // the challenge is single use
    expect((await c.post('/api/auth/passkeys/register/verify', { challengeId: opts.challengeId, response: phone.create(opts.options.challenge) })).statusCode).toBe(400);
    // the same authenticator is excluded from a second enrolment
    const again = (await c.post('/api/auth/passkeys/register/options', { password: PASSWORD })).json();
    expect(again.options.excludeCredentials.map((x: { id: string }) => x.id)).toEqual([b64u(phone.credId)]);
    // only the public key is stored; the challenge handle is stored hashed
    const row = ctx.db.prepare('SELECT * FROM passkeys').get() as { public_key: Buffer; credential_id: string };
    expect(row.credential_id).toBe(b64u(phone.credId));
    expect(ctx.db.prepare('SELECT id FROM webauthn_challenges WHERE id = ?').get(again.challengeId)).toBeUndefined();

    // sign in on a fresh browser: no e-mail, no password
    const anon = new Client(ctx.app);
    const lo = (await anon.post('/api/auth/passkey/login/options')).json();
    expect(lo.options.allowCredentials ?? []).toEqual([]); // names no account
    expect(lo.options.userVerification).toBe('required');
    const ok = await anon.post('/api/auth/passkey/login/verify', { challengeId: lo.challengeId, response: phone.get(lo.options.challenge, noa.id) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe('noa@x.org');
    expect((await anon.get('/api/auth/me')).statusCode).toBe(200);
    const sessions = (await anon.get('/api/auth/sessions')).json().sessions as { current: boolean; viaPasskey: boolean }[];
    expect(sessions.find((s) => s.current)!.viaPasskey).toBe(true);
    expect((await anon.get('/api/auth/passkeys')).json().passkeys[0].lastUsedAt).toBeTruthy();
    // replay of the same assertion: the challenge is gone
    expect((await new Client(ctx.app).post('/api/auth/passkey/login/verify', { challengeId: lo.challengeId, response: phone.get(lo.options.challenge, noa.id) })).statusCode).toBe(401);

    // another user cannot delete it; the owner can; then it no longer signs in
    await createUser(ctx, 'dan@x.org', 'member');
    const dan = new Client(ctx.app);
    await dan.login('dan@x.org');
    const id = made.json().passkey.id;
    expect((await dan.del(`/api/auth/passkeys/${id}`)).statusCode).toBe(404);
    expect((await dan.get('/api/auth/passkeys')).json().passkeys).toEqual([]);
    expect((await c.del(`/api/auth/passkeys/${id}`)).statusCode).toBe(200);
    expect((await signIn(new Client(ctx.app), phone, noa.id)).statusCode).toBe(401);
    const events = (ctx.db.prepare('SELECT event FROM audit_log').all() as { event: string }[]).map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(['passkey_add_failed', 'passkey_added', 'passkey_removed']));
  });

  it('rejects forged, cross-origin, unverified and cloned assertions with one generic answer', async () => {
    ctx = await setup();
    const noa = await createUser(ctx, 'noa@x.org', 'member');
    const c = new Client(ctx.app);
    await c.login('noa@x.org');
    const key = new SoftAuthenticator();
    expect((await enrol(c, key)).statusCode).toBe(200);

    // registration from another origin / without user verification
    const evil = new SoftAuthenticator('localhost', 'https://evil.example');
    expect((await enrol(c, evil)).statusCode).toBe(400);
    const o = (await c.post('/api/auth/passkeys/register/options', { password: PASSWORD })).json();
    const noUv = new SoftAuthenticator();
    expect((await c.post('/api/auth/passkeys/register/verify', { challengeId: o.challengeId, response: noUv.create(o.options.challenge, { uv: false }) })).statusCode).toBe(400);
    expect((await c.get('/api/auth/passkeys')).json().passkeys).toHaveLength(1);

    const anon = () => new Client(ctx.app);
    const bodies = new Set<string>();
    const bad = async (res: Awaited<ReturnType<typeof signIn>>) => {
      expect(res.statusCode).toBe(401);
      bodies.add(JSON.stringify(res.json().error));
    };
    await bad(await signIn(anon(), new SoftAuthenticator(), noa.id)); // unknown credential
    await bad(await signIn(anon(), key, noa.id, { origin: 'https://evil.example' })); // phishing origin
    await bad(await signIn(anon(), key, noa.id, { uv: false })); // no biometric / PIN
    // a different private key claiming the registered credential id
    const forged = new SoftAuthenticator();
    (forged as unknown as { credId: Buffer }).credId = key.credId;
    await bad(await signIn(anon(), forged, noa.id));
    expect(bodies.size).toBe(1);

    expect((await signIn(anon(), key, noa.id, { counter: 5 })).statusCode).toBe(200);
    // a signature counter that goes backwards means a cloned authenticator
    await bad(await signIn(anon(), key, noa.id, { counter: 3 }));
    expect((await signIn(anon(), key, noa.id, { counter: 6 })).statusCode).toBe(200);

    // malformed input never reaches the verifier
    const lo = (await anon().post('/api/auth/passkey/login/options')).json();
    expect((await anon().post('/api/auth/passkey/login/verify', { challengeId: lo.challengeId, response: { id: 'x' } })).statusCode).toBe(400);
    expect((await anon().post('/api/auth/passkey/login/verify', { challengeId: 'short', response: key.get('c', noa.id) })).statusCode).toBe(400);
  });

  it('counts as multi-factor, respects deactivation, SSO-only policy and the admin lost-device action', async () => {
    ctx = await setup({ MFA_REQUIRED_ROLES: 'manager' });
    const dana = await createUser(ctx, 'dana@x.org', 'manager');
    const admin = await createUser(ctx, 'root@x.org', 'admin');
    void admin;
    // a manager without TOTP is held at enrolment, so the passkey is added directly for this test
    const key = new SoftAuthenticator();
    const o = await ctx.app.services.passkeys.registrationOptions({ id: dana.id, email: dana.email, name: dana.name, authSource: 'local' }, PASSWORD, '127.0.0.1');
    await ctx.app.services.passkeys.register(dana.id, o.challengeId, undefined, key.create(o.options.challenge) as never, { ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' });
    expect(ctx.app.services.passkeys.list(dana.id)[0]!.name).toMatch(/Safari|iPhone|iOS/);

    const viaPassword = new Client(ctx.app);
    await viaPassword.login('dana@x.org');
    expect((await viaPassword.get('/api/boards')).json().error.code).toBe('MFA_SETUP_REQUIRED');
    expect((await viaPassword.post('/api/auth/passkeys/register/options', { password: PASSWORD })).statusCode).toBe(403);

    const viaPasskey = new Client(ctx.app);
    const res = await signIn(viaPasskey, key, dana.id);
    expect(res.json().user.mfaSetupRequired).toBe(false);
    expect((await viaPasskey.get('/api/boards')).statusCode).toBe(200);
    expect((await viaPasskey.patch('/api/auth/preferences', { emailNotifications: false })).json().user.mfaSetupRequired).toBe(false);

    // admin "disconnect devices" for another user removes sessions and passkeys
    const root = new Client(ctx.app);
    await root.login('root@x.org');
    const revoked = await root.post(`/api/users/${dana.id}/revoke-sessions`);
    expect(revoked.json()).toMatchObject({ ok: true, passkeysRemoved: 1 });
    expect((await viaPasskey.get('/api/boards')).statusCode).toBe(401);
    expect((await signIn(new Client(ctx.app), key, dana.id)).statusCode).toBe(401);

    // deactivated account: a valid passkey does not sign in
    const noa = await createUser(ctx, 'noa@x.org', 'member');
    const c = new Client(ctx.app);
    await c.login('noa@x.org');
    const k2 = new SoftAuthenticator();
    expect((await enrol(c, k2)).statusCode).toBe(200);
    ctx.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(noa.id);
    expect((await signIn(new Client(ctx.app), k2, noa.id)).statusCode).toBe(401);
  });

  it('is switched off together with local sign-in when SSO is enforced', async () => {
    ctx = await setup({ LOCAL_LOGIN: 'admins_only', OIDC_ISSUER: 'https://idp.example', OIDC_CLIENT_ID: 'suboard', OIDC_CLIENT_SECRET: 'not-a-real-secret-for-tests', PUBLIC_URL: ORIGIN });
    const noa = await createUser(ctx, 'noa@x.org', 'member');
    const key = new SoftAuthenticator();
    const o = await ctx.app.services.passkeys.registrationOptions({ id: noa.id, email: noa.email, name: noa.name, authSource: 'sso' }, undefined, '127.0.0.1');
    await ctx.app.services.passkeys.register(noa.id, o.challengeId, 'מפתח', key.create(o.options.challenge) as never, { ip: '127.0.0.1' });
    const res = await signIn(new Client(ctx.app), key, noa.id);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('USE_SSO');
  });
});
