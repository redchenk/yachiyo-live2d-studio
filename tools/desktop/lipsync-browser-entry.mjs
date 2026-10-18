// Test-only entry, injected by verify-lipsync into the sandboxed renderer.
import { createLive2DSpeechPlayer } from '../../src/frontend/services/room/live2dSpeech.js';
import { saveLipsyncSettings } from '../../src/frontend/services/room/lipsyncSettings.js';
window.__lipsyncTools = { createLive2DSpeechPlayer, saveLipsyncSettings };
