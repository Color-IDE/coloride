"""Authenticated loopback adapter for bundled WhisperLiveKit SimulStreaming."""
import os
import secrets
import sys
from urllib.parse import parse_qs

# Also enable upstream WebSocket authentication; middleware covers HTTP health/UI.
os.environ['WLK_API_TOKEN'] = os.environ['COLORIDE_VOICE_TOKEN']
import torch
torch.set_num_threads(min(4, os.cpu_count() or 1))
from whisperlivekit.whisper import _ALIGNMENT_HEADS
# Explicit checkpoint paths otherwise lose the model's trained alignment heads.
sys.argv.extend(['--custom-alignment-heads', _ALIGNMENT_HEADS['medium'].decode()])
full_mlx = '--coloride-full-mlx' in sys.argv
validate_runtime = '--validate-runtime' in sys.argv
for flag in ('--coloride-full-mlx', '--validate-runtime'):
    if flag in sys.argv:
        sys.argv.remove(flag)
from whisperlivekit import audio_processor, core

if full_mlx:
    _original_asr = core.SimulStreamingASR

    class GPUStreamingASR(_original_asr):
        def __init__(self, **kwargs):
            super().__init__(**kwargs, use_full_mlx=True)

    core.SimulStreamingASR = GPUStreamingASR
from streaming_language import session_online_factory

_original_factory = audio_processor.online_factory

def _online_factory(args, asr, language=None):
    return session_online_factory(_original_factory, args, asr, language)

audio_processor.online_factory = _online_factory
from whisperlivekit import basic_server as server
import uvicorn


class LocalAuthentication:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] in ('http', 'websocket'):
            supplied = parse_qs(scope.get('query_string', b'').decode()).get('token', [''])[0]
            if not secrets.compare_digest(supplied.encode(), os.environ['COLORIDE_VOICE_TOKEN'].encode()):
                if scope['type'] == 'websocket':
                    await send({'type': 'websocket.close', 'code': 4401})
                else:
                    await send({'type': 'http.response.start', 'status': 401, 'headers': []})
                    await send({'type': 'http.response.body', 'body': b'Unauthorized'})
                return
        await self.app(scope, receive, send)


if __name__ == '__main__' and validate_runtime:
    server.TranscriptionEngine(config=server.config)
    print('Bundled SimulStreaming engine loads offline.')
elif __name__ == '__main__':
    uvicorn.run(LocalAuthentication(server.app), host='127.0.0.1', port=server.config.port, log_level='warning')
