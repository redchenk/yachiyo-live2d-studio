function parameter(id, min, max, domain, options = {}) {
  return {
    id,
    min,
    max,
    domain,
    defaultValue: options.defaultValue ?? 0,
    smoothing: options.smoothing,
    outputMin: options.outputMin,
    outputMax: options.outputMax
  };
}

function chain(prefix, side, count, domain, options = {}) {
  return Array.from(
    { length: count },
    (_, index) => parameter(`${prefix}_${side}${index + 1}`, options.min ?? -1, options.max ?? 1, domain, options)
  );
}

function paired(prefix, count, domain, options = {}) {
  return [
    ...chain(prefix, 'L', count, domain, options),
    ...chain(prefix, 'R', count, domain, options)
  ];
}

function axis(prefix, axisName, count, domain, options = {}) {
  return Array.from(
    { length: count },
    (_, index) => parameter(`${prefix}_${axisName}${index + 1}`, options.min ?? -1, options.max ?? 1, domain, options)
  );
}

export const YACHIYO_MODEL_PARAMETERS = [
  parameter('ParamSwitchCtrl_BodyX', 0, 1, 'body-switch', { smoothing: 0, defaultValue: 1 }),
  parameter('ParamSwitchCtrl_BodyY', 0, 1, 'body-switch', { smoothing: 0, defaultValue: 1 }),
  parameter('ParamSwitchCtrl_BodyZ', 0, 1, 'body-switch', { smoothing: 0, defaultValue: 1 }),
  parameter('ParamSwitchCtrl_ChestZ', 0, 1, 'body-switch', { smoothing: 0, defaultValue: 1 }),
  parameter('ParamSwitchCtrl_HipZ', 0, 1, 'body-switch', { smoothing: 0, defaultValue: 1 }),
  parameter('ParamBodyInput_BodyX', -10, 10, 'body-input', { smoothing: 6 }),
  parameter('ParamBodyInput_BodyY', -10, 10, 'body-input', { smoothing: 6 }),
  parameter('ParamBodyInput_BodyZ', -10, 10, 'body-input', { smoothing: 6 }),
  parameter('ParamBodyInput_ChestZ', -10, 10, 'body-input', { smoothing: 6 }),
  parameter('ParamBodyInput_HipZ', -10, 10, 'body-input', { smoothing: 6 }),
  parameter('ParamOutput_BodyX', -10, 10, 'body-output', { smoothing: 8 }),
  parameter('ParamOutput_BodyY', -10, 10, 'body-output', { smoothing: 8 }),
  parameter('ParamOutput_BodyZ', -10, 10, 'body-output', { smoothing: 8 }),
  parameter('ParamOutput_ChestZ', -10, 10, 'body-output', { smoothing: 8 }),
  parameter('ParamOutput_HipZ', -10, 10, 'body-output', { smoothing: 8 }),
  parameter('ParamPhysicsRAM_BodyY', -10, 10, 'body-output', { smoothing: 10 }),
  parameter('ParamPosition_Z', -10, 10, 'body-depth', { smoothing: 8 }),
  parameter('ParamAngle_BodyX', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_BodyX2', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_BodyX3', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_BodyY', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_BodyY2', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_BodyZ', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_BodyZ2', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_ChestZ', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_HipZ', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_ShoulderL', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_ShoulderR', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_HipUp', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamAngle_HipDown', -10, 10, 'upper-body', { smoothing: 8 }),
  parameter('ParamHairFront', -10, 10, 'secondary-physics', { smoothing: 14 }),
  parameter('ParamHairSide', -10, 10, 'secondary-physics', { smoothing: 14 }),
  parameter('ParamHairBack', -10, 10, 'secondary-physics', { smoothing: 14 }),
  parameter('ParamEyeBallX2', -1, 1, 'eye-detail', { smoothing: 8 }),
  parameter('ParamEyeBallY2', -1, 1, 'eye-detail', { smoothing: 8 }),
  parameter('ParamEyeBallX3', -1, 1, 'eye-detail', { smoothing: 8 }),
  parameter('ParamEyeBallY3', -1, 1, 'eye-detail', { smoothing: 8 }),
  parameter('ParamMouthX2', -1, 1, 'mouth-detail', { smoothing: 0 }),
  parameter('ParamMouthShape', -1, 1, 'mouth-detail', { smoothing: 8 }),
  parameter('ParamCheekPuff2', 0, 1, 'mouth-detail', { smoothing: 8 }),
  ...paired('ParamEarShape', 3, 'ear-shape', { min: -1, max: 1 }),
  ...paired('ParamEarPhysics', 4, 'ear-physics', { min: -70, max: 70 }),
  ...paired('ParamEarPhysicsBS', 2, 'ear-physics', { min: -70, max: 70 }),
  ...axis('ParamHatPhysics', 'X', 4, 'hat-physics', { min: -30, max: 30 }),
  ...axis('ParamHatPhysics', 'Y', 4, 'hat-physics', { min: -30, max: 30 }),
  ...paired('ParamHatEar', 3, 'hat-ear', { min: -40, max: 40 }),
  ...paired('ParamWingPhysics', 4, 'wing-physics', { min: -70, max: 70 }),
  ...axis('ParamCheongsamPhysics', 'X', 5, 'cheongsam-physics', { min: -30, max: 30 }),
  parameter('ParamTongueOut_BS', 0, 1, 'tongue'),
  ...axis('ParamTonguePhysics', 'X', 2, 'tongue-physics', { min: -30, max: 30 }),
  ...axis('ParamTonguePhysics', 'Y', 2, 'tongue-physics', { min: -30, max: 30 }),
  ...paired('ParamDollEarPhysics', 4, 'doll-ear-physics', { min: -70, max: 70 })
];

export const YACHIYO_MODEL_PARAMETER_RANGES = Object.fromEntries(
  YACHIYO_MODEL_PARAMETERS.map((item) => [item.id, [item.min, item.max]])
);

export function yachiyoVTubeStudioParameterSettings() {
  return YACHIYO_MODEL_PARAMETERS.map((item) => ({
    name: `Yachiyo ${item.id}`,
    input: item.id,
    outputLive2D: item.id,
    min: item.min,
    max: item.max,
    inputRangeLower: item.min,
    inputRangeUpper: item.max,
    outputRangeLower: item.outputMin ?? item.min,
    outputRangeUpper: item.outputMax ?? item.max,
    defaultValue: item.defaultValue,
    createInput: true,
    smoothing: item.smoothing,
    domain: item.domain
  }));
}

export function yachiyoVTubeStudioCustomParameterSettings() {
  return yachiyoVTubeStudioParameterSettings().filter((item) => item.createInput !== false);
}
