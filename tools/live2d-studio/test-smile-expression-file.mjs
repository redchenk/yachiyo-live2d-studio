import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const expressionPath = new URL('../../models/tsukimi-yachiyo/expression_smile.exp3.json', import.meta.url);
const expression = JSON.parse(await readFile(expressionPath, 'utf8'));
const parameters = Array.isArray(expression.Parameters) ? expression.Parameters : [];
const parameterIds = new Set(parameters.map((parameter) => parameter.Id));

const closedEyeSmileParameters = [
  'ParamExpression_3',
  'ParamEyeSmile_Happy_L',
  'ParamEyeSmile_Happy_R',
  'ParamHide_EyesL1',
  'ParamHighLightHide_EyesL1',
  'ParamHide_EyeSocket',
  'ParamHide_EyeSocket2'
];

for (const id of closedEyeSmileParameters) {
  assert.equal(
    parameterIds.has(id),
    false,
    `plain smile expression should not include closed-eye parameter ${id}`
  );
}

assert.equal(parameterIds.has('ParamMouthForm'), true, 'plain smile should keep its mouth smile shape');
assert.equal(parameterIds.has('ParamCheek'), true, 'plain smile should keep its cheek lift');

const eyeTear = parameters.find((parameter) => parameter.Id === 'ParamExpression_1');
const leftEyeSmile = parameters.find((parameter) => parameter.Id === 'ParamEyeLSmile');
const rightEyeSmile = parameters.find((parameter) => parameter.Id === 'ParamEyeRSmile');

assert.ok(eyeTear, 'plain smile should borrow the model eye-tear highlight for a visible eye expression');
assert.ok(Number(eyeTear.Value) > 0 && Number(eyeTear.Value) <= 0.24, 'plain smile eye-tear highlight should stay subtle');
assert.ok(leftEyeSmile && rightEyeSmile, 'plain smile should include a subtle open-eye smile shape');
assert.ok(
  Number(leftEyeSmile.Value) > 0 &&
    Number(leftEyeSmile.Value) <= 0.28 &&
    Number(rightEyeSmile.Value) > 0 &&
    Number(rightEyeSmile.Value) <= 0.28,
  'plain smile eye-smile shape should stay below the closed-eye range'
);

console.log('plain smile expression file checks passed');
