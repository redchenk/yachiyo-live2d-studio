const STAGE_DIRECTION_LABEL_PATTERN = /^\s*(?:动作|動作|表情|姿势|姿勢|肢体|肢體|语气|語氣|Action|Expression|Pose|Motion|Body)\s*[:：]/iu;
const STAGE_DIRECTION_WORD_PATTERN = /(?:点头|點頭|颔首|頷首|摇头|搖頭|摆头|擺頭|靠近|凑近|湊近|贴近|貼近|前倾|前傾|后仰|後仰|左倾|左傾|右倾|右傾|摇摆|搖擺|晃动|晃動|轻晃|輕晃|蹦|跳|弹|彈|强调|強調|重音|拍|笑|微笑|害羞|脸红|臉紅|哭|流泪|流淚|眨眼|眨眼睛|nod|nodd?ing|shake(?:s|ing)?(?:\s|-|_)?head|lean(?:s|ing)?(?:\s|-|_)?(?:in|forward|left|right)?|sway|bounce|emphasis|accent|hit|wink|smile|blush|cry|tears|うなず|頷|首を振|近づ|ゆら|跳ね)/iu;
const WRAPPED_CUE_PATTERN = /([（(【\[])\s*([^()（）【】\[\]\n]{1,80})\s*([）)】\]])/gu;
const ITALIC_CUE_PATTERN = /(^|[\s\n])[*_]\s*([^*_\n]{1,80})\s*[*_](?=$|[\s\n,.!?;:，。！？；：])/gu;

function normalizeStageText(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
}

function isStageDirection(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return STAGE_DIRECTION_LABEL_PATTERN.test(value) || STAGE_DIRECTION_WORD_PATTERN.test(value);
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
    .filter((line) => !STAGE_DIRECTION_LABEL_PATTERN.test(line.trim()))
    .join('\n')
    .replace(WRAPPED_CUE_PATTERN, (match, open, inner) => (isStageDirection(inner) ? '' : match))
    .replace(ITALIC_CUE_PATTERN, (match, prefix, inner) => (isStageDirection(inner) ? prefix : match))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:，。！？；：])/g, '$1')
    .replace(/([（(【\[])\s+/g, '$1')
    .replace(/\s+([）)】\]])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanLive2DReply(text) {
  return stripLive2DStageDirections(text) || '';
}
