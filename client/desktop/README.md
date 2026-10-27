# Desktop shell

This application contains Electron main/preload code, embedded browser views, ide-host discovery/startup, cloud authentication, auto-update and packaging configuration.

React renders the IDE; the Python host owns files, terminal processes and agent tools. The host can outlive the UI, so quitting Electron preserves running terminal sessions while that host remains alive.

From the repository root after [repository guide](../../README.md#start-developing):

```sh
corepack pnpm dev          # Vite + Electron + local host
corepack pnpm desktop     # Build frontend and launch from checkout
```

Changes to main/preload require an Electron restart. These commands do not replace an installed application. See [Contributing](../../CONTRIBUTING.md) for installers and [isolated verification](../../tests/README.md#isolated-terminal-and-ide-verification) for isolated integration tests.
