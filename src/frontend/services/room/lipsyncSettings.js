import { DEFAULT_VOWEL_PROFILE } from '../../../shared/lipsync-profile.mjs';
import { validateVowelProfile } from '../../../shared/audio-lipsync.mjs';
const KEY = 'roomAudioLipsyncSettings';
export function readLipsyncSettings() {
  let value = {};
  try { value = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  let profile = DEFAULT_VOWEL_PROFILE;
  try { if (value.profile) profile = validateVowelProfile(value.profile); } catch {}
  return { gain: Math.min(4, Math.max(0.25, Number(value.gain) || 1)),
    gateDb: Math.min(-20, Math.max(-60, Number(value.gateDb) || -38)),
    delayMs: Math.min(250, Math.max(0, Number(value.delayMs) || 0)), profile,
    calibrated: Array.isArray(value.calibrated) ? value.calibrated.filter(x => ['A', 'I', 'U', 'E', 'O', '-'].includes(x)) : [] };
}
export function saveLipsyncSettings(patch) {
  localStorage.setItem(KEY, JSON.stringify({ ...readLipsyncSettings(), ...patch }));
  window.dispatchEvent(new Event('tsukuyomi:lipsync-settings'));
  return readLipsyncSettings();
}
