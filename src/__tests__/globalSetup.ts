/** Integration tests always run on a fresh database and OS-assigned loopback port. */
import { spawn, type ChildProcess, execFileSync } from 'child_process';
import { resolve, join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

let server: ChildProcess | null = null;
export async function setup() {
  const cwd = process.cwd();
  const dbPath = join(mkdtempSync(join(tmpdir(), 'ajaba-api-test-')), 'test.db');
  const env = { ...process.env, AJABA_DB_PATH: dbPath, PORT: '0', HOST: '127.0.0.1', NODE_ENV: 'test', AJABA_DISABLE_SCHEDULER: '1' };
  execFileSync(process.execPath, [resolve(cwd, 'node_modules/typescript/bin/tsc')], { cwd, stdio: 'pipe', timeout: 30_000 });
  execFileSync(process.execPath, [resolve(cwd, 'dist/db/migrate.js')], { cwd, env, stdio: 'pipe' });
  execFileSync(process.execPath, [resolve(cwd, 'dist/db/seed.js')], { cwd, env, stdio: 'pipe' });
  await new Promise<void>((done, reject) => {
    server = spawn(process.execPath, [resolve(cwd, 'dist/server.js')], { cwd, env, stdio: 'pipe', windowsHide: true });
    const timeout = setTimeout(() => { server?.kill(); reject(new Error('Isolated test server failed to start.')); }, 10_000);
    let log = '';
    const onData = (data: Buffer) => {
      log += data.toString();
      const match = log.match(/Ajaba Server running on http:\/\/localhost:(\d+)/);
      if (match) { process.env.AJABA_TEST_URL = `http://127.0.0.1:${match[1]}`; clearTimeout(timeout); done(); }
    };
    server.stdout?.on('data', onData); server.stderr?.on('data', onData);
    server.on('error', error => { clearTimeout(timeout); reject(error); });
    server.on('exit', code => { clearTimeout(timeout); if (!process.env.AJABA_TEST_URL) reject(new Error(`Isolated server exited (${code}): ${log}`)); });
  });
}
export async function teardown() { server?.kill('SIGTERM'); server = null; }
