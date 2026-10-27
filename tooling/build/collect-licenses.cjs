// Collect installed dependency texts before packaging; never fetch licenses at runtime.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
module.exports = function collectLicenses() {
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
    if (!found) sections.push(`Upstream package supplies no separate license text. Declared license: ${item.license}. Source: ${item.homepage || item.repository || "see package registry"}.`);
  }
  const localPython = path.join(root, 'core/ide-host/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const python = process.env.COLORIDE_LICENSE_PYTHON || (fs.existsSync(localPython) ? localPython : 'python');
  sections.push(execFileSync(python, ['-c', `
import importlib.metadata as m
m.distribution('coloride-desktop-backend')  # Reject an unrelated Python environment.
for d in sorted(m.distributions(), key=lambda d: d.metadata['Name'].lower()):
    if d.metadata['Name'] == 'coloride-desktop-backend': continue
    texts = []
    for f in d.files or []:
        if any(str(p).lower().startswith(('license', 'licence', 'copying', 'notice')) for p in [f.name]):
            p = d.locate_file(f)
            if p.is_file(): texts.append((f.name, p.read_text(errors='replace')))
    print('\\n## Python: ' + d.metadata['Name'] + ' ' + d.version)
    if not texts:
        print('No separate license file supplied. Declared license: ' + (d.metadata.get('License-Expression') or d.metadata.get('License') or 'not declared'))
    for name, text in texts: print('\\n### ' + name + '\\n\\n' + text)
`], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}));
  const electron = path.join(root, 'node_modules/electron/dist');
  for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
    sections.push(`\n## Electron: ${name}\n\n${fs.readFileSync(path.join(electron, name), 'utf8')}`);
  }
  const out = path.join(root, 'artifacts/licenses');
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'THIRD_PARTY_NOTICES.md'), sections.join('\n'));
};
if (require.main === module) module.exports();
