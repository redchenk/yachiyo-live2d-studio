import assert from 'node:assert/strict';
import { createServer } from 'vite';

class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, value);
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set();
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.classes.has(name) : Boolean(force);
    if (enabled) this.classes.add(name);
    else this.classes.delete(name);
    const base = String(this.element.className || '')
      .split(/\s+/)
      .filter((part) => part && part !== name);
    if (enabled) base.push(name);
    this.element.className = [...new Set(base)].join(' ');
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = new FakeStyle();
    this.classList = new FakeClassList(this);
    this.className = '';
    this.hidden = false;
    this.src = '';
    this.alt = '';
    this.width = 0;
    this.height = 0;
    this.drawnFrames = [];
    this.eventListeners = new Map();
  }

  appendChild(child) {
    if (child.parentElement) child.remove();
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  addEventListener(type, handler) {
    const listeners = this.eventListeners.get(type) || [];
    listeners.push(handler);
    this.eventListeners.set(type, listeners);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    return collectDescendants(this).filter((element) => matchesFakeSelector(element, selector));
  }

  getContext(type) {
    if (this.tagName !== 'CANVAS' || type !== '2d') return null;
    return {
      clearRect: () => {},
      drawImage: (image) => {
        this.drawnFrames.push(image.src);
      }
    };
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1000, height: 800 };
  }
}

function collectDescendants(root) {
  const result = [];
  for (const child of root.children || []) {
    result.push(child, ...collectDescendants(child));
  }
  return result;
}

function matchesFakeSelector(element, selector) {
  if (selector === 'img') return element.tagName === 'IMG';
  if (selector === 'canvas') return element.tagName === 'CANVAS';
  if (selector === '.live2d-vts-item-layer[data-live2d-vts-item-layer]') {
    return String(element.className || '').split(/\s+/).includes('live2d-vts-item-layer')
      && Boolean(element.dataset.live2dVtsItemLayer);
  }
  const layerMatch = String(selector).match(/^\.live2d-vts-item-layer\[data-layer="([^"]+)"\]$/);
  if (layerMatch) {
    return String(element.className || '').split(/\s+/).includes('live2d-vts-item-layer')
      && element.dataset.layer === layerMatch[1];
  }
  return false;
}

function createFakeOverlayDom() {
  const container = new FakeElement('div');
  const frameQueue = [];
  const images = new Map();
  let nextFrameId = 1;
  const listeners = new Map();
  class FakeImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.onload = null;
      this.onerror = null;
      this.decoding = '';
      this.loading = '';
      this._src = '';
    }

    set src(value) {
      this._src = value;
      images.set(value, this);
    }

    get src() {
      return this._src;
    }
  }
  const fakeWindow = {
    location: { href: 'http://127.0.0.1/' },
    Image: FakeImage,
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      frameQueue.push({ id, callback });
      return id;
    },
    cancelAnimationFrame(id) {
      const index = frameQueue.findIndex((frame) => frame.id === id);
      if (index >= 0) frameQueue.splice(index, 1);
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      listeners.set(type, handlers.filter((candidate) => candidate !== handler));
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) || []) handler(event);
    }
  };
  const fakeDocument = {
    createElement: (tagName) => new FakeElement(tagName),
    querySelector: (selector) => (selector === '#live2d-container' ? container : null)
  };
  return {
    window: fakeWindow,
    document: fakeDocument,
    container,
    queuedFrameCount: () => frameQueue.length,
    loadImage(url) {
      const image = images.get(url);
      assert.ok(image, `expected ${url} to be preloaded`);
      image.complete = true;
      image.naturalWidth = 64;
      image.naturalHeight = 32;
      image.onload?.();
    },
    flushNextFrame(now) {
      const frame = frameQueue.shift();
      assert.ok(frame, 'expected a queued animation frame');
      frame.callback(now);
    },
    flushAllFrames(now) {
      while (frameQueue.length) {
        const frame = frameQueue.shift();
        frame.callback(now);
      }
    }
  };
}

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
    mountLocalVtsItemOverlay,
    localVtsItemToManifestItem,
    localVtsFrameStateFromParameters,
    localVtsItemTransform,
    normalizeLocalVtsItemManifest,
    resolveLocalVtsItemAssetUrl
  } = await server.ssrLoadModule('/src/frontend/services/room/live2dLocalVtsItemOverlay.js');

  assert.equal(
    resolveLocalVtsItemAssetUrl('heart.gif'),
    '/models/tsukimi-yachiyo/items/heart.gif'
  );

  const normalized = normalizeLocalVtsItemManifest({
    Version: 1,
    BasePath: 'items',
    Items: [
      {
        Id: 'heart',
        Name: 'Heart',
        File: 'heart.gif',
        Visible: 'false',
        Layer: 'behind',
        Anchor: { X: 0.5, Y: 0.25 },
        Size: 0.2,
        Rotation: 5,
        Follow: {
          HeadX: 2,
          HeadY: -1,
          HeadZ: 0.5,
          BodyX: 1,
          BodyY: -0.5,
          BodyZ: 0.25
        }
      },
      {
        ItemID: 'bow',
        FileName: 'hair/bow.png',
        PositionX: 0.2,
        PositionY: -0.4,
        ItemSize: 96
      },
      {
        Id: 'animated-star',
        Frames: ['star-01.png', 'star-02.png'],
        FPS: 8
      },
      {
        Id: 'live2d-item-model',
        File: 'item.model3.json',
        ItemType: 'live2d',
        VTubeFile: 'item.vtube.json',
        Icon: 'Icons.png'
      },
      {
        Id: 'live2d-item-moc',
        File: 'item.moc3',
        ItemType: 'live2d'
      }
    ]
  });

  assert.equal(normalized.items.length, 5);
  assert.equal(normalized.unsupported.length, 0);

  const heart = normalized.items.find((item) => item.id === 'heart');
  assert.equal(heart.assetUrl, '/models/tsukimi-yachiyo/items/heart.gif');
  assert.equal(heart.visible, false);
  assert.equal(heart.layer, 'behind');
  assert.equal(heart.size.size, 0.2);

  const bow = normalized.items.find((item) => item.id === 'bow');
  assert.equal(bow.assetUrl, '/models/tsukimi-yachiyo/items/hair/bow.png');
  assert.deepEqual(bow.anchor, { x: 0.6, y: 0.7 });
  assert.equal(bow.size.size, 96);

  const animatedStar = normalized.items.find((item) => item.id === 'animated-star');
  assert.deepEqual(animatedStar.frames, [
    '/models/tsukimi-yachiyo/items/star-01.png',
    '/models/tsukimi-yachiyo/items/star-02.png'
  ]);
  assert.equal(animatedStar.fps, 8);
  assert.deepEqual(
    localVtsItemToManifestItem(animatedStar),
    {
      Id: 'animated-star',
      Name: 'animated-star',
      File: '',
      ItemType: 'sequence',
      Visible: true,
      Layer: 'front',
      Anchor: { X: 0.5, Y: 0.5 },
      Offset: { X: 0, Y: 0 },
      Scale: 1,
      Rotation: 0,
      Opacity: 1,
      Frames: ['star-01.png', 'star-02.png'],
      FPS: 8,
      Follow: {
        HeadX: 0,
        HeadY: 0,
        HeadZ: 0,
        BodyX: 0,
        BodyY: 0,
        BodyZ: 0,
        PositionX: 0,
        PositionY: 0
      }
    }
  );

  const live2dItem = normalized.items.find((item) => item.id === 'live2d-item-model');
  assert.equal(live2dItem.renderType, 'live2d');
  assert.equal(live2dItem.file, 'item.model3.json');
  assert.equal(live2dItem.assetUrl, '/models/tsukimi-yachiyo/items/item.model3.json');
  assert.equal(live2dItem.modelUrl, '/models/tsukimi-yachiyo/items/item.model3.json');
  assert.equal(live2dItem.vtubeUrl, '/models/tsukimi-yachiyo/items/item.vtube.json');
  assert.equal(live2dItem.previewUrl, '/models/tsukimi-yachiyo/items/Icons.png');
  assert.deepEqual(
    localVtsItemToManifestItem(live2dItem),
    {
      Id: 'live2d-item-model',
      Name: 'live2d-item-model',
      File: 'item.model3.json',
      ItemType: 'live2d',
      Visible: true,
      Layer: 'front',
      Anchor: { X: 0.5, Y: 0.5 },
      Offset: { X: 0, Y: 0 },
      Scale: 1,
      Rotation: 0,
      Opacity: 1,
      VTubeFile: 'item.vtube.json',
      Icon: 'Icons.png',
      Follow: {
        HeadX: 0,
        HeadY: 0,
        HeadZ: 0,
        BodyX: 0,
        BodyY: 0,
        BodyZ: 0,
        PositionX: 0,
        PositionY: 0
      }
    }
  );

  const live2dMoc = normalized.items.find((item) => item.id === 'live2d-item-moc');
  assert.equal(live2dMoc.file, 'item.model3.json');
  assert.equal(live2dMoc.renderType, 'live2d');

  const frameState = localVtsFrameStateFromParameters([
    { id: 'ParamAngle_HeadX', value: 10 },
    { id: 'ParamAngle_HeadY', value: -4 },
    { id: 'ParamAngle_HeadZ', value: 8 },
    { id: 'ParamAngle_BodyX', value: 3 },
    { id: 'ParamAngle_BodyY', value: 2 },
    { id: 'ParamAngle_BodyZ', value: -6 },
    { id: 'ParamMouthOpenY', value: 0.7 },
    { id: 'ParamEyeLOpen', value: 0.4 },
    { id: 'ParamEyeROpen', value: 0.5 }
  ]);
  assert.equal(frameState.mouthOpen, 0.7);
  assert.equal(frameState.eyeOpenLeft, 0.4);
  assert.equal(frameState.eyeOpenRight, 0.5);
  const transform = localVtsItemTransform(heart, frameState);
  assert.equal(transform.x, 23);
  assert.equal(transform.y, 3);
  assert.equal(transform.rotation, 7.5);
  assert.equal(
    transform.cssTransform,
    'translate(-50%, -50%) translate3d(23px, 3px, 0) rotate(7.5deg) scale(1, 1)'
  );

  const pinnedTransform = localVtsItemTransform(live2dItem, {
    headX: 30,
    headY: -20,
    headZ: 18,
    bodyX: 14,
    bodyY: -12,
    bodyZ: 9,
    positionX: 20,
    positionY: -18
  });
  assert.equal(pinnedTransform.x, 0);
  assert.equal(pinnedTransform.y, 0);
  assert.equal(pinnedTransform.rotation, 0);

  const overlayDom = createFakeOverlayDom();
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  globalThis.window = overlayDom.window;
  globalThis.document = overlayDom.document;
  globalThis.CustomEvent = FakeCustomEvent;
  try {
    const destroyOverlay = mountLocalVtsItemOverlay({ manifestUrls: [] });
    await Promise.resolve();
    overlayDom.flushAllFrames(0);
    overlayDom.window.TSUKUYOMI_LOCAL_VTS_ITEMS.upsert({
      Id: 'animated-star-overlay',
      Frames: ['star-01.png', 'star-02.png'],
      FPS: 2,
      Visible: true,
      Size: 120
    });
    const canvas = overlayDom.container.querySelector('canvas');
    assert.ok(canvas, 'sequence item should render as a canvas');
    const firstFrame = 'http://127.0.0.1/models/tsukimi-yachiyo/items/star-01.png';
    const secondFrame = 'http://127.0.0.1/models/tsukimi-yachiyo/items/star-02.png';
    overlayDom.loadImage(firstFrame);
    overlayDom.flushNextFrame(0);
    assert.equal(canvas.dataset.frameUrl, firstFrame);
    assert.deepEqual(canvas.drawnFrames, [firstFrame]);
    assert.equal(overlayDom.queuedFrameCount(), 1, 'visible sequence item should keep the animation loop alive');
    overlayDom.flushNextFrame(600);
    assert.equal(canvas.dataset.frameUrl, firstFrame, 'unloaded sequence frames should not replace the visible frame');
    assert.deepEqual(canvas.drawnFrames, [firstFrame]);
    overlayDom.loadImage(secondFrame);
    overlayDom.flushNextFrame(600);
    assert.equal(canvas.dataset.frameUrl, secondFrame);
    assert.deepEqual(canvas.drawnFrames, [firstFrame, secondFrame]);
    assert.equal(overlayDom.queuedFrameCount(), 1, 'sequence item should schedule the following frame after advancing');
    destroyOverlay();
    assert.equal(overlayDom.queuedFrameCount(), 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.CustomEvent = originalCustomEvent;
  }
} finally {
  await server.close();
}

console.log('local VTS item overlay checks passed');
