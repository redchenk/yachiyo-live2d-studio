import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modelDirectory = new URL('../../models/tsukimi-yachiyo/', import.meta.url);
const closedSmileExpressionPath = new URL('笑咪咪.exp3.json', modelDirectory);
const plainSmileExpressionPath = new URL('expression_smile.exp3.json', modelDirectory);
const closedSmileExpression = JSON.parse(await readFile(closedSmileExpressionPath, 'utf8'));
const plainSmileExpression = JSON.parse(await readFile(plainSmileExpressionPath, 'utf8'));
const closedSmileParameters = Array.isArray(closedSmileExpression.Parameters) ? closedSmileExpression.Parameters : [];
const plainSmileParameters = Array.isArray(plainSmileExpression.Parameters) ? plainSmileExpression.Parameters : [];
const closedSmileParameterIds = new Set(closedSmileParameters.map((parameter) => parameter.Id));
const plainSmileParameterIds = new Set(plainSmileParameters.map((parameter) => parameter.Id));

const sharedSmileParameters = [
  'ParamExpression_3',
  'ParamEyeSmile_Happy_L',
  'ParamEyeSmile_Happy_R',
  'ParamEyeLSmile',
  'ParamEyeRSmile',
  'ParamMouthForm',
  'ParamCheek'
];
const closedEyeOnlyParameters = [
  'ParamHide_EyesL1',
  'ParamHighLightHide_EyesL1',
  'ParamHide_EyeSocket',
  'ParamHide_EyeSocket2'
];

for (const id of sharedSmileParameters) {
  assert.equal(
    closedSmileParameterIds.has(id),
    true,
    `closed smile expression should include shared smile parameter ${id}`
  );
  assert.equal(
    plainSmileParameterIds.has(id),
    true,
    `plain smile expression should include shared smile parameter ${id}`
  );
}

for (const id of closedEyeOnlyParameters) {
  assert.equal(
    closedSmileParameterIds.has(id),
    true,
    `closed smile expression should include model-authored closed-eye parameter ${id}`
  );
  assert.equal(
    plainSmileParameterIds.has(id),
    false,
    `plain smile expression should not include closed-eye parameter ${id}`
  );
}

assert.equal(
  plainSmileParameterIds.has('ParamMouthShape'),
  true,
  'plain smile should include an explicit mouth shape lift'
);

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
    expressions.some((expression) => expression.Name === 'smile' && expression.File === 'expression_smile.exp3.json'),
    true,
    `${file} should route smile to the open-eye smile expression`
  );
  assert.equal(
    expressions.some((expression) => expression.Name === 'closed_smile' && expression.File === '笑咪咪.exp3.json'),
    true,
    `${file} should expose closed_smile as the same model-authored expression`
  );
}

console.log('smile expression file separation checks passed');
