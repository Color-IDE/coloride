import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));

function filesUnder(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file, extension) : extension.test(file) ? [file] : [];
  }).sort();
}

/** CJS exports remain public. Report compiler-proven unused bindings, not type errors. */
export function unusedJavaScript(files) {
  const program = ts.createProgram(files, {
    allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
    noUnusedLocals: true, noUnusedParameters: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  });
  return program.getSemanticDiagnostics()
    .filter(diagnostic => [6133, 6192, 6196, 6198].includes(diagnostic.code))
    .map(diagnostic => {
      const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
      return `${diagnostic.file.fileName}:${line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
    });
}

export function auditSource({ javascriptOnly = false } = {}) {
  let failed = false;
  const skipped = [];
  function run(label, command, args, optional = false, input) {
    process.stdout.write(`\n${label}\n`);
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', input });
    if (optional && result.error?.code === 'ENOENT') {
      skipped.push(label);
      console.log(`SKIPPED: ${command} is not installed`);
      return;
    }
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) failed = true;
  }
  const scriptFiles = ['client/desktop/src', 'tooling'].flatMap(directory =>
    filesUnder(path.join(root, directory), /\.(?:cjs|mjs|js)$/));
  const unused = unusedJavaScript(scriptFiles);
  console.log(`JavaScript unused-binding findings: ${unused.length}`);
  if (unused.length) { console.error(unused.join('\n')); failed = true; }
  for (const file of scriptFiles) run(`JavaScript syntax: ${path.relative(root, file)}`, process.execPath, ['--check', file]);

  if (javascriptOnly) {
    console.log(`JavaScript source audit: ${failed ? 'FAILED' : 'passed'}`);
    return failed ? 1 : 0;
  }

  const venv = path.join(root, 'core/ide-host/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const python = process.env.COLORIDE_PYTHON || (fs.existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3');
  run('Python unused bindings and review candidates', python, ['tooling/checks/audit-python.py']);

  const shellFiles = filesUnder(path.join(root, 'tooling'), /\.sh$/);
  for (const file of shellFiles) {
    const shell = /^#![^\n]*\bbash\b/.test(fs.readFileSync(file, 'utf8')) ? 'bash' : 'sh';
    run(`Shell syntax: ${path.relative(root, file)}`, shell, ['-n', file], process.platform === 'win32');
  }
  run('Shell unused variables', 'shellcheck', ['--include=SC2034', ...shellFiles], true);
  const powershellFiles = filesUnder(path.join(root, 'tooling'), /\.ps1$/);
  // Paths are JSON on stdin, never interpolated into executable PowerShell text.
  const parsePowerShell = `$failed = $false; foreach ($file in ([Console]::In.ReadToEnd() | ConvertFrom-Json)) { $tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { Write-Output $_ }; $failed = $true } }; if ($failed) { exit 1 }`;
  run('PowerShell syntax', 'pwsh', ['-NoProfile', '-NonInteractive', '-Command', parsePowerShell], true, JSON.stringify(powershellFiles));
  console.log(`\nSource audit: ${failed ? 'FAILED' : 'required checks passed'}; ${skipped.length} optional checks skipped.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = auditSource({ javascriptOnly: process.argv.includes('--javascript-only') });
}
