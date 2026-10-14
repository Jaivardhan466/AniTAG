import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const children = [
  spawn(process.execPath, [join(root, 'api/server.js')], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '0.0.0.0', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' }),
];
let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
for (const child of children) {
  child.on('error', (error) => {
    console.error('Could not start AniTAG services:', error.message);
    stop();
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    if (!stopping && code !== 0) {
      process.exitCode = code || 1;
      stop();
    }
  });
}
