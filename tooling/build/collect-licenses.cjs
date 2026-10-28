// Collect installed dependency texts before packaging; never fetch licenses at runtime.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
module.exports = function collectLicenses() {
  const overrides = require('./licenses/manifest.json');
  const sections = [fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')];
  const catalog = JSON.parse(execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['licenses', 'list', '--prod', '--json'], {cwd: root, encoding: 'utf8', shell: process.platform === 'win32'}));
  for (const item of Object.values(catalog).flat()) {
    if (item.name.startsWith('@coloride/') || item.name === 'coloride') continue;
    sections.push(`\n## ${item.name} (${item.versions.join(', ')})\nLicense: ${item.license}\n`);
    let found = false;
    for (const dir of item.paths) {
      for (const name of fs.readdirSync(dir).filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name))) {
        const file = path.join(dir, name);
        if (fs.statSync(file).isFile()) {
          sections.push(`### ${name}\n\n${fs.readFileSync(file, 'utf8')}`);
          found = true;
        }
      }
    }
    if (!found) {
      for (const version of item.versions) {
        const override = overrides[`${item.name}@${version}`];
        if (override) {
          sections.push(`Source: ${override.source}\n\n${fs.readFileSync(path.join(__dirname, 'licenses', override.file), 'utf8')}`);
        } else if (item.license === 'MIT') {
          const metadata = item.paths.map(dir => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')));
          sections.push(`Upstream declares MIT in package.json but supplies no separate license file. Package attribution: ${JSON.stringify(metadata.map(({name, version, author, contributors, repository}) => ({name, version, author, contributors, repository})))}\n\n${fs.readFileSync(path.join(__dirname, 'licenses/MIT.txt'), 'utf8')}`);
        } else {
          throw new Error(`Missing license text for ${item.name}@${version} (${item.license})`);
        }
      }
    }
  }
  const localPython = path.join(root, 'core/ide-host/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const python = process.env.COLORIDE_LICENSE_PYTHON || (fs.existsSync(localPython) ? localPython : 'python');
  sections.push(execFileSync(python, [path.join(__dirname, 'collect-python-licenses.py')], {encoding: 'utf8', env: {...process.env, PYTHONIOENCODING: 'utf-8'}, maxBuffer: 32 * 1024 * 1024}));
  const electron = path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
  for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
    sections.push(`\n## Electron: ${name}\n\n${fs.readFileSync(path.join(electron, name), 'utf8')}`);
  }
  const out = path.join(root, 'artifacts/licenses');
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'THIRD_PARTY_NOTICES.md'), sections.join('\n'));
};
if (require.main === module) module.exports();
