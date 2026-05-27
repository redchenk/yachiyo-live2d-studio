import { live2DPromptCatalog } from '../../constants/room/live2dManifest';
import {
  inferLive2DIntentFromText,
  normalizeLive2DIntent
} from './live2dControl';
import {
  compileBehaviorIntent,
  semanticActionPromptCatalog
} from './live2dBehaviorController';
import {
  cleanLive2DReply,
  extractLive2DStageDirections
} from './live2dText';
import { readJson, writeJson } from './roomStorage';

const HISTORY_KEY = 'live2dLLMControlHistory';

function pickReply(data) {
  if (data?.output_text) return String(data.output_text || '').trim();
  if (Array.isArray(data?.output)) {
    return data.output
      .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
      .filter((block) => block?.type === 'output_text' || block?.type === 'text')
      .map((block) => block.text || '')
      .join('\n')
      .trim();
  }
  if (Array.isArray(data?.content)) {
    return data.content
      .filter((block) => block?.type === 'text')
      .map((block) => block.text || '')
      .join('\n')
      .trim();
  }
  return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.reply || '';
}

function extractJsonObject(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start >= 0 && end > start ? value.slice(start, end + 1).trim() : value;
}

function cleanReply(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/(?:^|\n)\s*(?:动作|表情|姿态|语气|神态|Action|Expression)\s*[:：][^\n]{1,160}(?=\n|$)/giu, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanReplyForSpeech(text) {
  return cleanLive2DReply(text);
}

function hasBodyPose(intent) {
  return Boolean(intent?.bodyPose || intent?.sequence?.some((step) => step?.bodyPose));
}

function hasExpression(intent) {
  return Boolean(
    intent?.expression ||
    intent?.expressionMix?.length ||
    intent?.sequence?.some((step) => step?.expression || step?.expressionMix?.length)
  );
}

function mergeParameterTargets(primary = [], fallback = []) {
  const merged = Array.isArray(primary) ? [...primary] : [];
  const seen = new Set(merged.map((item) => String(item?.id || '').toLowerCase()).filter(Boolean));
  for (const target of Array.isArray(fallback) ? fallback : []) {
    const key = String(target?.id || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    merged.push(target);
    seen.add(key);
  }
  return merged;
}

function mergeInferredLive2DIntent(explicitIntent, inferredIntent) {
  if (!explicitIntent) return inferredIntent;
  if (!inferredIntent) return explicitIntent;

  const explicitHasBehavior = Array.isArray(explicitIntent.behaviorActions) && explicitIntent.behaviorActions.length > 0;
  const explicitHasBody = hasBodyPose(explicitIntent);
  const explicitHasExpression = hasExpression(explicitIntent);
  const strongerIntensity = Math.max(Number(explicitIntent.intensity) || 0, Number(inferredIntent.intensity) || 0) || undefined;
  const next = {
    ...explicitIntent,
    emotion: explicitIntent.emotion || inferredIntent.emotion,
    expression: explicitHasExpression ? explicitIntent.expression : inferredIntent.expression,
    expressionMix: explicitHasExpression ? explicitIntent.expressionMix : inferredIntent.expressionMix,
    motion: explicitIntent.motion || (!explicitHasBody ? inferredIntent.motion : null),
    bodyPose: explicitHasBody ? explicitIntent.bodyPose : inferredIntent.bodyPose,
    intensity: strongerIntensity || explicitIntent.intensity || inferredIntent.intensity,
    durationMs: explicitIntent.durationMs || inferredIntent.durationMs,
    behaviorActions: explicitIntent.behaviorActions || [],
    speechStyle: explicitIntent.speechStyle || inferredIntent.speechStyle || null,
    parameters: mergeParameterTargets(
      explicitIntent.parameters,
      explicitHasBody || explicitHasBehavior ? [] : inferredIntent.parameters
    )
  };

  if (Array.isArray(explicitIntent.sequence) && explicitIntent.sequence.length) {
    if (!explicitHasBody && !explicitHasBehavior && explicitIntent.sequence.length === 1) {
      delete next.sequence;
    } else {
      next.sequence = explicitIntent.sequence.map((step, index) => {
        if (explicitHasBody || explicitHasBehavior || index > 0) return step;
        return {
          ...step,
          bodyPose: step.bodyPose || inferredIntent.bodyPose,
          motion: step.motion || inferredIntent.motion,
          intensity: Math.max(Number(step.intensity) || 0, Number(inferredIntent.intensity) || 0) || step.intensity || inferredIntent.intensity,
          durationMs: step.durationMs || inferredIntent.durationMs,
          parameters: mergeParameterTargets(step.parameters, inferredIntent.parameters)
        };
      });
    }
  }

  return normalizeLive2DIntent(next) || explicitIntent;
}

function mergeBehaviorAndExplicitIntent(behaviorIntent, explicitIntent) {
  if (!behaviorIntent) return explicitIntent;
  if (!explicitIntent) return normalizeLive2DIntent(behaviorIntent);
  return normalizeLive2DIntent({
    ...explicitIntent,
    emotion: explicitIntent.emotion || behaviorIntent.emotion,
    expression: explicitIntent.expression || behaviorIntent.expression,
    expressionMix: explicitIntent.expressionMix?.length ? explicitIntent.expressionMix : behaviorIntent.expressionMix,
    bodyPose: explicitIntent.bodyPose || behaviorIntent.bodyPose,
    intensity: Math.max(Number(explicitIntent.intensity) || 0, Number(behaviorIntent.intensity) || 0) || behaviorIntent.intensity,
    durationMs: Math.max(Number(explicitIntent.durationMs) || 0, Number(behaviorIntent.durationMs) || 0) || behaviorIntent.durationMs,
    parameters: mergeParameterTargets(behaviorIntent.parameters, explicitIntent.parameters),
    behaviorActions: behaviorIntent.behaviorActions,
    speechStyle: behaviorIntent.speechStyle
  });
}

export function parseLive2DControlPayload(rawText) {
  const jsonText = extractJsonObject(rawText);
  try {
    const data = JSON.parse(jsonText);
    const rawReply = data.reply || data.text || data.message || '';
    const stageText = extractLive2DStageDirections(`${rawReply}\n${rawText}`);
    const reply = cleanReplyForSpeech(rawReply);
    const behaviorLive2D = compileBehaviorIntent(data);
    const explicitLive2D = mergeBehaviorAndExplicitIntent(
      behaviorLive2D,
      normalizeLive2DIntent(data.live2d || data.act || data.pose || data)
    );
    const inferredLive2D = inferLive2DIntentFromText([stageText, reply].filter(Boolean).join('\n'));
    const live2d = mergeInferredLive2DIntent(explicitLive2D, inferredLive2D);
    return {
      reply: reply || 'OK.',
      live2d,
      raw: data
    };
  } catch (_) {
    const stageText = extractLive2DStageDirections(rawText);
    const reply = cleanReplyForSpeech(rawText) || 'OK.';
    const behaviorLive2D = compileBehaviorIntent({ reply, text: [stageText, reply].filter(Boolean).join('\n') });
    const inferredLive2D = inferLive2DIntentFromText([stageText, reply].filter(Boolean).join('\n'));
    return {
      reply,
      live2d: mergeBehaviorAndExplicitIntent(behaviorLive2D, inferredLive2D),
      raw: rawText
    };
  }
}

function normalizeOpenAIUrl(apiUrl = '') {
  const url = String(apiUrl || '').trim();
  if (/(api\.openai\.com|api\.x\.ai)\/v1\/?$/i.test(url)) return `${url.replace(/\/$/, '')}/responses`;
  if (/(xiaomimimo\.com|token-plan-cn\.xiaomimimo\.com)\/v1\/?$/i.test(url)) return `${url.replace(/\/$/, '')}/chat/completions`;
  return url;
}

function isOpenAIResponsesApi(apiUrl = '') {
  return /(api\.openai\.com|api\.x\.ai)\/v1\/responses\/?$/i.test(String(apiUrl || '').replace(/\/$/, ''));
}

function isOpenRouterApi(apiUrl = '') {
  return /openrouter\.ai\/api\/v1\/chat\/completions\/?$/i.test(String(apiUrl || '').replace(/\/$/, ''));
}

function isKimiChatTarget(apiUrl = '', modelName = '') {
  return /api\.moonshot\.cn|moonshot|kimi/i.test(`${apiUrl || ''} ${modelName || ''}`);
}

function openRouterHeaders(apiUrl = '') {
  if (!isOpenRouterApi(apiUrl)) return {};
  return {
    'HTTP-Referer': window.location.origin,
    'X-OpenRouter-Title': 'Tsukuyomi Space'
  };
}

function buildDirectRequestBody(settings, systemPrompt, history, message) {
  const apiUrl = normalizeOpenAIUrl(settings.apiUrl || '');
  const model = settings.model || 'gpt-4o-mini';
  if (isOpenAIResponsesApi(apiUrl)) {
    return {
      model: settings.model || 'gpt-5.5',
      instructions: systemPrompt,
      input: [
        ...history.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.content || '') })),
        { role: 'user', content: String(message || '') }
      ],
      max_output_tokens: 1000
    };
  }
  return {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history.map((item) => ({ role: item.role, content: String(item.content || '') })),
      { role: 'user', content: String(message || '') }
    ],
    temperature: isKimiChatTarget(apiUrl, model) ? 1 : 0.4,
    max_tokens: 1000
  };
}

export function live2DControlSystemPrompt() {
  return [
    'You are controlling a Live2D character named Yachiyo.',
    'Yachiyo is being tested as an autonomous AI VTuber streamer: keep her present, reactive, playful, and concise.',
    'Return exactly one JSON object. Do not use Markdown. Do not add prose outside JSON.',
    'JSON schema:',
    '{"reply":"short visible reply","emotion":"smug|happy|shy|surprised|sad|neutral","intensity":0.72,"actions":[{"type":"look_at_chat","duration":1.2},{"type":"smirk","duration":2.0},{"type":"head_tilt","side":"right","duration":1.5}],"speech_style":{"speed":1.05,"pitch":0.08,"pause":"playful"}}',
    'The reply field must contain only natural dialogue. Never put stage directions, parenthesized action hints, asterisk actions, action labels, or pose descriptions in reply.',
    'The actions field is required and must contain at least 2 semantic actions. If the moment is calm, use look_at_chat + breathe.',
    'Use semantic actions, not raw Live2D parameters, for normal turns. The behavior controller maps actions to VTube Studio tracking curves.',
    'Choose 2-5 actions per live-stream turn. Good combos: look_at_chat + smirk + head_tilt, nod + smile, lean_in + blink, shake_head + smirk, bounce + smile, shiver + shy.',
    'Use intensity 0.45-0.85 for normal talking, 0.85-1.0 for punchlines or surprise.',
    'Use duration in seconds. Overlapping actions are allowed by repeating similar delay values; omit delay for a natural staggered performance.',
    'Only use raw live2d.parameters when a very specific model parameter is necessary.',
    semanticActionPromptCatalog(),
    live2DPromptCatalog()
  ].join('\n');
}

export function readLive2DLLMHistory() {
  const history = readJson(HISTORY_KEY, []);
  return Array.isArray(history) ? history.filter((item) => item && ['user', 'assistant'].includes(item.role)).slice(-8) : [];
}

export function clearLive2DLLMHistory() {
  writeJson(HISTORY_KEY, []);
}

export async function requestLive2DControl(message) {
  const settings = readJson('roomLLMSettings', {});
  if (!settings.apiKey || !settings.apiUrl) {
    throw new Error('Missing LLM settings. Configure LLM in Studio Settings first.');
  }

  const history = readLive2DLLMHistory();
  const systemPrompt = [settings.systemPrompt, live2DControlSystemPrompt()].filter(Boolean).join('\n\n');
  let rawReply = '';

  if (settings.useProxy) {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        conversation: history,
        apiKey: settings.apiKey,
        apiUrl: settings.apiUrl,
        model: settings.model,
        systemPrompt
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.message || `LLM ${response.status}`);
    rawReply = result.data?.reply || '';
  } else {
    const apiUrl = normalizeOpenAIUrl(settings.apiUrl);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
        ...openRouterHeaders(apiUrl)
      },
      body: JSON.stringify(buildDirectRequestBody({ ...settings, apiUrl }, systemPrompt, history, message))
    });
    if (!response.ok) throw new Error(`LLM ${response.status}`);
    rawReply = pickReply(await response.json());
  }

  const parsed = parseLive2DControlPayload(rawReply);
  const nextHistory = [
    ...history,
    { role: 'user', content: String(message || '') },
    { role: 'assistant', content: parsed.reply }
  ].slice(-8);
  writeJson(HISTORY_KEY, nextHistory);
  return parsed;
}
