import { createLocalVtsCubismItemRenderer } from './live2dLocalVtsCubismItemRenderer';

const DEFAULT_MODEL_BASE_URL = '/models/tsukimi-yachiyo/';
const DEFAULT_ITEM_BASE_PATH = 'items';
const DEFAULT_MANIFEST_URLS = [
  `${DEFAULT_MODEL_BASE_URL}vts-items.local.json`,
  `${DEFAULT_MODEL_BASE_URL}items_pinned_to_model.json`
];

export const LOCAL_VTS_ITEM_CONTROL_EVENT = 'tsukuyomi:live2d-local-vts-item';
export const LOCAL_VTS_ITEM_STATE_EVENT = 'tsukuyomi:live2d-local-vts-item-state';
export const LOCAL_CUBISM_FRAME_EVENT = 'tsukuyomi:live2d-local-cubism-frame';

const OVERLAY_STATE_KEY = '__TSUKUYOMI_LOCAL_VTS_ITEM_OVERLAY_STATE__';
const FRONT_LAYER = 'front';
const BEHIND_LAYER = 'behind';
const ITEM_DELETE_HOTSPOT_MIN_X = 0.92;
const ITEM_DELETE_HOTSPOT_MIN_Y = 0.92;
const IMAGE_FILE_RE = /\.(?:png|jpe?g|webp|gif|avif|svg)$/i;
const MODEL3_FILE_RE = /\.model3\.json$/i;
const MOC3_FILE_RE = /\.moc3$/i;
const LIVE2D_ITEM_FILE_RE = /\.(?:model3\.json|moc3)$/i;

const DEFAULT_ANCHOR = { x: 0.5, y: 0.5 };
const DEFAULT_FOLLOW = {
  headX: 0,
  headY: 0,
  headZ: 0,
  bodyX: 0,
  bodyY: 0,
  bodyZ: 0,
  positionX: 0,
  positionY: 0
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pickField(source, keys) {
  if (!isObject(source)) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  const entries = Object.entries(source);
  for (const key of keys) {
    const lowerKey = String(key).toLowerCase();
    const match = entries.find(([entryKey]) => String(entryKey).toLowerCase() === lowerKey);
    if (match) return match[1];
  }
  return undefined;
}

function normalizeString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'visible', 'enabled'].includes(text)) return true;
  if (['false', '0', 'no', 'off', 'hidden', 'disabled'].includes(text)) return false;
  return fallback;
}

function normalizePoint(value, fallback = null) {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : fallback;
  }
  if (!isObject(value)) return fallback;
  const x = Number(pickField(value, ['x', 'X', 'positionX', 'PositionX']));
  const y = Number(pickField(value, ['y', 'Y', 'positionY', 'PositionY']));
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : fallback;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function isAbsoluteAssetUrl(value) {
  return /^(?:https?:|data:|blob:|\/)/i.test(String(value || ''));
}

function joinAssetUrl(base, path) {
  const cleanBase = String(base || '').replace(/\/+$/, '');
  const cleanPath = String(path || '').replace(/^\.?\//, '');
  if (!cleanBase) return cleanPath;
  if (!cleanPath) return `${cleanBase}/`;
  return `${cleanBase}/${cleanPath}`;
}

export function resolveLocalVtsItemAssetUrl(file, options = {}) {
  const sourceFile = normalizeString(file);
  if (!sourceFile) return '';
  if (isAbsoluteAssetUrl(sourceFile)) return sourceFile;

  const modelBaseUrl = normalizeString(options.modelBaseUrl, DEFAULT_MODEL_BASE_URL);
  const basePath = normalizeString(options.basePath, DEFAULT_ITEM_BASE_PATH);
  if (basePath && sourceFile.replace(/\\/g, '/').startsWith(`${basePath.replace(/\\/g, '/')}/`)) {
    return joinAssetUrl(modelBaseUrl, sourceFile.replace(/\\/g, '/'));
  }
  const assetBaseUrl = basePath ? joinAssetUrl(modelBaseUrl, basePath) : modelBaseUrl;
  return joinAssetUrl(assetBaseUrl, sourceFile.replace(/\\/g, '/'));
}

function normalizeLayer(rawItem, index) {
  const layer = normalizeString(pickField(rawItem, [
    'layer',
    'Layer',
    'itemLayer',
    'ItemLayer',
    'sortingLayer',
    'SortingLayer'
  ])).toLowerCase();
  if (layer.includes('behind') || layer.includes('back') || layer.includes('rear')) return BEHIND_LAYER;
  if (layer.includes('front') || layer.includes('above') || layer.includes('foreground')) return FRONT_LAYER;

  const order = normalizeNumber(pickField(rawItem, [
    'zIndex',
    'ZIndex',
    'order',
    'Order',
    'itemOrder',
    'ItemOrder',
    'drawOrder',
    'DrawOrder'
  ]), index);
  return order < 0 ? BEHIND_LAYER : FRONT_LAYER;
}

function normalizeAnchor(rawItem) {
  const anchor = normalizePoint(pickField(rawItem, ['anchor', 'Anchor', 'modelAnchor', 'ModelAnchor']), null);
  if (anchor) return anchor;

  const position = normalizePoint(pickField(rawItem, [
    'position',
    'Position',
    'itemPosition',
    'ItemPosition',
    'scenePosition',
    'ScenePosition'
  ]), null);
  if (position) {
    return {
      x: 0.5 + position.x * 0.5,
      y: 0.5 - position.y * 0.5
    };
  }

  const positionX = pickField(rawItem, ['positionX', 'PositionX', 'itemPositionX', 'ItemPositionX', 'x', 'X']);
  const positionY = pickField(rawItem, ['positionY', 'PositionY', 'itemPositionY', 'ItemPositionY', 'y', 'Y']);
  const x = Number(positionX);
  const y = Number(positionY);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return {
      x: 0.5 + x * 0.5,
      y: 0.5 - y * 0.5
    };
  }

  return { ...DEFAULT_ANCHOR };
}

function normalizeOffset(rawItem) {
  const offset = normalizePoint(pickField(rawItem, ['offset', 'Offset', 'itemOffset', 'ItemOffset']), null);
  if (offset) return offset;
  return {
    x: normalizeNumber(pickField(rawItem, ['offsetX', 'OffsetX', 'xOffset', 'XOffset']), 0),
    y: normalizeNumber(pickField(rawItem, ['offsetY', 'OffsetY', 'yOffset', 'YOffset']), 0)
  };
}

function normalizeFollow(rawItem) {
  const follow = pickField(rawItem, ['follow', 'Follow', 'tracking', 'Tracking', 'pinFollow', 'PinFollow']);
  if (follow === false || normalizeString(follow).toLowerCase() === 'false') {
    return {
      headX: 0,
      headY: 0,
      headZ: 0,
      bodyX: 0,
      bodyY: 0,
      bodyZ: 0,
      positionX: 0,
      positionY: 0
    };
  }
  if (!isObject(follow)) return { ...DEFAULT_FOLLOW };
  return {
    headX: normalizeNumber(pickField(follow, ['headX', 'HeadX', 'faceAngleX', 'FaceAngleX', 'x', 'X']), 0),
    headY: normalizeNumber(pickField(follow, ['headY', 'HeadY', 'faceAngleY', 'FaceAngleY', 'y', 'Y']), 0),
    headZ: normalizeNumber(pickField(follow, ['headZ', 'HeadZ', 'faceAngleZ', 'FaceAngleZ', 'z', 'Z', 'rotation', 'Rotation']), 0),
    bodyX: normalizeNumber(pickField(follow, ['bodyX', 'BodyX', 'bodyAngleX', 'BodyAngleX']), 0),
    bodyY: normalizeNumber(pickField(follow, ['bodyY', 'BodyY', 'bodyAngleY', 'BodyAngleY']), 0),
    bodyZ: normalizeNumber(pickField(follow, ['bodyZ', 'BodyZ', 'bodyAngleZ', 'BodyAngleZ']), 0),
    positionX: normalizeNumber(pickField(follow, ['positionX', 'PositionX', 'facePositionX', 'FacePositionX']), 0),
    positionY: normalizeNumber(pickField(follow, ['positionY', 'PositionY', 'facePositionY', 'FacePositionY']), 0)
  };
}

function normalizeFile(rawItem) {
  return normalizeString(pickField(rawItem, [
    'file',
    'File',
    'model',
    'Model',
    'modelFile',
    'ModelFile',
    'fileName',
    'FileName',
    'filename',
    'Filename',
    'path',
    'Path',
    'image',
    'Image',
    'imageFile',
    'ImageFile',
    'itemFile',
    'ItemFile',
    'itemFileName',
    'ItemFileName',
    'texture',
    'Texture'
  ]));
}

function normalizeVTubeFile(rawItem) {
  return normalizeString(pickField(rawItem, [
    'vtubeFile',
    'VTubeFile',
    'vTubeFile',
    'VtubeFile',
    'itemSettingsFile',
    'ItemSettingsFile'
  ]));
}

function normalizeIconFile(rawItem) {
  return normalizeString(pickField(rawItem, [
    'icon',
    'Icon',
    'iconFile',
    'IconFile',
    'preview',
    'Preview',
    'previewFile',
    'PreviewFile'
  ]));
}

function normalizeRenderType(rawItem, file) {
  const explicitType = normalizeString(pickField(rawItem, [
    'type',
    'Type',
    'itemType',
    'ItemType',
    'renderType',
    'RenderType'
  ])).toLowerCase();
  if (explicitType.includes('live2d') || explicitType.includes('cubism') || explicitType.includes('moc')) return 'live2d';
  if (LIVE2D_ITEM_FILE_RE.test(file)) return 'live2d';
  return 'image';
}

function deriveModel3File(file) {
  const source = normalizeString(file);
  if (!source) return '';
  if (MODEL3_FILE_RE.test(source)) return source;
  if (MOC3_FILE_RE.test(source)) return source.replace(/\.moc3$/i, '.model3.json');
  return source;
}

function normalizeFrames(rawItem, options) {
  const rawFrames = pickField(rawItem, ['frames', 'Frames', 'frameFiles', 'FrameFiles', 'files', 'Files']);
  if (!Array.isArray(rawFrames)) return [];
  return rawFrames
    .map((frame) => normalizeFile(isObject(frame) ? frame : { file: frame }))
    .filter(Boolean)
    .map((file) => resolveLocalVtsItemAssetUrl(file, options));
}

function normalizeSizeValue(rawItem, keys) {
  const value = pickField(rawItem, keys);
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeItemSize(rawItem) {
  const size = normalizeSizeValue(rawItem, ['size', 'Size', 'itemSize', 'ItemSize']);
  const width = normalizeSizeValue(rawItem, ['width', 'Width', 'w', 'W']);
  const height = normalizeSizeValue(rawItem, ['height', 'Height', 'h', 'H']);
  return { size, width, height };
}

function normalizeItemId(rawItem, index) {
  const explicitId = normalizeString(pickField(rawItem, [
    'id',
    'Id',
    'ID',
    'itemId',
    'ItemId',
    'itemID',
    'ItemID'
  ]));
  if (explicitId) return explicitId;
  const name = normalizeString(pickField(rawItem, ['name', 'Name', 'displayName', 'DisplayName']));
  if (name) return name.replace(/\s+/g, '-').toLowerCase();
  const file = normalizeFile(rawItem);
  if (file) return file.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || `item-${index + 1}`;
  return `item-${index + 1}`;
}

function isSupportedItemFile(file, frames = [], renderType = 'image') {
  if (frames.length > 0) return true;
  if (!file) return false;
  if (renderType === 'live2d') return MODEL3_FILE_RE.test(file);
  if (LIVE2D_ITEM_FILE_RE.test(file)) return false;
  return IMAGE_FILE_RE.test(file) || !/\.[a-z0-9]+$/i.test(file);
}

export function normalizeLocalVtsItemManifest(manifest, options = {}) {
  const modelBaseUrl = normalizeString(options.modelBaseUrl, DEFAULT_MODEL_BASE_URL);
  const manifestBasePath = normalizeString(
    pickField(manifest, ['basePath', 'BasePath', 'itemBasePath', 'ItemBasePath']),
    DEFAULT_ITEM_BASE_PATH
  );
  const rawItems = Array.isArray(manifest)
    ? manifest
    : (pickField(manifest, ['items', 'Items', 'itemList', 'ItemList']) || []);
  const itemIdCounts = new Map();
  const unsupported = [];

  const items = (Array.isArray(rawItems) ? rawItems : []).map((rawItem, index) => {
    const basePath = normalizeString(pickField(rawItem, ['basePath', 'BasePath']), manifestBasePath);
    const sourceFile = normalizeFile(rawItem);
    const renderType = normalizeRenderType(rawItem, sourceFile);
    const file = renderType === 'live2d' ? deriveModel3File(sourceFile) : sourceFile;
    const vtubeFile = normalizeVTubeFile(rawItem);
    const iconFile = normalizeIconFile(rawItem);
    const frames = normalizeFrames(rawItem, { modelBaseUrl, basePath });
    const assetUrl = file ? resolveLocalVtsItemAssetUrl(file, { modelBaseUrl, basePath }) : frames[0] || '';
    const vtubeUrl = vtubeFile ? resolveLocalVtsItemAssetUrl(vtubeFile, { modelBaseUrl, basePath }) : '';
    const previewUrl = iconFile
      ? resolveLocalVtsItemAssetUrl(iconFile, { modelBaseUrl, basePath })
      : (renderType === 'image' ? assetUrl : '');
    const baseId = normalizeItemId(rawItem, index);
    const seen = itemIdCounts.get(baseId) || 0;
    itemIdCounts.set(baseId, seen + 1);
    const id = seen ? `${baseId}-${seen + 1}` : baseId;
    const size = normalizeItemSize(rawItem);
    const layer = normalizeLayer(rawItem, index);
    const zIndex = normalizeNumber(pickField(rawItem, [
      'zIndex',
      'ZIndex',
      'order',
      'Order',
      'itemOrder',
      'ItemOrder',
      'drawOrder',
      'DrawOrder'
    ]), index);
    const supported = isSupportedItemFile(assetUrl, frames, renderType);
    const item = {
      id,
      name: normalizeString(pickField(rawItem, ['name', 'Name', 'displayName', 'DisplayName']), id),
      file,
      assetUrl,
      modelUrl: renderType === 'live2d' ? assetUrl : '',
      vtubeFile,
      vtubeUrl,
      iconFile,
      previewUrl,
      renderType,
      frames,
      fps: Math.min(Math.max(normalizeNumber(pickField(rawItem, ['fps', 'FPS', 'frameRate', 'FrameRate']), 12), 1), 60),
      visible: normalizeBoolean(pickField(rawItem, [
        'visible',
        'Visible',
        'enabled',
        'Enabled',
        'active',
        'Active',
        'isVisible',
        'IsVisible'
      ]), true),
      layer,
      zIndex,
      anchor: normalizeAnchor(rawItem),
      offset: normalizeOffset(rawItem),
      size,
      scale: normalizeNumber(pickField(rawItem, ['scale', 'Scale']), 1),
      scaleX: normalizeNumber(pickField(rawItem, ['scaleX', 'ScaleX']), 1),
      scaleY: normalizeNumber(pickField(rawItem, ['scaleY', 'ScaleY']), 1),
      flipX: normalizeBoolean(pickField(rawItem, ['flipX', 'FlipX', 'mirrorX', 'MirrorX', 'mirrored', 'Mirrored']), false),
      flipY: normalizeBoolean(pickField(rawItem, ['flipY', 'FlipY', 'mirrorY', 'MirrorY']), false),
      rotation: normalizeNumber(pickField(rawItem, ['rotation', 'Rotation', 'angle', 'Angle', 'itemRotation', 'ItemRotation']), 0),
      opacity: Math.min(Math.max(normalizeNumber(pickField(rawItem, ['opacity', 'Opacity', 'alpha', 'Alpha']), 1), 0), 1),
      follow: normalizeFollow(rawItem),
      supported,
      source: options.source || ''
    };
    if (!supported) unsupported.push({ id, file: assetUrl, source: item.source });
    return item;
  }).filter((item) => item.supported);

  return {
    version: normalizeNumber(pickField(manifest, ['version', 'Version']), 1),
    basePath: manifestBasePath,
    items,
    unsupported
  };
}

export function localVtsItemToManifestItem(item, options = {}) {
  const includeFollow = options.includeFollow !== false;
  const manifestItem = {
    Id: item.id,
    Name: item.name || item.id,
    File: item.file,
    ItemType: item.renderType === 'live2d' ? 'live2d' : 'image',
    Visible: item.visible !== false,
    Layer: item.layer === BEHIND_LAYER ? BEHIND_LAYER : FRONT_LAYER,
    Anchor: {
      X: round(item.anchor?.x ?? 0.5, 5),
      Y: round(item.anchor?.y ?? 0.5, 5)
    },
    Offset: {
      X: round(item.offset?.x ?? 0, 3),
      Y: round(item.offset?.y ?? 0, 3)
    },
    Size: item.size?.size || item.size?.width || null,
    Scale: round(item.scale ?? 1, 4),
    Rotation: round(item.rotation ?? 0, 3),
    Opacity: round(item.opacity ?? 1, 4)
  };
  if (!manifestItem.Size) delete manifestItem.Size;
  if (Array.isArray(item.frames) && item.frames.length > 0) {
    manifestItem.ItemType = 'sequence';
    manifestItem.Frames = item.frames.map((frame) => {
      const text = String(frame || '');
      const prefix = `${DEFAULT_MODEL_BASE_URL}${DEFAULT_ITEM_BASE_PATH}/`;
      return text.startsWith(prefix) ? text.slice(prefix.length) : text;
    });
    manifestItem.FPS = round(item.fps ?? 12, 3);
  }
  if (item.vtubeFile) manifestItem.VTubeFile = item.vtubeFile;
  if (item.iconFile) manifestItem.Icon = item.iconFile;
  if (includeFollow) {
    manifestItem.Follow = {
      HeadX: round(item.follow?.headX ?? 0, 4),
      HeadY: round(item.follow?.headY ?? 0, 4),
      HeadZ: round(item.follow?.headZ ?? 0, 4),
      BodyX: round(item.follow?.bodyX ?? 0, 4),
      BodyY: round(item.follow?.bodyY ?? 0, 4),
      BodyZ: round(item.follow?.bodyZ ?? 0, 4),
      PositionX: round(item.follow?.positionX ?? 0, 4),
      PositionY: round(item.follow?.positionY ?? 0, 4)
    };
  }
  return manifestItem;
}

function parameterValue(values, ids, fallback = 0) {
  for (const id of ids) {
    const value = values[String(id)];
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

export function localVtsFrameStateFromParameters(parameters) {
  const values = {};
  for (const item of Array.isArray(parameters) ? parameters : []) {
    const id = normalizeString(pickField(item, ['id', 'Id', 'parameterId', 'ParameterId', 'name', 'Name']));
    const value = Number(pickField(item, ['value', 'Value']));
    if (!id || !Number.isFinite(value)) continue;
    values[id] = value;
  }
  return {
    headX: parameterValue(values, ['ParamAngle_HeadX', 'ParamAngleX', 'FaceAngleX', 'MocopiAngleX']),
    headY: parameterValue(values, ['ParamAngle_HeadY', 'ParamAngleY', 'FaceAngleY', 'MocopiAngleY']),
    headZ: parameterValue(values, ['ParamAngle_HeadZ', 'ParamAngle_HeadZ2', 'ParamAngleZ', 'FaceAngleZ', 'MocopiAngleZ']),
    bodyX: parameterValue(values, ['ParamAngle_BodyX', 'ParamAngle_BodyX2', 'ParamAngle_BodyX3', 'ParamBodyAngleX', 'MocopiBodyAngleX']),
    bodyY: parameterValue(values, ['ParamAngle_BodyY', 'ParamAngle_BodyY2', 'ParamBodyAngleY', 'MocopiBodyAngleY']),
    bodyZ: parameterValue(values, ['ParamAngle_BodyZ', 'ParamAngle_BodyZ2', 'ParamAngle_ChestZ', 'ParamBodyAngleZ', 'MocopiBodyAngleZ']),
    positionX: parameterValue(values, ['FacePositionX', 'PositionX', 'MocopiBodyPositionX']),
    positionY: parameterValue(values, ['FacePositionY', 'PositionY', 'MocopiBodyPositionY']),
    mouthOpen: parameterValue(values, ['ParamMouthOpenY', 'MouthOpen', 'MouthOpenY']),
    eyeOpenLeft: parameterValue(values, ['ParamEyeLOpen', 'EyeOpenLeft'], 1),
    eyeOpenRight: parameterValue(values, ['ParamEyeROpen', 'EyeOpenRight'], 1)
  };
}

export function localVtsItemTransform(item, frameState = {}) {
  const state = Array.isArray(frameState)
    ? localVtsFrameStateFromParameters(frameState)
    : { ...localVtsFrameStateFromParameters([]), ...frameState };
  const follow = item?.follow || {};
  const offset = item?.offset || { x: 0, y: 0 };
  const x = normalizeNumber(offset.x, 0) +
    state.headX * normalizeNumber(follow.headX, 0) +
    state.bodyX * normalizeNumber(follow.bodyX, 0) +
    state.positionX * normalizeNumber(follow.positionX, 0);
  const y = normalizeNumber(offset.y, 0) +
    state.headY * normalizeNumber(follow.headY, 0) +
    state.bodyY * normalizeNumber(follow.bodyY, 0) +
    state.positionY * normalizeNumber(follow.positionY, 0);
  const rotation = normalizeNumber(item?.rotation, 0) +
    state.headZ * normalizeNumber(follow.headZ, 0) +
    state.bodyZ * normalizeNumber(follow.bodyZ, 0);
  const scale = normalizeNumber(item?.scale, 1);
  const scaleX = scale * normalizeNumber(item?.scaleX, 1) * (item?.flipX ? -1 : 1);
  const scaleY = scale * normalizeNumber(item?.scaleY, 1) * (item?.flipY ? -1 : 1);

  return {
    x: round(x),
    y: round(y),
    rotation: round(rotation),
    scaleX: round(scaleX, 4),
    scaleY: round(scaleY, 4),
    cssTransform: [
      'translate(-50%, -50%)',
      `translate3d(${round(x)}px, ${round(y)}px, 0)`,
      `rotate(${round(rotation)}deg)`,
      `scale(${round(scaleX, 4)}, ${round(scaleY, 4)})`
    ].join(' ')
  };
}

function setOverlayState(patch) {
  if (typeof window === 'undefined') return;
  window[OVERLAY_STATE_KEY] = {
    ...(window[OVERLAY_STATE_KEY] || {}),
    ...patch,
    updatedAt: Date.now()
  };
}

async function fetchJsonMaybe(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

function ensureLayer(container, layer) {
  const selector = `.live2d-vts-item-layer[data-layer="${layer}"]`;
  const existing = container.querySelector(selector);
  if (existing) return existing;
  const element = document.createElement('div');
  element.className = 'live2d-vts-item-layer';
  element.dataset.layer = layer;
  element.dataset.live2dVtsItemLayer = layer;
  container.appendChild(element);
  return element;
}

function removeOverlayLayers(container) {
  container?.querySelectorAll('.live2d-vts-item-layer[data-live2d-vts-item-layer]')
    .forEach((layer) => layer.remove());
}

function resolveSizeCss(value, reference) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '';
  const numeric = Number(value);
  if (numeric <= 1) return `${Math.max(1, Math.round(reference * numeric))}px`;
  return `${Math.round(numeric)}px`;
}

function applyItemSizing(element, item, container) {
  const rect = container.getBoundingClientRect();
  const reference = Math.max(rect.width || 0, 1);
  const width = item.size?.width || item.size?.size;
  const height = item.size?.height;
  const widthCss = resolveSizeCss(width, reference);
  const heightCss = resolveSizeCss(height, rect.height || reference);
  element.style.width = widthCss;
  element.style.height = heightCss;
  element.style.setProperty('--live2d-item-width', widthCss || '160px');
  element.style.setProperty('--live2d-item-height', heightCss || widthCss || '160px');
}

function applyItemStaticStyle(element, item, container) {
  element.dataset.itemId = item.id;
  element.dataset.layer = item.layer;
  if ('alt' in element) element.alt = item.name || item.id;
  element.draggable = false;
  if (element.tagName === 'IMG') {
    element.decoding = 'async';
    element.loading = 'eager';
  }
  element.style.left = `${round((item.anchor?.x ?? 0.5) * 100, 4)}%`;
  element.style.top = `${round((item.anchor?.y ?? 0.5) * 100, 4)}%`;
  element.style.opacity = String(item.opacity);
  element.style.zIndex = String(Math.round(item.zIndex || 0));
  applyItemSizing(element, item, container);
}

function itemVisible(item, overrides) {
  return overrides.has(item.id) ? overrides.get(item.id) : item.visible;
}

export function mountLocalVtsItemOverlay(options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const containerSelector = options.containerSelector || '#live2d-container';
  const modelBaseUrl = options.modelBaseUrl || DEFAULT_MODEL_BASE_URL;
  const manifestUrls = options.manifestUrls || DEFAULT_MANIFEST_URLS;
  const selectionHighlightMs = Math.max(0, Number(options.selectionHighlightMs ?? 5000));
  const elements = new Map();
  const cubismRenderers = new Map();
  const sequenceFrameCaches = new Map();
  const visibilityOverrides = new Map();
  let items = [];
  let unsupported = [];
  let frameState = localVtsFrameStateFromParameters([]);
  let frameId = 0;
  let destroyed = false;
  let loadToken = 0;
  let selectedItemId = '';
  let selectedHighlightUntil = 0;
  let selectedHighlightTimer = 0;
  let editorEnabled = false;
  let editDragState = null;

  function findContainer() {
    return document.querySelector(containerSelector);
  }

  function scheduleApply() {
    if (frameId || destroyed) return;
    frameId = window.requestAnimationFrame(applyItems);
  }

  function clearSelectedHighlightTimer() {
    if (!selectedHighlightTimer) return;
    const clearTimer = typeof window.clearTimeout === 'function' ? window.clearTimeout.bind(window) : clearTimeout;
    clearTimer(selectedHighlightTimer);
    selectedHighlightTimer = 0;
  }

  function scheduleSelectedHighlightExpiry() {
    clearSelectedHighlightTimer();
    if (!selectionHighlightMs || !selectedItemId || destroyed) return;
    const delay = Math.max(0, selectedHighlightUntil - performance.now() + 16);
    const setTimer = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : setTimeout;
    selectedHighlightTimer = setTimer(() => {
      selectedHighlightTimer = 0;
      renderItems();
    }, delay);
  }

  function markSelectedItemAdjusted(id = selectedItemId) {
    if (!id) return;
    selectedItemId = String(id);
    selectedHighlightUntil = performance.now() + selectionHighlightMs;
    scheduleSelectedHighlightExpiry();
  }

  function selectedHighlightActive(item) {
    return editorEnabled
      && item?.id === selectedItemId
      && (!selectionHighlightMs || performance.now() <= selectedHighlightUntil);
  }

  function visibleItems() {
    return items.filter((item) => itemVisible(item, visibilityOverrides));
  }

  function itemStateSnapshot() {
    return items.map((item) => ({
      ...localVtsItemToManifestItem({
        ...item,
        visible: itemVisible(item, visibilityOverrides)
      }),
      id: item.id,
      name: item.name,
      file: item.file,
      assetUrl: item.assetUrl,
      modelUrl: item.modelUrl,
      vtubeFile: item.vtubeFile,
      vtubeUrl: item.vtubeUrl,
      iconFile: item.iconFile,
      previewUrl: item.previewUrl,
      renderType: item.renderType,
      visible: itemVisible(item, visibilityOverrides),
      layer: item.layer,
      anchor: { ...(item.anchor || DEFAULT_ANCHOR) },
      offset: { ...(item.offset || { x: 0, y: 0 }) },
      size: { ...(item.size || {}) },
      scale: item.scale,
      rotation: item.rotation,
      opacity: item.opacity,
      selected: item.id === selectedItemId,
      source: item.source
    }));
  }

  function emitItemState() {
    window.dispatchEvent(new CustomEvent(LOCAL_VTS_ITEM_STATE_EVENT, {
      detail: {
        items: itemStateSnapshot(),
        selectedItemId,
        editorEnabled,
        itemCount: items.length,
        visibleItemCount: visibleItems().length,
        unsupported
      }
    }));
  }

  function selectItem(id) {
    selectedItemId = id && items.some((item) => item.id === String(id)) ? String(id) : '';
    if (selectedItemId) markSelectedItemAdjusted(selectedItemId);
    renderItems();
  }

  function normalizeEditorItem(rawItem, basePath = DEFAULT_ITEM_BASE_PATH) {
    return normalizeLocalVtsItemManifest({
      Version: 1,
      BasePath: basePath || DEFAULT_ITEM_BASE_PATH,
      Items: [rawItem]
    }, {
      modelBaseUrl,
      source: 'local-item-editor'
    }).items[0] || null;
  }

  function upsertItem(rawItem, options = {}) {
    const item = normalizeEditorItem(rawItem, options.basePath);
    if (!item) return null;
    const existingIndex = items.findIndex((current) => current.id === item.id);
    if (existingIndex >= 0) items.splice(existingIndex, 1, item);
    else items.push(item);
    if (options.select !== false) markSelectedItemAdjusted(item.id);
    renderItems();
    scheduleApply();
    return item;
  }

  function mergePointPatch(current, patch, keys = ['x', 'y']) {
    const point = normalizePoint(patch, null);
    if (point) return point;
    const next = { ...(current || { x: 0, y: 0 }) };
    const x = Number(pickField(patch, [keys[0], keys[0].toUpperCase()]));
    const y = Number(pickField(patch, [keys[1], keys[1].toUpperCase()]));
    if (Number.isFinite(x)) next.x = x;
    if (Number.isFinite(y)) next.y = y;
    return next;
  }

  function updateItem(id, patch = {}) {
    const item = items.find((candidate) => candidate.id === String(id || selectedItemId));
    if (!item) return null;
    const layer = pickField(patch, ['layer', 'Layer']);
    const visible = pickField(patch, ['visible', 'Visible']);
    const scale = pickField(patch, ['scale', 'Scale']);
    const rotation = pickField(patch, ['rotation', 'Rotation']);
    const opacity = pickField(patch, ['opacity', 'Opacity']);
    const anchor = pickField(patch, ['anchor', 'Anchor']);
    const offset = pickField(patch, ['offset', 'Offset']);
    const size = pickField(patch, ['size', 'Size', 'itemSize', 'ItemSize']);

    if (layer !== undefined) item.layer = normalizeLayer({ Layer: layer }, 0);
    if (visible !== undefined) {
      item.visible = normalizeBoolean(visible, true);
      visibilityOverrides.delete(item.id);
    }
    if (scale !== undefined) item.scale = Math.min(Math.max(normalizeNumber(scale, item.scale), 0.05), 6);
    if (rotation !== undefined) item.rotation = normalizeNumber(rotation, item.rotation);
    if (opacity !== undefined) item.opacity = Math.min(Math.max(normalizeNumber(opacity, item.opacity), 0), 1);
    if (anchor !== undefined) item.anchor = mergePointPatch(item.anchor, anchor);
    if (offset !== undefined) item.offset = mergePointPatch(item.offset, offset);
    if (size !== undefined) {
      item.size = {
        ...item.size,
        size: Math.min(Math.max(normalizeNumber(size, item.size?.size || 160), 1), 2000)
      };
    }
    markSelectedItemAdjusted(item.id);
    renderItems();
    scheduleApply();
    return item;
  }

  function removeItem(id) {
    const itemId = String(id || selectedItemId || '');
    if (!itemId) return false;
    const nextItems = items.filter((item) => item.id !== itemId);
    if (nextItems.length === items.length) return false;
    items = nextItems;
    visibilityOverrides.delete(itemId);
    if (selectedItemId === itemId) {
      selectedItemId = '';
      selectedHighlightUntil = 0;
      clearSelectedHighlightTimer();
    }
    renderItems();
    scheduleApply();
    return true;
  }

  function itemInDeleteHotspot(item) {
    const anchor = item?.anchor || {};
    return Number(anchor.x) >= ITEM_DELETE_HOTSPOT_MIN_X && Number(anchor.y) >= ITEM_DELETE_HOTSPOT_MIN_Y;
  }

  function setDeleteHotspotState(container, item = null) {
    const dragging = Boolean(editDragState);
    const ready = dragging && itemInDeleteHotspot(item);
    container?.classList?.toggle?.('live2d-vts-item-dragging', dragging);
    container?.classList?.toggle?.('live2d-vts-item-delete-ready', ready);
  }

  function setEditorEnabled(enabled) {
    editorEnabled = Boolean(enabled);
    if (!editorEnabled) {
      selectedItemId = '';
      selectedHighlightUntil = 0;
      clearSelectedHighlightTimer();
      editDragState = null;
      setDeleteHotspotState(findContainer(), null);
    }
    renderItems();
  }

  function setVisible(id, visible) {
    if (!id) {
      items.forEach((item) => visibilityOverrides.set(item.id, visible));
    } else {
      visibilityOverrides.set(String(id), visible);
    }
    renderItems();
    scheduleApply();
  }

  function toggleVisible(id) {
    const targetItems = id ? items.filter((item) => item.id === String(id)) : items;
    targetItems.forEach((item) => visibilityOverrides.set(item.id, !itemVisible(item, visibilityOverrides)));
    renderItems();
    scheduleApply();
  }

  function clampAnchorValue(value) {
    return Math.min(Math.max(Number(value) || 0, -0.45), 1.45);
  }

  function onItemPointerDown(event) {
    if (!editorEnabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const id = event.currentTarget?.dataset?.itemId;
    const item = items.find((candidate) => candidate.id === id);
    const container = findContainer();
    if (!item || !container) return;
    const rect = container.getBoundingClientRect();
    selectedItemId = item.id;
    markSelectedItemAdjusted(item.id);
    editDragState = {
      id: item.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: item.anchor?.x ?? 0.5,
      originY: item.anchor?.y ?? 0.5,
      width: Math.max(rect.width, 1),
      height: Math.max(rect.height, 1)
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch (_) {}
    setDeleteHotspotState(container, item);
    renderItems();
    event.stopPropagation();
    event.preventDefault();
  }

  function onItemPointerMove(event) {
    if (!editorEnabled || !editDragState || event.pointerId !== editDragState.pointerId) return;
    const item = items.find((candidate) => candidate.id === editDragState.id);
    if (!item) return;
    item.anchor = {
      x: clampAnchorValue(editDragState.originX + (event.clientX - editDragState.startX) / editDragState.width),
      y: clampAnchorValue(editDragState.originY + (event.clientY - editDragState.startY) / editDragState.height)
    };
    markSelectedItemAdjusted(item.id);
    setDeleteHotspotState(findContainer(), item);
    renderItems();
    scheduleApply();
    event.stopPropagation();
    event.preventDefault();
  }

  function onItemPointerEnd(event) {
    if (!editDragState || event.pointerId !== editDragState.pointerId) return;
    const item = items.find((candidate) => candidate.id === editDragState.id);
    const shouldDelete = event.type === 'pointerup' && itemInDeleteHotspot(item);
    try {
      if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch (_) {}
    editDragState = null;
    setDeleteHotspotState(findContainer(), null);
    if (shouldDelete) {
      removeItem(item.id);
    } else {
      renderItems();
      emitItemState();
    }
    event.stopPropagation();
    event.preventDefault();
  }

  function onItemWheel(event) {
    if (!editorEnabled) return;
    const id = event.currentTarget?.dataset?.itemId;
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    selectedItemId = item.id;
    if (event.shiftKey) {
      item.rotation = normalizeNumber(item.rotation, 0) - Number(event.deltaY || 0) * 0.06;
    } else {
      const rate = event.ctrlKey ? 0.00055 : 0.00145;
      item.scale = Math.min(Math.max(normalizeNumber(item.scale, 1) * Math.exp(-Number(event.deltaY || 0) * rate), 0.05), 6);
    }
    markSelectedItemAdjusted(item.id);
    renderItems();
    scheduleApply();
    event.stopPropagation();
    event.preventDefault();
  }

  function destroyCubismRenderer(id) {
    const renderer = cubismRenderers.get(id);
    if (!renderer) return;
    renderer.destroy?.();
    cubismRenderers.delete(id);
  }

  function resolveFrameHref(frameUrl) {
    if (!frameUrl) return '';
    try {
      return new URL(frameUrl, window.location.href).href;
    } catch (_) {
      return String(frameUrl);
    }
  }

  function markSequenceFrameReady(cache, url, failed = false) {
    cache.pending.delete(url);
    if (failed) cache.failed.add(url);
    else cache.loaded.add(url);
    scheduleApply();
  }

  function preloadSequenceFrame(cache, url) {
    if (!url || cache.loaded.has(url) || cache.pending.has(url) || cache.failed.has(url)) return;
    if (typeof window.Image !== 'function') {
      cache.loaded.add(url);
      return;
    }
    const image = new window.Image();
    image.decoding = 'async';
    image.loading = 'eager';
    cache.images.set(url, image);
    cache.pending.set(url, image);
    image.onload = () => {
      const decodePromise = typeof image.decode === 'function' ? image.decode() : null;
      if (decodePromise?.then) {
        decodePromise.then(
          () => markSequenceFrameReady(cache, url),
          () => markSequenceFrameReady(cache, url)
        );
      } else {
        markSequenceFrameReady(cache, url);
      }
    };
    image.onerror = () => markSequenceFrameReady(cache, url, true);
    image.src = url;
    if (image.complete && image.naturalWidth !== 0) markSequenceFrameReady(cache, url);
  }

  function ensureSequenceFrameCache(item) {
    const frameUrls = (Array.isArray(item.frames) ? item.frames : [])
      .map(resolveFrameHref)
      .filter(Boolean);
    const signature = frameUrls.join('\n');
    let cache = sequenceFrameCaches.get(item.id);
    if (!cache || cache.signature !== signature) {
      cache = {
        signature,
        images: new Map(),
        loaded: new Set(),
        pending: new Map(),
        failed: new Set()
      };
      sequenceFrameCaches.set(item.id, cache);
    }
    frameUrls.forEach((url) => preloadSequenceFrame(cache, url));
    return cache;
  }

  function isSequenceImageItem(item) {
    return item?.renderType !== 'live2d' && Array.isArray(item?.frames) && item.frames.length > 1;
  }

  function drawSequenceFrame(canvas, image, frameUrl) {
    if (!canvas || canvas.tagName !== 'CANVAS' || !image || !frameUrl || canvas.dataset.frameUrl === frameUrl) return;
    const width = Math.max(1, Math.round(image.naturalWidth || image.width || 1));
    const height = Math.max(1, Math.round(image.naturalHeight || image.height || width));
    const context = canvas.getContext?.('2d');
    if (!context) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    canvas.dataset.frameUrl = frameUrl;
  }

  function elementMatchesItem(element, item) {
    const tag = String(element?.tagName || '').toLowerCase();
    return item.renderType === 'live2d' || isSequenceImageItem(item) ? tag === 'canvas' : tag === 'img';
  }

  function attachItemListeners(element) {
    element.addEventListener('pointerdown', onItemPointerDown);
    element.addEventListener('pointermove', onItemPointerMove);
    element.addEventListener('pointerup', onItemPointerEnd);
    element.addEventListener('pointercancel', onItemPointerEnd);
    element.addEventListener('lostpointercapture', onItemPointerEnd);
    element.addEventListener('wheel', onItemWheel, { passive: false });
  }

  function createItemElement(item) {
    const canvasItem = item.renderType === 'live2d' || isSequenceImageItem(item);
    const element = document.createElement(canvasItem ? 'canvas' : 'img');
    element.className = item.renderType === 'live2d'
      ? 'live2d-vts-item live2d-vts-item-canvas'
      : isSequenceImageItem(item)
        ? 'live2d-vts-item live2d-vts-item-sequence-canvas'
        : 'live2d-vts-item';
    if (item.renderType === 'live2d') {
      try {
        cubismRenderers.set(item.id, createLocalVtsCubismItemRenderer(element));
      } catch (error) {
        element.dataset.live2dItemError = error?.message || 'Live2D item renderer unavailable';
      }
    }
    attachItemListeners(element);
    elements.set(item.id, element);
    return element;
  }

  function renderItems() {
    const container = findContainer();
    if (!container) return;
    const frontLayer = ensureLayer(container, FRONT_LAYER);
    const behindLayer = ensureLayer(container, BEHIND_LAYER);
    frontLayer.classList.toggle('editing', editorEnabled);
    behindLayer.classList.toggle('editing', editorEnabled);
    const validIds = new Set(items.map((item) => item.id));
    for (const [id, element] of elements) {
      if (!validIds.has(id)) {
        destroyCubismRenderer(id);
        sequenceFrameCaches.delete(id);
        element.remove();
        elements.delete(id);
      }
    }

    for (const item of items) {
      const layer = item.layer === BEHIND_LAYER ? behindLayer : frontLayer;
      let element = elements.get(item.id);
      if (element && !elementMatchesItem(element, item)) {
        destroyCubismRenderer(item.id);
        element.remove();
        elements.delete(item.id);
        element = null;
      }
      if (!element) element = createItemElement(item);
      if (element.parentElement !== layer) layer.appendChild(element);
      applyItemStaticStyle(element, item, container);
      element.classList.toggle('editing', editorEnabled);
      element.classList.toggle('selected', selectedHighlightActive(item));
      element.classList.toggle('delete-target', editorEnabled && editDragState?.id === item.id && itemInDeleteHotspot(item));
      element.tabIndex = editorEnabled ? 0 : -1;
      const visible = itemVisible(item, visibilityOverrides);
      element.hidden = !visible;
      if (visible && item.renderType !== 'live2d') {
        if (isSequenceImageItem(item)) ensureSequenceFrameCache(item);
        else if (!element.src) element.src = item.assetUrl;
      }
    }

    setOverlayState({
      mounted: true,
      status: 'ready',
      itemCount: items.length,
      visibleItemCount: items.filter((item) => itemVisible(item, visibilityOverrides)).length,
      unsupportedCount: unsupported.length
    });
    emitItemState();
  }

  function applyItems(now = performance.now()) {
    frameId = 0;
    const container = findContainer();
    if (!container) return;
    if (elements.size !== items.length) renderItems();
    let needsNextAnimationFrame = false;
    for (const item of items) {
      const element = elements.get(item.id);
      if (!element || element.hidden) continue;
      if (item.renderType === 'live2d') {
        const renderer = cubismRenderers.get(item.id);
        renderer?.render?.(item, frameState);
        if (renderer?.loadPromise) scheduleApply();
      } else if (isSequenceImageItem(item)) {
        needsNextAnimationFrame = true;
        const cache = ensureSequenceFrameCache(item);
        const frameIndex = Math.floor((now / 1000) * item.fps) % item.frames.length;
        const frameUrl = resolveFrameHref(item.frames[frameIndex]);
        if (frameUrl && cache.loaded.has(frameUrl)) drawSequenceFrame(element, cache.images.get(frameUrl), frameUrl);
      } else if (!element.src && item.assetUrl) {
        element.src = item.assetUrl;
      }
      applyItemSizing(element, item, container);
      element.style.transform = localVtsItemTransform(item, frameState).cssTransform;
    }
    if (needsNextAnimationFrame) scheduleApply();
  }

  async function reload() {
    const token = ++loadToken;
    setOverlayState({ mounted: true, status: 'loading' });
    const manifests = await Promise.all(manifestUrls.map(async (url) => ({
      url,
      manifest: await fetchJsonMaybe(url)
    })));
    if (destroyed || token !== loadToken) return;
    const normalized = manifests
      .filter((entry) => entry.manifest)
      .map((entry) => normalizeLocalVtsItemManifest(entry.manifest, {
        modelBaseUrl,
        source: entry.url
    }));
    items = normalized.flatMap((entry) => entry.items);
    unsupported = normalized.flatMap((entry) => entry.unsupported);
    if (selectedItemId && !items.some((item) => item.id === selectedItemId)) selectedItemId = '';
    renderItems();
    scheduleApply();
  }

  function onFrame(event) {
    frameState = localVtsFrameStateFromParameters(event.detail?.parameters);
    scheduleApply();
  }

  function onFaceFrame(event) {
    if (event.detail?.source === 'cubism-behavior' || event.detail?.source === 'local-cubism-fallback') {
      frameState = localVtsFrameStateFromParameters(event.detail?.parameters);
      scheduleApply();
    }
  }

  function onControl(event) {
    const detail = event.detail || {};
    const action = normalizeString(detail.action || detail.type || detail.command).toLowerCase();
    const id = detail.id || detail.itemId || detail.itemID || detail.name;
    if (action === 'reload') {
      reload();
    } else if (action === 'show') {
      setVisible(id, true);
    } else if (action === 'hide') {
      setVisible(id, false);
    } else if (action === 'toggle') {
      toggleVisible(id);
    } else if (action === 'set') {
      setVisible(id, normalizeBoolean(detail.visible, true));
    } else if (action === 'editor' || action === 'set-editor') {
      setEditorEnabled(normalizeBoolean(detail.enabled ?? detail.visible ?? detail.value, true));
    } else if (action === 'select') {
      selectItem(id);
    } else if (action === 'upsert' || action === 'add') {
      upsertItem(detail.item || detail.payload || detail, {
        basePath: detail.basePath || DEFAULT_ITEM_BASE_PATH,
        select: detail.select !== false
      });
    } else if (action === 'update') {
      updateItem(id, detail.patch || detail.item || detail.payload || detail);
    } else if (action === 'remove' || action === 'delete') {
      removeItem(id);
    }
  }

  window.addEventListener(LOCAL_CUBISM_FRAME_EVENT, onFrame);
  window.addEventListener('tsukuyomi:live2d-face', onFaceFrame);
  window.addEventListener(LOCAL_VTS_ITEM_CONTROL_EVENT, onControl);
  window.addEventListener('resize', scheduleApply);
  window.TSUKUYOMI_LOCAL_VTS_ITEMS = {
    reload,
    show: (id) => setVisible(id, true),
    hide: (id) => setVisible(id, false),
    toggle: (id) => toggleVisible(id),
    select: (id) => selectItem(id),
    setEditorEnabled,
    upsert: (item, options = {}) => upsertItem(item, options),
    update: (id, patch) => updateItem(id, patch),
    remove: (id) => removeItem(id),
    snapshot: () => itemStateSnapshot(),
    manifestItems: () => items.map((item) => localVtsItemToManifestItem({
      ...item,
      visible: itemVisible(item, visibilityOverrides)
    })),
    list: () => items.map((item) => ({
      id: item.id,
      name: item.name,
      visible: itemVisible(item, visibilityOverrides),
      layer: item.layer,
      renderType: item.renderType,
      source: item.source
    }))
  };
  reload();

  return () => {
    destroyed = true;
    window.removeEventListener(LOCAL_CUBISM_FRAME_EVENT, onFrame);
    window.removeEventListener('tsukuyomi:live2d-face', onFaceFrame);
    window.removeEventListener(LOCAL_VTS_ITEM_CONTROL_EVENT, onControl);
    window.removeEventListener('resize', scheduleApply);
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
    clearSelectedHighlightTimer();
    const container = findContainer();
    removeOverlayLayers(container);
    cubismRenderers.forEach((renderer) => renderer.destroy?.());
    cubismRenderers.clear();
    sequenceFrameCaches.clear();
    elements.clear();
    if (window.TSUKUYOMI_LOCAL_VTS_ITEMS) delete window.TSUKUYOMI_LOCAL_VTS_ITEMS;
    setOverlayState({ mounted: false, status: 'destroyed', itemCount: 0, visibleItemCount: 0 });
  };
}
