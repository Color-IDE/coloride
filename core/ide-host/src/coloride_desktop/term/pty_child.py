"""Tiny exec-only child: claim the controlling terminal outside the host loop."""

from __future__ import annotations

import os
import sys


def main(argv: list[str] | None = None) -> None:
    import fcntl
    import termios

    command = sys.argv[1:] if argv is None else argv
    if not command:
        raise SystemExit("missing shell command")
    # The host creates a new session via posix_spawn/subprocess, not preexec_fn.
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    os.tcsetpgrp(0, os.getpgrp())
    os.execvpe(command[0], command, os.environ)


if __name__ == "__main__":
    main()
