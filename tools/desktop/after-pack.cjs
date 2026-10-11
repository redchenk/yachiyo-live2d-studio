const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

exports.default = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // Desktop/synced folders may attach Finder metadata during packaging. These
  // two attributes invalidate codesign; only clean the newly generated bundle.
  for (const attribute of ['com.apple.FinderInfo', 'com.apple.ResourceFork']) {
    try { await promisify(execFile)('xattr', ['-dr', attribute, app]); }
    catch (error) {
      const lines = String(error.stderr || '').trim().split('\n').filter(Boolean);
      if (!lines.length || lines.some(line => !/No such xattr/.test(line))) throw error;
    }
  }
};
