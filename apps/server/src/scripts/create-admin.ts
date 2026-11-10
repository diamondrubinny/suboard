/**
 * Creates (or resets) an administrator account from the command line.
 * The password is read interactively (not echoed) or from stdin — never from argv,
 * so it does not end up in shell history or process listings.
 *
 *   npm run create-admin -- --email admin@example.org --name "מנהל מערכת"
 *
 * Break-glass for a locked-out administrator (lost MFA device and recovery codes), requires shell
 * access to the server; the action is written to the security audit log:
 *   npm run create-admin -- --email admin@example.org --reset-mfa
 */
import { createUserSchema, emailSchema, passwordSchema } from '@suboard/shared';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { createServices } from '../services/index.js';

async function readPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
  }
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, 'reset-mfa': { type: 'boolean' } } });
  const email = emailSchema.parse(values.email ?? '');
  const name = values.name?.trim() || 'מנהל מערכת';

  if (values['reset-mfa']) {
    const config = loadConfig();
    const db = openDatabase(config.databasePath);
    const services = createServices(db, config, { mailer: null, scanner: null });
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`No user with e-mail ${email}`);
    services.mfa.clear(user.id);
    services.auth.revokeAllSessions(user.id);
    services.audit.log('mfa_reset', { userId: null, meta: { targetUserId: user.id, via: 'cli' } });
    console.log(`MFA reset for ${email}. The user must enrol again at next sign-in.`);
    db.close();
    return;
  }

  const password = await readPassword('Password (min 12 chars): ');
  passwordSchema.parse(password);

  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const services = createServices(db, config, { mailer: null, scanner: null });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
  if (existing) {
    const actor = { id: existing.id, name, role: 'admin' as const };
    db.prepare("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?").run(existing.id);
    await services.users.update(actor, existing.id, { password, unlock: true });
    db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(existing.id);
    console.log(`Existing user ${email} promoted to admin and password reset.`);
  } else {
    await services.users.create(null, createUserSchema.parse({ email, name, role: 'admin', password }), { mustChangePassword: false });
    console.log(`Administrator ${email} created.`);
  }
  db.close();
}

main().catch((err) => {
  console.error(err?.issues?.map((i: { message: string }) => i.message).join('; ') ?? err?.message ?? err);
  process.exit(1);
});
