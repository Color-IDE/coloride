<div align="center">

# Coloride

**Your code. Your Mac. One IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Made%20in-Europe-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Made in Europe" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555?style=flat-square" alt="MIT license" /></a>


**English** · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride editor and terminal" width="880" />

</div>

---

Open a folder and work with your code, terminals and browser on this computer. Nothing in that path calls a Coloride server.

Coloride is a trademark. The MIT license covers the source code, not the name, logo or domains.

## What works today

Coloride runs on **macOS with Apple Silicon**.

- **Edit code:** file explorer, editor tabs, CodeMirror language support, completion, diagnostics, search and image previews.
- **Run your project:** local terminals with job control and sessions that stay up while the local host is alive.
- **Preview your work:** an embedded Chromium browser and pop-out windows. Localhost points to your computer.
- **Start from a blank file:** New File opens an untitled buffer. Closing it asks whether to save if you changed it.

Sign-in and the managed agent are off. [coloride.dev](https://coloride.dev) points here until it has an API. SSH remote workspaces are still in the source and are not exposed in the interface. The [roadmap](./docs/roadmap.md) records priorities, not finished work.

## Checks

From the repository root, after the setup below:

```sh
corepack pnpm typecheck
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
```

UI and Electron checks are in [tests/README.md](./tests/README.md). How to send a change is in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Start developing

Use Node.js 22, pnpm 9.15.4 and Python 3.12+ (CI uses 3.12). From the repository root:

```sh
python3.12 -m venv core/ide-host/.venv
core/ide-host/.venv/bin/python -m pip install -e 'core/ide-host[dev]'
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

This starts Vite and Electron, which starts or reconnects to the local Python host. No server provisioning is needed. React changes use Vite HMR. Electron main/preload changes require an Electron restart; a persistent Python host may retain older code while sessions are active. Do not terminate user sessions for validation.

## Architecture

```text
Electron desktop shell
  ├─ React UI: editor, explorer, terminals, browser, agent
  └─ Authenticated local Python host (HTTP / WebSocket)
       ├─ Local files, PTYs, language servers and agent tools
       ├─ Configured model providers / optional cloud services
       └─ Optional SSH/SFTP transport to a remote workspace
```

The Python host owns execution and terminal processes. The renderer consumes API responses and events. Agent tools pass through Coloride's policy and approval layer. The model/tool decision loop uses Coloride’s bundled turn scheduler; provider integration and workspace execution belong to Coloride.

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
| `artifacts` | Generated build caches, screenshots and test results (ignored by Git) |
| `tests/electron` | Isolated Electron integration and full-IDE smoke tests |

The renderer is grouped into `src/app` (composition), `src/features` (IDE functions) and `src/shared` (reusable code). Shared renderer modules must not depend on features or app composition, and features must not depend on app composition.

## Documentation

| Guide | Contents |
| --- | --- |
| [Contributing](./CONTRIBUTING.md) | Setup, placement, checks and pull requests |
| [Phased roadmap](./docs/roadmap.md) | Objectives, scope and exit criteria for phases 0–12 |
| [Tests](./tests/README.md) | Suite folders, coverage and commands |
| [Security](./SECURITY.md) | Security boundaries, threat model and reporting |

## Status

The project is licensed under the [MIT License](./LICENSE). The supported desktop target is macOS on Apple Silicon. Package versions are maintained in the root and Electron `package.json` files. Build configuration for other systems is not a statement of platform support.

### Optional cloud services and community builds

Files, editing and local terminals work without an account. This repository ships
with cloud services disabled: `client/desktop/src/cloud-config.json` contains
`enabled: false` and empty endpoints. Run `pnpm dev` without additional cloud
configuration. Community installers inherit these defaults.

Forks operating a compatible cloud service can set `appBase` and `apiBase` in the
same file and enable cloud services explicitly. Runtime overrides are `COLORIDE_CLOUD_ENABLED`,
`COLORIDE_CLOUD_APP_BASE` (browser login) and `COLORIDE_CLOUD_AUTH_BASE` (API);
`COLORIDE_CLOUD_API_BASE` is an API alias. Endpoints must use HTTPS without embedded
credentials, query strings or fragments. An alternate server must implement the
existing device-login, account, product and managed-model API contracts.
Electron passes the resolved API configuration to its Python host and exposes
only public configuration to the renderer. A standalone Python host uses the same
environment variables; a browser-only Vite build reads them at build/start time.

Changing cloud configuration requires restarting the app. Close its terminal
tabs first: an existing host with active sessions is preserved rather than reused
with different cloud settings. Refresh tokens for alternate API endpoints use
separate files so the official account token is not sent to a fork's server.
When cloud is disabled, provider API keys can still be used directly; external
model providers require their own credentials and network connection.

This setting controls account and managed-agent access. Editing, terminals,
search, the embedded browser and local files do not call Coloride. Sign-in and
agent model requests are the calls that use `apiBase`.

Open-source builds do not register the machine, upload workspace paths, or
report usage to the product dashboard. They also do not download updates from
the official feed unless `COLORIDE_OFFICIAL_UPDATE=1`.

Crash reporting is separate (`COLORIDE_SENTRY_DISABLED=1`).
