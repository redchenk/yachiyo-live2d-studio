import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const {
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
        HeadX: 1.15,
        HeadY: -0.82,
        HeadZ: 0.34,
        BodyX: 0.32,
        BodyY: -0.22,
        BodyZ: 0.16,
        PositionX: 1.15,
        PositionY: -1.15
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
} finally {
  await server.close();
}

console.log('local VTS item overlay checks passed');
