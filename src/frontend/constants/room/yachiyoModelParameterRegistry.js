function parameter(id, min, max, domain, options = {}) {
  return {
    id,
    min,
    max,
    domain,
    defaultValue: options.defaultValue ?? 0,
    resetEachFrame: Boolean(options.resetEachFrame)
  };
}

function chain(prefix, side, count, domain, options = {}) {
  return Array.from(
    { length: count },
    (_, index) => parameter(`${prefix}_${side}${index + 1}`, options.min ?? -30, options.max ?? 30, domain, options)
  );
}

function numbered(prefix, count, domain, options = {}) {
  return Array.from(
    { length: count },
    (_, index) => parameter(`${prefix}${index + 1}`, options.min ?? -30, options.max ?? 30, domain, options)
  );
}

function paired(prefix, count, domain, options = {}) {
  return [
    ...chain(prefix, 'L', count, domain, options),
    ...chain(prefix, 'R', count, domain, options)
  ];
}

export const YACHIYO_BODY_SWITCH_PARAMETER_IDS = [
  'ParamSwitchCtrl_BodyX',
  'ParamSwitchCtrl_BodyY',
  'ParamSwitchCtrl_BodyZ',
  'ParamSwitchCtrl_ChestZ',
  'ParamSwitchCtrl_HipZ'
];

export const YACHIYO_MODEL_PARAMETERS = [
  parameter('ParamAngle_HeadX', -30, 30, 'head'),
  parameter('ParamAngle_HeadY', -30, 30, 'head'),
  parameter('ParamAngle_HeadZ', -30, 30, 'head'),
  parameter('ParamAngle_HeadZ2', -30, 30, 'head'),
  parameter('ParamAngleModify_HeadX', -30, 30, 'head'),
  parameter('ParamAngleModify_HeadY', -30, 30, 'head'),

  ...YACHIYO_BODY_SWITCH_PARAMETER_IDS.map((id) => parameter(id, 0, 1, 'body-switch', { defaultValue: 1 })),
  parameter('PositionZ', -30, 30, 'body'),
  parameter('ParamPosition_Z', -30, 30, 'body'),
  parameter('ParamBodyInput_BodyX', -30, 30, 'body'),
  parameter('ParamBodyInput_BodyY', -30, 30, 'body'),
  parameter('ParamBodyInput_BodyZ', -30, 30, 'body'),
  parameter('ParamBodyInput_ChestZ', -30, 30, 'body'),
  parameter('ParamBodyInput_HipZ', -30, 30, 'body'),
  parameter('ParamOutput_BodyX', -30, 30, 'body'),
  parameter('ParamOutput_BodyY', -30, 30, 'body'),
  parameter('ParamOutput_BodyZ', -30, 30, 'body'),
  parameter('ParamOutput_ChestZ', -30, 30, 'body'),
  parameter('ParamOutput_HipZ', -30, 30, 'body'),
  parameter('ParamPhysicsRAM_BodyX', -30, 30, 'body'),
  parameter('ParamPhysicsRAM_BodyY', -30, 30, 'body'),
  parameter('ParamPhysicsRAM_BodyZ', -30, 30, 'body'),
  parameter('ParamPhysicsRAM_ChestZ', -30, 30, 'body'),
  parameter('ParamPhysicsRAM_HipZ', -30, 30, 'body'),
  parameter('ParamAngle_BodyX', -30, 30, 'body'),
  parameter('ParamAngle_BodyX2', -30, 30, 'body'),
  parameter('ParamAngle_BodyX3', -30, 30, 'body'),
  parameter('ParamAngle_BodyY', -30, 30, 'body'),
  parameter('ParamAngle_BodyY2', -30, 30, 'body'),
  parameter('ParamAngle_BodyZ', -30, 30, 'body'),
  parameter('ParamAngle_BodyZ2', -30, 30, 'body'),
  parameter('ParamAngle_ChestZ', -30, 30, 'body'),
  parameter('ParamAngle_HipZ', -30, 30, 'body'),
  parameter('ParamAngle_ShoulderL', -30, 30, 'body'),
  parameter('ParamAngle_ShoulderR', -30, 30, 'body'),
  parameter('ParamAngle_HipUp', -30, 30, 'body'),
  parameter('ParamAngle_HipDown', -30, 30, 'body'),

  parameter('ParamHairFront', -30, 30, 'hair'),
  parameter('ParamHairSide', -30, 30, 'hair'),
  parameter('ParamHairBack', -30, 30, 'hair'),
  parameter('ParamBreath', 0, 1, 'breath', { defaultValue: 0.5 }),
  parameter('ParamBreath2', 0, 1, 'breath'),
  parameter('ParamBreath3', 0, 1, 'breath'),

  ...paired('ParamEarShape', 3, 'ear-shape', { min: -1, max: 1 }),
  ...paired('ParamEarPhysics', 4, 'ear'),
  ...paired('ParamEarPhysicsBS', 2, 'ear'),
  ...paired('ParamHatEar', 3, 'ear'),

  ...paired('ParamWingPhysics', 4, 'wing'),
  ...paired('ParamTailPhysics', 7, 'tail'),

  ...paired('ParamDressAngle', 3, 'cloth'),
  ...numbered('ParamDressPhysics_X', 6, 'cloth'),
  ...numbered('ParamDressPhysics_Y', 5, 'cloth'),
  ...numbered('ParamCheongsamPhysics_X', 5, 'cloth'),
  ...paired('ParamDressPhysics', 4, 'cloth'),
  ...paired('ParamSleevePhysics', 6, 'cloth'),
  ...paired('ParamSleeveLPhysics', 4, 'cloth'),
  ...paired('ParamBackClothesPhysics', 4, 'cloth'),
  ...numbered('ParamBackClothesPhysics_X', 4, 'cloth'),
  ...numbered('ParamBackClothesPhysics_Y', 4, 'cloth'),
  ...paired('ParamOvercoatPhysics', 5, 'cloth'),
  ...numbered('ParamOvercoatPhysics_X', 5, 'cloth'),
  ...numbered('ParamOvercoatPhysics_Y', 5, 'cloth'),

  ...paired('ParamBowHPhysics', 5, 'accessory'),
  ...paired('ParamBowBPhysics', 5, 'accessory'),
  ...paired('ParamHChainPhysics', 3, 'accessory'),
  ...paired('ParamBChainPhysics', 3, 'accessory'),
  ...paired('ParamHeadPendantPhysics', 6, 'accessory'),
  ...paired('ParamBodyPendantePhysics', 6, 'accessory'),
  ...numbered('ParamLiquidPhysics_X', 3, 'accessory'),
  parameter('ParamLiquidPhysics_Y', -30, 30, 'accessory'),
  parameter('ParamLiquidPhysics_Z', -30, 30, 'accessory'),
  parameter('ParamPearlPhysics_L1', -30, 30, 'accessory'),
  parameter('ParamPearlPhysics_L2', -30, 30, 'accessory'),

  parameter('ParamEyeBallX2', -1, 1, 'eye'),
  parameter('ParamEyeBallY2', -1, 1, 'eye'),
  parameter('ParamEyeBallX3', -1, 1, 'eye'),
  parameter('ParamEyeBallY3', -1, 1, 'eye'),
  parameter('ParamEyeLSquint', 0, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamEyeRSquint', 0, 1, 'expression', { resetEachFrame: true }),

  parameter('ParamBrowLY2', -1, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamBrowRY2', -1, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamBrowLAngle', -1, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamBrowRAngle', -1, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamBrowLForm', -1, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamBrowRForm', -1, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamBrowLX', -1, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamBrowRX', -1, 1, 'expression', { resetEachFrame: true }),

  parameter('ParamMouthThickness', -1, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamMouthStraight', -1, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamMouthShape', -1, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamMouthX2', -1, 1, 'expression', { resetEachFrame: true }),
  parameter('ParamCheekPuff2', 0, 1, 'expression', { resetEachFrame: true })
];

export const YACHIYO_MODEL_PARAMETER_RANGES = Object.fromEntries(
  YACHIYO_MODEL_PARAMETERS.map((item) => [item.id, [item.min, item.max]])
);

export const YACHIYO_MODEL_DIRECT_PARAMETER_IDS = new Set(
  YACHIYO_MODEL_PARAMETERS.map((item) => item.id)
);

const PARAMETERS_BY_KEY = new Map(
  YACHIYO_MODEL_PARAMETERS.map((item) => [item.id.toLowerCase(), item])
);

export function yachiyoDirectParameterIdForLive2D(id) {
  const key = String(id || '').trim().toLowerCase();
  return PARAMETERS_BY_KEY.get(key)?.id || '';
}

export function yachiyoParameterDomain(id) {
  return PARAMETERS_BY_KEY.get(String(id || '').trim().toLowerCase())?.domain || '';
}

export function yachiyoShouldResetParameterEachFrame(id) {
  return Boolean(PARAMETERS_BY_KEY.get(String(id || '').trim().toLowerCase())?.resetEachFrame);
}

export function yachiyoExpressionResetParameters() {
  return YACHIYO_MODEL_PARAMETERS
    .filter((item) => item.resetEachFrame)
    .map((item) => ({
      id: item.id,
      value: item.defaultValue,
      weight: 0.16
    }));
}

export function yachiyoVTubeStudioParameterSettings() {
  return YACHIYO_MODEL_PARAMETERS.map((item) => ({
    name: `Yachiyo ${item.id}`,
    input: item.id,
    outputLive2D: item.id,
    min: item.min,
    max: item.max,
    defaultValue: item.defaultValue
  }));
}
