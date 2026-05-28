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

export const YACHIYO_MODEL_PARAMETERS = [
  ...paired('ParamEarShape', 3, 'ear-shape', { min: -1, max: 1 })
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
