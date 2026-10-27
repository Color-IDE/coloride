const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

module.exports = async () => {
  // Clean installs may skip dependency lifecycle scripts. Obtain Electron's
  // version-matched license texts before collecting notices for the package.
  const electronRoot = path.dirname(require.resolve('electron/package.json'));
  if (!fs.existsSync(path.join(electronRoot, 'dist', 'LICENSES.chromium.html'))) {
    execFileSync(process.execPath, [path.join(electronRoot, 'install.js')], {stdio: 'inherit'});
  }
  require('../../../tooling/build/collect-licenses.cjs')();
  await (await import('./agent-runtime/build.mjs')).default();
};
