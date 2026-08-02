export function shouldReadBilibiliDanmakuAloud(_message = {}, settings = {}, context = {}) {
  if (!settings.readAloud) return false;
  return context.autoReplyActive !== true;
}
