const DEFAULT_RENDER_SIZE = 256;
const MAX_RENDER_DPR = 2.5;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Shader compile failed.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_uv = a_uv;
    }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_opacity;
    void main() {
      vec4 color = texture2D(u_texture, v_uv);
      gl_FragColor = vec4(color.rgb, color.a * u_opacity);
    }
  `);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create program.');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Program link failed.';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json();
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.arrayBuffer();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error(`Unable to load ${url}`)), { once: true });
    image.src = url;
  });
}

function resolveRelativeUrl(file, baseUrl) {
  return new URL(String(file || ''), baseUrl).href;
}

function normalizeParameterSettings(vtubeJson) {
  const settings = Array.isArray(vtubeJson?.ParameterSettings) ? vtubeJson.ParameterSettings : [];
  return settings
    .map((setting) => ({
      input: String(setting?.Input || '').trim(),
      output: String(setting?.OutputLive2D || '').trim(),
      inputMin: normalizeNumber(setting?.InputRangeLower, -1),
      inputMax: normalizeNumber(setting?.InputRangeUpper, 1),
      outputMin: normalizeNumber(setting?.OutputRangeLower, -1),
      outputMax: normalizeNumber(setting?.OutputRangeUpper, 1),
      clampInput: Boolean(setting?.ClampInput),
      clampOutput: Boolean(setting?.ClampOutput)
    }))
    .filter((setting) => setting.input && setting.output);
}

function frameInputValue(input, frameState = {}) {
  const key = String(input || '').trim().toLowerCase();
  if (key === 'faceanglex' || key === 'headanglex') return normalizeNumber(frameState.headX, 0);
  if (key === 'faceangley' || key === 'headangley') return normalizeNumber(frameState.headY, 0);
  if (key === 'faceanglez' || key === 'headanglez') return normalizeNumber(frameState.headZ, 0);
  if (key === 'bodyanglex') return normalizeNumber(frameState.bodyX, 0);
  if (key === 'bodyangley') return normalizeNumber(frameState.bodyY, 0);
  if (key === 'bodyanglez') return normalizeNumber(frameState.bodyZ, 0);
  if (key === 'facepositionx' || key === 'positionx') return normalizeNumber(frameState.positionX, 0);
  if (key === 'facepositiony' || key === 'positiony') return normalizeNumber(frameState.positionY, 0);
  if (key === 'mouthopen' || key === 'mouthopeny') return normalizeNumber(frameState.mouthOpen, 0);
  if (key === 'eyeopenleft') return normalizeNumber(frameState.eyeOpenLeft, 1);
  if (key === 'eyeopenright') return normalizeNumber(frameState.eyeOpenRight, 1);
  return 0;
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  if (Math.abs(inMax - inMin) < 0.00001) return outMin;
  const t = (value - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

function findParameterIndex(model, id) {
  const ids = model?.parameters?.ids || [];
  for (let index = 0; index < ids.length; index += 1) {
    if (String(ids[index]) === id) return index;
  }
  return -1;
}

function setParameter(model, id, value) {
  const index = findParameterIndex(model, id);
  if (index < 0) return false;
  const min = normalizeNumber(model.parameters.minimumValues?.[index], -Infinity);
  const max = normalizeNumber(model.parameters.maximumValues?.[index], Infinity);
  model.parameters.values[index] = clamp(value, min, max);
  return true;
}

function applyParameters(model, parameterSettings, frameState) {
  let applied = 0;
  for (const setting of parameterSettings) {
    let value = frameInputValue(setting.input, frameState);
    if (setting.clampInput) value = clamp(value, setting.inputMin, setting.inputMax);
    value = mapRange(value, setting.inputMin, setting.inputMax, setting.outputMin, setting.outputMax);
    if (setting.clampOutput) value = clamp(value, setting.outputMin, setting.outputMax);
    if (setParameter(model, setting.output, value)) applied += 1;
  }

  if (applied > 0) return;
  setParameter(model, 'ParamAngleX', normalizeNumber(frameState.headX, 0));
  setParameter(model, 'ParamAngleY', normalizeNumber(frameState.headY, 0));
  setParameter(model, 'ParamAngleZ', normalizeNumber(frameState.headZ, 0));
  setParameter(model, 'ParamBodyAngleX', normalizeNumber(frameState.bodyX, 0));
  setParameter(model, 'ParamBodyAngleY', normalizeNumber(frameState.bodyY, 0));
  setParameter(model, 'ParamBodyAngleZ', normalizeNumber(frameState.bodyZ, 0));
  setParameter(model, 'ParamMouthOpenY', normalizeNumber(frameState.mouthOpen, 0));
  setParameter(model, 'ParamEyeLOpen', normalizeNumber(frameState.eyeOpenLeft, 1));
  setParameter(model, 'ParamEyeROpen', normalizeNumber(frameState.eyeOpenRight, 1));
}

function drawableVisible(drawables, index) {
  const flags = drawables.dynamicFlags?.[index];
  const utils = window.Live2DCubismCore?.Utils;
  if (utils?.hasIsVisibleBit && flags !== undefined) return utils.hasIsVisibleBit(flags);
  return normalizeNumber(drawables.opacities?.[index], 1) > 0.001;
}

function drawableBlendMode(drawables, index) {
  const flags = drawables.constantFlags?.[index];
  const utils = window.Live2DCubismCore?.Utils;
  if (utils?.hasBlendAdditiveBit?.(flags)) return 'additive';
  if (utils?.hasBlendMultiplicativeBit?.(flags)) return 'multiplicative';
  return 'normal';
}

function calculateBounds(drawables) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vertices of drawables.vertexPositions || []) {
    if (!vertices) continue;
    for (let index = 0; index < vertices.length; index += 2) {
      const x = vertices[index];
      const y = vertices[index + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) {
    return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  }
  return { minX, minY, maxX, maxY };
}

function transformVertices(vertices, bounds) {
  const width = Math.max(bounds.maxX - bounds.minX, 0.001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.001);
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerY = (bounds.minY + bounds.maxY) * 0.5;
  const scale = Math.min(1.86 / width, 1.86 / height);
  const output = new Float32Array(vertices.length);
  for (let index = 0; index < vertices.length; index += 2) {
    output[index] = (vertices[index] - centerX) * scale;
    output[index + 1] = (vertices[index + 1] - centerY) * scale;
  }
  return output;
}

export class LocalVtsCubismItemRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false
    });
    if (!this.gl) throw new Error('WebGL is unavailable for Live2D item rendering.');
    this.program = createProgram(this.gl);
    this.positionBuffer = this.gl.createBuffer();
    this.uvBuffer = this.gl.createBuffer();
    this.indexBuffer = this.gl.createBuffer();
    this.positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
    this.uvLocation = this.gl.getAttribLocation(this.program, 'a_uv');
    this.opacityLocation = this.gl.getUniformLocation(this.program, 'u_opacity');
    this.textureLocation = this.gl.getUniformLocation(this.program, 'u_texture');
    this.modelUrl = '';
    this.loadPromise = null;
    this.resource = null;
    this.error = '';
  }

  ensureSize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(Math.round(rect.width || DEFAULT_RENDER_SIZE), 1);
    const cssHeight = Math.max(Math.round(rect.height || rect.width || DEFAULT_RENDER_SIZE), 1);
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_RENDER_DPR);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  async load(item) {
    const core = window.Live2DCubismCore;
    if (!core?.Moc || !core?.Model) throw new Error('Live2D Cubism Core is unavailable.');

    const modelUrl = item.modelUrl || item.assetUrl;
    const model3 = await fetchJson(modelUrl);
    const refs = isObject(model3?.FileReferences) ? model3.FileReferences : {};
    const mocFile = refs.Moc;
    const textures = Array.isArray(refs.Textures) ? refs.Textures : [];
    if (!mocFile || !textures.length) throw new Error('Live2D item model3 is missing moc or textures.');

    const vtubeJson = item.vtubeUrl ? await fetchJson(item.vtubeUrl).catch(() => null) : null;
    const mocBytes = await fetchArrayBuffer(resolveRelativeUrl(mocFile, modelUrl));
    const moc = core.Moc.fromArrayBuffer(mocBytes);
    if (!moc) throw new Error('Unable to initialize Live2D item moc.');
    const model = core.Model.fromMoc(moc);
    if (!model) throw new Error('Unable to initialize Live2D item model.');

    const textureImages = await Promise.all(textures.map((texture) => loadImage(resolveRelativeUrl(texture, modelUrl))));
    const glTextures = textureImages.map((image) => this.createTexture(image));

    return {
      moc,
      model,
      glTextures,
      parameterSettings: normalizeParameterSettings(vtubeJson),
      model3
    };
  }

  ensureLoaded(item) {
    const modelUrl = item.modelUrl || item.assetUrl;
    if (!modelUrl) return;
    if (this.modelUrl === modelUrl && this.resource) return;
    if (this.modelUrl === modelUrl && this.loadPromise) return;
    this.disposeResource();
    this.modelUrl = modelUrl;
    this.loadPromise = this.load(item)
      .then((resource) => {
        if (this.modelUrl === modelUrl) {
          this.resource = resource;
          this.error = '';
        } else {
          this.disposeResource(resource);
        }
      })
      .catch((error) => {
        this.error = error?.message || 'Live2D item load failed.';
      })
      .finally(() => {
        if (this.modelUrl === modelUrl) this.loadPromise = null;
      });
  }

  createTexture(image) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  render(item, frameState) {
    this.ensureSize();
    this.ensureLoaded(item);
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.resource) return;

    const { model, glTextures, parameterSettings } = this.resource;
    applyParameters(model, parameterSettings, frameState);
    model.update();

    const drawables = model.drawables;
    const bounds = calculateBounds(drawables);
    const order = Array.from({ length: drawables.count }, (_, index) => index)
      .sort((left, right) => normalizeNumber(drawables.renderOrders?.[left], left) - normalizeNumber(drawables.renderOrders?.[right], right));

    gl.useProgram(this.program);
    gl.uniform1i(this.textureLocation, 0);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    for (const index of order) {
      if (!drawableVisible(drawables, index)) continue;
      const texture = glTextures[drawables.textureIndices?.[index] || 0];
      if (!texture) continue;
      const vertices = transformVertices(drawables.vertexPositions[index], bounds);
      const uvs = drawables.vertexUvs[index];
      const indices = drawables.indices[index];
      if (!vertices?.length || !uvs?.length || !indices?.length) continue;

      const blend = drawableBlendMode(drawables, index);
      if (blend === 'additive') gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      else if (blend === 'multiplicative') gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.positionLocation);
      gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.uvLocation);
      gl.vertexAttribPointer(this.uvLocation, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
      gl.uniform1f(this.opacityLocation, normalizeNumber(drawables.opacities?.[index], 1) * normalizeNumber(item.opacity, 1));
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
  }

  disposeResource(resource = this.resource) {
    if (!resource || !this.gl) return;
    for (const texture of resource.glTextures || []) {
      if (texture) this.gl.deleteTexture(texture);
    }
    resource.model?.release?.();
    resource.moc?._release?.();
    if (resource === this.resource) this.resource = null;
  }

  destroy() {
    this.disposeResource();
    if (!this.gl) return;
    if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
    if (this.uvBuffer) this.gl.deleteBuffer(this.uvBuffer);
    if (this.indexBuffer) this.gl.deleteBuffer(this.indexBuffer);
    if (this.program) this.gl.deleteProgram(this.program);
    this.positionBuffer = null;
    this.uvBuffer = null;
    this.indexBuffer = null;
    this.program = null;
    this.gl = null;
  }
}

export function createLocalVtsCubismItemRenderer(canvas) {
  return new LocalVtsCubismItemRenderer(canvas);
}
