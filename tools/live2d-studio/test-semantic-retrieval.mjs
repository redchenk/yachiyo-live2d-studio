import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-semantic-'));
const corpus = path.join(temp, 'long-corpus.txt');
fs.writeFileSync(corpus, 'plain unrelated background. '.repeat(700) + '\n樱花约定的准确时间是周六下午三点，地点是湖畔。');
let calls = 0;
const api = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const input = JSON.parse(body); calls++;
  assert.equal(req.headers.authorization, undefined, 'local embeddings may omit authentication');
  const vector = Array(input.model === 'bad-dimension' ? 33 : 32).fill(0);
  vector[/松饼|パンケーキ/.test(input.input) ? 0 : /樱花|湖畔/.test(input.input) ? 1 : 2] = 1;
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ embedding: vector }] }));
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const service = spawn(process.execPath, [path.join(root, 'tools/memory/memory-data-service.mjs'), '--port', '0', '--repo-root', temp], {
  env: { ...process.env, YACHIYO_SQLITE_DRIVER: 'node', YACHIYO_DATA_DIR: temp, YACHIYO_MEMORY_AUTOSTART_MANAGED_MILVUS: '0' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
});
let errorText = ''; service.stderr.on('data', chunk => { errorText += chunk; });
const base = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(errorText || 'service timeout')), 10000);
  service.on('message', msg => { if (msg.type === 'ready') { clearTimeout(timeout); resolve(`http://127.0.0.1:${msg.port}`); } });
  service.once('exit', code => { clearTimeout(timeout); reject(new Error(`service exit ${code}: ${errorText}`)); });
});
const settings = { provider: 'sqlite', databasePath: path.join(temp, 'memory.sqlite'), personaCorpusPath: corpus, embeddingApiUrl: `http://127.0.0.1:${api.address().port}/embeddings`, embeddingModel: 'semantic-fixture', embeddingDimension: 32, retrievalMode: 'hybrid', maxNotesPerTurn: 8 };
async function post(route, body) {
  const response = await fetch(`${base}/api/memory/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...settings, ...body }) });
  const result = await response.json(); assert.equal(result.success, true, JSON.stringify(result)); return result;
}
try {
  await post('init');
  await post('write', { memory: { type: 'session', title: '早餐愿望', text: '八千代想吃热松饼。', importance: .8, confidence: .9 } });
  const query = { text: 'パンケーキ', excludeLegacyPersona: true };
  const recall = await post('search', { query });
  assert.ok(recall.notes.some(note => /松饼/.test(note.summary || note.content)), 'semantic fixture must retrieve across Japanese and Chinese without shared keywords');
  assert.equal(recall.vectorHealth.degraded, false);
  const before = calls;
  await post('search', { query });
  assert.equal(calls, before, 'repeated queries and unchanged vectors use the embedding cache');
  const tail = await post('search', { query: { text: '樱花约定的时间' } });
  assert.ok(tail.notes.some(note => /周六下午三点/.test(note.content || note.summary)), 'a huge unbroken paragraph must not hide the tail of an imported document');
  const degraded = await post('search', { embeddingModel: 'bad-dimension', query: { text: 'dimension mismatch' } });
  assert.equal(degraded.vectorHealth.degraded, true, 'dimension mismatches must fall back rather than fold unrelated vector coordinates');
  assert.match(degraded.vectorHealth.signature, /fallback$/);
  console.log('Semantic cross-language fixture, long-document chunking, cache and strict vector dimension checks passed');
} finally {
  await fetch(`${base}/api/memory/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"stopMilvus":false}' }).catch(() => {});
  service.kill(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); fs.rmSync(temp, { recursive: true, force: true });
}
