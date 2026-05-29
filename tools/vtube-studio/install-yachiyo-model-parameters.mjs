import fs from 'node:fs';
import path from 'node:path';
import { yachiyoVTubeStudioParameterSettings } from '../../src/frontend/constants/room/yachiyoModelParameterRegistry.js';

const defaultTarget = path.resolve('models/tsukimi-yachiyo/tsukimi-yachiyo.vtube.json');
const targetArg = process.argv[2] || process.env.YACHIYO_VTUBE_JSON || defaultTarget;

const targetPath = path.resolve(targetArg);

function smoothingFor(setting) {
  if (Number.isFinite(Number(setting.smoothing))) return Number(setting.smoothing);
  if (setting.input.startsWith('ParamSwitchCtrl_')) return 0;
  if (setting.input.startsWith('ParamBreath')) return 25;
  if (setting.input.startsWith('ParamBody') || setting.input.startsWith('ParamAngle_')) return 12;
  if (setting.input.startsWith('ParamHair')) return 18;
  return 20;
}

function toVTubeParameterSetting(setting) {
  return {
    Folder: setting.folder || 'Yachiyo Direct Control',
    Name: setting.name,
    Input: setting.input,
    InputRangeLower: setting.inputRangeLower ?? setting.min,
    InputRangeUpper: setting.inputRangeUpper ?? setting.max,
    OutputRangeLower: setting.outputRangeLower ?? setting.min,
    OutputRangeUpper: setting.outputRangeUpper ?? setting.max,
    ClampInput: Boolean(setting.clampInput),
    ClampOutput: Boolean(setting.clampOutput),
    UseBlinking: Boolean(setting.useBlinking),
    UseBreathing: Boolean(setting.useBreathing),
    OutputLive2D: setting.outputLive2D,
    Smoothing: smoothingFor(setting),
    Minimized: false
  };
}

const model = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
if (!Array.isArray(model.ParameterSettings)) model.ParameterSettings = [];

const existing = new Map(
  model.ParameterSettings.map((item, index) => [`${item.Input}=>${item.OutputLive2D}`, { item, index }])
);
const desiredSettings = yachiyoVTubeStudioParameterSettings();
const desiredKeys = new Set(desiredSettings.map((setting) => `${setting.input}=>${setting.outputLive2D}`));

let added = 0;
let updated = 0;
const beforeCleanup = model.ParameterSettings.length;

model.ParameterSettings = model.ParameterSettings.filter((item) => {
  if (item.Folder !== 'Yachiyo Direct Control') return true;
  return desiredKeys.has(`${item.Input}=>${item.OutputLive2D}`);
});
const removed = beforeCleanup - model.ParameterSettings.length;

existing.clear();
model.ParameterSettings.forEach((item, index) => {
  existing.set(`${item.Input}=>${item.OutputLive2D}`, { item, index });
});

for (const setting of desiredSettings) {
  const key = `${setting.input}=>${setting.outputLive2D}`;
  const next = toVTubeParameterSetting(setting);
  const found = existing.get(key);
  if (found) {
    model.ParameterSettings[found.index] = { ...found.item, ...next };
    updated += 1;
  } else {
    model.ParameterSettings.push(next);
    added += 1;
  }
}

fs.writeFileSync(targetPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
console.log(`Installed Yachiyo VTS mappings: ${added} added, ${updated} updated, ${removed} stale removed`);
console.log(targetPath);
