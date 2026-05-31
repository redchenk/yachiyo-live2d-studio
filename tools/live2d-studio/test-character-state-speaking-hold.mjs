import assert from 'node:assert/strict';
import { createLive2DCharacterStateMachine } from '../../src/frontend/services/room/live2dCharacterStateMachine.js';

const state = createLive2DCharacterStateMachine();

state.onExternalState({
  mode: 'speaking',
  holdMs: 2200,
  attention: 0.88,
  arousal: 0.68
}, 1000);

state.sample(1900);
assert.equal(
  state.getState().mode,
  'speaking',
  'external streaming speech hold should keep speaking alive during a silent TTS boundary'
);

state.onExternalState({
  mode: 'listening',
  holdMs: 1200,
  attention: 0.62
}, 2050);

state.sample(2100);
assert.equal(
  state.getState().mode,
  'listening',
  'explicit listening state should still be able to settle after the streaming turn'
);

console.log('character state speaking hold checks passed');
