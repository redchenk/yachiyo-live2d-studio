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
    this.pointerCaptureId = null;
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

  dispatch(type, event = {}) {
    const dispatched = {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 0,
      clientY: 0,
      currentTarget: this,
      type,
      stopPropagation: () => {},
      preventDefault: () => {},
      ...event
    };
    for (const handler of this.eventListeners.get(type) || []) handler(dispatched);
    return dispatched;
  }

  setPointerCapture(pointerId) {
    this.pointerCaptureId = pointerId;
  }

  hasPointerCapture(pointerId) {
    return this.pointerCaptureId === pointerId;
  }

  releasePointerCapture(pointerId) {
    if (this.pointerCaptureId === pointerId) this.pointerCaptureId = null;
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
    if (this.rect) {
      const rect = {
        left: this.rect.left || 0,
        top: this.rect.top || 0,
        width: this.rect.width || 0,
        height: this.rect.height || 0
      };
      return {
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height
      };
    }
    const left = Number.parseFloat(this.style.left);
    const top = Number.parseFloat(this.style.top);
    const width = Number.parseFloat(this.style.width);
    const height = Number.parseFloat(this.style.height);
    if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(width) && Number.isFinite(height)) {
      return { left, top, width, height, right: left + width, bottom: top + height };
    }
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
  const page = new FakeElement('main');
  const container = new FakeElement('div');
  const caption = new FakeElement('section');
  caption.rect = { left: 100, top: 600, width: 360, height: 90 };
  page.appendChild(caption);
  page.appendChild(container);
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
    innerWidth: 1280,
    innerHeight: 720,
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
    body: page,
    createElement: (tagName) => new FakeElement(tagName),
    documentElement: { clientWidth: 1280, clientHeight: 720 },
    querySelector: (selector) => {
      if (selector === '#live2d-container') return container;
      if (selector === '.live2d-page') return page;
      if (selector === '.live2d-caption') return caption;
      return null;
    }
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
    inferLocalVtsItemManifestFollow,
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

  const moustacheManifestFollow = inferLocalVtsItemManifestFollow({
    Name: 'Moustache Black',
    File: 'moustache_black.png',
    ItemType: 'image'
  }, { x: 0.5, y: 0.58 });
  assert.equal(moustacheManifestFollow.Profile, 'mouth');
  assert.equal(moustacheManifestFollow.Auto, true);
  assert.ok(moustacheManifestFollow.HeadX > 0.2 && moustacheManifestFollow.HeadX < 0.35, 'mouth profile should follow head turns gently');
  assert.ok(moustacheManifestFollow.PinWeight > 0.05 && moustacheManifestFollow.PinWeight < 0.15, 'mouth profile should use a subtle face pivot orbit');
  assert.equal(moustacheManifestFollow.MaxOffset, 8, 'auto-pinned mouth items should have a tight follow limit');
  assert.equal(moustacheManifestFollow.PositionX, 0, 'auto face profiles should not multiply FacePositionX');
  assert.equal(moustacheManifestFollow.PositionY, 0, 'auto face profiles should not multiply FacePositionY');

  const followInferred = normalizeLocalVtsItemManifest({
    Version: 1,
    BasePath: 'items',
    Items: [
      {
        Id: 'moustache-auto',
        File: 'moustache_black.png',
        Anchor: { X: 0.5, Y: 0.58 },
        Size: 160
      }
    ]
  }).items[0];
  assert.equal(followInferred.follow.profile, 'mouth');
  assert.equal(followInferred.follow.maxOffset, 8);
  const facePinnedTransform = localVtsItemTransform(followInferred, {
    headX: 18,
    headY: 6,
    headZ: 12,
    bodyX: 0,
    bodyY: 0,
    bodyZ: 0,
    positionX: 0,
    positionY: 0
  }, {
    containerWidth: 1000,
    containerHeight: 800
  });
  assert.ok(facePinnedTransform.x > 2 && facePinnedTransform.x < 8, 'moustache should translate with head turn without overshooting');
  assert.ok(facePinnedTransform.rotation > 3 && facePinnedTransform.rotation < 5, 'moustache should rotate with head tilt subtly');
  assert.ok(facePinnedTransform.scaleX < 1, 'moustache should receive subtle yaw depth scaling');

  const extremeFacePinnedTransform = localVtsItemTransform(followInferred, {
    headX: 80,
    headY: 40,
    headZ: 60,
    bodyX: 20,
    bodyY: -20,
    bodyZ: 20,
    positionX: 0,
    positionY: 0
  }, {
    containerWidth: 1600,
    containerHeight: 1200
  });
  assert.ok(
    Math.hypot(extremeFacePinnedTransform.x, extremeFacePinnedTransform.y) <= followInferred.follow.maxOffset + 0.75,
    'auto-pinned item translation should stay within its follow limit even on a large stage'
  );

  const positionOnlyTransform = localVtsItemTransform(followInferred, {
    headX: 0,
    headY: 0,
    headZ: 0,
    bodyX: 0,
    bodyY: 0,
    bodyZ: 0,
    positionX: 15,
    positionY: -15
  }, {
    containerWidth: 1000,
    containerHeight: 800
  });
  assert.equal(positionOnlyTransform.x, 0, 'FacePositionX should not fling auto-pinned image items');
  assert.equal(positionOnlyTransform.y, 0, 'FacePositionY should not fling auto-pinned image items');

  const frozenTransform = localVtsItemTransform(followInferred, {
    headX: 18,
    headY: 6,
    headZ: 12,
    bodyX: 7,
    bodyY: -4,
    bodyZ: 5,
    positionX: 15,
    positionY: -15
  }, {
    containerWidth: 1000,
    containerHeight: 800,
    freezeFollow: true
  });
  assert.equal(frozenTransform.x, 0, 'selected items should stay stable while adjusting');
  assert.equal(frozenTransform.y, 0, 'selected items should stay stable while adjusting');
  assert.equal(frozenTransform.rotation, 0, 'selected items should not rotate from model motion while adjusting');
  assert.equal(frozenTransform.scaleX, 1, 'selected items should not depth-scale while adjusting');

  const noKeywordStatic = normalizeLocalVtsItemManifest({
    Version: 1,
    BasePath: 'items',
    Items: [
      {
        Id: 'plain-star',
        File: 'plain-star.png',
        Anchor: { X: 0.5, Y: 0.5 },
        Size: 160
      }
    ]
  }).items[0];
  assert.equal(noKeywordStatic.follow.profile, '');
  assert.equal(localVtsItemTransform(noKeywordStatic, { headX: 18, headZ: 12 }).x, 0);

  const overlayDom = createFakeOverlayDom();
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  globalThis.window = overlayDom.window;
  globalThis.document = overlayDom.document;
  globalThis.CustomEvent = FakeCustomEvent;
  try {
    const destroyOverlay = mountLocalVtsItemOverlay({ manifestUrls: [], selectionHighlightMs: 1 });
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
    overlayDom.window.TSUKUYOMI_LOCAL_VTS_ITEMS.setEditorEnabled(true);
    overlayDom.window.TSUKUYOMI_LOCAL_VTS_ITEMS.upsert({
      Id: 'delete-me',
      File: 'delete-me.png',
      Visible: true,
      Size: 120,
      Anchor: { X: 0.5, Y: 0.5 }
    });
    const image = overlayDom.container.querySelector('img');
    assert.ok(image, 'static item should render as an image');
    assert.match(image.className, /\bselected\b/);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.doesNotMatch(image.className, /\bselected\b/);
    image.dispatch('pointerdown', { pointerId: 9, clientX: 500, clientY: 400 });
    image.dispatch('pointermove', { pointerId: 9, clientX: 500, clientY: 640 });
    assert.match(image.className, /\bdelete-target\b/);
    image.dispatch('pointerup', { pointerId: 9, clientX: 500, clientY: 640 });
    assert.equal(
      overlayDom.window.TSUKUYOMI_LOCAL_VTS_ITEMS.snapshot().some((item) => item.id === 'delete-me'),
      false
    );
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
