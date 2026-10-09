// Runs API (:4000) and Vite UI (:5173) together. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const run = (name, script) => {
  const p = spawn('npm', ['run', script], { stdio: 'inherit', shell: true });
  p.on('exit', (code) => { console.log(`[${name}] exited (${code})`); stop(); });
  return p;
};
const procs = [run('api', 'dev:server'), run('ui', 'dev:client')];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  procs.forEach((p) => { try { p.kill(); } catch {} });
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
