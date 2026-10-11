import path from 'node:path';

export function createServiceManager({ moduleRoot, resourceRoot, dataDir, fork, log = () => {} }) {
  const entries = new Map();
  let closing = false;
  const scripts = { memory: 'tools/memory/memory-data-service.mjs', minecraft: 'tools/minecraft/minecraft-agent-service.mjs' };
  async function ensure(name) {
    if (closing) throw new Error('Studio is shutting down');
    if (entries.has(name)) return entries.get(name).ready;
    if (!scripts[name]) throw new Error('Unknown bundled service');
    const child = fork(path.join(moduleRoot, scripts[name]), ['--port', '0', '--repo-root', resourceRoot, '--parent-pid', String(process.pid)], {
      cwd: dataDir,
      env: { ...process.env, YACHIYO_DATA_DIR: dataDir, YACHIYO_REPO_ROOT: resourceRoot, YACHIYO_SQLITE_DRIVER: 'node', YACHIYO_MEMORY_AUTOSTART_MANAGED_MILVUS: '0' },
      stdio: 'pipe', serviceName: `Yachiyo ${name}`
    });
    const entry = { child, port: 0, ready: null };
    entry.ready = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { reject(new Error(`${name} failed to start within 30 seconds`)); child.kill(); }, 30_000);
      child.stdout?.on('data', chunk => log(`${name}: ${chunk}`));
      child.stderr?.on('data', chunk => log(`${name}: ${chunk}`));
      child.on('message', message => {
        if (message?.type !== 'ready' || settled) return;
        settled = true; clearTimeout(timer);
        if (message.ready === false) { reject(new Error(`${name}: ${message.error}`)); child.kill(); return; }
        entry.port = message.port;
        resolve(`http://127.0.0.1:${message.port}`);
      });
      child.once('error', error => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(`${name} process error`)); });
      child.once('exit', code => {
        clearTimeout(timer); entries.delete(name);
        if (!settled) reject(new Error(`${name} exited before becoming ready (${code})`));
        else if (!closing) log(`${name} exited (${code}); the next request will restart it`);
      });
    });
    entries.set(name, entry);
    return entry.ready;
  }
  async function close() {
    closing = true;
    await Promise.allSettled([...entries].map(async ([name, entry]) => {
      const exited = new Promise(resolve => entry.child.once('exit', resolve));
      if (entry.port) {
        await fetch(`http://127.0.0.1:${entry.port}/api/${name}/shutdown`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"stopMilvus":false}', signal: AbortSignal.timeout(2000)
        }).catch(() => {});
      }
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2500))]);
      entry.child.kill();
    }));
    entries.clear();
  }
  return { ensure, close };
}
