import { live2DPromptCatalog } from '../../constants/room/live2dManifest';
import {
  inferLive2DIntentFromText,
  normalizeLive2DIntent
} from './live2dControl';
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
    parameters: mergeParameterTargets(
      explicitIntent.parameters,
      explicitHasBody ? [] : inferredIntent.parameters
    )
  };

  if (Array.isArray(explicitIntent.sequence) && explicitIntent.sequence.length) {
    if (!explicitHasBody && explicitIntent.sequence.length === 1) {
      delete next.sequence;
    } else {
      next.sequence = explicitIntent.sequence.map((step, index) => {
        if (explicitHasBody || index > 0) return step;
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

export function parseLive2DControlPayload(rawText) {
  const jsonText = extractJsonObject(rawText);
  try {
    const data = JSON.parse(jsonText);
    const rawReply = data.reply || data.text || data.message || '';
    const stageText = extractLive2DStageDirections(`${rawReply}\n${rawText}`);
    const reply = cleanReplyForSpeech(rawReply);
    const explicitLive2D = normalizeLive2DIntent(data.live2d || data.act || data.pose || data);
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
    return {
      reply,
      live2d: inferLive2DIntentFromText([stageText, reply].filter(Boolean).join('\n')),
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
    '{"reply":"short visible reply","live2d":{"emotion":"happy|shy|sad|crying|neutral","expression":"neutral|smile|bsmile|namida|tears","expressionMix":[{"expression":"smile","weight":1}],"bodyPose":"none|nod|shake_head|lean_in|lean_left|lean_right|sway|bounce|emphasis","parameters":[{"id":"ParamOutput_BodyX","value":16,"weight":0.9,"durationMs":1500}],"intensity":1,"durationMs":4200,"sequence":[]}}',
    'The reply field must contain only natural dialogue. Never put stage directions, parenthesized action hints, asterisk actions, action labels, or pose descriptions in reply.',
    'If you need Yachiyo to nod, lean, sway, bounce, shake her head, or emphasize a line, put that only in live2d.bodyPose, live2d.parameters, or live2d.sequence.',
    'For live-stream turns, choose a visible bodyPose unless the line is intentionally quiet. Do not only change the face.',
    'Vary bodyPose across turns: nod for acknowledgement, lean_in for focus, sway for idle talk, bounce for excitement, shake_head for playful refusal, emphasis for punchlines.',
    'Use parameters for precise acting: gaze, head motion, torso lean, body roll, chest/hip split, shoulders, hair follow-through, brows, mouth shape, cheek, and breathing. Prefer 5-10 parameter targets per active turn.',
    'When bodyPose is visible, use intensity 0.95-1.0, enable ParamSwitchCtrl_BodyX/Y/Z/ChestZ/HipZ at value 1, and pair it with Yachiyo body-chain targets such as ParamBodyInput_BodyX, ParamBodyInput_BodyY, ParamBodyInput_BodyZ, ParamOutput_BodyX, ParamOutput_BodyY, ParamOutput_BodyZ, ParamPhysicsRAM_BodyX, ParamPhysicsRAM_BodyY, ParamPhysicsRAM_BodyZ, ParamAngle_BodyX, ParamAngle_BodyY, ParamAngle_BodyZ, ParamAngle_ChestZ, ParamAngle_HipZ, PositionZ, or ParamPosition_Z.',
    'For a Neuro-sama-like stream feel, use tiny gaze shifts plus VTube Studio-style head targets ParamAngle_HeadX/Y/Z, visible but smooth body leans, chest/hip counter-motion, shoulder accents, brow changes, and breath accents that match the spoken line.',
    'Avoid fighting TTS mouth opening. Use ParamMouthForm for smile/frown shape and leave ParamMouthOpenY to voice unless you intentionally need a manual mouth override.',
    'Use durationMs on each parameter target when you want a quick glance or eyebrow shift, and keep the value within the listed range.',
    'Use sequence only when a multi-step performance is clearly helpful. Keep sequence to 3 steps or fewer.',
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
