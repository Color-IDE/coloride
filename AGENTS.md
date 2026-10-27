# Coloride repository conventions

Coloride is a local desktop IDE. Opening files and using terminals must work without cloud login or SSH. Remote workspaces and managed AI are optional capabilities.

## Placement

- `client/ide`: React renderer. `src/app` composes the application and shell; `src/features/<area>` owns each IDE function; `src/shared` holds reusable API/UI/assets/utilities.
- `client/desktop`: Electron main/preload, browser views, runtime bundle and packaging.
- `core/ide-host`: Python execution host. Keep module names under `coloride_desktop` stable.
- `packages/contracts`: shared OpenAPI and TypeScript payloads.
- `tooling/dev`: development launch and environment setup.
- `tooling/build`: sidecar and runner builders.
- `tooling/release`: signing, release and publishing.
- `tooling/checks`: structural checks, source audits and test runners.
- `artifacts`: generated build caches, screenshots and test results; never source code.
- `tests/electron`: cross-component integration, support harnesses and full-IDE smoke.

Do not recreate `backend`, `frontend`, `desktop`, `shared`, `apps`, `services` or `ops` at the repository root. Shared renderer modules must not depend on features or app composition. Features must not depend on app composition. Prefer the editor's existing public entry point when importing its public components.

Keep Python tests under each service's `tests/<area>`, frontend unit tests under `client/ide/tests/unit/<area>` and manual/benchmark scripts under their dedicated test folders. Do not add duplicate documentation for information already covered by the README or the current guides in `docs`.

## Verification

Run `pnpm typecheck` (includes structural checks) and `pnpm build:web` for renderer changes. Use `core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q` for backend changes. Build the bundled runtime with `node client/desktop/src/agent-runtime/build.mjs` when needed.

For integration changes, use `pnpm test:electron` and the isolated smoke commands in `tests/README.md`. UI changes need running-app checks. Never attach integration fixtures to installed user sessions. Report passed, failed and skipped checks separately; do not weaken assertions to make an unrelated reorganization pass.

Preserve unrelated worktree changes and third-party licenses/notices. Update runtime discovery, workspace configuration, CI, packaging and documentation whenever moving an entry point or component.
