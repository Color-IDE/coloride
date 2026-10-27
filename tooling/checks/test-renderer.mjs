import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? discover(file) : /\.test\.tsx?$/.test(entry.name) ? [file] : [];
  }))).flat().sort();
}
const files = await discover(path.join(root, 'client/ide/tests/unit'));
if (!files.length) throw new Error('No renderer unit tests discovered');
const result = spawnSync(process.execPath, [
  '--import', 'tsx', '--import', './client/ide/tests/support/register-assets.mjs',
  '--test', ...files,
], { cwd: root, stdio: 'inherit', env: { ...process.env, TSX_TSCONFIG_PATH: path.join(root, 'client/ide/tsconfig.json') } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
