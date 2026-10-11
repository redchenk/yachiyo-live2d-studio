/** Official Flash defaults to high-effort thinking; live speech needs immediate content. */
export function liveChatModelOptions(apiUrl, model) {
  let officialDeepSeek = false;
  try { officialDeepSeek = /(^|\.)deepseek\.com$/.test(new URL(apiUrl).hostname); } catch { /* URL validation belongs to the transport. */ }
  return officialDeepSeek && model === 'deepseek-flash' ? { thinking: { type: 'disabled' } } : {};
}
