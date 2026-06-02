import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const port = Number(argValue('port', process.env.PORT || '3302')) || 3302;
const host = argValue('host', process.env.HOST || '127.0.0.1') || '127.0.0.1';
const repoRoot = argValue('repo-root', process.env.YACHIYO_REPO_ROOT || process.cwd());
const apiPackagePath = require.resolve('@neteasecloudmusicapienhanced/api/package.json', {
  paths: [repoRoot, path.dirname(fileURLToPath(import.meta.url))]
});
const apiRoot = path.dirname(apiPackagePath);

process.env.PORT = String(port);
process.env.HOST = host;
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.YACHIYO_REPO_ROOT = repoRoot;
process.env.CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';

const generateConfig = require(path.join(apiRoot, 'generateConfig.js'));
const { serveNcmApi } = require(path.join(apiRoot, 'server.js'));

let app = null;

async function main() {
  await generateConfig();
  app = await serveNcmApi({
    port,
    host,
    checkVersion: false
  });
  app.get('/healthz', (_request, response) => {
    response.json({
      ok: true,
      provider: 'netease-cloud',
      managed: true,
      port
    });
  });
}

function shutdown() {
  const server = app?.server;
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  process.stderr.write(`Managed NetEase Cloud Music API failed: ${error?.stack || error}\n`);
  process.exit(1);
});
