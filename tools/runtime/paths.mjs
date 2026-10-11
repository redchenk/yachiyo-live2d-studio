import os from 'node:os';
import path from 'node:path';

export function studioDataDirectory({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.YACHIYO_DATA_DIR) return path.resolve(env.YACHIYO_DATA_DIR);
  const base = platform === 'win32'
    ? env.LOCALAPPDATA || env.APPDATA || path.join(home, 'AppData', 'Local')
    : platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(base, 'YachiyoLive2DStudio');
}
