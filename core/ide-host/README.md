# Coloride IDE host

Python 3.12+ FastAPI service used by the desktop IDE. Electron starts or reconnects to this host. It can remain alive after Electron closes to preserve local terminal sessions.

Responsibilities:

- Authenticated REST/WebSocket APIs, defaulting to `127.0.0.1`.
- Local file access, PTYs, terminal history/reconnect and language servers.
- Agent sessions, providers, context, policies, approvals, checkpoints and tools.
- Optional SSH/SFTP access, remote terminals and browser transport.

Local work does not require an SSH connection or cloud login. External AI still requires provider configuration or managed authentication.

From the repository root after [repository guide](../../README.md#start-developing):

```sh
core/ide-host/.venv/bin/python -m coloride_desktop.sidecar --no-frontend
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
```

See [isolated verification](../../tests/README.md#isolated-terminal-and-ide-verification), [repository guide](../../README.md#architecture) and [security](../../SECURITY.md). The default bind address can be overridden by configuration; keep it on loopback for desktop use.

## Experimental remote runner

`src/coloride_desktop/runner/` retains the optional persistent remote-job implementation. It is separate from the local IDE host and requires a compatible remote artifact plus a hosted job-token exchange and execution lease before production model turns can be enabled. Desktop refresh tokens, provider keys and SSH credentials must not be sent as job payloads. This capability is not part of ordinary local setup.

`tooling/build/build-runner.sh x86_64|arm64`, run from the repository root inside a matching Linux builder, creates the optional remote-runner artifact. It is a manual build entry point, not part of local IDE startup.
