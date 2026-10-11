import { liveChatModelOptions } from '../../src/shared/chat-model-options.mjs';
export function buildChatRequest(input, streaming = false) {
  const url = new URL(input.apiUrl);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Chat URL must use HTTP or HTTPS');
  const responses = /\/responses\/?$/.test(url.pathname);
  const history = (input.conversation || []).filter(x => ['user', 'assistant'].includes(x.role)).map(x => ({ role: x.role, content: String(x.content || '') }));
  const vision = input.vision;
  const image = vision?.includeImage !== false && (vision?.imageBase64 || vision?.cursorCropBase64);
  let content = String(input.message || '');
  if (image) {
    const dataUrl = image.startsWith('data:') ? image : `data:${vision.mimeType || 'image/png'};base64,${image}`;
    content = responses
      ? [{ type: 'input_text', text: content }, { type: 'input_image', image_url: dataUrl, detail: vision.detail || 'low' }]
      : [{ type: 'text', text: content }, { type: 'image_url', image_url: { url: dataUrl, detail: vision.detail || 'low' } }];
  }
  const body = responses
    ? { model: input.model, instructions: input.systemPrompt || '', input: [...history, { role: 'user', content }], max_output_tokens: 1000, stream: streaming }
    : { model: input.model, messages: [...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []), ...history, { role: 'user', content }], max_tokens: 1000, ...liveChatModelOptions(input.apiUrl, input.model), temperature: /kimi|moonshot/i.test(input.model + url.hostname) ? 1 : 0.4, stream: streaming };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey || ''}` };
  if (url.hostname === 'openrouter.ai') Object.assign(headers, { 'HTTP-Referer': 'http://127.0.0.1', 'X-OpenRouter-Title': 'Yachiyo Live2D Studio' });
  return { url: url.href, body, headers };
}

export function chatReply(data) {
  return data?.choices?.[0]?.message?.content || data?.output_text || data?.output?.flatMap(x => x.content || []).map(x => x.text || '').join('') || data?.reply || '';
}
