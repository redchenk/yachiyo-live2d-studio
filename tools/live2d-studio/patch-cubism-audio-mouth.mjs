import fs from 'node:fs';
// Keep this integration patch reproducible until upstream Cubism sources are vendored.
const file = new URL('../../lib/bundled/live2d-room-neuro-live.iife.js', import.meta.url);
let source = fs.readFileSync(file, 'utf8');
const before = 'this._model.setParameterValueById(this._idParamMouthOpenY,e.value*n)';
const after = 'this._model.setParameterValueById(this._idParamMouthOpenY,e.value*n*this._model.getParameterMaximumValue(this._model.getParameterIndex(this._idParamMouthOpenY)))';
if (!source.includes(after)) {
  if (source.split(before).length !== 2) throw new Error('Cubism mouth patch anchor changed');
  source = source.replace(before, after); fs.writeFileSync(file, source);
}
