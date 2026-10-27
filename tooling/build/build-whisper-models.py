"""Download version-pinned Whisper weights at build time, never on a user's device."""
import shutil
import sys
from pathlib import Path
from huggingface_hub import snapshot_download
from whisperlivekit.whisper import _download, _MODELS

if __name__ == '__main__':
    cache, out = map(Path, sys.argv[1:3])
    cache.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    # OpenAI's downloader verifies the SHA-256 embedded in its model URL.
    checkpoint = _download(_MODELS['medium'], str(cache), False)
    shutil.copy2(checkpoint, out / 'medium.pt')
    if sys.argv[3] == 'mlx':
        snapshot_download('mlx-community/whisper-medium-mlx', revision='7fc08c4eac4c316526498f147dfdee6f6303f975',
                          local_dir=str(cache / 'mlx'), allow_patterns=['config.json', 'weights.npz', 'README.md'])
        shutil.copytree(cache / 'mlx', out / 'mlx', dirs_exist_ok=True)
    print('Bundled Whisper medium weights ready.', flush=True)
