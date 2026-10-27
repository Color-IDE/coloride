const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const VERSION = '0.2.26';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function createRuntime(root, { bundleRoot, packaged = false } = {}) {
  let pending = null;
  let child = null;
  let endpoint = null;
  let generation = 0;
  let diagnostics = "";
  const stop = () => { generation++; child?.kill(); child = null; endpoint = null; pending = null; };
  async function ensure(progress) {
    if (endpoint) return endpoint;
    if (pending) return pending;
    const current = generation;
    pending = (async () => {
      const manifestPath = bundleRoot && path.join(bundleRoot, 'manifest.json');
      const bundled = manifestPath && fs.existsSync(manifestPath);
      if (!bundled) throw new Error(packaged ? 'The bundled voice runtime is missing. Reinstall Coloride.' : 'Build the voice runtime with pnpm --filter @coloride/electron build:voice.');
      let python;
      let script;
      let modelArgs = [];
      if (bundled) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.platform !== process.platform || manifest.arch !== process.arch || manifest.engine !== 'whisperlivekit' || manifest.whisperlivekit !== VERSION || manifest.model !== 'medium' || manifest.policy !== 'simulstreaming' || manifest.fullMlx !== (process.platform === 'darwin' && process.arch === 'arm64')) {
          throw new Error('The bundled voice runtime does not match this app. Reinstall Coloride.');
        }
        python = path.join(bundleRoot, manifest.python);
        script = path.join(bundleRoot, 'server.py');
        if (!fs.existsSync(python) || !fs.existsSync(script) || !fs.existsSync(path.join(bundleRoot, 'streaming_language.py')) || !fs.existsSync(path.join(bundleRoot, 'model/medium.pt')) || (manifest.backend === 'mlx-whisper' && !fs.existsSync(path.join(bundleRoot, 'model/mlx/weights.npz')))) {
          throw new Error('The bundled voice model is incomplete. Reinstall Coloride.');
        }
        modelArgs = ['--model', 'medium', '--decoder-model-path', path.join(bundleRoot, 'model/medium.pt'), '--backend', manifest.backend, '--backend-policy', 'simulstreaming', '--language', 'auto', '--pcm-input', '--min-chunk-size', '0.5', '--beams', '1'];
        if (manifest.backend === 'mlx-whisper') modelArgs.push('--encoder-model-path', path.join(bundleRoot, 'model/mlx'));
        if (manifest.fullMlx) modelArgs.push('--coloride-full-mlx');
      }
      if (current !== generation) throw new Error('Voice input cancelled.');
      const port = await freePort();
      const token = randomBytes(32).toString('hex');
      progress('Loading local voice model…');
      let tail = '';
      const worker = spawn(python, [script, '--port', String(port), ...modelArgs], {
        env: { ...process.env, COLORIDE_VOICE_TOKEN: token, PYTHONUNBUFFERED: '1',
          ...(bundled ? { PYTHONPATH: path.join(bundleRoot, 'site-packages'), PYTHONNOUSERSITE: '1',
            PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', NUMBA_CACHE_DIR: path.join(root, 'numba') } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      child = worker;
      let exited = false;
      for (const stream of [worker.stdout, worker.stderr]) stream.on('data', data => { tail = (tail + data).slice(-8000); diagnostics = tail; });
      worker.once('error', error => { exited = true; tail = error.message; });
      worker.once('exit', () => { exited = true; if (child === worker) { child = null; endpoint = null; } });
      const deadline = Date.now() + 600_000;
      while (Date.now() < deadline) {
        if (current !== generation) { worker.kill(); throw new Error('Voice input cancelled.'); }
        if (exited) throw new Error(`Could not start local voice recognition: ${tail.slice(-1500)}`);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { signal: AbortSignal.timeout(1000) });
          if (response.ok) { endpoint = { url: `ws://127.0.0.1:${port}/asr?token=${token}` }; return endpoint; }
        } catch {}
        await delay(300);
      }
      worker.kill();
      throw new Error('The local voice model took too long to start. Try again.');
    })().finally(() => { if (current === generation) pending = null; });
    return pending;
  }
  return { ensure, stop, diagnostics: () => diagnostics.replace(/token=[^&\s]+/g, "token=[redacted]") };
}
module.exports = { createRuntime };
