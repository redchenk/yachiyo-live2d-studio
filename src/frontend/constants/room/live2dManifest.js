export const roomLive2DManifest = {
  id: 'tsukimi-yachiyo',
  name: 'Tsukimi Yachiyo',
  modelJson: '/models/tsukimi-yachiyo/tsukimi-yachiyo.model3.json',
  expressions: [
    {
      id: 'neutral',
      label: 'Neutral',
      emotion: 'neutral',
      prompt: 'calm, attentive, listening, or no strong emotion'
    },
    {
      id: 'smile',
      label: 'Smile',
      emotion: 'happy',
      prompt: 'warm, happy, reassured, or gentle smile'
    },
    {
      id: 'bsmile',
      label: 'Shy smile',
      emotion: 'shy',
      prompt: 'shy, blushing, playful, smug, or mildly annoyed'
    },
    {
      id: 'namida',
      label: 'Tearful',
      emotion: 'sad',
      prompt: 'sad, lonely, moved, or eyes welling up'
    },
    {
      id: 'tears',
      label: 'Crying',
      emotion: 'crying',
      prompt: 'crying, strongly hurt, or clearly shedding tears'
    }
  ],
  motions: [
    {
      id: 'nod',
      label: 'Nod',
      prompt: 'agreeing, greeting, or acknowledging the audience'
    },
    {
      id: 'shake_head',
      label: 'Shake head',
      prompt: 'gentle refusal, surprise, or playful disagreement'
    },
    {
      id: 'lean_in',
      label: 'Lean in',
      prompt: 'curiosity, whispering, intimacy, or focusing on the audience'
    },
    {
      id: 'lean_left',
      label: 'Lean left',
      prompt: 'playful tilt or soft side movement'
    },
    {
      id: 'lean_right',
      label: 'Lean right',
      prompt: 'playful tilt or soft side movement'
    },
    {
      id: 'sway',
      label: 'Sway',
      prompt: 'idle rhythmic body movement or cheerful energy'
    },
    {
      id: 'bounce',
      label: 'Bounce',
      prompt: 'excited response or lively emphasis'
    },
    {
      id: 'emphasis',
      label: 'Emphasis',
      prompt: 'small body accent when stressing a line'
    }
  ],
  parameterControls: [
    {
      id: 'ParamAngleX',
      label: 'Head yaw',
      prompt: 'small left-right head turns',
      min: -30,
      max: 30
    },
    {
      id: 'ParamAngleY',
      label: 'Head pitch',
      prompt: 'small up-down head motion or a subtle nod',
      min: -30,
      max: 30
    },
    {
      id: 'ParamAngleZ',
      label: 'Head roll',
      prompt: 'gentle head tilt or playful roll',
      min: -30,
      max: 30
    },
    {
      id: 'ParamBodyAngleX',
      label: 'Body lean',
      prompt: 'torso lean left-right',
      min: -10,
      max: 10
    },
    {
      id: 'ParamBodyAngleY',
      label: 'Body pitch',
      prompt: 'torso forward-back movement',
      min: -10,
      max: 10
    },
    {
      id: 'ParamBodyAngleZ',
      label: 'Body roll',
      prompt: 'torso twist or side sway',
      min: -10,
      max: 10
    },
    {
      id: 'ParamEyeBallX',
      label: 'Gaze X',
      prompt: 'look left-right without moving the whole head too much',
      min: -1,
      max: 1
    },
    {
      id: 'ParamEyeBallY',
      label: 'Gaze Y',
      prompt: 'look up-down without moving the whole head too much',
      min: -1,
      max: 1
    },
    {
      id: 'ParamEyeLOpen',
      label: 'Left eye open',
      prompt: 'temporary eye openness or a wink',
      min: 0,
      max: 1,
      experimental: true
    },
    {
      id: 'ParamEyeROpen',
      label: 'Right eye open',
      prompt: 'temporary eye openness or a wink',
      min: 0,
      max: 1,
      experimental: true
    },
    {
      id: 'ParamBrowLY',
      label: 'Left brow',
      prompt: 'left eyebrow raise, frown, or concern',
      min: -1,
      max: 1
    },
    {
      id: 'ParamBrowRY',
      label: 'Right brow',
      prompt: 'right eyebrow raise, frown, or concern',
      min: -1,
      max: 1
    },
    {
      id: 'ParamMouthForm',
      label: 'Mouth shape',
      prompt: 'smile or frown shape without forcing lip opening',
      min: -1,
      max: 1
    },
    {
      id: 'ParamCheek',
      label: 'Cheek',
      prompt: 'blush or cheek tension',
      min: 0,
      max: 1
    },
    {
      id: 'ParamBreath',
      label: 'Breath',
      prompt: 'subtle idle breathing',
      min: 0,
      max: 1
    }
  ]
};

export function live2DPromptCatalog(manifest = roomLive2DManifest) {
  const expressions = manifest.expressions
    .map((item) => `- ${item.id}: ${item.label}; use for ${item.prompt}`)
    .join('\n');
  const motions = manifest.motions
    .map((item) => `- ${item.id}: ${item.label}; use for ${item.prompt}`)
    .join('\n');
  const parameters = manifest.parameterControls
    .map((item) => `- ${item.id}: ${item.label}; use for ${item.prompt}; range ${item.min}..${item.max}${item.experimental ? '; experimental' : ''}`)
    .join('\n');

  return [
    'Live2D control whitelist:',
    'Available expression ids:',
    expressions,
    'Available bodyPose ids:',
    motions,
    'Available fine parameter ids:',
    parameters,
    'Control rules: only use listed ids. Use bodyPose for posture/body movement. Pair visible bodyPose choices with precise ParamAngle and ParamBodyAngle targets. Use parameters for gaze, head, torso, brow, mouth-shape, cheek, and breathing changes. Use bodyPose none when no body movement is needed.'
  ].join('\n');
}
