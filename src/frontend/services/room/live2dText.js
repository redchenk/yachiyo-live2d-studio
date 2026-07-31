const STAGE_DIRECTION_LABEL_PATTERN = /^\s*(?:动作|動作|行动|行動|表情|姿势|姿勢|肢体|肢體|语气|語氣|旁白|舞台指示|演出指示|Action(?:s)?|Expression|Pose|Motion|Body|Stage(?:\s+Direction)?|Narration|BEAT|EMOTION_BEAT|ACTION_BEAT|CAPTION|SUBTITLE|ZH_CAPTION|CONTROL|LIVE2D_CONTROL|speech_style|interruptPolicy)\s*[:：]/iu;
const STAGE_DIRECTION_WORD_PATTERN = /(?:歪头|歪頭|侧头|側頭|点头|點頭|颔首|頷首|摇头|搖頭|摆头|擺頭|靠近|凑近|湊近|贴近|貼近|前倾|前傾|后仰|後仰|左倾|左傾|右倾|右傾|侧身|側身|看向|望向|转身|轉身|挥手|揮手|摇摆|搖擺|晃动|晃動|轻晃|輕晃|蹦|跳|弹|彈|强调|強調|重音|拍|拍手|鼓掌|轻笑|輕笑|偷笑|大笑|微笑|害羞|脸红|臉紅|哭|流泪|流淚|眨眼|眨眼睛|清嗓|清了清嗓子|清喉咙|清了清喉咙|咳嗽|咳咳|干咳|輕咳|轻咳|giggles?|giggling|laughs?|laughing|looks?(?:\s+to)?(?:\s+the)?\s+(?:side|left|right|camera|chat)|glances?|turns?|waves?|waving|clears?(?:\s|-|_)?(?:her|his|their)?(?:\s|-|_)?throat|cough(?:s|ing)?|nods?|nodding|shake(?:s|ing)?(?:\s|-|_)?head|lean(?:s|ing)?(?:\s|-|_)?(?:in|forward|left|right)?|sways?|swaying|bounces?|bouncing|emphasizes?|accent|hits?|tilts?(?:\s|-|_)?head|wink(?:s|ing)?|smiles?|smiling|blush(?:es|ing)?|cries|crying|tears|首をかしげ|首を傾げ|首を傾け|うなず|頷|首を振|近づ|見つめ|横を見る|振り向|手を振|微笑|笑(?:う|い|って)|ゆら|跳ね|咳払い)/iu;
const WRAPPED_CUE_PATTERN = /([（(【\[])\s*([^()（）【】\[\]\n]{1,80})\s*([）)】\]])/gu;
const ITALIC_CUE_PATTERN = /(^|[\s\n])[*_]\s*([^*_\n]{1,80})\s*[*_](?=$|[\s\n,.!?;:，。！？；：])/gu;
const LEADING_CUE_PATTERN = /^\s*([^，。！？,.!?;:、\n]{1,36})\s*[，。！？,.!?;:、-]\s*/u;
const CUE_CLAUSE_SEPARATOR_PATTERN = /([，。！？,.!?;:、-]+)/u;
const INLINE_STAGE_CUE_START_PATTERN = /^(?:我|她|他|八千代|yachiyo|角色|模型)?\s*(?:轻轻地?|微微|稍微|缓缓|慢慢|快速|用力|开心地?|害羞地?|认真地?|俏皮地?|そっと|ゆっくり|少し|gently|softly|slightly|slowly|quickly|playfully)?\s*(?:歪头|歪頭|侧头|側頭|点头|點頭|颔首|頷首|摇头|搖頭|摆头|擺頭|靠近|凑近|湊近|贴近|貼近|前倾|前傾|后仰|後仰|左倾|左傾|右倾|右傾|侧身|側身|看向|望向|转身|轉身|挥手|揮手|摇摆|搖擺|晃动|晃動|轻晃|輕晃|蹦|跳|弹|彈|强调|強調|重音|眨眼|眨眼睛|微笑|害羞|脸红|臉紅|哭|流泪|流淚|清嗓|清了清嗓子|清喉咙|清了清喉咙|咳嗽|咳咳|干咳|輕咳|轻咳|giggles?|giggling|laughs?|laughing|looks?(?:\s+to)?(?:\s+the)?\s+(?:side|left|right|camera|chat)|glances?|turns?|waves?|waving|clears?(?:\s|-|_)?(?:her|his|their)?(?:\s|-|_)?throat|cough(?:s|ing)?|nods?|nodding|shake(?:s|ing)?(?:\s|-|_)?head|lean(?:s|ing)?(?:\s|-|_)?(?:in|forward|left|right)?|sways?|swaying|bounces?|bouncing|emphasizes?|accent|hits?|tilts?(?:\s|-|_)?head|wink(?:s|ing)?|smiles?|smiling|blush(?:es|ing)?|cries|crying|tears|首をかしげ|首を傾げ|首を傾け|うなず|頷|首を振|近づ|見つめ|横を見る|振り向|手を振|微笑|笑(?:う|い|って)|ゆら|跳ね|咳払い)/iu;

const LIVE2D_CONTROL_JSON_FIELD_PATTERN = /"(?:reply|text|message|caption|subtitle|caption_zh|captionZh|live2d|act|pose|motion|emotion|expression|expressionMix|bodyPose|parameters|parameterTargets|sequence|durationMs|intensity|actions|behaviorActions|speech_style|speechStyle|interruptPolicy|memory_writes|acknowledgedIndexes)"\s*:/i;
const CONTROL_PROTOCOL_LINE_PATTERN = /^\s*(?:BEAT|EMOTION_BEAT|ACTION_BEAT|CAPTION|SUBTITLE|ZH_CAPTION|CONTROL|JSON|LIVE2D_CONTROL|actions?|behaviorActions?|speech_style|speechStyle|interruptPolicy|live2d|parameters?|parameterTargets?)\s*[:：]/iu;
const SEMANTIC_ACTION_ID_PATTERN = /\b(?:look_at_chat|head_tilt|lean_in|shake_head|ear_wiggle|ear_perk|tongue_out|closed_smile|closed_eyes|tear_drop|watery_eyes|breathe|bounce|sway|smirk|blink|wink|nod|wave|emphasis|shiver)\b/iu;

function normalizeStageText(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
}

function unwrapJsonFence(text) {
  const value = String(text || '').trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : value;
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeJsonEscape(char, tail) {
  if (char === 'n') return ['\n', 0];
  if (char === 'r') return ['\r', 0];
  if (char === 't') return ['\t', 0];
  if (char === 'b') return ['\b', 0];
  if (char === 'f') return ['\f', 0];
  if (char === 'u') {
    const hex = tail.slice(0, 4);
    if (/^[0-9a-f]{4}$/i.test(hex)) {
      return [String.fromCharCode(parseInt(hex, 16)), 4];
    }
  }
  return [char, 0];
}

export function readLive2DJsonStringField(text, fieldName) {
  const value = unwrapJsonFence(normalizeStageText(text));
  const marker = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*"`, 'i').exec(value);
  if (!marker) return '';

  let result = '';
  let index = marker.index + marker[0].length;
  while (index < value.length) {
    const char = value[index];
    if (char === '"') return result.trim();
    if (char === '\\') {
      const next = value[index + 1];
      if (!next) break;
      const [decoded, consumed] = decodeJsonEscape(next, value.slice(index + 2));
      result += decoded;
      index += 2 + consumed;
      continue;
    }
    result += char;
    index += 1;
  }
  return result.trim();
}

export function stripLive2DControlJson(text) {
  const value = unwrapJsonFence(normalizeStageText(text));
  if (!value.trim()) return value;

  const startsLikeJson = /^[\s`]*(?:\{|\[\s*(?:\{|"))/u.test(String(text || ''));
  if (!startsLikeJson && !LIVE2D_CONTROL_JSON_FIELD_PATTERN.test(value)) return value;

  const reply =
    readLive2DJsonStringField(value, 'reply') ||
    readLive2DJsonStringField(value, 'text') ||
    readLive2DJsonStringField(value, 'message');
  if (reply) return reply;

  return startsLikeJson || LIVE2D_CONTROL_JSON_FIELD_PATTERN.test(value)
    ? ''
    : value;
}

function isStageDirection(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return STAGE_DIRECTION_LABEL_PATTERN.test(value) || STAGE_DIRECTION_WORD_PATTERN.test(value);
}

function stripStageLabelLine(line) {
  const trimmed = String(line || '').trim();
  if (!STAGE_DIRECTION_LABEL_PATTERN.test(trimmed)) return line;
  const rest = trimmed.replace(STAGE_DIRECTION_LABEL_PATTERN, '').trim();
  const leading = rest.match(LEADING_CUE_PATTERN);
  if (leading && isStageDirection(leading[1])) return rest.slice(leading[0].length).trim();
  return '';
}

function stripLeadingCue(line) {
  const value = String(line || '').trimStart();
  const leading = value.match(LEADING_CUE_PATTERN);
  if (!leading || !isInlineStageCue(leading[1])) return line;
  return value.slice(leading[0].length).trimStart();
}

function isInlineStageCue(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 42) return false;
  return STAGE_DIRECTION_LABEL_PATTERN.test(value) || INLINE_STAGE_CUE_START_PATTERN.test(value);
}

function stripInlineCueClauses(line) {
  const parts = String(line || '').split(CUE_CLAUSE_SEPARATOR_PATTERN);
  if (parts.length < 3) return line;
  const kept = [];
  for (let index = 0; index < parts.length; index += 2) {
    const clause = parts[index];
    const delimiter = parts[index + 1] || '';
    if (isInlineStageCue(clause)) continue;
    kept.push(clause);
    if (delimiter) kept.push(delimiter);
  }
  return kept.join('');
}

function stripPureCueLine(line) {
  const value = String(line || '').trim();
  if (!value) return '';
  if (CONTROL_PROTOCOL_LINE_PATTERN.test(value)) return '';
  if (isInlineStageCue(value)) return '';
  const actionIds = value.match(new RegExp(SEMANTIC_ACTION_ID_PATTERN.source, 'giu')) || [];
  const actionRemainder = value
    .replace(new RegExp(SEMANTIC_ACTION_ID_PATTERN.source, 'giu'), '')
    .replace(/[\s,./|+&;:：，。！？!?'"`~()（）\[\]【】_-]+/gu, '');
  return actionIds.length > 0 && !actionRemainder ? '' : line;
}

export function extractLive2DStageDirections(text) {
  const value = normalizeStageText(text);
  const directions = [];

  value.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (STAGE_DIRECTION_LABEL_PATTERN.test(trimmed)) {
      directions.push(trimmed.replace(STAGE_DIRECTION_LABEL_PATTERN, '').trim());
    }
  });

  value.replace(WRAPPED_CUE_PATTERN, (match, open, inner) => {
    if (isStageDirection(inner)) directions.push(inner.trim());
    return match;
  });
  value.replace(ITALIC_CUE_PATTERN, (match, prefix, inner) => {
    if (isStageDirection(inner)) directions.push(inner.trim());
    return match;
  });

  return directions.join('\n').trim();
}

export function stripLive2DStageDirections(text) {
  return normalizeStageText(text)
    .split(/\r?\n/)
    .map(stripStageLabelLine)
    .filter((line) => String(line || '').trim())
    .join('\n')
    .replace(WRAPPED_CUE_PATTERN, (match, open, inner) => (isStageDirection(inner) ? '' : match))
    .replace(ITALIC_CUE_PATTERN, (match, prefix, inner) => (isStageDirection(inner) ? prefix : match))
    .split(/\r?\n/)
    .map(stripLeadingCue)
    .map(stripInlineCueClauses)
    .map(stripPureCueLine)
    .filter((line) => String(line || '').trim())
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:，。！？；：])/g, '$1')
    .replace(/([，,、;:：；-])\s*$/u, '')
    .replace(/([（(【\[])\s+/g, '$1')
    .replace(/\s+([）)】\]])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanLive2DReply(text) {
  return stripLive2DStageDirections(stripLive2DControlJson(text)) || '';
}
