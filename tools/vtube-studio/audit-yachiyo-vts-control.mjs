import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { URL } from 'node:url';
import { yachiyoVTubeStudioParameterSettings } from '../../src/frontend/constants/room/yachiyoModelParameterRegistry.js';

const DEFAULT_MODEL_DIR = path.resolve('models/tsukimi-yachiyo');
const DEFAULT_CDI = path.join(DEFAULT_MODEL_DIR, 'tsukimi-yachiyo.cdi3.json');
const DEFAULT_VTUBE = path.join(DEFAULT_MODEL_DIR, 'tsukimi-yachiyo.vtube.json');
const DEFAULT_VTS_URL = 'ws://127.0.0.1:8001';
const DEFAULT_PLUGIN_NAME = 'Yachiyo Live2D Studio';
const DEFAULT_PLUGIN_DEVELOPER = 'redchenk';
const API_NAME = 'VTubeStudioPublicAPI';
const API_VERSION = '1.0';

function readArgs(argv) {
  const args = {
    cdi: DEFAULT_CDI,
    vtube: DEFAULT_VTUBE,
    url: DEFAULT_VTS_URL,
    probe: false,
    ensureInputs: false,
    deleteInputs: false,
    pluginName: DEFAULT_PLUGIN_NAME,
    pluginDeveloper: DEFAULT_PLUGIN_DEVELOPER,
    token: process.env.VTS_AUTH_TOKEN || '',
    write: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--cdi') args.cdi = path.resolve(next());
    else if (arg === '--vtube') args.vtube = path.resolve(next());
    else if (arg === '--url') args.url = next() || DEFAULT_VTS_URL;
    else if (arg === '--probe') args.probe = true;
    else if (arg === '--ensure-inputs') {
      args.probe = true;
      args.ensureInputs = true;
    }
    else if (arg === '--delete-inputs') {
      args.probe = true;
      args.deleteInputs = true;
    }
    else if (arg === '--token') args.token = next();
    else if (arg === '--plugin-name') args.pluginName = next() || DEFAULT_PLUGIN_NAME;
    else if (arg === '--plugin-developer') args.pluginDeveloper = next() || DEFAULT_PLUGIN_DEVELOPER;
    else if (arg === '--write') args.write = path.resolve(next());
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  npm run audit:yachiyo-vts-control',
    '  node tools/vtube-studio/audit-yachiyo-vts-control.mjs --probe --url ws://127.0.0.1:8001',
    '',
    'Options:',
    '  --cdi <path>       Live2D display-info file. Defaults to project model cdi3.',
    '  --vtube <path>     VTube Studio model config. Defaults to project vtube.json.',
    '  --probe            Also query a running VTube Studio Public API.',
    '  --ensure-inputs    Ensure Yachiyo custom input parameters exist in VTS, then audit.',
    '  --delete-inputs    Delete Yachiyo custom inputs owned by the selected plugin, then audit.',
    '  --plugin-name      VTS plugin name. Defaults to the app plugin identity.',
    '  --plugin-developer VTS plugin developer. Defaults to the app plugin identity.',
    '  --token <token>    Existing VTS auth token. Can also use VTS_AUTH_TOKEN.',
    '  --write <path>     Write the markdown report.'
  ].join('\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function idOf(item) {
  return String(item?.Id || item?.id || item?.name || '').trim();
}

function ownerOf(item) {
  return String(
    item?.addedBy ||
    item?.AddedBy ||
    item?.pluginName ||
    item?.PluginName ||
    item?.createdBy ||
    item?.CreatedBy ||
    item?.owner ||
    item?.Owner ||
    ''
  ).trim();
}

function extractInputParameters(response) {
  return Array.isArray(response?.data?.defaultParameters)
    ? [...response.data.defaultParameters, ...(response.data.customParameters || [])]
    : [];
}

function extractCdiParameters(cdi) {
  const parameters = Array.isArray(cdi?.Parameters) ? cdi.Parameters : [];
  return parameters
    .map((item) => ({
      id: String(item.Id || '').trim(),
      groupId: String(item.GroupId || '').trim(),
      name: String(item.Name || '').trim()
    }))
    .filter((item) => item.id);
}

function extractVtubeSettings(vtube) {
  return (Array.isArray(vtube?.ParameterSettings) ? vtube.ParameterSettings : [])
    .map((item) => ({
      folder: String(item.Folder || ''),
      name: String(item.Name || ''),
      input: String(item.Input || ''),
      outputLive2D: String(item.OutputLive2D || ''),
      smoothing: item.Smoothing,
      useBlinking: Boolean(item.UseBlinking),
      useBreathing: Boolean(item.UseBreathing)
    }))
    .filter((item) => item.outputLive2D);
}

function byCount(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function groupDesiredSettings(settings) {
  const groups = new Map();
  for (const setting of settings) {
    const key = setting.domain || 'uncategorized';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(setting);
  }
  return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}

function renderTable(headers, rows) {
  if (!rows.length) return '_None._';
  const header = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map((cell) => String(cell ?? '').replace(/\|/g, '\\|')).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

function localAudit(args) {
  const cdi = readJson(args.cdi);
  const vtube = readJson(args.vtube);
  const cdiParameters = extractCdiParameters(cdi);
  const cdiIds = new Set(cdiParameters.map((item) => item.id));
  const vtubeSettings = extractVtubeSettings(vtube);
  const vtubeMappingKeys = new Set(vtubeSettings.map((item) => `${item.input}=>${item.outputLive2D}`));
  const desiredSettings = yachiyoVTubeStudioParameterSettings();
  const desiredKeys = new Set(desiredSettings.map((item) => `${item.input}=>${item.outputLive2D}`));
  const yachiyoSettings = vtubeSettings.filter((item) => item.folder === 'Yachiyo Direct Control');

  return {
    args,
    cdiParameters,
    cdiGroups: byCount(cdiParameters, (item) => item.groupId),
    vtubeSettings,
    yachiyoSettings,
    desiredSettings,
    desiredGroups: groupDesiredSettings(desiredSettings),
    missingLive2DOutputs: desiredSettings.filter((item) => !cdiIds.has(item.outputLive2D)),
    missingVtubeMappings: desiredSettings.filter((item) => !vtubeMappingKeys.has(`${item.input}=>${item.outputLive2D}`)),
    staleYachiyoMappings: yachiyoSettings.filter((item) => !desiredKeys.has(`${item.input}=>${item.outputLive2D}`)),
    duplicateVtubeOutputs: byCount(vtubeSettings, (item) => item.outputLive2D).filter(([, count]) => count > 1),
    riskyDirectExpressionMappings: desiredSettings.filter((item) => (
      item.outputLive2D.startsWith('ParamExpression_') ||
      item.outputLive2D.startsWith('ParamHide_') ||
      item.outputLive2D.startsWith('ParamHighLightHide_') ||
      item.outputLive2D === 'ParamEyeLOpen' ||
      item.outputLive2D === 'ParamEyeROpen'
    ))
  };
}

function websocketAccept(key) {
  return crypto.createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = crypto.randomBytes(4);
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = 0x80 | length;
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = Boolean(first & 0x80);
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    if (masked) cursor += 4;
    if (buffer.length - cursor < length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }
    if (opcode === 1 || opcode === 0) frames.push({ fin, opcode, text: payload.toString('utf8') });
    offset = cursor + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function createVtsClient(rawUrl) {
  const url = new URL(rawUrl || DEFAULT_VTS_URL);
  const host = url.hostname === '0.0.0.0' ? '127.0.0.1' : url.hostname;
  const port = Number(url.port || 8001);
  const resource = `${url.pathname || '/'}${url.search || ''}`;
  let socket = null;
  let buffer = Buffer.alloc(0);
  let fragmentedText = '';
  let requestCounter = 0;
  const pending = new Map();

  function request(messageType, data = undefined, timeoutMs = 12000) {
    requestCounter += 1;
    const requestID = `audit-${Date.now().toString(36)}-${requestCounter}`;
    const payload = {
      apiName: API_NAME,
      apiVersion: API_VERSION,
      requestID,
      messageType,
      ...(data === undefined ? {} : { data })
    };
    socket.write(encodeFrame(JSON.stringify(payload)));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestID);
        reject(new Error(`${messageType} timed out`));
      }, timeoutMs);
      pending.set(requestID, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  function close() {
    if (socket) socket.destroy();
    socket = null;
  }

  async function connect() {
    const key = crypto.randomBytes(16).toString('base64');
    const expectedAccept = websocketAccept(key);
    socket = net.createConnection({ host, port });

    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.write([
          `GET ${resource || '/'} HTTP/1.1`,
          `Host: ${host}:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '',
          ''
        ].join('\r\n'));
      });
      let handshake = Buffer.alloc(0);
      socket.on('data', function onHandshakeData(chunk) {
        handshake = Buffer.concat([handshake, chunk]);
        const text = handshake.toString('utf8');
        const splitAt = text.indexOf('\r\n\r\n');
        if (splitAt < 0) return;
        socket.off('data', onHandshakeData);
        const headerText = text.slice(0, splitAt);
        const accepted = /101 Switching Protocols/i.test(headerText) && headerText.includes(expectedAccept);
        if (!accepted) {
          reject(new Error(`WebSocket handshake failed: ${headerText.split('\r\n')[0] || 'no response'}`));
          return;
        }
        const remaining = handshake.subarray(Buffer.byteLength(text.slice(0, splitAt + 4)));
        if (remaining.length) handleData(remaining);
        resolve();
      });
    });

    socket.on('data', handleData);
    socket.on('error', (error) => {
      for (const item of pending.values()) item.reject(error);
      pending.clear();
    });
  }

  function handleData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    const decoded = decodeFrames(buffer);
    buffer = decoded.rest;
    for (const frame of decoded.frames) {
      let message = frame.text;
      if (frame.opcode === 1 && !frame.fin) {
        fragmentedText = message;
        continue;
      }
      if (frame.opcode === 0) {
        fragmentedText += message;
        if (!frame.fin) continue;
        message = fragmentedText;
        fragmentedText = '';
      }
      const payload = JSON.parse(message);
      const item = pending.get(payload.requestID);
      if (!item) continue;
      pending.delete(payload.requestID);
      if (payload.messageType === 'APIError') item.reject(new Error(payload.data?.message || 'VTS API error'));
      else item.resolve(payload);
    }
  }

  return { connect, request, close };
}

async function probeVts(args, local) {
  const client = createVtsClient(args.url);
  await client.connect();
  try {
    const state = await client.request('APIStateRequest');
    if (!state?.data?.currentSessionAuthenticated) {
      const token = args.token || String((await client.request('AuthenticationTokenRequest', {
        pluginName: args.pluginName,
        pluginDeveloper: args.pluginDeveloper
      }, 60000))?.data?.authenticationToken || '');
      if (!token) throw new Error('VTube Studio did not return an authentication token.');
      const auth = await client.request('AuthenticationRequest', {
        pluginName: args.pluginName,
        pluginDeveloper: args.pluginDeveloper,
        authenticationToken: token
      });
      if (!auth?.data?.authenticated) throw new Error(auth?.data?.reason || 'VTube Studio authentication failed.');
    }

    let initialInputs = await client.request('InputParameterListRequest').catch((error) => ({ error: error.message }));
    let initialInputParams = extractInputParameters(initialInputs);
    let initialInputIds = new Set(initialInputParams.map(idOf).filter(Boolean));

    const deletedInputs = [];
    const deletionSkipped = [];
    const deletionErrors = [];
    if (args.deleteInputs) {
      for (const item of local.desiredSettings.filter((setting) => setting.createInput !== false)) {
        await client.request('ParameterDeletionRequest', {
          parameterName: item.input
        }).then(() => {
          deletedInputs.push(item.input);
        }).catch((error) => {
          const message = String(error?.message || '');
          if (/not found|does not exist|different plugin|other plugin|not created/i.test(message)) {
            deletionSkipped.push(item.input);
            return;
          }
          deletionErrors.push(`${item.input}: ${error.message || error}`);
        });
      }
      initialInputs = await client.request('InputParameterListRequest').catch((error) => ({ error: error.message }));
      initialInputParams = extractInputParameters(initialInputs);
      initialInputIds = new Set(initialInputParams.map(idOf).filter(Boolean));
    }

    const ensuredInputs = [];
    const ensureErrors = [];
    const ownedByOtherPlugin = [];
    if (args.ensureInputs) {
      const missingInputs = local.desiredSettings
        .filter((setting) => setting.createInput !== false)
        .filter((setting) => !initialInputIds.has(setting.input));
      for (const item of missingInputs) {
        await client.request('ParameterCreationRequest', {
          parameterName: item.input,
          explanation: `Yachiyo model input for ${item.outputLive2D}`,
          min: item.min,
          max: item.max,
          defaultValue: item.defaultValue
        }).then(() => {
          ensuredInputs.push(item.input);
        }).catch((error) => {
          const message = String(error?.message || '');
          if (/another plugin/i.test(message)) {
            ownedByOtherPlugin.push(item.input);
            return;
          }
          if (/already exists|already created|exists|duplicate|taken/i.test(message)) return;
          ensureErrors.push(`${item.input}: ${error.message || error}`);
        });
      }
    }

    const [currentModel, inputs, live2d, expressions, hotkeys] = await Promise.all([
      client.request('CurrentModelRequest').catch((error) => ({ error: error.message })),
      client.request('InputParameterListRequest').catch((error) => ({ error: error.message })),
      client.request('Live2DParameterListRequest').catch((error) => ({ error: error.message })),
      client.request('ExpressionStateRequest', { details: true }).catch((error) => ({ error: error.message })),
      client.request('HotkeysInCurrentModelRequest').catch((error) => ({ error: error.message }))
    ]);

    const live2dParams = Array.isArray(live2d?.data?.parameters) ? live2d.data.parameters : [];
    const live2dIds = new Set(live2dParams.map(idOf).filter(Boolean));
    const inputParams = extractInputParameters(inputs);
    const inputIds = new Set(inputParams.map(idOf).filter(Boolean));
    const customInputParams = Array.isArray(inputs?.data?.customParameters) ? inputs.data.customParameters : [];
    const customInputById = new Map(customInputParams.map((item) => [idOf(item), item]).filter(([id]) => id));
    const desiredInputOwners = local.desiredSettings
      .map((item) => ({
        input: item.input,
        outputLive2D: item.outputLive2D,
        domain: item.domain,
        owner: ownerOf(customInputById.get(item.input))
      }))
      .filter((item) => item.owner);
    const desiredInputOwnerGroups = byCount(desiredInputOwners, (item) => item.owner);

    return {
      currentModel,
      inputs,
      live2d,
      expressions,
      hotkeys,
      live2dCount: live2dParams.length,
      inputCount: inputParams.length,
      deletedInputs,
      deletionSkipped,
      deletionErrors,
      ensuredInputs,
      ensureErrors,
      ownedByOtherPlugin,
      desiredInputOwners,
      desiredInputOwnerGroups,
      missingLive2DOutputs: local.desiredSettings.filter((item) => !live2dIds.has(item.outputLive2D)),
      missingInputParameters: local.desiredSettings.filter((item) => !inputIds.has(item.input))
    };
  } finally {
    client.close();
  }
}

function renderReport(local, live = null, liveError = null) {
  const lines = [];
  lines.push('# Yachiyo VTube Studio Control Audit');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## VTS Control Contract');
  lines.push('');
  lines.push('VTube Studio separates controllable inputs from Live2D model outputs:');
  lines.push('');
  lines.push('- `InjectParameterDataRequest` writes VTS input parameters.');
  lines.push('- `ParameterCreationRequest` creates plugin-owned custom input parameters.');
  lines.push('- `.vtube.json` `ParameterSettings` maps each input parameter to one `OutputLive2D` parameter.');
  lines.push('- Expression files and `ExpressionActivationRequest` should own expression-only parameters.');
  lines.push('');
  lines.push('For this model, the app creates custom input parameters with the same names as selected Live2D outputs. The installer writes one-to-one mappings from those custom inputs to the model outputs, so the runtime bridge can drive upper-body, accessories, mouth detail, and eye detail without relying on opaque VTS tracking presets. `ParamExpression_*`, `ParamHide_*`, and direct eye-open outputs are intentionally excluded to avoid expression overlap bugs.');
  lines.push('');
  lines.push('## Local Model Files');
  lines.push('');
  lines.push(`- CDI: \`${local.args.cdi}\``);
  lines.push(`- VTube: \`${local.args.vtube}\``);
  lines.push(`- CDI parameters: ${local.cdiParameters.length}`);
  lines.push(`- VTS ParameterSettings: ${local.vtubeSettings.length}`);
  lines.push(`- Desired Yachiyo direct mappings: ${local.desiredSettings.length}`);
  lines.push(`- Installed Yachiyo mappings: ${local.yachiyoSettings.length}`);
  lines.push('');
  lines.push('## Desired Control Domains');
  lines.push('');
  lines.push(renderTable(
    ['Domain', 'Count', 'Examples'],
    local.desiredGroups.map(([domain, items]) => [domain, items.length, items.slice(0, 5).map((item) => item.outputLive2D).join(', ')])
  ));
  lines.push('');
  lines.push('## Missing From Local VTube Mapping');
  lines.push('');
  lines.push(renderTable(
    ['Input', 'OutputLive2D', 'Domain'],
    local.missingVtubeMappings.slice(0, 120).map((item) => [item.input, item.outputLive2D, item.domain])
  ));
  lines.push('');
  lines.push('## Missing From CDI');
  lines.push('');
  lines.push(renderTable(
    ['OutputLive2D', 'Domain'],
    local.missingLive2DOutputs.map((item) => [item.outputLive2D, item.domain])
  ));
  lines.push('');
  lines.push('## Stale Yachiyo Mappings');
  lines.push('');
  lines.push(renderTable(
    ['Input', 'OutputLive2D'],
    local.staleYachiyoMappings.map((item) => [item.input, item.outputLive2D])
  ));
  lines.push('');
  lines.push('## Safety Checks');
  lines.push('');
  lines.push(`- Direct expression/eye-open mappings in registry: ${local.riskyDirectExpressionMappings.length}`);
  lines.push('- Expression files should remain the owner of ParamExpression_* and eye-hide parameters to avoid overlapping eyes.');
  lines.push('- Direct registry focuses on upper-body, secondary eye/mouth detail, accessories, and physics helpers.');
  lines.push('');

  if (liveError) {
    lines.push('## Live VTS Probe');
    lines.push('');
    lines.push(`Probe failed: ${liveError.message || liveError}`);
    lines.push('');
  } else if (live) {
    lines.push('## Live VTS Probe');
    lines.push('');
    lines.push(`- Current model: ${live.currentModel?.data?.modelName || live.currentModel?.data?.modelID || 'unknown'}`);
    lines.push(`- VTS input parameters visible: ${live.inputCount}`);
    lines.push(`- VTS Live2D parameters visible: ${live.live2dCount}`);
    if (
      live.deletedInputs?.length ||
      live.deletionSkipped?.length ||
      live.deletionErrors?.length ||
      live.ensuredInputs?.length ||
      live.ensureErrors?.length ||
      live.ownedByOtherPlugin?.length
    ) {
      lines.push(`- Deleted custom inputs for selected plugin: ${live.deletedInputs?.length || 0}`);
      lines.push(`- Skipped deletes not owned by selected plugin: ${live.deletionSkipped?.length || 0}`);
      lines.push(`- Custom input deletion errors: ${live.deletionErrors?.length || 0}`);
      lines.push(`- Created missing custom inputs for selected plugin: ${live.ensuredInputs?.length || 0}`);
      lines.push(`- Existing custom inputs owned by another plugin: ${live.ownedByOtherPlugin?.length || 0}`);
      lines.push(`- Custom input creation errors: ${live.ensureErrors?.length || 0}`);
    }
    lines.push('');
    if (live.ownedByOtherPlugin?.length) {
      lines.push('### Custom Inputs Owned By Another Plugin');
      lines.push('');
      lines.push(renderTable(
        ['Input'],
        live.ownedByOtherPlugin.slice(0, 120).map((item) => [item])
      ));
      lines.push('');
    }
    if (live.desiredInputOwnerGroups?.length) {
      lines.push('### Desired Input Owner Groups');
      lines.push('');
      lines.push(renderTable(
        ['Owner', 'Count'],
        live.desiredInputOwnerGroups.map(([owner, count]) => [owner, count])
      ));
      lines.push('');
    }
    if (live.deletionErrors?.length) {
      lines.push('### Custom Input Deletion Errors');
      lines.push('');
      lines.push(live.deletionErrors.map((item) => `- ${item}`).join('\n'));
      lines.push('');
    }
    if (live.ensureErrors?.length) {
      lines.push('### Custom Input Creation Errors');
      lines.push('');
      lines.push(live.ensureErrors.map((item) => `- ${item}`).join('\n'));
      lines.push('');
    }
    lines.push('### Missing Live2D Outputs In Running VTS');
    lines.push('');
    lines.push(renderTable(
      ['OutputLive2D', 'Domain'],
      live.missingLive2DOutputs.slice(0, 80).map((item) => [item.outputLive2D, item.domain])
    ));
    lines.push('');
    lines.push('### Missing VTS Input Parameters In Running VTS');
    lines.push('');
    lines.push(renderTable(
      ['Input', 'OutputLive2D', 'Domain'],
      live.missingInputParameters.slice(0, 80).map((item) => [item.input, item.outputLive2D, item.domain])
    ));
    lines.push('');
  }

  lines.push('## Recommended Fix Flow');
  lines.push('');
  lines.push('1. Run `npm run install:yachiyo-vts-parameters -- <path-to-model.vtube.json>` for the exact model loaded in VTS.');
  lines.push('2. Restart or reload the model in VTube Studio.');
  lines.push('3. Start this app with VTS output enabled so the bridge creates custom inputs through `ParameterCreationRequest`.');
  lines.push('4. Re-run this audit with `--probe` and confirm missing mapping/input counts are zero or intentionally ignored.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const local = localAudit(args);
  let live = null;
  let liveError = null;
  if (args.probe) {
    try {
      live = await probeVts(args, local);
    } catch (error) {
      liveError = error;
    }
  }
  const report = renderReport(local, live, liveError);
  if (args.write) {
    fs.mkdirSync(path.dirname(args.write), { recursive: true });
    fs.writeFileSync(args.write, report, 'utf8');
  }
  console.log(report);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
