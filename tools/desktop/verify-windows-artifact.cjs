const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');

exports.default = async event => {
  if (event.target?.name !== 'nsis' || !event.file?.endsWith('.exe')) return;
  const { inspectNsis } = await import('./nsis-uninstaller.mjs');
  const installer = inspectNsis(await fs.readFile(event.file));
  const sevenZip = await getPath7za();
  const extract = async entry => (await promisify(execFile)(sevenZip, ['e', '-so', event.file, entry], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 })).stdout;
  const stdout = await extract('$R0/Uninstall Yachiyo Live2D Studio.exe');
  const repairCopy = await extract('$PLUGINSDIR/yachiyo-fixed-uninstaller.exe');
  const uninstaller = inspectNsis(stdout);
  if (!installer.crcValid || installer.uninstaller || !uninstaller.crcValid || !uninstaller.uninstaller || !(installer.flags & 8) || !(uninstaller.flags & 8) || !stdout.equals(repairCopy)) throw new Error('Windows installer/uninstaller integrity verification failed');
  await fs.writeFile(event.file + '.integrity.json', JSON.stringify({ passed: true, installer, uninstaller }, null, 2) + '\n');
  console.log('  • verified final Windows installer AND embedded uninstaller CRC');
};
