import {
  normalizeBehaviorActionType,
  normalizeBehaviorToken
} from './behaviorActionRegistry';

function vts(id, value, weight = 0.55, mode = 'set') {
  return { id, value, weight, mode };
}

function action(type, duration = 1.2, delay = undefined, options = {}) {
  return {
    type,
    duration,
    ...(delay === undefined ? {} : { delay }),
    ...options
  };
}

export const YACHIYO_EXPRESSION_PRESETS = [
  {
    id: 'neutral',
    label: 'Neutral',
    emotion: 'neutral',
    prompt: 'calm, attentive, listening, or no strong emotion',
    aliases: ['none', 'normal', 'default', 'calm'],
    expression: 'neutral',
    files: ['neutral', 'expression_neutral'],
    actions: [action('look_at_chat', 1.0), action('breathe', 1.8, 0.1)],
    vts: [
      vts('MouthSmile', 0.56, 0.42),
      vts('Brows', 0.54, 0.3),
      vts('BrowLeftY', 0.54, 0.3),
      vts('BrowRightY', 0.54, 0.3)
    ]
  },
  {
    id: 'smile',
    label: 'Smile',
    emotion: 'happy',
    prompt: 'warm, happy, reassured, cheerful, or gentle smile',
    aliases: ['happy', 'joy', 'cheerful', 'gentle', 'warm', 'laugh'],
    expression: 'smile',
    files: ['smile', 'happy', 'expression_smile'],
    actions: [
      action('look_at_chat', 1.0),
      action('smile', 1.6, 0.05),
      action('nod', 1.25, 0.18)
    ],
    vts: [
      vts('MouthSmile', 0.82, 0.7),
      vts('Brows', 0.62, 0.46),
      vts('BrowLeftY', 0.62, 0.44),
      vts('BrowRightY', 0.62, 0.44),
      vts('EyeOpenLeft', 0.84, 0.26),
      vts('EyeOpenRight', 0.84, 0.26)
    ]
  },
  {
    id: 'bsmile',
    label: 'Soft Shy Smile',
    emotion: 'shy',
    prompt: 'legacy shy smile, soft blush, or playful smile',
    aliases: ['soft_smile', 'legacy_shy'],
    expression: 'bsmile',
    files: ['bsmile', 'blush', 'expression_bsmile'],
    actions: [
      action('look_at_chat', 1.0),
      action('smile', 1.45, 0.08),
      action('head_tilt', 1.2, 0.24, { side: 'right' })
    ],
    vts: [
      vts('MouthSmile', 0.76, 0.62),
      vts('Brows', 0.64, 0.42),
      vts('BrowLeftY', 0.64, 0.38),
      vts('BrowRightY', 0.64, 0.38),
      vts('EyeOpenLeft', 0.82, 0.22),
      vts('EyeOpenRight', 0.82, 0.22)
    ]
  },
  {
    id: 'shy',
    label: 'Shy',
    emotion: 'shy',
    prompt: 'embarrassed, blushing, bashful, or softly flustered',
    aliases: ['blush', 'embarrassed', 'bashful', 'flustered'],
    expression: 'shy',
    files: ['shy', 'blush', 'expression_shy', 'bsmile', 'expression_bsmile'],
    actions: [
      action('look_at_chat', 0.95),
      action('smile', 1.3, 0.06),
      action('head_tilt', 1.35, 0.18, { side: 'right' }),
      action('shiver', 1.0, 0.32, { intensity: 0.58 })
    ],
    vts: [
      vts('MouthSmile', 0.72, 0.66),
      vts('Brows', 0.66, 0.5),
      vts('BrowLeftY', 0.66, 0.46),
      vts('BrowRightY', 0.66, 0.46),
      vts('EyeOpenLeft', 0.78, 0.28),
      vts('EyeOpenRight', 0.78, 0.28),
      vts('EyeLeftY', -0.12, 0.34),
      vts('EyeRightY', -0.12, 0.34)
    ]
  },
  {
    id: 'smug',
    label: 'Smug',
    emotion: 'smug',
    prompt: 'smug, teasing, confident, sly, or playful provocation',
    aliases: ['smirk', 'teasing', 'playful', 'sly', 'confident'],
    expression: 'smug',
    files: ['smug', 'expression_smug', 'bsmile', 'expression_bsmile'],
    actions: [
      action('look_at_chat', 0.95),
      action('smirk', 1.55, 0.05),
      action('head_tilt', 1.25, 0.16, { side: 'left' }),
      action('lean_in', 1.3, 0.28, { intensity: 0.72 })
    ],
    vts: [
      vts('MouthSmile', 0.88, 0.78),
      vts('Brows', 0.6, 0.48),
      vts('BrowLeftY', 0.72, 0.55),
      vts('BrowRightY', 0.48, 0.55),
      vts('MouthX', -0.24, 0.36),
      vts('EyeOpenLeft', 0.8, 0.22),
      vts('EyeOpenRight', 0.88, 0.22)
    ]
  },
  {
    id: 'surprised',
    label: 'Surprised',
    emotion: 'surprised',
    prompt: 'surprised, shocked, startled, impressed, or suddenly curious',
    aliases: ['surprise', 'shock', 'shocked', 'startled', 'wow'],
    expression: 'surprised',
    files: ['surprised', 'surprise', 'expression_surprised'],
    actions: [
      action('surprised', 1.15),
      action('lean_in', 1.25, 0.1, { intensity: 0.76 }),
      action('blink', 0.34, 1.02),
      action('bounce', 1.0, 0.18, { intensity: 0.62 })
    ],
    vts: [
      vts('EyeOpenLeft', 1, 0.72),
      vts('EyeOpenRight', 1, 0.72),
      vts('Brows', 0.82, 0.72),
      vts('BrowLeftY', 0.82, 0.72),
      vts('BrowRightY', 0.82, 0.72),
      vts('MouthSmile', 0.42, 0.35),
      vts('JawOpen', 0.42, 0.34),
      vts('MouthFunnel', 0.5, 0.34)
    ]
  },
  {
    id: 'angry',
    label: 'Angry',
    emotion: 'angry',
    prompt: 'angry, annoyed, irritated, stubborn, or scolding',
    aliases: ['annoyed', 'irritated', 'mad', 'upset', 'scold', 'angry_smile'],
    expression: 'angry',
    files: ['angry', 'expression_angry'],
    actions: [
      action('look_at_chat', 0.9),
      action('shake_head', 1.25, 0.05),
      action('lean_in', 1.35, 0.18, { intensity: 0.76 }),
      action('emphasis', 1.0, 0.38, { intensity: 0.72 })
    ],
    vts: [
      vts('MouthSmile', 0.28, 0.68),
      vts('Brows', 0.24, 0.72),
      vts('BrowLeftY', 0.22, 0.68),
      vts('BrowRightY', 0.22, 0.68),
      vts('EyeOpenLeft', 0.76, 0.28),
      vts('EyeOpenRight', 0.76, 0.28)
    ]
  },
  {
    id: 'puff',
    label: 'Pout',
    emotion: 'puff',
    prompt: 'pouting, sulking, cheek puff, mock annoyance, or cute refusal',
    aliases: ['pout', 'sulk', 'cheek_puff', 'cheekpuff'],
    expression: 'puff',
    files: ['puff', 'pout', 'expression_puff'],
    actions: [
      action('look_at_chat', 0.9),
      action('shake_head', 1.05, 0.08, { intensity: 0.58 }),
      action('head_tilt', 1.25, 0.2, { side: 'right', intensity: 0.68 })
    ],
    vts: [
      vts('MouthSmile', 0.34, 0.56),
      vts('CheekPuff', 0.86, 0.78),
      vts('MouthShrug', 0.48, 0.56),
      vts('Brows', 0.38, 0.48),
      vts('BrowLeftY', 0.38, 0.46),
      vts('BrowRightY', 0.38, 0.46)
    ]
  },
  {
    id: 'tongue',
    label: 'Tongue',
    emotion: 'tongue',
    prompt: 'playful tongue-out, teasing, mischief, or cheeky joke',
    aliases: ['blep', 'mischief', 'cheeky', 'tongue_out'],
    expression: 'tongue',
    files: ['tongue', 'tongue_out', 'expression_tongue'],
    actions: [
      action('look_at_chat', 0.9),
      action('smirk', 1.4, 0.06),
      action('wink', 0.52, 0.18, { side: 'right' }),
      action('lean_in', 1.2, 0.26, { intensity: 0.64 })
    ],
    vts: [
      vts('TongueOut', 1, 0.86),
      vts('MouthSmile', 0.78, 0.62),
      vts('MouthOpen', 0.22, 0.22),
      vts('EyeOpenLeft', 0.82, 0.24),
      vts('EyeOpenRight', 0.82, 0.24)
    ]
  },
  {
    id: 'dizzy',
    label: 'Dizzy',
    emotion: 'dizzy',
    prompt: 'dizzy, confused, overwhelmed, dazed, or stunned',
    aliases: ['confused', 'dazed', 'overwhelmed', 'stunned', 'panic'],
    expression: 'dizzy',
    files: ['dizzy', 'confused', 'expression_dizzy'],
    actions: [
      action('look_at_chat', 0.8),
      action('shake_head', 1.2, 0.05, { intensity: 0.55 }),
      action('sway', 1.6, 0.16, { intensity: 0.62 }),
      action('blink', 0.34, 0.9)
    ],
    vts: [
      vts('EyeOpenLeft', 0.62, 0.54),
      vts('EyeOpenRight', 0.62, 0.54),
      vts('Brows', 0.44, 0.46),
      vts('BrowLeftY', 0.44, 0.42),
      vts('BrowRightY', 0.44, 0.42),
      vts('MouthSmile', 0.38, 0.42),
      vts('MouthFunnel', 0.28, 0.28)
    ]
  },
  {
    id: 'namida',
    label: 'Tearful',
    emotion: 'sad',
    prompt: 'sad, lonely, moved, eyes welling up, or quietly hurt',
    aliases: ['sad', 'sorrow', 'tearful', 'moved', 'lonely'],
    expression: 'namida',
    files: ['namida', 'sad', 'tear', 'expression_namida'],
    actions: [
      action('look_at_chat', 0.9),
      action('nod', 1.25, 0.1, { intensity: 0.54 }),
      action('breathe', 1.8, 0.18)
    ],
    vts: [
      vts('MouthSmile', 0.3, 0.58),
      vts('Brows', 0.32, 0.58),
      vts('BrowLeftY', 0.3, 0.52),
      vts('BrowRightY', 0.3, 0.52),
      vts('EyeOpenLeft', 0.76, 0.28),
      vts('EyeOpenRight', 0.76, 0.28)
    ]
  },
  {
    id: 'tears',
    label: 'Tears',
    emotion: 'crying',
    prompt: 'crying, hurt, watery-eyed, or visibly upset',
    aliases: ['cry', 'crying', 'weeping', 'sob', 'sobbing'],
    expression: 'tears',
    files: ['tears', 'cry', 'crying', 'expression_tears'],
    actions: [
      action('look_at_chat', 0.85),
      action('shiver', 1.1, 0.08, { intensity: 0.54 }),
      action('nod', 1.35, 0.18, { intensity: 0.5 }),
      action('breathe', 1.6, 0.36)
    ],
    vts: [
      vts('MouthSmile', 0.24, 0.62),
      vts('Brows', 0.24, 0.66),
      vts('BrowLeftY', 0.24, 0.6),
      vts('BrowRightY', 0.24, 0.6),
      vts('EyeOpenLeft', 0.68, 0.32),
      vts('EyeOpenRight', 0.68, 0.32)
    ]
  },
  {
    id: 'crying',
    label: 'Crying',
    emotion: 'crying',
    prompt: 'strong crying, emotional collapse, or dramatic tears',
    aliases: ['hard_cry', 'big_cry', 'wail'],
    expression: 'crying',
    files: ['crying', 'tears', 'expression_crying', 'expression_tears'],
    actions: [
      action('look_at_chat', 0.8),
      action('shiver', 1.2, 0.05, { intensity: 0.62 }),
      action('shake_head', 1.1, 0.2, { intensity: 0.5 }),
      action('breathe', 1.5, 0.4)
    ],
    vts: [
      vts('MouthSmile', 0.2, 0.66),
      vts('Brows', 0.2, 0.72),
      vts('BrowLeftY', 0.2, 0.66),
      vts('BrowRightY', 0.2, 0.66),
      vts('EyeOpenLeft', 0.64, 0.34),
      vts('EyeOpenRight', 0.64, 0.34)
    ]
  },
  {
    id: 'fire',
    label: 'Fire',
    emotion: 'fire',
    prompt: 'fired up, intense anger, competitive mode, or dramatic resolve',
    aliases: ['rage', 'furious', 'heated', 'fired_up', 'serious'],
    expression: 'fire',
    files: ['fire', 'expression_fire'],
    actions: [
      action('look_at_chat', 0.85),
      action('lean_in', 1.25, 0.05, { intensity: 0.82 }),
      action('emphasis', 1.0, 0.18, { intensity: 0.86 }),
      action('shake_head', 1.1, 0.34, { intensity: 0.62 })
    ],
    vts: [
      vts('MouthSmile', 0.24, 0.68),
      vts('Brows', 0.2, 0.72),
      vts('BrowLeftY', 0.2, 0.66),
      vts('BrowRightY', 0.2, 0.66),
      vts('EyeOpenLeft', 0.74, 0.36),
      vts('EyeOpenRight', 0.74, 0.36)
    ]
  }
];

const PRESETS_BY_ID = new Map(YACHIYO_EXPRESSION_PRESETS.map((preset) => [preset.id, preset]));
const EXPRESSION_ALIASES = new Map();

for (const preset of YACHIYO_EXPRESSION_PRESETS) {
  [
    preset.id,
    preset.emotion,
    preset.expression,
    ...(preset.aliases || []),
    ...(preset.files || [])
  ].forEach((value) => {
    const key = normalizeBehaviorToken(value);
    if (key && !EXPRESSION_ALIASES.has(key)) EXPRESSION_ALIASES.set(key, preset.id);
  });
}

function cloneAction(item, index, options = {}) {
  const intensity = Number.isFinite(Number(item.intensity))
    ? Number(item.intensity)
    : Math.min(1, Math.max(0.05, Number(options.intensity) || 0.72));
  return {
    ...item,
    intensity,
    delay: item.delay ?? (index > 0 ? 0.1 + index * 0.12 : 0)
  };
}

export function normalizeSemanticExpressionId(value) {
  const key = normalizeBehaviorToken(value);
  return EXPRESSION_ALIASES.get(key) || '';
}

export function resolveSemanticExpressionPreset(value) {
  return PRESETS_BY_ID.get(normalizeSemanticExpressionId(value)) || null;
}

export function semanticExpressionFromEmotion(value) {
  const id = normalizeSemanticExpressionId(value);
  return id || (normalizeBehaviorToken(value) ? 'neutral' : '');
}

export function semanticExpressionManifestItems() {
  return YACHIYO_EXPRESSION_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    emotion: preset.emotion,
    prompt: preset.prompt
  }));
}

export function semanticExpressionIds() {
  return YACHIYO_EXPRESSION_PRESETS.map((preset) => preset.id);
}

export function semanticExpressionFileCandidates(value) {
  const preset = resolveSemanticExpressionPreset(value);
  const key = normalizeBehaviorToken(value);
  const base = preset
    ? [preset.expression, preset.id, ...(preset.files || []), ...(preset.aliases || [])]
    : [key];
  return [...new Set(
    base
      .filter(Boolean)
      .flatMap((item) => {
        const token = normalizeBehaviorToken(item);
        return token ? [token, `expression_${token}`] : [];
      })
  )];
}

export function semanticExpressionVTSOverlay(value) {
  const preset = resolveSemanticExpressionPreset(value);
  return preset?.vts ? preset.vts.map((item) => ({ ...item })) : [];
}

export function semanticExpressionBehaviorActions(value, options = {}) {
  const preset = resolveSemanticExpressionPreset(value);
  if (!preset?.actions?.length) return [];
  const existing = new Set((Array.isArray(options.existingActions) ? options.existingActions : [])
    .map((item) => normalizeBehaviorActionType(item?.type || item?.action || item?.name || item?.motion))
    .filter(Boolean));
  return preset.actions
    .filter((item) => {
      const type = normalizeBehaviorActionType(item.type);
      return type && !existing.has(type);
    })
    .slice(0, Math.max(0, Number(options.limit) || 4))
    .map((item, index) => cloneAction(item, index, options));
}

export function semanticExpressionPromptCatalog() {
  return [
    'Semantic emotion ids for the emotion field:',
    ...YACHIYO_EXPRESSION_PRESETS
      .filter((preset) => preset.id !== 'bsmile')
      .map((preset) => `- ${preset.id}: ${preset.prompt}`)
  ].join('\n');
}
