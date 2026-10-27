# Coloride IDE interface

This application contains the React UI for the Coloride desktop IDE: file explorer, CodeMirror editor, xterm terminals, embedded-browser controls, agent timeline and settings.

From the repository root after [repository guide](../../README.md#start-developing):

```sh
corepack pnpm dev          # Full IDE: Vite + Electron + local host
corepack pnpm dev:web      # Vite only; no native shell or host startup
corepack pnpm typecheck
corepack pnpm build:web
```

Start with `src/app/App.tsx`. Native operations use the Electron preload bridge; files, terminals and agent execution use the authenticated local API. Local workspaces do not require SSH or cloud login.

Unit tests live in `tests/unit/`; Electron integration lives under the repository-level `tests/electron/`. See [repository guide](../../README.md#start-developing) for test-runner coverage and limits.

## Source ownership

- `src/app/`: shell composition and global actions.
- `src/features/`: editor, explorer, terminal, agents, settings, auth and onboarding.
- `src/shared/`: reusable API, controls, theme tokens and utilities.

Use the [repository guide](../../README.md#architecture) before adding modules. `src/app/styles.css` is an ordered import manifest, not a place to append new feature rules. The editor is CodeMirror 6; historical Monaco-style visual references do not describe the current engine.
