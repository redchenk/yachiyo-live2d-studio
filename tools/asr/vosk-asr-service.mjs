import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const DEFAULT_PORT = 3301;
const MAX_JSON_BYTES = 48 * 1024 * 1024;
const DEFAULT_SAMPLE_RATE = 16000;

const args = parseArgs(process.argv.slice(2));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(args['repo-root'] || process.env.YACHIYO_REPO_ROOT || path.join(scriptDir, '..', '..'));
const port = clampInt(args.port, DEFAULT_PORT, 1, 65535);
const modelCache = new Map();

let voskModule = null;

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i] || '';
    if (!value.startsWith('--')) continue;
    const eq = value.indexOf('=');
    if (eq >= 0) {
      result[value.slice(2, eq)] = value.slice(eq + 1);
      continue;
    }
    const key = value.slice(2);
    result[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return result;
}

function clampInt(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.round(numeric), min), max);
}

function jsonResponse(response, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    Connection: 'close'
  });
  response.end(payload);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_JSON_BYTES) {
        reject(new Error('ASR request is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function loadVosk() {
  if (voskModule) return voskModule;
  try {
    voskModule = require('vosk');
    voskModule.setLogLevel?.(-1);
    return voskModule;
  } catch (error) {
    throw new Error(`Vosk package is not installed. Run npm install in the project root. ${error.message}`);
  }
}

function resolveModelPath(modelPath) {
  const raw = String(modelPath || '').trim();
  const candidate = raw
    ? (path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw))
    : path.resolve(repoRoot, 'models', 'vosk', 'vosk-model-small-cn-0.22');
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`Vosk model directory not found: ${candidate}. Run npm run install:vosk-model, or set Settings -> ASR -> Model Path to an installed Vosk model directory.`);
  }
  return candidate;
}

function getModel(modelPath) {
  const resolved = resolveModelPath(modelPath);
  if (modelCache.has(resolved)) return modelCache.get(resolved);
  const vosk = loadVosk();
  const model = new vosk.Model(resolved);
  modelCache.set(resolved, model);
  return model;
}

function readAscii(buffer, offset, length) {
  return buffer.slice(offset, offset + length).toString('ascii');
}

function parseWav(buffer) {
  if (buffer.length < 44 || readAscii(buffer, 0, 4) !== 'RIFF' || readAscii(buffer, 8, 4) !== 'WAVE') {
    return null;
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = DEFAULT_SAMPLE_RATE;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = readAscii(buffer, offset, 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (chunkId === 'fmt ') {
      audioFormat = buffer.readUInt16LE(offset);
      channels = buffer.readUInt16LE(offset + 2);
      sampleRate = buffer.readUInt32LE(offset + 4);
      bitsPerSample = buffer.readUInt16LE(offset + 14);
    } else if (chunkId === 'data') {
      dataStart = offset;
      dataSize = Math.min(chunkSize, buffer.length - offset);
      break;
    }
    offset += chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16 || dataStart < 0) {
    throw new Error('Vosk ASR expects mono 16-bit PCM WAV audio.');
  }

  return {
    sampleRate,
    pcm: buffer.slice(dataStart, dataStart + dataSize)
  };
}

function normalizeVoskResult(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_) {
      return { text: value };
    }
  }
  return value;
}

async function recognize(input) {
  const audioBase64 = String(input.audioBase64 || '').trim();
  if (!audioBase64) throw new Error('audioBase64 is required.');
  const model = getModel(input.modelPath);
  const audio = Buffer.from(audioBase64, 'base64');
  const wav = parseWav(audio);
  const sampleRate = clampInt(wav?.sampleRate || input.sampleRate, DEFAULT_SAMPLE_RATE, 8000, 48000);
  const pcm = wav?.pcm || audio;
  if (!pcm.length) throw new Error('Audio payload is empty.');

  const vosk = loadVosk();
  const recognizer = new vosk.Recognizer({ model, sampleRate });
  try {
    if (input.words && typeof recognizer.setWords === 'function') {
      recognizer.setWords(true);
    }
    const maxAlternatives = clampInt(input.maxAlternatives, 0, 0, 10);
    if (maxAlternatives > 0 && typeof recognizer.setMaxAlternatives === 'function') {
      recognizer.setMaxAlternatives(maxAlternatives);
    }
    recognizer.acceptWaveform(pcm);
    const result = normalizeVoskResult(recognizer.finalResult());
    const alternatives = Array.isArray(result.alternatives)
      ? result.alternatives
          .filter((item) => String(item?.text || '').trim())
          .sort((left, right) => Number(right?.confidence) - Number(left?.confidence))
      : [];
    return {
      text: String(alternatives[0]?.text || result.text || '').trim(),
      result,
      sampleRate,
      modelPath: resolveModelPath(input.modelPath)
    };
  } finally {
    recognizer.free?.();
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  if (request.method === 'GET' && url.pathname === '/healthz') {
    jsonResponse(response, 200, { ok: true, service: 'vosk-asr' });
    return;
  }
  if (request.method !== 'POST' || url.pathname !== '/api/asr') {
    jsonResponse(response, 404, { success: false, error: 'Not Found' });
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const input = rawBody ? JSON.parse(rawBody) : {};
    const data = await recognize(input);
    jsonResponse(response, 200, { success: true, data });
  } catch (error) {
    jsonResponse(response, 500, { success: false, error: error.message || 'ASR failed' });
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Yachiyo Vosk ASR service listening on http://127.0.0.1:${port}\n`);
});

function shutdown() {
  for (const model of modelCache.values()) {
    model.free?.();
  }
  modelCache.clear();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
