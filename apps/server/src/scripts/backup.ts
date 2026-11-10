/**
 * Online, consistent SQLite backup (safe while the server is running — uses SQLite's backup API).
 *   npm run backup -w @suboard/server -- --out /secure/backups
 * Keeps the newest N files (default 14). Store backups encrypted and off-host.
 */
import Database from 'better-sqlite3';
import { chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, keep: { type: 'string' } } });
  const config = loadConfig();
  const outDir = resolve(values.out ?? './backups');
  const keep = Math.max(1, Number(values.keep ?? 14));
  mkdirSync(outDir, { recursive: true, mode: 0o700 });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(outDir, `suboard-${stamp}.db`);
  const db = new Database(config.databasePath, { readonly: true, fileMustExist: true });
  await db.backup(target);
  db.close();

  // Make the copy a single self-contained file (no -wal/-shm) and owner-readable only.
  const copy = new Database(target);
  copy.pragma('journal_mode = DELETE');
  const result = copy.pragma('integrity_check', { simple: true });
  copy.close();
  chmodSync(target, 0o600);
  if (result !== 'ok') throw new Error(`Backup integrity check failed: ${String(result)}`);

  const old = readdirSync(outDir)
    .filter((f) => /^suboard-.*\.db$/.test(f))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) rmSync(join(outDir, f));
  console.log(`Backup written: ${target} (integrity ok, pruned ${old.length})`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
