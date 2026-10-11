exports.default = async context => {
  if (process.platform !== 'darwin' || context.electronPlatformName !== 'win32') return;
  const { UninstallerReader } = require('app-builder-lib/out/targets/nsis/nsisUtil.js');
  const { writeNsisUninstaller } = await import('./nsis-uninstaller.mjs');
  // Override only this build process. Do not modify node_modules or old releases.
  // The replacement verifies the original CRC and fails on unknown layouts.
  UninstallerReader.exec = writeNsisUninstaller;
};
