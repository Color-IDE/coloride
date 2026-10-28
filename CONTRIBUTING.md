# Contributing

Coloride is a local desktop IDE. Opening files and using terminals must work without a Coloride account, an SSH connection or a VPS. Remote workspaces and managed AI are optional.

The supported desktop target is macOS on Apple Silicon. Build configuration for other systems is not a statement of platform support.

## Set up

Use Node.js 22, pnpm 9.15.4 and Python 3.12 or newer. CI uses Python 3.12. From the repository root:

```sh
python3.12 -m venv core/ide-host/.venv
core/ide-host/.venv/bin/python -m pip install -e 'core/ide-host[dev]'
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

`pnpm dev` starts Vite and Electron. Electron starts or reconnects to the local Python host. No server provisioning is needed.

React changes use Vite HMR. Electron main and preload changes need an Electron restart. A persistent Python host can keep older code while sessions are active. Do not terminate user sessions to validate a change.

Installers and signed releases are separate from a development checkout. `pnpm desktop` builds the frontend and launches Electron from this checkout. It does not replace an installed application. Packaging scripts live under `tooling/release`.

## Where code goes

| Directory | Responsibility |
| --- | --- |
| `client/ide` | React UI, CodeMirror editor, xterm terminals |
| `client/desktop` | Native shell, preload bridge, browser, host lifecycle, packaging |
| `core/ide-host` | Local FastAPI host, files, PTYs, language servers, agents, optional SSH |
| `packages/contracts` | API definitions and TypeScript contracts |
| `tooling/dev` | Development launch and environment setup |
| `tooling/build` | Sidecar and remote runner builds |
| `tooling/release` | Signing, release and publishing |
| `tooling/checks` | Structure checks, source audits and test runners |
| `artifacts` | Generated build caches, screenshots and test results |
| `tests/electron` | Isolated Electron integration and full-IDE smoke tests |

The renderer is grouped into `src/app` (composition), `src/features` (IDE functions) and `src/shared` (reusable code). Shared renderer modules must not depend on features or app composition. Features must not depend on app composition. Prefer the editor's existing public entry point when importing its public components.

Do not recreate `backend`, `frontend`, `desktop`, `shared`, `apps`, `services` or `ops` at the repository root. Keep Python tests under each service's `tests/<area>`, frontend unit tests under `client/ide/tests/unit/<area>`, and manual or benchmark scripts in their dedicated test folders.

The Python host owns execution and terminal processes. The renderer consumes API responses and events. Agent tools pass through Coloride's policy and approval layer. Keep module names under `coloride_desktop` stable.

## What has to be done

Coloride is being built incrementally. The [current contribution focus](./docs/roadmap.md#current-contribution-focus)
sets out the product work we want help with:

- Git connected to the file tree, editor and agent change review.
- A reliable SSH connector for complete remote project workflows.
- An integrated debugger using DAP.
- A more adaptive agent, with a stronger agent interface and backend.
- An extension format, public API, permissions and isolated extension host.
- Connections to agent and browser sessions on other computers.
- Team collaboration with explicit sharing and execution permissions.
- Better code navigation, project intelligence and reproducible performance benchmarks.

Some of these areas already have a foundation. Before proposing work, inspect the
current implementation and identify a concrete gap. The roadmap owns product
scope; issues track individual tasks and their status.

### Where to propose work

- **Roadmap:** product direction and expected outcomes.
- **Discussions, when available:** open questions and substantial architecture proposals.
- **Issues:** reproducible bugs or scoped tasks with dependencies and testable acceptance criteria. Search existing issues first; broad tracking issues should link smaller tasks.
- **Pull requests:** focused implementations linked to the relevant issue, with verification evidence.

For a substantial feature, agree on its scope in an issue or design discussion
before investing in a large implementation. Include the user problem, current
behavior, proposed change and how it will be verified. Distinguish mocked checks
from live-service results. UI changes need running-app verification; performance
claims need hardware, workload and measurement conditions.

macOS Apple Silicon remains the supported target until another platform has its
own tested development, packaging and release workflow. Bug reports should
include the OS, hardware, revision, reproduction steps and sanitized logs; never
post API keys, account tokens or private workspace data.

## Change rules

- Preserve unrelated worktree changes and third-party licenses and notices.
- When you move an entry point or component, update runtime discovery, workspace configuration, CI, packaging and the guides that name it.
- API changes update OpenAPI, TypeScript contracts, Python models and consumers together.
- Keep local file and terminal use independent of cloud login. Model requests and enabled integrations may send selected context to their configured services.
- Integration fixtures use temporary projects, user data and hosts. Never attach them to installed user sessions. See [isolated verification](./tests/README.md#isolated-terminal-and-ide-verification).
- Report passed, failed and skipped checks separately. Do not weaken assertions so an unrelated reorganization can pass.

## Checks

Run the checks that match the change, from the repository root.

Renderer changes:

```sh
corepack pnpm typecheck
corepack pnpm build:web
```

`pnpm typecheck` includes the structural check. Behavior changes also need their relevant tests and a running-app check. Unit tests do not certify browser layout.

Backend changes:

```sh
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
```

When the bundled agent runtime changes, rebuild it:

```sh
node client/desktop/src/agent-runtime/build.mjs
```

Integration changes use `corepack pnpm test:electron` and the isolated smoke commands in [tests/README.md](./tests/README.md). UI changes need running-app checks.

## Pull requests

Describe the user-visible change, the checks you ran, and any checks you skipped. Include the commit or branch you tested against when a result depends on local state.

Remove tokens, keys and personal project data from reports, screenshots and logs. Vulnerability reports go through the private channel in [SECURITY.md](./SECURITY.md), not a public issue.

## Guides

| Guide | Contents |
| --- | --- |
| [README](./README.md) | Product overview, setup and architecture |
| [Tests](./tests/README.md) | Suite folders, coverage and commands |
| [Security](./SECURITY.md) | Security boundaries, threat model and reporting |
| [License](./LICENSE) | MIT license |
| [Roadmap](./docs/roadmap.md) | Objectives, scope and exit criteria for phases 0–12 |
