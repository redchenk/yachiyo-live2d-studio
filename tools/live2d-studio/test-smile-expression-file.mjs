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
  'ParamEyeLSmile',
  'ParamEyeRSmile',
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

console.log('plain smile expression file checks passed');
