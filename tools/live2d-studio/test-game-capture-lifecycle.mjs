import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});

try {
  const { createLive2DGameCapture } = await server.ssrLoadModule(
    '/src/frontend/services/room/live2dGameCapture.js'
  );

  const videoTrack = new EventTarget();
  videoTrack.kind = 'video';
  videoTrack.label = 'Yachiyo Test Game';
  let stopped = false;
  videoTrack.stop = () => { stopped = true; };
  const stream = {
    getTracks: () => [videoTrack],
    getVideoTracks: () => [videoTrack]
  };
  let requestedConstraints = null;
  const mediaDevices = {
    getDisplayMedia: async (constraints) => {
      requestedConstraints = constraints;
      return stream;
    }
  };
  const states = [];
  const video = {
    srcObject: null,
    muted: false,
    playsInline: false,
    playCalls: 0,
    async play() { this.playCalls += 1; }
  };

  const capture = createLive2DGameCapture({
    mediaDevices,
    onState: (state) => states.push(state)
  });
  capture.attach(video);
  const active = await capture.start();

  assert.equal(active.status, 'live');
  assert.equal(active.sourceLabel, 'Yachiyo Test Game');
  assert.equal(requestedConstraints.audio, false, 'game preview must not replay captured audio');
  assert.equal(requestedConstraints.video.frameRate.ideal, 60);
  assert.equal(video.srcObject, stream);
  assert.equal(video.muted, true);
  assert.equal(video.playsInline, true);
  assert.equal(video.playCalls, 1);
  assert.equal(capture.isActive(), true);

  videoTrack.dispatchEvent(new Event('ended'));
  assert.equal(capture.snapshot().status, 'ended');
  assert.equal(video.srcObject, null);

  await capture.start();
  capture.stop();
  assert.equal(stopped, true);
  assert.equal(capture.snapshot().status, 'idle');
  assert.ok(states.some((state) => state.status === 'selecting'));
  assert.ok(states.some((state) => state.status === 'live'));

  console.log('Game capture lifecycle checks passed');
} finally {
  await server.close();
}
