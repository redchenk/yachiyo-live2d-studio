import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modelDirectory = new URL('../../models/tsukimi-yachiyo/', import.meta.url);
const officialSmileExpressionPath = new URL('笑咪咪.exp3.json', modelDirectory);
const plainSmileExpressionPath = new URL('expression_smile.exp3.json', modelDirectory);
const officialSmileExpression = JSON.parse(await readFile(officialSmileExpressionPath, 'utf8'));
const plainSmileExpression = JSON.parse(await readFile(plainSmileExpressionPath, 'utf8'));
const officialSmileParameters = Array.isArray(officialSmileExpression.Parameters) ? officialSmileExpression.Parameters : [];
const plainSmileParameters = Array.isArray(plainSmileExpression.Parameters) ? plainSmileExpression.Parameters : [];
const officialSmileParameterIds = new Set(officialSmileParameters.map((parameter) => parameter.Id));
const plainSmileParameterIds = new Set(plainSmileParameters.map((parameter) => parameter.Id));

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
    officialSmileParameterIds.has(id),
    true,
    `official smile expression should include model-authored closed-eye parameter ${id}`
  );
  assert.equal(
    plainSmileParameterIds.has(id),
    false,
    `open smile fallback should not include closed-eye parameter ${id}`
  );
}

assert.equal(officialSmileParameterIds.has('ParamMouthForm'), true, 'official smile should keep its mouth smile shape');
assert.equal(officialSmileParameterIds.has('ParamCheek'), true, 'official smile should keep its cheek lift');
assert.equal(plainSmileParameterIds.has('ParamMouthForm'), true, 'open smile fallback should keep its mouth smile shape');
assert.equal(plainSmileParameterIds.has('ParamCheek'), true, 'open smile fallback should keep its cheek lift');

const modelFiles = [
  'tsukimi-yachiyo.model3.json',
  'tsukimi-yachiyo-lite.model3.json',
  'tsukimi-yachiyo-mobile.model3.json',
  'tsukimi-yachiyo-ios.model3.json'
];

for (const file of modelFiles) {
  const model = JSON.parse(await readFile(new URL(file, modelDirectory), 'utf8'));
  const expressions = Array.isArray(model?.FileReferences?.Expressions) ? model.FileReferences.Expressions : [];
  assert.equal(
    expressions.some((expression) => expression.Name === 'smile' && expression.File === '笑咪咪.exp3.json'),
    true,
    `${file} should route smile to the model-authored 笑咪咪 expression`
  );
  assert.equal(
    expressions.some((expression) => expression.Name === 'closed_smile' && expression.File === '笑咪咪.exp3.json'),
    true,
    `${file} should expose closed_smile as the same model-authored expression`
  );
}

console.log('official smile expression file checks passed');
