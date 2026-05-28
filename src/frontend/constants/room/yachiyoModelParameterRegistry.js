function parameter(id, min, max, domain, options = {}) {
  return {
    id,
    min,
    max,
    domain,
    defaultValue: options.defaultValue ?? 0
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
    defaultValue: item.defaultValue
  }));
}
