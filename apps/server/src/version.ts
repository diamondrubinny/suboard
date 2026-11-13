import { readFileSync } from 'node:fs';

/** The running version, read once from the server's package.json (next to `src/` and `dist/`). */
function read(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
export const APP_VERSION = read();
