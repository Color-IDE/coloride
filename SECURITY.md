# Security policy

Coloride is a desktop IDE that can read files and execute commands with the permissions of its local host user. Agent mode and approval settings control tool execution; they do not create an operating-system sandbox around a project.

## Boundaries

- Run the Python host on loopback (`127.0.0.1`, the default). `COLORIDE_HOST` can override this; exposing the host on a network changes the trust boundary.
- Execution REST and WebSocket APIs require the local host token. Protect host discovery files and do not share tokens or token-bearing URLs.
- Electron renderer windows use context isolation and sandboxing with Node integration disabled. Native capabilities are exposed through the preload bridge.
- Agent tool calls pass through Coloride's policy and approval layer. Review mode, access level, command targets and file changes before authorizing work.
- Model requests can include selected code, messages, attachments and tool results. Managed AI and external providers are separate data boundaries.
- Provider secrets use the backend secret-store/environment paths. Desktop cloud refresh tokens are written to the Electron user-data directory only when `safeStorage` can encrypt them with a real OS secret store. On Linux, the `basic_text` backend is treated as unavailable because Electron encrypts it with a hardcoded key. If encryption is unavailable, the refresh token stays in the main process for that session and is not written to disk. Do not claim that credentials never exist on disk when encryption is available.
- Optional SSH workspaces use the connected user's server permissions. Pairing and the experimental remote runner are separate remote surfaces, not requirements for local use.

## Reporting

Report vulnerabilities through [private vulnerability reporting](https://github.com/Color-IDE/coloride/security/advisories/new) on this repository. Include the affected commit, reproduction steps and impact, with tokens, keys and personal project data removed. Do not open a public issue for an unfixed vulnerability.

## Assets

- Local project files, unsaved work and running shell processes.
- Agent conversations, checkpoints, project memory and terminal history.
- Local API bearer token and persistent-host discovery state.
- Provider credentials, cloud tokens and optional SSH credentials.
- Code and tool output included in external model or integration requests.

## Trust boundaries

| Boundary | Controls and limits |
| --- | --- |
| Renderer → Electron | Preload IPC, context isolation, disabled renderer Node integration and Electron sandbox |
| Renderer → Python host | Default loopback bind and authenticated execution APIs / WebSockets |
| Model → workspace | Structured tools, mode/access policy, approvals and checkpoints; project text and tool output remain untrusted input |
| Host → local filesystem/processes | Host user's OS permissions; the selected folder is not a filesystem sandbox |
| Host → model/cloud/integrations | Configured endpoints and credentials; selected context can leave the machine |
| Host → SSH workspace | Verified SSH connection, remote identity and its OS permissions |

A persistent local host and its shells can outlive the UI. Closing a window is not a process termination or credential revocation mechanism. Explicitly closing a terminal tab ends its shell; a host or OS restart ends running processes.

## Review areas

- Keep host binding, discovery files and bearer tokens private to the intended local user.
- Validate IPC senders, payloads, external navigation and browser session separation.
- Test approval scope, prompt injection resistance and local/SSH session separation.
- Check secret-store fallbacks and log redaction; do not assume every credential is non-exportable or absent from disk.
- Protect against stale file saves, incomplete reads, failed restores and checkpoint conflicts.
- Bound terminal history, model context, background jobs and replay buffers.
- Validate signing, notarization and updater artifacts independently of a successful local build.

Legacy pairing/server-daemon endpoints and the experimental remote runner need their own deployment review before remote exposure. They are not a reason to require server provisioning for the local IDE.
