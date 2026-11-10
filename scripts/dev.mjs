// Cross-platform dev launcher: runs the API and the web dev server together (Windows/macOS/Linux).
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  ['server', ['run', 'dev', '-w', '@suboard/server']],
  ['web', ['run', 'dev', '-w', '@suboard/web']],
].map(([name, args]) => {
  const p = spawn(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    for (const other of procs) if (other !== p && !other.killed) other.kill();
    process.exitCode = code ?? 0;
  });
  return p;
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => procs.forEach((p) => p.kill(sig)));
