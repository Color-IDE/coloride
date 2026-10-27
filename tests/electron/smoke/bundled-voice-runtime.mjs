import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRuntime } = require('../../../client/desktop/src/dictation/runtime.cjs');
const bundleRoot = resolve(process.argv[2] ?? 'client/desktop/resources/voice-runtime');
const expectedLanguage = process.argv[4] ?? '';
assert.ok(['', 'es', 'fr', 'en'].includes(expectedLanguage));
const language = 'auto';
const audioFile = process.argv[3] ? resolve(process.argv[3]) : '';
const scratch = await mkdtemp(join(tmpdir(), 'coloride-bundled-voice-'));
const originalPath = process.env.PATH;
let runtime;
try {
  // Packaged mode must never fall back to pip or a system Python.
  process.env.PATH = '';
  const missing = createRuntime(join(scratch, 'missing-cache'), { packaged: true, bundleRoot: join(scratch, 'missing') });
  await assert.rejects(missing.ensure(() => {}), /bundled voice runtime is missing/);
  missing.stop();
  runtime = createRuntime(join(scratch, 'empty-cache'), { packaged: true, bundleRoot });
  const endpoint = await runtime.ensure(message => console.log(message));
  const url = endpoint.url.replace('ws:', 'http:').replace('/asr?', '/?');
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url.split('?')[0])).status, 401);
  const manifest = JSON.parse(await readFile(join(bundleRoot, 'manifest.json'), 'utf8'));
  const python = join(bundleRoot, manifest.python);
  const client = `
import asyncio, json, os, time
from pathlib import Path
import websockets
async def main():
    pcm=Path(os.environ['VOICE_TEST_AUDIO']).read_bytes() if os.environ['VOICE_TEST_AUDIO'] else bytes(64000)
    texts=[]
    detected=set()
    partials=[]
    live=[]
    started=time.monotonic()
    flushing=False
    sent=0
    async with websockets.connect(os.environ['VOICE_TEST_ENDPOINT']) as socket:
        assert json.loads(await socket.recv())['useAudioWorklet']
        async def read():
            async for raw in socket:
                data=json.loads(raw)
                assert data.get('type') != 'error', data
                if data.get('type')=='ready_to_stop': return
                if data.get('buffer_transcription') and not flushing: partials.append(data['buffer_transcription'])
                detected.update(line['detected_language'] for line in data.get('lines', []) if line.get('detected_language'))
                text=' '.join(x.get('text') or '' for x in data.get('lines',[])).strip()
                if text: texts.append(text)
                candidate=text or data.get('buffer_transcription') or ''
                if any(char.isalpha() for char in candidate) and not flushing:
                    live.append((round((time.monotonic()-started)*1000), text or data['buffer_transcription'], sent))
        reader=asyncio.create_task(read())
        for i in range(0,len(pcm),3200):
            await socket.send(pcm[i:i+3200]); sent=min(i+3200,len(pcm)); await asyncio.sleep(.1)
        # Give the receiver time to process the last live frame before EOF.
        await asyncio.sleep(.3)
        if os.environ['VOICE_TEST_AUDIO']:
            assert live, 'No streaming text before EOF'
            assert any(position < len(pcm) for _, _, position in live), 'Text arrived only after the recording ended'
        flushing=True
        await socket.send(b'')
        await asyncio.wait_for(reader,90)
    if os.environ['VOICE_TEST_AUDIO']: assert texts, 'No confirmed transcription received'
    if os.environ['VOICE_TEST_EXPECT_LANGUAGE']:
        assert os.environ['VOICE_TEST_EXPECT_LANGUAGE'] in detected, ('Wrong automatic language', detected)
    print('Detected languages:', sorted(detected))
    print('WhisperLiveKit live results (ms, text):', live[:3])
    print('WhisperLiveKit final:', texts[-1:] )
    print('Bundled PCM transcription and final flush PASS')
asyncio.run(main())
`;
  const { stdout } = await promisify(execFile)(python, ['-c', client], {
    env: { ...process.env, PATH: '', PYTHONPATH: join(bundleRoot, 'site-packages'), PYTHONNOUSERSITE: '1', HF_HUB_OFFLINE: '1',
      VOICE_TEST_AUDIO: audioFile, VOICE_TEST_EXPECT_LANGUAGE: expectedLanguage, VOICE_TEST_ENDPOINT: endpoint.url + '&language=' + language }, timeout: 120000,
  });
  console.log(stdout.trim());
  console.log('Portable runtime + bundled model + empty cache + no system Python + offline mode PASS');
} catch (error) {
  console.error(runtime?.diagnostics());
  throw error;
} finally {
  runtime?.stop();
  process.env.PATH = originalPath;
  await rm(scratch, { recursive: true, force: true });
}
