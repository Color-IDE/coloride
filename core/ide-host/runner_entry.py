"""PyInstaller entrypoint for the Linux-only Coloride Runner."""

from coloride_desktop.runner.runtime import main


if __name__ == "__main__":
    raise SystemExit(main())
