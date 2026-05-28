import fs from 'node:fs';
import path from 'node:path';
import { yachiyoVTubeStudioParameterSettings } from '../../src/frontend/constants/room/yachiyoModelParameterRegistry.js';

const targetArg = process.argv[2] || process.env.YACHIYO_VTUBE_JSON;

if (!targetArg) {
  console.error('Usage: npm run install:yachiyo-vts-parameters -- <path-to-model.vtube.json>');
  process.exit(1);
}

const targetPath = path.resolve(targetArg);

function smoothingFor(setting) {
  if (setting.input.startsWith('ParamSwitchCtrl_')) return 0;
  if (setting.input.startsWith('ParamBreath')) return 25;
  if (setting.input.startsWith('ParamBody') || setting.input.startsWith('ParamAngle_')) return 12;
  if (setting.input.startsWith('ParamHair')) return 18;
  return 20;
}

function toVTubeParameterSetting(setting) {
  return {
    Folder: 'Yachiyo Direct Control',
    Name: setting.name,
    Input: setting.input,
    InputRangeLower: setting.min,
    InputRangeUpper: setting.max,
    OutputRangeLower: setting.min,
    OutputRangeUpper: setting.max,
    ClampInput: false,
    ClampOutput: false,
    UseBlinking: false,
    UseBreathing: false,
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
