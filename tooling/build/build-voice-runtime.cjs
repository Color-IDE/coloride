// Build-time only: bundle a portable Python, offline weights and local adapter.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'client/desktop/resources/voice-runtime');
const cache = path.join(root, 'artifacts/voice-build');
const VERSION = '0.2.26';
const PYTHON_VERSION = '3.12.13';
const MODEL_REVISION = '7fc08c4eac4c316526498f147dfdee6f6303f975';
const useMLX = process.platform === 'darwin' && process.arch === 'arm64';
const modelBuilder = path.join(__dirname, 'build-whisper-models.py');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`Voice runtime build failed: ${command} (exit ${result.status})`);
}
function buildVoiceRuntime() {
  const server = path.join(root, 'client/desktop/src/dictation/server.py');
  const languageAdapter = path.join(root, 'client/desktop/src/dictation/streaming_language.py');
  const fingerprint = hash([__filename, server, languageAdapter, modelBuilder].map(file => fs.readFileSync(file)).map(buffer => buffer.toString()).join('\n'));
  const manifestPath = path.join(out, 'manifest.json');
  const pythonRelative = process.platform === 'win32' ? 'python/python.exe' : 'python/bin/python3';
  const python = path.join(out, pythonRelative);
  const deps = path.join(out, 'site-packages');
  const spec = [`whisperlivekit${useMLX ? '[mlx-whisper]' : ''}==${VERSION}`, ...(useMLX ? ['mlx==0.32.4', 'mlx-whisper==0.4.3'] : [])];
  const dependencyFingerprint = hash(JSON.stringify({ spec, python: PYTHON_VERSION, platform: process.platform, arch: process.arch }));
  const assetFingerprint = hash(fs.readFileSync(modelBuilder));
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  const samePlatform = previous.platform === process.platform && previous.arch === process.arch;
  const hasDependencies = fs.existsSync(python) && fs.existsSync(path.join(deps, `whisperlivekit-${VERSION}.dist-info`))
    && (!useMLX || (fs.existsSync(path.join(deps, 'mlx-0.32.4.dist-info')) && fs.existsSync(path.join(deps, 'mlx_whisper-0.4.3.dist-info'))));
  const hasModels = fs.existsSync(path.join(out, 'model/medium.pt')) && (!useMLX || fs.existsSync(path.join(out, 'model/mlx/weights.npz')));
  if (samePlatform && previous.fingerprint === fingerprint && hasDependencies && hasModels
    && fs.existsSync(path.join(out, 'server.py')) && fs.existsSync(path.join(out, 'streaming_language.py'))) {
    console.log('Bundled voice runtime is current.');
    return;
  }
  // Adapter changes reuse the validated dependency/model layers. The legacy
  // manifest migration is restricted to the exact versions already installed.
  const reuseDependencies = samePlatform && hasDependencies && previous.pythonVersion === PYTHON_VERSION
    && (previous.dependencyFingerprint === dependencyFingerprint || (!previous.dependencyFingerprint && previous.whisperlivekit === VERSION));
  const reuseModels = reuseDependencies && hasModels && previous.model === 'medium'
    && (previous.assetFingerprint === assetFingerprint || (!previous.assetFingerprint && (!previous.modelRevision || previous.modelRevision === MODEL_REVISION)));
  fs.mkdirSync(cache, { recursive: true });
  if (!reuseDependencies) {
    const tools = path.join(cache, 'tools');
    const toolsPython = path.join(tools, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (!fs.existsSync(toolsPython)) {
      const candidates = [process.env.COLORIDE_VOICE_BUILD_PYTHON, process.env.COLORIDE_VOICE_PYTHON, '/opt/homebrew/bin/python3.12', 'python3.12', 'python3', 'python'].filter(Boolean);
      const bootstrap = candidates.find(candidate => spawnSync(candidate, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)'], { timeout: 5000, windowsHide: true }).status === 0);
      if (!bootstrap) throw new Error('Python is needed on the build machine to bundle voice input.');
      run(bootstrap, ['-m', 'venv', tools]);
    }
    run(toolsPython, ['-m', 'pip', 'install', '--disable-pip-version-check', 'uv==0.11.11']);
    const installs = path.join(cache, 'python');
    run(toolsPython, ['-m', 'uv', 'python', 'install', PYTHON_VERSION, '--install-dir', installs, '--no-bin', '--no-registry']);
    const distribution = fs.readdirSync(installs).find(name => name.startsWith(`cpython-${PYTHON_VERSION}-`) && fs.statSync(path.join(installs, name)).isDirectory());
    if (!distribution) throw new Error('Portable Python distribution was not found.');
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.cpSync(path.join(installs, distribution), path.join(out, 'python'), { recursive: true, verbatimSymlinks: true });
    run(toolsPython, ['-m', 'uv', 'pip', 'install', '--python', python, '--target', deps, ...spec]);
  }
  const env = { ...process.env, PYTHONPATH: deps, PYTHONNOUSERSITE: '1', HF_HOME: path.join(cache, 'models') };
  if (!reuseModels) {
    fs.rmSync(path.join(out, 'model'), { recursive: true, force: true });
    run(python, [modelBuilder, path.join(cache, 'whisper-medium'), path.join(out, 'model'), useMLX ? 'mlx' : 'cpu'], env);
  }
  fs.copyFileSync(server, path.join(out, 'server.py'));
  fs.copyFileSync(languageAdapter, path.join(out, 'streaming_language.py'));
  fs.mkdirSync(path.join(out, 'licenses'), { recursive: true });
  if (!fs.existsSync(path.join(out, 'licenses/Whisper-MIT.txt'))) {
    run(python, ['-c', `import urllib.request; from pathlib import Path; Path(${JSON.stringify(path.join(out, 'licenses/Whisper-MIT.txt'))}).write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/openai/whisper/main/LICENSE').read())`], env);
  }
  fs.writeFileSync(path.join(out, 'licenses/MODELS.txt'), `OpenAI Whisper medium (MIT), MLX conversion mlx-community/whisper-medium-mlx at ${MODEL_REVISION}. WhisperLiveKit Apache-2.0 license retained in package metadata.\n`);
  const args = ['--model', 'medium', '--decoder-model-path', path.join(out, 'model/medium.pt'), '--backend', useMLX ? 'mlx-whisper' : 'whisper', '--backend-policy', 'simulstreaming', '--language', 'auto', '--pcm-input', '--min-chunk-size', '0.5', '--beams', '1'];
  if (useMLX) args.push('--encoder-model-path', path.join(out, 'model/mlx'), '--coloride-full-mlx');
  run(python, [path.join(out, 'server.py'), '--validate-runtime', ...args], {
    ...env, COLORIDE_VOICE_TOKEN: crypto.randomBytes(32).toString('hex'), HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', NUMBA_CACHE_DIR: path.join(cache, 'numba'),
  });
  fs.writeFileSync(manifestPath, JSON.stringify({ platform: process.platform, arch: process.arch, python: pythonRelative,
    engine: 'whisperlivekit', whisperlivekit: VERSION, backend: useMLX ? 'mlx-whisper' : 'whisper', fullMlx: useMLX,
    policy: 'simulstreaming', model: 'medium', modelRevision: MODEL_REVISION, pythonVersion: PYTHON_VERSION,
    dependencyFingerprint, assetFingerprint, fingerprint }, null, 2));
}
module.exports = { buildVoiceRuntime };
if (require.main === module) buildVoiceRuntime();
