import fs from 'node:fs';

// The upstream Cubism application sources are not in this repository. Keep the
// small integration patch reproducible, and fail if an upstream bundle changes.
const file = new URL('../../lib/bundled/live2d-room-neuro-live.iife.js', import.meta.url);
let source = fs.readFileSync(file, 'utf8');
function replaceOnce(before, after) {
  if (source.includes(after)) return;
  if (source.split(before).length !== 2) throw new Error(`Cubism patch anchor changed: ${before.slice(0, 90)}`);
  source = source.replace(before, after);
}
replaceOnce('function Zi(){', `
// Advance an absolute deadline: rounding a 60 Hz callback to 16.6 ms must not
// discard a whole frame. Skip missed deadlines rather than replaying old poses.
function tsukuyomiCubismShouldRender(state, now) {
  if (!state.visible) return false;
  const interval = state.targetFrameMs;
  const tolerance = 0.5;
  if (!Number.isFinite(state.nextRenderAt)) state.nextRenderAt = now;
  if (now + tolerance < state.nextRenderAt) return false;
  state.nextRenderAt += (Math.floor(Math.max(0, now + tolerance - state.nextRenderAt) / interval) + 1) * interval;
  state.lastRenderAt = now;
  return true;
}
function Zi(){`);
replaceOnce('if($.visible&&e-$.lastRenderAt>=$.targetFrameMs){if($.lastRenderAt=e,a)', 'if(tsukuyomiCubismShouldRender($,e)){if(a)');
replaceOnce('$.visible=document.visibilityState!==`hidden`,$.lastRenderAt=0', '$.visible=document.visibilityState!==`hidden`,$.lastRenderAt=0,$.nextRenderAt=undefined');
replaceOnce('i&&r.setExpression(i,na(t.durationMs)),Ji.has(String(t.motion||``).toLowerCase())&&r.startTapBodyMotion();let a=ra(t.bodyPose||t.motion);a&&r.startProceduralBodyPose(a,Number(t.intensity),na(t.durationMs)),r.setParameterTargets(t.parameters)',
  'i&&r.setExpression(i,na(t.durationMs));if(!window.TSUKUYOMI_CUBISM_BEHAVIOR_BRIDGE){Ji.has(String(t.motion||``).toLowerCase())&&r.startTapBodyMotion();let a=ra(t.bodyPose||t.motion);a&&r.startProceduralBodyPose(a,Number(t.intensity),na(t.durationMs))}r.setParameterTargets(t.parameters)');
replaceOnce('this.setParameterTargets([]),this._models.clear()', 'this.setParameterTargets([]),this._activeExpression=null,this._models.clear()');
replaceOnce('this._expressionResetTimer=null;let e=this._models.at(0);e&&e.setExpression(`neutral`)', 'this._expressionResetTimer=null;this.setExpression(`neutral`)');
replaceOnce('n&&e&&(n.setExpression(e),e===`neutral`?', 'n&&e&&(this._activeExpression!==e&&(n.setExpression(e),this._activeExpression=e),e===`neutral`?');
replaceOnce('e&&(e.setRandomExpression(),this.scheduleNeutralExpressionReset())', 'e&&(this._activeExpression=null,e.setRandomExpression(),this.scheduleNeutralExpressionReset())');
fs.writeFileSync(file, source);
console.log('Cubism cadence and transition integration patch applied');
