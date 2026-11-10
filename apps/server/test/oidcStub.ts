import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

/** Claims a test wants in the next ID token; travels inside the authorization code. */
export interface StubIdentity {
  sub: string;
  email?: string;
  name?: string;
  amr?: string[];
  oid?: string;
  /** Overrides (to test validation): a wrong nonce / audience / issuer. */
  nonce?: string;
  aud?: string;
  iss?: string;
}

/**
 * A minimal OpenID Provider for tests: discovery, JWKS, and a token endpoint that verifies PKCE and
 * issues RS256-signed ID tokens. The "authorization code" is the base64url JSON of the identity plus
 * the nonce / code_challenge copied from the authorization request.
 */
export async function startOidcStub(clientId: string, clientSecret: string): Promise<{ issuer: string; close: () => Promise<void>; code: (id: StubIdentity, authorizeUrl: string) => string }> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  let issuer = '';
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', async () => {
        const form = new URLSearchParams(raw);
        const basic = req.headers.authorization?.startsWith('Basic ') ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString() : '';
        const [cid, csec] = basic ? basic.split(':').map(decodeURIComponent) : [form.get('client_id'), form.get('client_secret')];
        if (cid !== clientId || csec !== clientSecret) return json(401, { error: 'invalid_client' });
        let payload: StubIdentity & { challenge: string; reqNonce: string };
        try {
          payload = JSON.parse(Buffer.from(form.get('code') ?? '', 'base64url').toString());
        } catch {
          return json(400, { error: 'invalid_grant' });
        }
        const verifier = form.get('code_verifier') ?? '';
        if (createHash('sha256').update(verifier).digest('base64url') !== payload.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
        const now = Math.floor(Date.now() / 1000);
        const idToken = await new SignJWT({
          ...(payload.email ? { email: payload.email } : {}),
          ...(payload.name ? { name: payload.name } : {}),
          ...(payload.amr ? { amr: payload.amr } : {}),
          ...(payload.oid ? { oid: payload.oid } : {}),
          nonce: payload.nonce ?? payload.reqNonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(payload.iss ?? issuer)
          .setAudience(payload.aud ?? clientId)
          .setSubject(payload.sub)
          .setIssuedAt(now)
          .setExpirationTime(now + 300)
          .sign(privateKey);
        json(200, { access_token: 'stub-access', token_type: 'Bearer', expires_in: 300, id_token: idToken });
      });
      return;
    }
    json(404, { error: 'not_found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer,
    close: () => new Promise((r) => server.close(() => r())),
    code: (id, authorizeUrl) => {
      const q = new URL(authorizeUrl).searchParams;
      return Buffer.from(JSON.stringify({ ...id, challenge: q.get('code_challenge'), reqNonce: q.get('nonce') })).toString('base64url');
    },
  };
}
