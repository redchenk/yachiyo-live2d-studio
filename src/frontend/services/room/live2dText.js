const STAGE_DIRECTION_LABEL_PATTERN = /^\s*(?:动作|動作|表情|姿势|姿勢|肢体|肢體|语气|語氣|Action|Expression|Pose|Motion|Body)\s*[:：]/iu;
const STAGE_DIRECTION_WORD_PATTERN = /(?:点头|點頭|颔首|頷首|摇头|搖頭|摆头|擺頭|靠近|凑近|湊近|贴近|貼近|前倾|前傾|后仰|後仰|左倾|左傾|右倾|右傾|摇摆|搖擺|晃动|晃動|轻晃|輕晃|蹦|跳|弹|彈|强调|強調|重音|拍|拍手|鼓掌|笑|微笑|害羞|脸红|臉紅|哭|流泪|流淚|眨眼|眨眼睛|清嗓|清了清嗓子|清喉咙|清了清喉咙|咳嗽|咳咳|干咳|輕咳|轻咳|clears?(?:\s|-|_)?(?:her|his|their)?(?:\s|-|_)?throat|cough(?:s|ing)?|nods?|nodding|shake(?:s|ing)?(?:\s|-|_)?head|lean(?:s|ing)?(?:\s|-|_)?(?:in|forward|left|right)?|sways?|swaying|bounces?|bouncing|emphasizes?|accent|hits?|tilts?(?:\s|-|_)?head|wink(?:s|ing)?|smiles?|smiling|blush(?:es|ing)?|cries|crying|tears|うなず|頷|首を振|近づ|ゆら|跳ね|咳払い)/iu;
const WRAPPED_CUE_PATTERN = /([（(【\[])\s*([^()（）【】\[\]\n]{1,80})\s*([）)】\]])/gu;
const ITALIC_CUE_PATTERN = /(^|[\s\n])[*_]\s*([^*_\n]{1,80})\s*[*_](?=$|[\s\n,.!?;:，。！？；：])/gu;
const LEADING_CUE_PATTERN = /^\s*([^，。！？,.!?;:、\n]{1,36})\s*[，。！？,.!?;:、-]\s*/u;
const CUE_CLAUSE_SEPARATOR_PATTERN = /([，。！？,.!?;:、-]+)/u;
const INLINE_STAGE_CUE_START_PATTERN = /^(?:我|她|他|八千代|yachiyo|角色|模型)?\s*(?:轻轻地?|微微|稍微|缓缓|慢慢|快速|用力|开心地?|害羞地?|认真地?|俏皮地?|gently|softly|slightly|slowly|quickly|playfully)?\s*(?:点头|點頭|颔首|頷首|摇头|搖頭|摆头|擺頭|靠近|凑近|湊近|贴近|貼近|前倾|前傾|后仰|後仰|左倾|左傾|右倾|右傾|摇摆|搖擺|晃动|晃動|轻晃|輕晃|蹦|跳|弹|彈|强调|強調|重音|眨眼|眨眼睛|微笑|害羞|脸红|臉紅|哭|流泪|流淚|清嗓|清了清嗓子|清喉咙|清了清喉咙|咳嗽|咳咳|干咳|輕咳|轻咳|clears?(?:\s|-|_)?(?:her|his|their)?(?:\s|-|_)?throat|cough(?:s|ing)?|nods?|nodding|shake(?:s|ing)?(?:\s|-|_)?head|lean(?:s|ing)?(?:\s|-|_)?(?:in|forward|left|right)?|sways?|swaying|bounces?|bouncing|emphasizes?|accent|hits?|tilts?(?:\s|-|_)?head|wink(?:s|ing)?|smiles?|smiling|blush(?:es|ing)?|cries|crying|tears)/iu;

function normalizeStageText(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
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
  if (!leading || !isStageDirection(leading[1])) return line;
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
  return isInlineStageCue(line) ? '' : line;
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
  return stripLive2DStageDirections(text) || '';
}
