from __future__ import annotations

import asyncio
import contextlib
import json
import os
import secrets
import shlex
import sys
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from typing import Any, cast
from urllib.parse import unquote, urlencode

try:
    import pty
except ImportError:  # Windows — local PTY terminals are Unix-only.
    pty = None  # type: ignore[assignment]

import asyncssh
import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from ..agents.client import AgentProxyClient, AgentTurnActiveError
from ..agents.config import AgentConfigStore
from ..agents.domain import AgentMode
from ..browser import BrowserService
from ..certs.store import (
    CertificateBundle,
    KeyringCertificateStore,
    generate_dev_certificate,
)
from ..cloud import cloud_api_base, cloud_enabled
from ..config import LaunchConfig
from ..events import EventHub
from ..files.local import WorkspaceFileService
from ..files.search import ProjectSearchService, SearchConnectionError
from ..files.service import (
    EditorContentTooLargeError,
    FileVersionRequiredError,
    PartialFileWriteBlockedError,
    RemoteFileService,
)
from ..git.safe_deploy import SafeGitDeployService
from ..lsp import LspRegistry
from ..lsp.local import open_local_lsp_process, run_local_command
from ..models import (
    AgentApprovalRequest,
    AgentApprovalResponse,
    AgentCheckpointRestoreRequest,
    AgentConfigResponse,
    AgentConfigUpdateRequest,
    AgentEvaluationResponse,
    AgentEventResponse,
    AgentGuardResolveRequest,
    AgentInfo,
    AgentIntegrationsUpdateRequest,
    AgentLinearCredentialRequest,
    AgentPlanDismissRequest,
    AgentPlanImplementRequest,
    AgentPlanModel,
    AgentPlanUpdateRequest,
    AgentSessionAccessRequest,
    AgentSessionArchiveRequest,
    AgentSessionForkRequest,
    AgentSessionModeRequest,
    AgentSessionReasoningRequest,
    AgentSessionSendRequest,
    AgentSessionStartRequest,
    AgentSessionStartResponse,
    AgentSessionStopRequest,
    AgentSessionWorkspaceRequest,
    AgentToolInfo,
    AuthorizedKeyAddRequest,
    AuthorizedKeysResponse,
    BrowserOpenRequest,
    BrowserOpenResponse,
    BrowserScreenshotResponse,
    BrowserSessionInfo,
    BugReportRequest,
    BugReportResponse,
    ConnConnectRequest,
    ConnDirectRequest,
    ConnInfo,
    ConnStatePayload,
    ConnStatsPayload,
    ErrorPayload,
    FileCopyRequest,
    FileDeleteRequest,
    FileListRequest,
    FileMkdirRequest,
    FileReadRequest,
    FileRenameRequest,
    FileSearchRequest,
    FileStatRequest,
    FileWriteRequest,
    HostKeyInfo,
    HostKeyInspectRequest,
    HostKeyTrustRequest,
    LocalWorkspaceOpenRequest,
    LspSessionInfo,
    LspStartRequest,
    PairStartRequest,
    PairStartResponse,
    Profile,
    ProfileUpdateRequest,
    ServerDashboardResponse,
    ServerSettingsResponse,
    SessionSummary,
    TermCreateRequest,
    TermCreateResponse,
    TermInfoResponse,
    TermSessionInfo,
    WorkspaceGrantRequest,
    WorkspaceOpenRequest,
)
from ..profiles.store import (
    ConnectionProfile,
    JsonProfileStore,
    generate_profile_id,
    make_cert_profile,
    make_dev_profile_from_pair,
)
from ..reports.store import BugReportStore
from ..security import bearer_auth
from ..ssh.host_keys import HostKeyInspection, HostKeyStore
from ..ssh.manager import AsyncSSHConnectionManager, ConnectionCredentials, _as_text
from ..ssh.restricted import (
    DEFAULT_ALLOWED_ROOTS,
    DEFAULT_BROWSE_ROOTS,
    RESTRICTED_USERNAME,
    is_path_under_roots,
    is_safe_workspace_path,
    normalize_remote_root,
    path_allowed_for_restricted,
)
from ..term.sessions import TerminalRegistry
from ..term.local_pty import LocalPtyIO
from ..term.tmux_control import TmuxControlClient


def _http_error(status: int, code: str, message: str, retryable: bool = False) -> HTTPException:
    """Centralized structured error using ErrorPayload."""
    payload = ErrorPayload(code=code, message=message, retryable=retryable)
    return HTTPException(status_code=status, detail=payload.model_dump(by_alias=True))


def _websocket_authorized(websocket: WebSocket, token: str | None, expected: str) -> bool:
    header = websocket.headers.get("authorization") or ""
    if header == f"Bearer {expected}":
        return True
    raw = token if token is not None else websocket.query_params.get("token")
    if raw is None:
        return False
    return unquote(str(raw)) == expected


def _normalize_terminal_history(value: str) -> bytes:
    """Trim capture-pane padding and emit terminal-safe line endings."""
    lines = value.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    while lines and not lines[0].strip(" \t"):
        lines.pop(0)
    while lines and not lines[-1].strip(" \t"):
        lines.pop()
    if not lines:
        return b""
    return ("\r\n".join(lines) + "\r\n").encode()


def _host_key_info(inspection: HostKeyInspection) -> HostKeyInfo:
    return HostKeyInfo(
        host=inspection.host,
        port=inspection.port,
        algorithm=inspection.algorithm,
        fingerprint=inspection.fingerprint,
        publicKey=inspection.public_key,
        status=inspection.status,
        trustedFingerprint=inspection.trusted_fingerprint,
    )


def _profile_model(profile: ConnectionProfile) -> Profile:
    return Profile(
        id=profile.id,
        name=profile.name,
        host=profile.host,
        port=profile.port,
        username=profile.username,
        provider="other",
        deviceId="dev-device",
        createdAt=profile.created_at,
        defaultWorkspace=profile.default_workspace,
        workspaceEnvironment=profile.workspace_environment,
        workspaceSourcePath=profile.workspace_source_path,
        productionAccess=profile.production_access,
        productionCapabilities=profile.production_capabilities,
        productionRuntime=profile.production_runtime,
        defaultShell=profile.default_shell,
        terminalPersistence=profile.terminal_persistence,
        monitorInterval=profile.monitor_interval,
        accessMode="restricted",
        allowedRoots=profile.allowed_roots,
    )


async def _http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Ensure all HTTPException responses are JSON with ErrorPayload shape."""
    _ = request
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    # fallback: wrap plain strings
    code = "http_error"
    if exc.status_code == status.HTTP_404_NOT_FOUND:
        code = "not_found"
    elif exc.status_code == status.HTTP_403_FORBIDDEN:
        code = "forbidden"
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorPayload(
            code=code,
            message=str(exc.detail) if exc.detail else "",
            retryable=False,
        ).model_dump(by_alias=True),
    )


def create_app(config: LaunchConfig) -> FastAPI:
    @contextlib.asynccontextmanager
    async def lifespan(application: FastAPI):
        try:
            yield
        finally:
            # This runs when the host itself exits, not when Electron detaches.
            for terminal in application.state.terminals.list():
                if terminal.local:
                    application.state.terminals.close(terminal.term_id, preserve_history=True)
            await application.state.search.close()

    app = FastAPI(title="Coloride Desktop Backend", version="0.1.0", lifespan=lifespan)
    app.state.config = config
    app.state.events = EventHub()
    app.state.ssh = AsyncSSHConnectionManager()
    app.state.terminals = TerminalRegistry(os.environ.get("COLORIDE_TERMINAL_STATE_DIR"))
    app.state.terminal_host_idle_task = None
    app.state.profiles = JsonProfileStore()
    app.state.host_keys = HostKeyStore()
    app.state.bug_reports = BugReportStore()
    # Use real keyring store for cert material (persistent, OS-backed)
    app.state.certs = KeyringCertificateStore()
    app.state.restricted_allowed_roots = None
    app.state.session_identity = {"username": None, "elevated": False}

    app.state.agent_config = AgentConfigStore()

    # Coloride owns the model loop locally; tools execute through the verified SSH connection.
    async def _run_on_ssh(cmd: str) -> Any:
        conn = getattr(app.state.ssh, "command_connection", None) or app.state.ssh.connection
        if conn is None:
            raise RuntimeError("No active SSH connection")
        return await conn.run(cmd, check=False, timeout=200)

    async def _run_for_agent(cmd: str) -> Any:
        """Run through the transport bound to the current agent session."""
        if app.state.files.mode != "local":
            return await _run_on_ssh(cmd)
        process = await asyncio.create_subprocess_exec(
            os.environ.get("SHELL") or "/bin/zsh",
            "-lc",
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=200)
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            with contextlib.suppress(Exception):
                await process.communicate()
            return SimpleNamespace(
                exit_status=124,
                stdout="",
                stderr="Command timed out after 200s without finishing.",
            )

        return SimpleNamespace(
            exit_status=int(process.returncode or 0),
            stdout=stdout.decode("utf-8", errors="replace"),
            stderr=stderr.decode("utf-8", errors="replace"),
        )

    def _enforce_remote_path(path: str, mutate: bool) -> None:
        from ..agents.tools import path_in_active_agent_workspace, relax_path_policy

        if relax_path_policy():
            return
        # The user already chose this folder. The connected Linux identity and
        # its native permissions are the authority for remote paths.
        if path_in_active_agent_workspace(path):
            return
        if bool(getattr(app.state, "session_identity", {}).get("elevated")):
            return
        roots = app.state.restricted_allowed_roots
        if roots is None:
            return
        if not path_allowed_for_restricted(path, allowed_roots=roots, mutate=mutate):
            print(
                f"[PATH_POLICY] denied mutate={mutate} path={path!r} roots={roots!r}",
                flush=True,
            )
            operation = "change" if mutate else "open"
            raise PermissionError(f"Coloride Access cannot {operation} paths outside the permitted server areas")

    # File service (SFTP + optional SSH runner for content search via ripgrep).
    remote_files = RemoteFileService(
        lambda: app.state.ssh.get_sftp(),
        run_command=_run_on_ssh,
        path_policy=_enforce_remote_path,
    )
    app.state.files = WorkspaceFileService(remote_files)
    app.state.safe_git = SafeGitDeployService(_run_on_ssh)

    # App-wide remote browser (UI explorer + agent tools share this service).
    app.state.browsers = BrowserService(run_command=_run_on_ssh, files=app.state.files)

    app.state.agents = AgentProxyClient(
        run_command=_run_for_agent,
        publish=app.state.events.publish,
        files=app.state.files,
        browsers=app.state.browsers,
        config=app.state.agent_config,
    )

    def _search_remote_binding(connection_id: str | None):
        snapshot = app.state.ssh.snapshot
        conn = getattr(app.state.ssh, "command_connection", None) or app.state.ssh.connection
        if conn is None or not connection_id or connection_id != snapshot.profile_id:
            raise SearchConnectionError("The search workspace is not on the active SSH connection")
        # Retain this exact transport and identity; background work cannot move
        # to another server or Linux user when the UI changes connection.
        identity = f"{connection_id}:{id(conn)}"

        async def run(command: str):
            current = getattr(app.state.ssh, "command_connection", None) or app.state.ssh.connection
            if current is not conn or app.state.ssh.snapshot.profile_id != connection_id:
                raise SearchConnectionError("The indexed SSH connection changed")
            return await conn.run(command, check=False, timeout=15)

        return identity, run

    app.state.search = ProjectSearchService(remote_binding=_search_remote_binding)
    app.state.agents.bind_search(app.state.search)

    async def _resolve_production_context(session: Any) -> dict[str, Any] | None:
        if getattr(session, "workspace_kind", "ssh") != "ssh":
            return None
        profile_id = app.state.ssh.snapshot.profile_id
        profile = await app.state.profiles.get(profile_id) if profile_id else None
        live = profile.workspace_source_path or ""
        work = profile.default_workspace or session.cwd
        if not live.startswith("/var/www/") or not is_safe_workspace_path(work):
            return None
        cwd = (session.cwd or "").rstrip("/") or "/"
        work_root = work.rstrip("/")
        if cwd != work_root and not cwd.startswith(work_root + "/"):
            return None
        return {
            "productionPath": live,
            "workspacePath": work,
            "access": profile.production_access,
            "capabilities": profile.production_capabilities,
            "runtime": profile.production_runtime,
        }

    app.state.agents.bind_production(
        resolver=_resolve_production_context,
        controller=app.state.safe_git,
    )

    async def _resolve_filesystem_roots(session: Any) -> dict[str, Any] | None:
        if getattr(session, "workspace_kind", "ssh") != "ssh":
            return None
        profile_id = app.state.ssh.snapshot.profile_id
        profile = await app.state.profiles.get(profile_id) if profile_id else None
        allowed = _profile_allowed_roots(profile) if profile is not None else list(DEFAULT_ALLOWED_ROOTS)
        readable = list(dict.fromkeys([*DEFAULT_BROWSE_ROOTS, *allowed]))
        return {"writableRoots": allowed, "readableRoots": readable}

    app.state.agents.bind_filesystem_roots(_resolve_filesystem_roots)

    def _ssh_work_conn():
        return getattr(app.state.ssh, "command_connection", None) or app.state.ssh.connection

    async def _kill_tmux_session(name: str) -> None:
        command = f"tmux kill-session -t {shlex.quote(name)} 2>/dev/null || true"
        seen: list[object] = []
        for conn in (app.state.ssh.connection, _ssh_work_conn()):
            if conn is None or conn in seen:
                continue
            seen.append(conn)
            with contextlib.suppress(Exception):
                await conn.run(command, check=False)

    async def _run_on_editor_ssh(cmd: str) -> Any:
        # Same Linux user as files/terminal/agent (elevated root on Computer).
        conn = _ssh_work_conn()
        if conn is None:
            raise RuntimeError("No active SSH connection")
        return await conn.run(cmd, check=False, timeout=200)

    async def _lsp_run_command(cmd: str) -> Any:
        if app.state.files.mode == "local":
            return await run_local_command(cmd)
        return await _run_on_editor_ssh(cmd)

    async def _lsp_open_process(command: str, *, encoding: str | None = "utf-8") -> Any:
        if app.state.files.mode == "local":
            return await open_local_lsp_process(command, encoding=encoding)
        return await app.state.ssh.open_process(command, encoding=encoding)

    app.state.lsp = LspRegistry(_lsp_open_process, _lsp_run_command)
    app.state.agents.bind_lsp(app.state.lsp)

    auth = Depends(bearer_auth(config.bearer_token))

    # Ensure all errors use structured ErrorPayload
    app.exception_handler(HTTPException)(_http_exception_handler)

    # Allow Vite dev origin when running in COLORIDE_DEV mode
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_origin_regex=r"http://(127\.0\.0\.1|localhost):\d+",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def desktop_security_headers(request: Request, call_next: Any) -> Response:
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "base-uri 'none'; object-src 'none'; frame-ancestors 'none'; "
            "script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https:; font-src 'self' data:; "
            "connect-src 'self' http://127.0.0.1:* http://localhost:* "
            "ws://127.0.0.1:* ws://localhost:* https:; "
            "worker-src 'self' blob:; media-src 'self' data: blob:; "
            "form-action 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(self), geolocation=(), payment=(), usb=()"
        )
        return response

    if config.frontend_dist is not None:
        frontend_dist = Path(config.frontend_dist)
        assets_dir = frontend_dist / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/default-user-avatar.png", include_in_schema=False)
        async def desktop_default_avatar() -> FileResponse:
            avatar = frontend_dist / "default-user-avatar.png"
            if not avatar.is_file():
                raise _http_error(status.HTTP_404_NOT_FOUND, "frontend.avatar_missing", "Avatar not found.")
            return FileResponse(avatar, media_type="image/png")

        @app.get("/", response_class=HTMLResponse)
        async def desktop_index() -> HTMLResponse:
            index_path = frontend_dist / "index.html"
            if not index_path.exists():
                raise _http_error(
                    status.HTTP_404_NOT_FOUND,
                    "frontend.not_built",
                    "Frontend build not found. Run pnpm build:web first.",
                )
            return HTMLResponse(index_path.read_text(encoding="utf-8"))

    @app.get("/api/health", dependencies=[auth])
    async def health() -> dict[str, str]:
        idle_task = app.state.terminal_host_idle_task
        if idle_task is not None and not idle_task.done():
            idle_task.cancel()
        app.state.terminal_host_idle_task = None
        return {"status": "ok", "service": "coloride-desktop-backend"}

    # ── Cloud product auth proxy ─────────────────────────────────────────────
    # The renderer cannot call api.coloride.com directly (no CORS for Electron/
    # Vite origins → browser "Failed to fetch"). The local sidecar proxies
    # /auth/* so the UI stays same-origin to 127.0.0.1.
    #
    # Platform API key (rk_live_...) identifies THIS desktop build to the cloud.
    # User JWTs (access_token after browser link) stay separate on Authorization.
    cloud_auth_base = cloud_api_base(os.environ)
    cloud_available = cloud_enabled(os.environ)

    def require_cloud_enabled() -> None:
        if not cloud_available:
            raise _http_error(status.HTTP_403_FORBIDDEN, "cloud.disabled", "Cloud services are disabled in this distribution.")
    cloud_api_key = (
        os.environ.get("COLORIDE_CLOUD_API_KEY", "").strip()
        or os.environ.get("COLORIDE_API_KEY", "").strip()
    )
    # Packaged Electron performs token-bearing device poll/refresh/logout in its
    # main process. Keep renderer proxy compatibility only for browser/Vite dev.
    renderer_refresh_allowed = config.frontend_dist is None

    def require_renderer_refresh_allowed() -> None:
        if not renderer_refresh_allowed:
            raise _http_error(
                status.HTTP_403_FORBIDDEN,
                "cloud_auth.main_process_required",
                "Token-bearing cloud authentication is restricted to Electron main.",
            )

    async def _proxy_cloud_auth(
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        authorization: str | None = None,
        query: dict[str, str] | None = None,
    ) -> Response:
        require_cloud_enabled()
        url = f"{cloud_auth_base}{path}"
        if query:
            url = f"{url}?{urlencode(query)}"
        headers: dict[str, str] = {
            "accept": "application/json",
            "user-agent": "Coloride-Desktop/cloud-auth-proxy",
        }
        if body is not None:
            headers["content-type"] = "application/json"
        # Machine credential for the Coloride cloud product API (not the user password).
        if cloud_api_key:
            headers["x-api-key"] = cloud_api_key
        # User session JWT after browser-link approve (/auth/me, etc.).
        if authorization:
            headers["authorization"] = authorization
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                upstream = await client.request(method, url, content=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise _http_error(
                status.HTTP_504_GATEWAY_TIMEOUT,
                "cloud_auth.timeout",
                "Coloride cloud auth timed out.",
            ) from exc
        except httpx.HTTPError as exc:
            raise _http_error(
                status.HTTP_502_BAD_GATEWAY,
                "cloud_auth.unreachable",
                f"Could not reach Coloride cloud auth ({cloud_auth_base}).",
            ) from exc

        # Pass through JSON (or text) status from the cloud API.
        media = upstream.headers.get("content-type", "application/json")
        return Response(content=upstream.content, status_code=upstream.status_code, media_type=media)

    @app.post("/api/cloud-auth/device/code", dependencies=[auth])
    async def cloud_auth_device_code() -> Response:
        return await _proxy_cloud_auth("POST", "/auth/device/code", body=b"{}")

    @app.get("/api/cloud-auth/device/poll", dependencies=[auth])
    async def cloud_auth_device_poll(
        device_code: str = "",
        challenge: str = "",
    ) -> Response:
        require_renderer_refresh_allowed()
        # device_code is the challenge itself (a long secret).
        code = (device_code or challenge or "").strip()
        if not code:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "cloud_auth.device_code_required",
                "device_code is required.",
            )
        return await _proxy_cloud_auth(
            "GET",
            "/auth/device/poll",
            query={"device_code": code, "challenge": code},
        )

    @app.post("/api/cloud-auth/refresh", dependencies=[auth])
    async def cloud_auth_refresh(request: Request) -> Response:
        require_renderer_refresh_allowed()
        return await _proxy_cloud_auth("POST", "/auth/refresh", body=await request.body())

    @app.post("/api/cloud-auth/logout", dependencies=[auth])
    async def cloud_auth_logout(request: Request) -> Response:
        require_renderer_refresh_allowed()
        return await _proxy_cloud_auth("POST", "/auth/logout", body=await request.body())

    @app.get("/api/cloud-auth/me", dependencies=[auth])
    async def cloud_auth_me(request: Request) -> Response:
        authorization = request.headers.get("authorization")
        # Prefer the cloud access JWT passed by the renderer as X-Cloud-Authorization
        # so it does not collide with the local sidecar Bearer token.
        cloud_bearer = request.headers.get("x-cloud-authorization") or authorization
        return await _proxy_cloud_auth("GET", "/auth/me", authorization=cloud_bearer)

    @app.put("/api/cloud-auth/agent-token", dependencies=[auth])
    async def cloud_auth_agent_token(request: Request) -> dict[str, bool]:
        """Push the user cloud JWT so the agent can call managed /v1/llm/responses."""
        from coloride_desktop.agents.cloud_token import (
            clear_cloud_access_token,
            set_cloud_access_token,
        )

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        require_cloud_enabled()
        token = body.get("accessToken") or body.get("access_token") or ""
        if isinstance(token, str) and token.strip():
            set_cloud_access_token(token.strip())
            return {"ok": True}
        clear_cloud_access_token()
        return {"ok": True}

    @app.delete("/api/cloud-auth/agent-token", dependencies=[auth])
    async def cloud_auth_agent_token_clear() -> dict[str, bool]:
        from coloride_desktop.agents.cloud_token import clear_cloud_access_token

        clear_cloud_access_token()
        return {"ok": True}

    # Prefer product profile from /v1/me when available (dashboard-aligned user fields).
    @app.get("/api/cloud-v1/me", dependencies=[auth])
    async def cloud_v1_me(request: Request) -> Response:
        cloud_bearer = request.headers.get("x-cloud-authorization") or request.headers.get(
            "authorization"
        )
        return await _proxy_cloud_auth("GET", "/v1/me", authorization=cloud_bearer)

    @app.api_route(
        "/api/cloud-v1/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        dependencies=[auth],
    )
    async def cloud_v1_proxy(path: str, request: Request) -> Response:
        """Proxy product API (machines, projects, agents, usage, dashboard).

        Renderer → local sidecar (avoids CORS) → https://api.coloride.com/v1/*
        User JWT arrives as X-Cloud-Authorization.
        """
        cleaned = path.lstrip("/")
        if not cleaned or ".." in cleaned.split("/"):
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "cloud_v1.invalid_path",
                "Invalid product API path.",
            )
        cloud_bearer = request.headers.get("x-cloud-authorization")
        if not cloud_bearer:
            raise _http_error(
                status.HTTP_401_UNAUTHORIZED,
                "cloud_v1.auth_required",
                "Cloud access token required (X-Cloud-Authorization).",
            )
        # Forward query string as-is.
        query_items = [(key, value) for key, value in request.query_params.multi_items()]
        query = dict(query_items) if query_items else None
        method = request.method.upper()
        raw_body = await request.body()
        body = raw_body if method != "GET" and raw_body else None
        return await _proxy_cloud_auth(
            method,
            f"/v1/{cleaned}",
            body=body,
            authorization=cloud_bearer,
            query=query,
        )

    @app.post("/api/reports", response_model=BugReportResponse, dependencies=[auth])
    async def reports_create(request: BugReportRequest) -> BugReportResponse:
        try:
            report = app.state.bug_reports.save(
                categories=request.categories,
                description=request.description,
                include_diagnostics=request.include_diagnostics,
                connection_state=app.state.ssh.snapshot.state.value,
            )
        except OSError as exc:
            raise _http_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "reports.local_save_failed",
                "The report could not be stored securely on this device.",
                retryable=True,
            ) from exc
        return BugReportResponse(
            reportId=report["id"],
            createdAt=report["createdAt"],
            storedLocally=True,
        )

    @app.post("/api/conn/host-key/inspect", response_model=HostKeyInfo, dependencies=[auth])
    async def host_key_inspect(request: HostKeyInspectRequest) -> HostKeyInfo:
        try:
            key = await asyncio.wait_for(
                asyncssh.get_server_host_key(request.host, request.port),
                timeout=10,
            )
            return _host_key_info(app.state.host_keys.inspect(request.host, request.port, key))
        except Exception as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "conn.host_key_unavailable",
                f"Unable to read the SSH identity for {request.host}:{request.port}: {exc}",
                retryable=True,
            ) from exc

    @app.post("/api/conn/host-key/trust", response_model=HostKeyInfo, dependencies=[auth])
    async def host_key_trust(request: HostKeyTrustRequest) -> HostKeyInfo:
        try:
            key = await asyncio.wait_for(
                asyncssh.get_server_host_key(request.host, request.port),
                timeout=10,
            )
            public_key = key.export_public_key().decode().strip()
            fingerprint = key.get_fingerprint("sha256")
            if not (
                secrets.compare_digest(fingerprint, request.fingerprint)
                and secrets.compare_digest(public_key, request.public_key.strip())
            ):
                raise _http_error(
                    status.HTTP_409_CONFLICT,
                    "conn.host_key_changed_during_verification",
                    "The server identity changed before it could be trusted. Connection blocked.",
                )
            return _host_key_info(app.state.host_keys.trust(request.host, request.port, key))
        except HTTPException:
            raise
        except Exception as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "conn.host_key_unavailable",
                f"Unable to trust the SSH identity for {request.host}:{request.port}: {exc}",
                retryable=True,
            ) from exc

    @app.post("/api/conn/host-key/forget", dependencies=[auth])
    async def host_key_forget(request: HostKeyInspectRequest) -> dict[str, bool]:
        return {"ok": app.state.host_keys.forget(request.host, request.port)}

    @app.get("/api/profiles", response_model=list[Profile], dependencies=[auth])
    async def profiles_list() -> list[Profile]:
        stored = await app.state.profiles.list()
        return [_profile_model(profile) for profile in stored if not profile.hidden]

    @app.patch("/api/profiles/{profile_id}", response_model=Profile, dependencies=[auth])
    async def profiles_update(profile_id: str, request: ProfileUpdateRequest) -> Profile:
        if not request.model_fields_set:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "profile.empty_update",
                "Provide at least one server setting to update.",
            )

        name = request.name.strip() if request.name is not None else None
        if request.name is not None and not name:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "profile.invalid_name", "Server name cannot be empty.")

        default_workspace = (
            request.default_workspace.strip()
            if request.default_workspace is not None
            else None
        )
        if request.default_workspace is not None and not default_workspace.startswith("/"):
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "profile.invalid_workspace",
                "Default workspace must be an absolute server path.",
            )

        stored = next(
            (profile for profile in await app.state.profiles.list() if profile.id == profile_id),
            None,
        )
        if stored is None:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "profile.not_found",
                f"Profile {profile_id} not found",
            )

        from ..profiles.store import (
            normalize_production_capabilities,
            normalize_production_runtime,
        )

        updated = replace(
            stored,
            name=name if name is not None else stored.name,
            default_workspace=(
                default_workspace
                if request.default_workspace is not None
                else stored.default_workspace
            ),
            default_shell=request.default_shell if request.default_shell is not None else stored.default_shell,
            terminal_persistence=(
                request.terminal_persistence
                if request.terminal_persistence is not None
                else stored.terminal_persistence
            ),
            monitor_interval=(
                request.monitor_interval
                if request.monitor_interval is not None
                else stored.monitor_interval
            ),
            production_access=(
                request.production_access
                if request.production_access is not None
                else stored.production_access
            ),
            production_capabilities=(
                normalize_production_capabilities(request.production_capabilities)
                if request.production_capabilities is not None
                else stored.production_capabilities
            ),
            production_runtime=(
                normalize_production_runtime(request.production_runtime)
                if request.production_runtime is not None
                else stored.production_runtime
            ),
        )
        try:
            await app.state.profiles.save(updated)
        except Exception as exc:
            raise _http_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "profile.save_failed",
                "Unable to save the server name.",
                retryable=True,
            ) from exc

        return _profile_model(updated)

    @app.delete("/api/profiles/{profile_id}", dependencies=[auth])
    async def profiles_delete(profile_id: str) -> dict[str, bool]:
        stored_profile = await app.state.profiles.get(profile_id)

        try:
            deleted = await app.state.profiles.delete(profile_id)
        except Exception as exc:
            raise _http_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "profile.secure_delete_failed",
                "Unable to remove the saved credential from the system keychain.",
                retryable=True,
            ) from exc
        if not deleted:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "profile.not_found",
                f"Profile {profile_id} not found",
            )

        # Forget Server is destructive for that server's terminal sessions,
        # but must never touch local shells or terminals parked for another VPS.
        forgotten_sessions = [
            session
            for session in app.state.terminals.list()
            if not session.local and session.connection_id == profile_id
        ]
        if app.state.ssh.snapshot.profile_id == profile_id:
            for session in forgotten_sessions:
                if session.tmux_session:
                    await _kill_tmux_session(session.tmux_session)
        app.state.terminals.close_connection(profile_id)
        await app.state.agents.forget_server_memory(profile_id)

        if hasattr(app.state, "certs") and app.state.certs is not None:
            with contextlib.suppress(Exception):
                await app.state.certs.delete(profile_id)

        # The hidden administrative credential exists only to grant future
        # workspaces. Removing the visible server removes that credential too.
        if stored_profile and stored_profile.bootstrap_profile_id:
            with contextlib.suppress(Exception):
                await app.state.profiles.delete(stored_profile.bootstrap_profile_id)
            if hasattr(app.state, "certs") and app.state.certs is not None:
                with contextlib.suppress(Exception):
                    await app.state.certs.delete(stored_profile.bootstrap_profile_id)

        if app.state.ssh.snapshot.profile_id == profile_id:
            await app.state.agents.stop_all()
            with contextlib.suppress(Exception):
                await app.state.lsp.close_all()
            await app.state.ssh.disconnect()
            app.state.restricted_allowed_roots = None
            app.state.session_identity = {"username": None, "elevated": False}
            await app.state.events.publish("conn:state", {"state": "idle", "profileId": None})

        return {"ok": True}

    @app.post("/api/pair/start", response_model=PairStartResponse, dependencies=[auth])
    async def pair_start(request: PairStartRequest) -> PairStartResponse:
        prof = make_dev_profile_from_pair(
            host=request.host,
            port=request.port,
            phrase=request.phrase,
            username="root",
        )
        try:
            await app.state.profiles.save(prof)
        except Exception as exc:
            raise _http_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "profile.secure_save_failed",
                "Unable to save the server credential in the system keychain.",
                retryable=True,
            ) from exc
        expires = datetime.now(UTC) + timedelta(hours=24)
        return PairStartResponse(profileId=prof.id, certExpiresAt=expires)

    @app.post("/api/pair/start-cert", response_model=PairStartResponse, dependencies=[auth])
    async def pair_start_cert(request: PairStartRequest) -> PairStartResponse:
        """Dev-only: generate a throwaway key+user cert and create a profile for cert auth.

        The returned profile can be used with /api/conn/connect. The target SSH server
        must already trust the CA public key we just generated (not done here).
        """
        priv, user_cert, ca_pub = generate_dev_certificate(principal="root")
        # store the bundle for later inspection / renewal simulation
        bundle = CertificateBundle(
            profile_id="",  # filled after profile save
            public_key=ca_pub,
            user_certificate=user_cert,
            host_ca_key=ca_pub,
            expires_at=datetime.now(UTC) + timedelta(hours=24),
        )
        prof = make_cert_profile(
            host=request.host,
            port=request.port,
            private_key=priv,
            certificate=user_cert,
            username="root",
        )
        await app.state.profiles.save(prof)
        bundle = CertificateBundle(
            profile_id=prof.id,
            public_key=ca_pub,
            user_certificate=user_cert,
            host_ca_key=ca_pub,
            expires_at=datetime.now(UTC) + timedelta(hours=24),
        )
        # Persist both bundle + private key into the real keyring store
        await app.state.certs.save(bundle, private_key=priv)
        expires = bundle.expires_at
        return PairStartResponse(profileId=prof.id, certExpiresAt=expires)

    @app.post("/api/conn/connect", response_model=ConnInfo, dependencies=[auth])
    async def conn_connect(request: ConnConnectRequest) -> ConnInfo:
        previous_connection = app.state.ssh.snapshot.profile_id
        was_local = app.state.files.mode == "local"
        if previous_connection and previous_connection != request.profile_id:
            await app.state.agents.invalidate_connection(previous_connection)
            app.state.terminals.suspend_all()
        elif was_local:
            app.state.terminals.suspend_all()
        app.state.files.use_remote()
        try:
            prof = await app.state.profiles.get(request.profile_id)
        except Exception as exc:
            raise _http_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "profile.credential_unavailable",
                "The saved credential could not be read from the system keychain.",
                retryable=True,
            ) from exc
        if prof is None:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "profile.not_found",
                f"Profile {request.profile_id} not found",
            )

        # Prefer secrets from the persistent keyring cert store (real M1+ path)
        priv = prof.private_key
        cert = prof.certificate
        host_ca_key: str | None = None
        if hasattr(app.state, "certs") and app.state.certs is not None:
            try:
                kpriv = await app.state.certs.load_private_key(request.profile_id)
                if kpriv:
                    priv = kpriv
                kbundle = await app.state.certs.load(request.profile_id)
                if kbundle:
                    cert = kbundle.user_certificate
                    host_ca_key = kbundle.host_ca_key
            except Exception:
                # If keyring load fails, fall back to whatever is in the profile
                pass

        creds = ConnectionCredentials(
            host=prof.host,
            port=prof.port,
            username=prof.username,
            password=prof.password,
            private_key=priv,
            certificate=cert,
            host_ca_key=host_ca_key,
            trusted_host_key=app.state.host_keys.get(prof.host, prof.port),
        )

        try:
            snapshot = await app.state.ssh.connect(request.profile_id, creds)
        except Exception as exc:
            host_key_unknown = "host identity has not been trusted" in str(exc)
            raise _http_error(
                status.HTTP_409_CONFLICT if host_key_unknown else status.HTTP_400_BAD_REQUEST,
                "conn.host_key_unknown" if host_key_unknown else "conn.connect_failed",
                str(exc),
                retryable=not host_key_unknown,
            ) from exc
        # The SSH user's own Linux permissions are the filesystem authority.
        # Legacy profiles may still carry restricted metadata, but reconnecting
        # them must not reactivate the retired path/user-switch architecture.
        app.state.restricted_allowed_roots = None
        app.state.session_identity = {
            "username": prof.username,
            "elevated": False,
        }
        payload = ConnStatePayload(
            state=snapshot.state.value,
            profileId=snapshot.profile_id,
            socksPort=app.state.ssh.socks_port,
        )
        await app.state.events.publish("conn:state", payload.model_dump(by_alias=True))

        # wire the event publisher so the manager can push periodic stats
        app.state.ssh.set_event_publisher(app.state.events.publish)

        # Tell the SSH manager where the serverd lives on the VPS so it can poll /health
        # We assume serverd runs on port 8787 on the same host as the SSH target.
        base = f"http://{prof.host}:8787"
        app.state.ssh.set_serverd_base_url(base)

        return ConnInfo(
            profileId=request.profile_id,
            serverVersion="dev",
            certExpiresAt=snapshot.cert_expires_at,
            socksPort=app.state.ssh.socks_port,
        )

    @app.post("/api/conn/connect-direct", response_model=ConnInfo, dependencies=[auth])
    async def conn_connect_direct(request: ConnDirectRequest) -> ConnInfo:
        previous_connection = app.state.ssh.snapshot.profile_id
        if previous_connection:
            await app.state.agents.invalidate_connection(previous_connection)
            app.state.terminals.suspend_all()
        elif app.state.files.mode == "local":
            app.state.terminals.suspend_all()
        app.state.files.use_remote()
        private_key: str | None = None
        if request.private_key_path:
            key_path = Path(request.private_key_path).expanduser()
            try:
                private_key = key_path.read_text(encoding="utf-8")
            except OSError as e:
                raise _http_error(
                    status.HTTP_400_BAD_REQUEST,
                    "conn.private_key_unreadable",
                    f"Unable to read private key: {key_path}",
                ) from e

        profile = ConnectionProfile(
            id=generate_profile_id(),
            name=request.name or f"{request.username}@{request.host}",
            host=request.host,
            port=request.port,
            username=request.username,
            password=request.password,
            private_key=private_key,
            created_at=datetime.now(UTC),
        )

        creds = ConnectionCredentials(
            host=profile.host,
            port=profile.port,
            username=profile.username,
            password=profile.password,
            private_key=private_key,
            private_key_passphrase=request.private_key_passphrase,
            trusted_host_key=app.state.host_keys.get(profile.host, profile.port),
        )

        try:
            snapshot = await app.state.ssh.connect(profile.id, creds)
        except Exception as e:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "conn.connect_failed",
                str(e),
                retryable=True,
            ) from e
        app.state.restricted_allowed_roots = None
        app.state.session_identity = {"username": profile.username, "elevated": False}

        try:
            await app.state.profiles.save(profile)
        except Exception as exc:
            await app.state.ssh.disconnect()
            raise _http_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "profile.secure_save_failed",
                "Connected successfully, but the credential could not be saved securely.",
                retryable=True,
            ) from exc
        if private_key and hasattr(app.state, "certs") and app.state.certs is not None:
            with contextlib.suppress(Exception):
                await app.state.certs.save_private_key(profile.id, private_key)

        payload = ConnStatePayload(
            state=snapshot.state.value,
            profileId=snapshot.profile_id,
            socksPort=app.state.ssh.socks_port,
        )
        await app.state.events.publish("conn:state", payload.model_dump(by_alias=True))
        app.state.ssh.set_event_publisher(app.state.events.publish)
        app.state.ssh.set_serverd_base_url(f"http://{profile.host}:8787")

        return ConnInfo(
            profileId=profile.id,
            serverVersion="dev",
            certExpiresAt=snapshot.cert_expires_at,
            socksPort=app.state.ssh.socks_port,
        )

    @app.post("/api/lsp/sessions", response_model=LspSessionInfo, dependencies=[auth])
    async def lsp_start_session(request: LspStartRequest) -> dict[str, object]:
        local = app.state.files.active_local
        if local is None and app.state.ssh.connection is None:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "server.not_connected", "Open a local folder or connect to a server first.")
        if local is not None:
            try:
                local.normalize(request.root_path)
            except PermissionError as exc:
                raise _http_error(status.HTTP_400_BAD_REQUEST, "lsp.invalid", str(exc)) from exc
        try:
            session = await app.state.lsp.start(request.language, request.root_path)
            return session.to_info()
        except ValueError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "lsp.invalid", str(exc)) from exc
        except RuntimeError as exc:
            raise _http_error(status.HTTP_404_NOT_FOUND, "lsp.unavailable", str(exc)) from exc
        except Exception as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "lsp.start_failed", str(exc)) from exc

    @app.delete("/api/lsp/sessions/{session_id}", dependencies=[auth])
    async def lsp_stop_session(session_id: str) -> dict[str, bool]:
        ok = await app.state.lsp.stop(session_id)
        if not ok:
            raise _http_error(status.HTTP_404_NOT_FOUND, "lsp.not_found", f"Unknown LSP session: {session_id}")
        return {"ok": True}

    @app.post("/api/conn/setup-restricted", dependencies=[auth])
    async def conn_setup_restricted() -> dict[str, object]:
        """Legacy compatibility endpoint which preserves the connected SSH user."""
        if app.state.ssh.connection is None:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "conn.not_connected", "Connect to a server first.")
        profile_id = app.state.ssh.snapshot.profile_id
        if profile_id is None:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "conn.no_profile",
                "The connection is not associated with a saved profile.",
            )
        profile = await app.state.profiles.get(profile_id)
        if profile is None:
            raise _http_error(status.HTTP_404_NOT_FOUND, "profile.not_found", "Connected profile not found.")
        app.state.session_identity = {"username": profile.username, "elevated": False}
        return {
            "profileId": profile.id,
            "username": profile.username,
            "allowedRoots": profile.allowed_roots or [],
        }

    def _profile_allowed_roots(profile: ConnectionProfile | None) -> list[str]:
        roots: list[str] = []
        raw_roots = getattr(profile, "allowed_roots", None) if profile is not None else None
        for item in raw_roots or list(DEFAULT_ALLOWED_ROOTS):
            try:
                normalized = normalize_remote_root(item)
            except ValueError:
                continue
            if normalized not in roots:
                roots.append(normalized)
        return roots or list(DEFAULT_ALLOWED_ROOTS)

    def _session_identity() -> dict[str, Any]:
        current = getattr(app.state, "session_identity", None)
        if isinstance(current, dict):
            return current
        return {"username": None, "elevated": False}

    def _is_coloride_home_path(path: str) -> bool:
        """True for /home/coloride and /tmp/coloride trees. Computer `/` is not."""
        current = (path or "").rstrip("/") or "/"
        if current == "/":
            return False
        return is_path_under_roots(current, DEFAULT_ALLOWED_ROOTS) or is_safe_workspace_path(current)

    def _connected_username(profile: ConnectionProfile) -> str:
        return str(getattr(profile, "username", "") or _session_identity().get("username") or RESTRICTED_USERNAME)

    async def _bootstrap_credentials(profile: ConnectionProfile) -> ConnectionCredentials:
        bootstrap_id = getattr(profile, "bootstrap_profile_id", None)
        if not bootstrap_id:
            raise RuntimeError("Bootstrap credential is unavailable.")
        bootstrap = await app.state.profiles.get(bootstrap_id)
        if bootstrap is None:
            raise RuntimeError("Bootstrap credential is unavailable.")
        private_key = bootstrap.private_key
        certificate = bootstrap.certificate
        if hasattr(app.state, "certs") and app.state.certs is not None:
            private_key = await app.state.certs.load_private_key(bootstrap.id) or private_key
            bundle = await app.state.certs.load(bootstrap.id)
            if bundle:
                certificate = bundle.user_certificate
        host_keys = getattr(app.state, "host_keys", None)
        trusted = host_keys.get(bootstrap.host, bootstrap.port) if host_keys is not None else None
        return ConnectionCredentials(
            host=bootstrap.host,
            port=bootstrap.port,
            username=bootstrap.username,
            password=bootstrap.password,
            private_key=private_key,
            certificate=certificate,
            trusted_host_key=trusted,
        )

    async def _rebind_linux_session_tools() -> None:
        """Reconnect terminals and LSP onto the current Linux user."""
        bounce = getattr(app.state.terminals, "bounce_remote", None)
        if callable(bounce):
            bounce()
        with contextlib.suppress(Exception):
            await app.state.lsp.close_all()

    async def _apply_session_user(profile: ConnectionProfile, *, elevated: bool) -> str:
        """Open an extra admin SSH session without replacing the visible connection."""
        identity = _session_identity()
        connected = _connected_username(profile)
        was_elevated = bool(identity.get("elevated"))
        if elevated:
            opener = getattr(app.state.ssh, "open_elevated_connection", None)
            if opener is None or not getattr(profile, "bootstrap_profile_id", None):
                app.state.session_identity = {"username": connected, "elevated": False}
                return connected
            bootstrap_creds = await _bootstrap_credentials(profile)
            wanted_user = bootstrap_creds.username
            current_user = str(identity.get("username") or connected)
            if current_user == wanted_user and was_elevated:
                await opener(bootstrap_creds)
                return current_user
            username = await opener(bootstrap_creds)
            app.state.session_identity = {"username": username, "elevated": True}
            await _rebind_linux_session_tools()
            return username

        closer = getattr(app.state.ssh, "close_elevated_connection", None)
        if closer is not None:
            await closer()
        app.state.session_identity = {"username": connected, "elevated": False}
        if was_elevated:
            await _rebind_linux_session_tools()
        return connected

    async def _apply_user_for_path(profile: ConnectionProfile, path: str) -> str:
        """Computer and other system paths use admin/root; Coloride home stays coloride."""
        connected = _connected_username(profile)
        if connected == "root":
            app.state.session_identity = {"username": "root", "elevated": False}
            return "root"
        if _is_coloride_home_path(path):
            return await _apply_session_user(profile, elevated=False)
        if getattr(profile, "bootstrap_profile_id", None):
            return await _apply_session_user(profile, elevated=True)
        app.state.session_identity = {"username": connected, "elevated": False}
        return connected

    async def _ensure_linux_user_for_path(path: str) -> None:
        if not path:
            return
        profile_id = getattr(getattr(app.state.ssh, "snapshot", None), "profile_id", None)
        if not profile_id:
            return
        profile = await app.state.profiles.get(profile_id)
        if profile is None:
            return
        with contextlib.suppress(Exception):
            await _apply_user_for_path(profile, path)

    async def _ensure_file_access(path: str, *, mutate: bool) -> None:
        _ = mutate
        await _ensure_linux_user_for_path(path)

    async def _require_active_ssh_workspace(
        *,
        connection_id: str | None,
        cwd: str,
        filesystem_scope: str = "workspace",
    ) -> ConnectionProfile:
        active_connection = app.state.ssh.snapshot.profile_id
        connection = app.state.ssh.connection
        is_closed = getattr(connection, "is_closed", None)
        connection_live = bool(
            connection is not None
            and callable(is_closed)
            and not is_closed()
        )
        profile = (
            await app.state.profiles.get(active_connection)
            if active_connection
            else None
        )
        _ = filesystem_scope
        authorized = bool(
            connection_live
            and active_connection
            and connection_id == active_connection
            and profile is not None
            and cwd.startswith("/")
        )
        if not authorized or profile is None:
            raise _http_error(
                status.HTTP_403_FORBIDDEN,
                "agents.workspace_not_authorized",
                "This SSH chat is no longer attached to the connected server. "
                "Reconnect the correct server before continuing.",
            )
        return profile

    async def _reconcile_connected_profile(profile: ConnectionProfile) -> ConnectionProfile:
        """Reconnect without changing Linux identity or moving the workspace."""
        app.state.restricted_allowed_roots = None
        app.state.session_identity = {"username": profile.username, "elevated": False}
        return profile

    async def _open_workspace(
        request_path: str,
        environment: str | None = None,
        *,
        persist_default: bool = True,
        elevate: bool = False,
    ) -> dict[str, object]:
        """Open the selected folder. Computer / system paths use admin; Coloride home stays coloride."""
        _ = elevate
        profile_id = app.state.ssh.snapshot.profile_id
        profile = await app.state.profiles.get(profile_id) if profile_id else None
        if profile is None or app.state.ssh.connection is None:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "workspace.connection_required",
                "Connect to the server before selecting a workspace.",
            )
        try:
            root = normalize_remote_root(request_path)
        except ValueError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "workspace.invalid_path", str(exc)) from exc
        try:
            session_user = await _apply_user_for_path(profile, root)
        except Exception as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "workspace.elevation_failed",
                str(exc),
            ) from exc
        try:
            metadata = (await app.state.files.stat_paths([root]))[0]
        except Exception as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "workspace.open_failed",
                str(exc),
                retryable=True,
            ) from exc
        if not metadata.get("exists") or metadata.get("kind") != "dir":
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "workspace.invalid_path",
                f"Workspace must be an existing directory: {root}",
            )
        selected_environment = (
            environment
            if environment in {"development", "production"}
            else profile.workspace_environment or "development"
        )
        if persist_default:
            updated = replace(
                profile,
                default_workspace=root,
                workspace_environment=selected_environment,
                workspace_source_path=root,
            )
            await app.state.profiles.save(updated)
        app.state.restricted_allowed_roots = None
        elevated = bool(_session_identity().get("elevated"))
        await app.state.search.warm(root, kind="ssh", connection_id=profile_id)
        return {
            "path": root,
            "sourcePath": root,
            "environment": selected_environment,
            "allowedRoots": [root],
            "sessionChanges": {"migrated": [], "invalidated": [], "reauthorized": []},
            "sessionUser": session_user,
            "elevated": elevated,
        }

    @app.post("/api/workspaces/open", dependencies=[auth])
    async def workspace_open(request: WorkspaceOpenRequest) -> dict[str, object]:
        return await _open_workspace(
            request.path,
            request.environment,
            elevate=request.elevate,
        )

    @app.post("/api/workspaces/prepare-agent", dependencies=[auth])
    async def workspace_prepare_agent(request: WorkspaceOpenRequest) -> dict[str, object]:
        """Prepare one chat workspace without replacing the profile's default workspace."""
        return await _open_workspace(
            request.path,
            request.environment,
            persist_default=False,
            elevate=False,
        )

    @app.post("/api/workspaces/grant", dependencies=[auth])
    async def workspace_grant(request: WorkspaceGrantRequest) -> dict[str, object]:
        """Legacy Development route retained for clients before workspace environments."""
        return await _open_workspace(request.path, "development")

    @app.post("/api/conn/disconnect", dependencies=[auth])
    async def conn_disconnect() -> dict[str, bool]:
        disconnected_profile = app.state.ssh.snapshot.profile_id
        affected_terminals = [
            session
            for session in app.state.terminals.list()
            if not session.local and session.connection_id == disconnected_profile
        ]
        # Publish term:exit only for terminals belonging to this server.
        for session in affected_terminals:
            tid = session.term_id
            if not app.state.terminals.has_reported_exit(tid):
                code = None
                if session.process:
                    try:
                        code = session.process.returncode()
                    except Exception:
                        code = None
                await app.state.events.publish("term:exit", {"termId": tid, "code": code})
                app.state.terminals.mark_exit_reported(tid)

        # Kill remote tmux sessions so a later reconnect does not re-attach
        # stale shells into the wrong tab (each new tab gets a fresh session).
        for session in affected_terminals:
            if session.tmux_session:
                await _kill_tmux_session(session.tmux_session)

        app.state.terminals.close_connection(disconnected_profile)

        await app.state.agents.stop_all()
        await app.state.agents.invalidate_connection(disconnected_profile)

        with contextlib.suppress(Exception):
            await app.state.lsp.close_all()

        # Tear down VPS Chromium sessions owned by this desktop connection.
        with contextlib.suppress(Exception):
            await app.state.browsers.close_all()

        await app.state.ssh.disconnect()
        app.state.restricted_allowed_roots = None
        app.state.session_identity = {"username": None, "elevated": False}

        await app.state.events.publish("conn:state", {"state": "idle", "profileId": None})
        return {"ok": True}

    @app.get("/api/conn/state", response_model=ConnStatePayload, dependencies=[auth])
    async def conn_state() -> ConnStatePayload:
        snapshot = app.state.ssh.snapshot
        return ConnStatePayload(
            state=snapshot.state.value,
            profileId=snapshot.profile_id,
            socksPort=app.state.ssh.socks_port,
        )

    @app.post("/api/conn/reconnect", response_model=ConnInfo, dependencies=[auth])
    async def conn_reconnect() -> ConnInfo:
        try:
            await app.state.agents.stop_all()
            with contextlib.suppress(Exception):
                await app.state.lsp.close_all()
            snapshot = await app.state.ssh.reconnect()
        except Exception as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "conn.reconnect_failed",
                str(exc),
                retryable=True,
            ) from exc
        if snapshot.profile_id:
            profile = await app.state.profiles.get(snapshot.profile_id)
            if profile is not None:
                await _reconcile_connected_profile(profile)
        await app.state.events.publish(
            "conn:state",
            ConnStatePayload(
                state=snapshot.state.value,
                profileId=snapshot.profile_id,
                socksPort=app.state.ssh.socks_port,
            ).model_dump(by_alias=True),
        )
        return ConnInfo(
            profileId=snapshot.profile_id or "",
            serverVersion="dev",
            certExpiresAt=snapshot.cert_expires_at,
            socksPort=app.state.ssh.socks_port,
        )

    @app.get("/api/conn/stats", response_model=ConnStatsPayload, dependencies=[auth])
    async def conn_stats() -> ConnStatsPayload:
        data = await app.state.ssh.get_stats()
        # data uses alias names (rttMs, memPct, etc.)
        return ConnStatsPayload.model_validate(data, by_alias=True)

    @app.get("/api/server/dashboard", response_model=ServerDashboardResponse, dependencies=[auth])
    async def server_dashboard() -> ServerDashboardResponse:
        try:
            return ServerDashboardResponse.model_validate(await app.state.ssh.get_dashboard(), by_alias=True)
        except RuntimeError as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "server.dashboard_unavailable",
                str(exc),
                retryable=True,
            ) from exc
        except Exception as exc:
            raise _http_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "server.dashboard_failed",
                "The server dashboard could not be refreshed.",
                retryable=True,
            ) from exc

    @app.get("/api/server/settings", response_model=ServerSettingsResponse, dependencies=[auth])
    async def server_settings() -> ServerSettingsResponse:
        snapshot = app.state.ssh.snapshot
        if snapshot.profile_id is None:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "server.not_connected", "Connect to a server first.")
        profile = await app.state.profiles.get(snapshot.profile_id)
        if profile is None:
            raise _http_error(status.HTTP_404_NOT_FOUND, "profile.not_found", "The active server profile was not found.")
        try:
            info = await app.state.ssh.get_server_info()
        except RuntimeError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "server.info_unavailable", str(exc), retryable=True) from exc

        trusted_key = app.state.host_keys.get(profile.host, profile.port)
        algorithm: str | None = None
        fingerprint: str | None = None
        if trusted_key:
            with contextlib.suppress(Exception):
                parsed_key = asyncssh.import_public_key(trusted_key)
                algorithm = parsed_key.get_algorithm()
                fingerprint = parsed_key.get_fingerprint("sha256")
        return ServerSettingsResponse(
            profileId=profile.id,
            authenticationMethod=app.state.ssh.authentication_method(),
            hostKeyStatus="trusted" if trusted_key else "unknown",
            hostKeyAlgorithm=algorithm,
            hostKeyFingerprint=fingerprint,
            **info,
        )
    @app.get("/api/server/authorized-keys", response_model=AuthorizedKeysResponse, dependencies=[auth])
    async def authorized_keys_list() -> AuthorizedKeysResponse:
        try:
            return AuthorizedKeysResponse(keys=await app.state.ssh.list_authorized_keys())
        except RuntimeError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "server.keys_unavailable", str(exc), retryable=True) from exc

    @app.post("/api/server/authorized-keys", response_model=AuthorizedKeysResponse, dependencies=[auth])
    async def authorized_keys_add(request: AuthorizedKeyAddRequest) -> AuthorizedKeysResponse:
        try:
            return AuthorizedKeysResponse(keys=await app.state.ssh.add_authorized_key(request.public_key))
        except RuntimeError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "server.key_add_failed", str(exc)) from exc

    @app.delete("/api/server/authorized-keys/{key_id}", response_model=AuthorizedKeysResponse, dependencies=[auth])
    async def authorized_keys_delete(key_id: str) -> AuthorizedKeysResponse:
        try:
            return AuthorizedKeysResponse(keys=await app.state.ssh.delete_authorized_key(key_id))
        except RuntimeError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "server.key_delete_failed", str(exc)) from exc

    @app.post("/api/files/list", dependencies=[auth])
    async def files_list(request: FileListRequest) -> dict[str, object]:
        try:
            await _ensure_linux_user_for_path(request.path)
            entries = await app.state.files.list(request.path, request.offset, request.limit)
            return {"entries": [e.model_dump(by_alias=True) for e in entries]}
        except RuntimeError as e:
            if "SFTP" in str(e) or "sftp" in str(e).lower():
                raise _http_error(status.HTTP_400_BAD_REQUEST, "files.sftp_unavailable", str(e)) from e
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.list_error", str(e)) from e
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.list_error", str(e)) from e

    @app.post("/api/local-workspace/open", dependencies=[auth])
    async def local_workspace_open(request: LocalWorkspaceOpenRequest) -> dict[str, str]:
        """Switch the shared file/agent perimeter to one native local folder."""
        try:
            root = app.state.files.use_local(request.path)
        except (FileNotFoundError, NotADirectoryError, PermissionError, OSError) as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "local_workspace.invalid_path",
                str(exc),
            ) from exc

        # A local workspace and an SSH workspace are mutually exclusive.
        if app.state.ssh.connection is not None:
            previous_connection = app.state.ssh.snapshot.profile_id
            await app.state.agents.stop_all()
            await app.state.agents.invalidate_connection(previous_connection)
            app.state.terminals.suspend_all()
            with contextlib.suppress(Exception):
                await app.state.lsp.close_all()
            await app.state.ssh.disconnect()
        app.state.restricted_allowed_roots = [root]
        await app.state.search.warm(root, kind="local")
        return {"mode": "local", "path": root}

    @app.post("/api/files/search", dependencies=[auth])
    async def files_search(request: FileSearchRequest) -> dict[str, object]:
        try:
            await _ensure_linux_user_for_path(request.path)
            mode = request.mode
            has_shell = getattr(app.state.files, "_run_command", None) is not None

            # Local search needs no SSH runner; both services implement unified search.
            local_search = getattr(app.state.files, "mode", None) == "local" and mode in ("all", "content")
            if (has_shell or local_search) and mode in ("all", "name", "content"):
                want_names = mode in ("all", "name")
                want_content = mode in ("all", "content")
                name_limit = request.name_limit if mode != "content" else 1
                content_limit = request.content_limit if mode != "name" else 1
                if mode == "name":
                    name_limit = request.name_limit or request.limit
                if mode == "content":
                    content_limit = request.content_limit or request.limit

                name_hits, matches, names_trunc, content_trunc, engine = await app.state.files.search_unified(
                    request.path,
                    request.query,
                    include=request.include,
                    name_limit=name_limit,
                    content_limit=content_limit,
                    case_sensitive=request.case_sensitive,
                    names=want_names,
                    content=want_content,
                )

                if mode == "content":
                    return {
                        "mode": "content",
                        "matches": [match.model_dump(by_alias=True) for match in matches],
                        "truncated": content_trunc,
                        "engine": engine,
                    }
                if mode == "name":
                    return {
                        "mode": "name",
                        "entries": [
                            {
                                "name": name,
                                "path": path,
                                "kind": "file",
                                "size": 0,
                                "mtime": "1970-01-01T00:00:00Z",
                            }
                            for name, path in name_hits
                        ],
                    }
                return {
                    "mode": "all",
                    "files": [{"name": name, "path": path} for name, path in name_hits],
                    "matches": [match.model_dump(by_alias=True) for match in matches],
                    "filesTruncated": names_trunc,
                    "matchesTruncated": content_trunc,
                    "engine": engine,
                }

            # Fallback: SFTP filename walk (no shell runner).
            entries = await app.state.files.search(request.path, request.query, request.include, request.limit)
            return {
                "mode": "name",
                "entries": [entry.model_dump(by_alias=True) for entry in entries],
            }
        except RuntimeError as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.search_error", str(e)) from e
        except ValueError as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.search_error", str(e)) from e
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.search_error", str(e)) from e

    @app.post("/api/files/read", dependencies=[auth])
    async def files_read(request: FileReadRequest) -> dict[str, object]:
        try:
            await _ensure_linux_user_for_path(request.path)
            content_b64, etag, truncated = await app.state.files.read(request.path)
            return {"content": content_b64, "etag": etag, "truncated": truncated}
        except FileNotFoundError as e:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "files.not_found",
                f"File not found: {request.path}",
            ) from e
        except IsADirectoryError as e:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "files.is_directory",
                f"Is a directory: {request.path}",
            ) from e
        except PermissionError as e:
            raise _http_error(
                status.HTTP_403_FORBIDDEN,
                "files.permission_denied",
                f"Permission denied: {request.path}",
            ) from e
        except RuntimeError as e:
            if "SFTP" in str(e) or "sftp" in str(e).lower():
                raise _http_error(status.HTTP_400_BAD_REQUEST, "files.sftp_unavailable", str(e)) from e
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.read_error", str(e)) from e
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.read_error", str(e)) from e

    @app.post("/api/files/stat", dependencies=[auth])
    async def files_stat(request: FileStatRequest) -> dict[str, object]:
        """Cheap remote probe for external-change detection (tree + open editors)."""
        paths = list(request.paths)
        if request.path:
            paths.insert(0, request.path)
        # Hard cap so a huge open-tabs set cannot stall SFTP.
        paths = paths[:40]
        if not paths:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "files.stat_empty",
                "Provide path or paths to stat.",
            )
        try:
            await _ensure_linux_user_for_path(paths[0])
            entries = await app.state.files.stat_paths(paths)
            return {"entries": entries}
        except RuntimeError as e:
            if "SFTP" in str(e) or "sftp" in str(e).lower():
                raise _http_error(status.HTTP_400_BAD_REQUEST, "files.sftp_unavailable", str(e)) from e
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.stat_error", str(e)) from e
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.stat_error", str(e)) from e

    @app.post("/api/files/write", dependencies=[auth])
    async def files_write(request: FileWriteRequest) -> dict[str, object]:
        try:
            await _ensure_file_access(request.path, mutate=True)
            new_etag = await app.state.files.write(request.path, request.content, request.etag)
            return {"etag": new_etag}
        except PartialFileWriteBlockedError as e:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "files.partial_content_write_blocked",
                "This file is larger than 10 MB and was opened as a partial read-only preview.",
            ) from e
        except FileVersionRequiredError as e:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "files.etag_required",
                "The existing file must be opened completely before it can be overwritten.",
            ) from e
        except EditorContentTooLargeError as e:
            raise _http_error(
                status.HTTP_413_CONTENT_TOO_LARGE,
                "files.editor_content_too_large",
                "File is larger than the 50 MB upload limit.",
            ) from e
        except FileNotFoundError as e:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "files.parent_missing",
                f"Parent folder does not exist: {request.path}",
            ) from e
        except RuntimeError as e:
            if str(e) == "etag_mismatch":
                raise _http_error(
                    status.HTTP_409_CONFLICT,
                    "files.etag_mismatch",
                    "File was modified",
                ) from e
            if "SFTP" in str(e) or "sftp" in str(e).lower():
                raise _http_error(status.HTTP_400_BAD_REQUEST, "files.sftp_unavailable", str(e)) from e
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.write_error", str(e)) from e
        except PermissionError as e:
            raise _http_error(
                status.HTTP_403_FORBIDDEN,
                "files.permission_denied",
                f"Permission denied: {request.path}",
            ) from e
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.write_error", str(e)) from e

    async def _authorize_agent_file_request(
        session_id: str,
        path: str,
        *,
        for_write: bool,
    ) -> SessionSummary:
        session = await app.state.agents.get_session(session_id)
        if session is None:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                f"Unknown agent session: {session_id}",
            )
        session_scope = getattr(session, "filesystem_scope", "workspace")
        if session_scope == "server":
            if session.workspace_kind == "ssh":
                await _require_active_ssh_workspace(
                    connection_id=session.connection_id,
                    cwd=session.cwd,
                    filesystem_scope="server",
                )
        elif not is_path_under_roots(path, [session.cwd]):
            raise _http_error(
                status.HTTP_403_FORBIDDEN,
                "agents.file_outside_workspace",
                "This file is outside the chat workspace.",
            )
        if session.workspace_kind == "ssh":
            if session_scope != "server":
                await _require_active_ssh_workspace(
                    connection_id=session.connection_id,
                    cwd=session.cwd,
                    filesystem_scope=session_scope,
                )
        else:
            try:
                app.state.files.authorize_local_session(session_id, session.cwd)
            except (OSError, RuntimeError, ValueError) as exc:
                raise _http_error(
                    status.HTTP_403_FORBIDDEN,
                    "agents.workspace_not_authorized",
                    "This local chat workspace is no longer available.",
                ) from exc

        # Resolve symlinks under the per-session adapter before granting the
        # operation. The profile can authorize projects A+B, but a chat rooted
        # at A must never follow a link or direct path into B.
        try:
            with app.state.files.session_scope(session_id):
                session_root = await app.state.files.realpath(session.cwd)
                try:
                    resolved = await app.state.files.realpath(path)
                except FileNotFoundError:
                    if not for_write:
                        # The read endpoint will produce the normal not-found
                        # response; there is no object to escape through.
                        resolved = path
                    else:
                        # Resolve the closest existing parent so a missing leaf
                        # cannot escape through a symlink into another workspace.
                        missing: list[str] = []
                        cursor = PurePosixPath(path)
                        while True:
                            if cursor.name:
                                missing.append(cursor.name)
                            parent = cursor.parent
                            if parent == cursor:
                                raise PermissionError(path)
                            try:
                                resolved_parent = await app.state.files.realpath(str(parent))
                                resolved = str(
                                    PurePosixPath(resolved_parent).joinpath(*reversed(missing))
                                )
                                break
                            except FileNotFoundError:
                                cursor = parent
        except PermissionError as exc:
            raise _http_error(
                status.HTTP_403_FORBIDDEN,
                "agents.file_outside_workspace",
                "This file resolves outside the chat workspace.",
            ) from exc
        if session_scope != "server" and not is_path_under_roots(resolved, [session_root]):
            raise _http_error(
                status.HTTP_403_FORBIDDEN,
                "agents.file_outside_workspace",
                "This file resolves outside the chat workspace.",
            )
        return session

    @app.post("/api/agents/sessions/{session_id}/files/read", dependencies=[auth])
    async def agent_session_file_read(
        session_id: str,
        request: FileReadRequest,
    ) -> dict[str, object]:
        await _authorize_agent_file_request(session_id, request.path, for_write=False)
        with app.state.files.session_scope(session_id):
            return await files_read(request)

    @app.post("/api/agents/sessions/{session_id}/files/write", dependencies=[auth])
    async def agent_session_file_write(
        session_id: str,
        request: FileWriteRequest,
    ) -> dict[str, object]:
        await _authorize_agent_file_request(session_id, request.path, for_write=True)
        with app.state.files.session_scope(session_id):
            return await files_write(request)

    @app.post("/api/files/mkdir", dependencies=[auth])
    async def files_mkdir(request: FileMkdirRequest) -> dict[str, bool]:
        try:
            await _ensure_file_access(request.path, mutate=True)
            await app.state.files.mkdir(request.path)
            return {"ok": True}
        except PermissionError as e:
            raise _http_error(
                status.HTTP_403_FORBIDDEN,
                "files.permission_denied",
                f"Permission denied: {request.path}",
            ) from e
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.mkdir_error", str(e)) from e

    @app.post("/api/files/delete", dependencies=[auth])
    async def files_delete(request: FileDeleteRequest) -> dict[str, bool]:
        try:
            await _ensure_file_access(request.path, mutate=True)
            await app.state.files.delete(request.path, recursive=request.recursive)
            return {"ok": True}
        except FileNotFoundError as e:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "files.not_found",
                f"File not found: {request.path}",
            ) from e
        except PermissionError as e:
            raise _http_error(
                status.HTTP_403_FORBIDDEN,
                "files.permission_denied",
                f"Permission denied: {request.path}",
            ) from e
        except RuntimeError as e:
            if "not empty" in str(e).lower():
                raise _http_error(status.HTTP_409_CONFLICT, "files.dir_not_empty", str(e)) from e
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.delete_error", str(e)) from e
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.delete_error", str(e)) from e

    @app.post("/api/files/rename", dependencies=[auth])
    async def files_rename(request: FileRenameRequest) -> dict[str, bool]:
        try:
            await _ensure_file_access(request.old_path, mutate=True)
            await _ensure_file_access(request.new_path, mutate=True)
            await app.state.files.rename(request.old_path, request.new_path)
            return {"ok": True}
        except FileNotFoundError as e:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "files.not_found",
                f"File not found: {request.old_path}",
            ) from e
        except PermissionError as e:
            raise _http_error(
                status.HTTP_403_FORBIDDEN,
                "files.permission_denied",
                f"Permission denied: {request.old_path}",
            ) from e
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.rename_error", str(e)) from e

    @app.post("/api/files/copy", dependencies=[auth])
    async def files_copy(request: FileCopyRequest) -> dict[str, bool]:
        try:
            await _ensure_file_access(request.source_path, mutate=False)
            await _ensure_file_access(request.dest_path, mutate=True)
            await app.state.files.copy(request.source_path, request.dest_path)
            return {"ok": True}
        except FileNotFoundError as e:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "files.not_found",
                f"File not found: {request.source_path}",
            ) from e
        except FileExistsError as e:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "files.already_exists",
                str(e),
            ) from e
        except PermissionError as e:
            raise _http_error(
                status.HTTP_403_FORBIDDEN,
                "files.permission_denied",
                f"Permission denied: {request.source_path}",
            ) from e
        except ValueError as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.copy_error", str(e)) from e
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "files.copy_error", str(e)) from e


    def _git_safe_payload(st: Any) -> dict[str, Any]:
        return {
            "productionPath": st.production_path,
            "workspacePath": st.workspace_path,
            "ready": st.ready,
            "isGitRepo": st.is_git_repo,
            "branch": st.branch,
            "productionCommit": st.production_commit,
            "workspaceCommit": st.workspace_commit,
            "dirty": st.dirty,
            "filesChanged": st.files_changed,
            "insertions": st.insertions,
            "deletions": st.deletions,
            "ahead": st.ahead,
            "behind": st.behind,
            "canDeploy": st.can_deploy,
            "message": st.message,
            "lastDeployCommit": getattr(st, "last_deploy_commit", None),
            "lastDeployStatus": getattr(st, "last_deploy_status", None),
            "health": getattr(st, "health", None),
            "drift": bool(getattr(st, "drift", False)),
            "deployedCommits": list(getattr(st, "deployed_commits", ()) or ()),
            "files": [
                {
                    "path": f.path,
                    "status": f.status,
                    "insertions": f.insertions,
                    "deletions": f.deletions,
                }
                for f in (st.files or ())
            ],
        }

    def _deploy_payload(result: Any) -> dict[str, Any]:
        payload = _git_safe_payload(result.status)
        payload.update(
            {
                "deployCommit": result.commit,
                "deployMessage": result.message,
                "healthOk": result.health_ok,
                "needsRollback": result.needs_rollback,
                "steps": [
                    {
                        "id": step.id,
                        "label": step.label,
                        "ok": step.ok,
                        "detail": step.detail,
                    }
                    for step in (result.steps or ())
                ],
            }
        )
        return payload

    async def _production_controller_options() -> tuple[dict[str, str], dict[str, bool]]:
        profile_id = app.state.ssh.snapshot.profile_id
        profile = await app.state.profiles.get(profile_id) if profile_id else None
        if profile is None:
            return {}, {}
        return profile.production_runtime or {}, profile.production_capabilities or {}

    @app.post("/api/git/safe/ensure", dependencies=[auth])
    async def git_safe_ensure(request: Request) -> dict[str, Any]:
        body = await request.json()
        path = str(body.get("productionPath") or "").strip()
        if not path.startswith("/"):
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.invalid_path", "productionPath required")
        try:
            st = await app.state.safe_git.ensure_workspace(path)
            return _git_safe_payload(st)
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.ensure_failed", str(e)) from e

    @app.post("/api/git/safe/status", dependencies=[auth])
    async def git_safe_status(request: Request) -> dict[str, Any]:
        body = await request.json()
        path = str(body.get("productionPath") or "").strip()
        if not path.startswith("/"):
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.invalid_path", "productionPath required")
        try:
            st = await app.state.safe_git.status(path)
            return _git_safe_payload(st)
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.status_failed", str(e)) from e

    @app.post("/api/git/safe/diff", dependencies=[auth])
    async def git_safe_diff(request: Request) -> dict[str, Any]:
        body = await request.json()
        path = str(body.get("productionPath") or "").strip()
        file_path = str(body.get("path") or "").strip()
        if not path.startswith("/") or not file_path:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.invalid_path", "productionPath and path required")
        try:
            diff = await app.state.safe_git.file_diff(path, file_path)
            return {"path": file_path, "diff": diff}
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.diff_failed", str(e)) from e

    @app.post("/api/git/safe/history", dependencies=[auth])
    async def git_safe_history(request: Request) -> dict[str, Any]:
        body = await request.json()
        path = str(body.get("productionPath") or "").strip()
        limit = int(body.get("limit") or 40)
        if not path.startswith("/"):
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.invalid_path", "productionPath required")
        try:
            commits = await app.state.safe_git.list_history(path, limit=limit)
            return {"commits": commits}
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.history_failed", str(e)) from e

    @app.post("/api/git/safe/commit", dependencies=[auth])
    async def git_safe_commit(request: Request) -> dict[str, Any]:
        body = await request.json()
        path = str(body.get("productionPath") or "").strip()
        message = str(body.get("message") or "coloride: workspace changes")
        if not path.startswith("/"):
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.invalid_path", "productionPath required")
        try:
            st = await app.state.safe_git.commit_workspace(path, message)
            return _git_safe_payload(st)
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.commit_failed", str(e)) from e

    @app.post("/api/git/safe/deploy", dependencies=[auth])
    async def git_safe_deploy(request: Request) -> dict[str, Any]:
        body = await request.json()
        path = str(body.get("productionPath") or "").strip()
        commit = body.get("commit")
        commit_s = str(commit).strip() if commit else None
        force = bool(body.get("force"))
        if not path.startswith("/"):
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.invalid_path", "productionPath required")
        try:
            runtime, capabilities = await _production_controller_options()
            result = await app.state.safe_git.deploy_commit(
                path,
                commit_s,
                runtime=runtime,
                capabilities=capabilities,
                ignore_drift=force,
            )
            return _deploy_payload(result)
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.deploy_failed", str(e)) from e

    @app.post("/api/git/safe/rollback", dependencies=[auth])
    async def git_safe_rollback(request: Request) -> dict[str, Any]:
        body = await request.json()
        path = str(body.get("productionPath") or "").strip()
        commit = str(body.get("commit") or "").strip()
        if not path.startswith("/") or not commit:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.invalid_path", "productionPath and commit required")
        try:
            runtime, capabilities = await _production_controller_options()
            result = await app.state.safe_git.rollback(
                path,
                commit,
                runtime=runtime,
                capabilities=capabilities,
            )
            return _deploy_payload(result)
        except Exception as e:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "git.rollback_failed", str(e)) from e

    @app.get("/api/browser/sessions", response_model=list[BrowserSessionInfo], dependencies=[auth])
    async def browser_list_sessions() -> list[BrowserSessionInfo]:
        return [
            BrowserSessionInfo(
                id=record.browser_id,
                owner=record.owner,
                url=record.url,
                title=record.title,
                createdAt=record.created_at,
                updatedAt=record.updated_at,
            )
            for record in app.state.browsers.list()
        ]

    @app.post("/api/browser/open", response_model=BrowserOpenResponse, dependencies=[auth])
    async def browser_open(request: BrowserOpenRequest) -> BrowserOpenResponse:
        try:
            value = await app.state.browsers.open(
                request.url,
                owner=request.owner or "ui",
                browser_id=request.browser_id,
                reuse_owner=False,
            )
        except KeyError as exc:
            raise _http_error(status.HTTP_404_NOT_FOUND, "browser.not_found", str(exc)) from exc
        except ValueError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "browser.invalid", str(exc)) from exc
        except RuntimeError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "browser.open_failed", str(exc)) from exc
        except Exception as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "browser.open_failed", str(exc)) from exc

        return BrowserOpenResponse(
            browserId=str(value.get("browserId") or ""),
            url=str(value.get("url") or request.url),
            title=str(value.get("title") or ""),
            owner=str(value.get("owner") or request.owner or "ui"),
            snapshot=str(value["snapshot"]) if value.get("snapshot") else None,
            refCount=int(value["refCount"]) if isinstance(value.get("refCount"), int) else None,
        )

    @app.get(
        "/api/browser/{browser_id}/screenshot",
        response_model=BrowserScreenshotResponse,
        dependencies=[auth],
    )
    async def browser_screenshot(browser_id: str) -> BrowserScreenshotResponse:
        try:
            value = await app.state.browsers.screenshot(browser_id)
        except KeyError as exc:
            raise _http_error(status.HTTP_404_NOT_FOUND, "browser.not_found", str(exc)) from exc
        except RuntimeError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "browser.screenshot_failed", str(exc)) from exc
        except Exception as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "browser.screenshot_failed", str(exc)) from exc

        return BrowserScreenshotResponse(
            browserId=browser_id,
            url=str(value.get("url") or ""),
            title=str(value.get("title") or ""),
            mimeType=str(value.get("mimeType") or "image/png"),
            imageBase64=str(value.get("imageBase64") or ""),
            byteLength=int(value["byteLength"]) if isinstance(value.get("byteLength"), int) else None,
        )

    @app.post("/api/browser/{browser_id}/close", dependencies=[auth])
    async def browser_close(browser_id: str) -> dict[str, Any]:
        try:
            value = await app.state.browsers.close(browser_id)
        except Exception as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "browser.close_failed", str(exc)) from exc
        return {"ok": True, "browserId": browser_id, **{k: v for k, v in value.items() if k != "ok"}}

    @app.websocket("/ws/browser/{browser_id}")
    async def browser_socket(websocket: WebSocket, browser_id: str, token: str | None = None) -> None:
        """Live embedded browser: JPEG frames out, mouse/keyboard events in.

        Protocol (JSON text frames both ways):
          server → client: {type:"frame", mimeType, imageBase64, url, title, width, height}
          server → client: {type:"meta", url, title} | {type:"error", message}
          client → server: {type:"click", x, y, button?, clickCount?}
                           {type:"wheel", x?, y?, deltaX, deltaY}
                           {type:"type", text}
                           {type:"press", key}
                           {type:"navigate", url}
                           {type:"ping"}
        """
        if not _websocket_authorized(websocket, token, config.bearer_token):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        if app.state.browsers.get(browser_id) is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        if app.state.ssh.connection is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await websocket.accept()
        stop = asyncio.Event()
        quality = 52
        min_interval = 0.28  # ~3.5 fps — balance SSH cost vs feel

        async def _send_frame() -> None:
            try:
                value = await app.state.browsers.frame(browser_id, quality=quality)
            except Exception as exc:  # noqa: BLE001
                with contextlib.suppress(Exception):
                    await websocket.send_json({"type": "error", "message": str(exc)})
                return
            image = str(value.get("imageBase64") or "")
            if not image:
                return
            with contextlib.suppress(Exception):
                await websocket.send_json(
                    {
                        "type": "frame",
                        "mimeType": value.get("mimeType") or "image/jpeg",
                        "imageBase64": image,
                        "url": value.get("url") or "",
                        "title": value.get("title") or "",
                        "width": value.get("width") or 1280,
                        "height": value.get("height") or 800,
                    }
                )

        async def _pump_frames() -> None:
            # First frame ASAP, then cadence.
            await _send_frame()
            while not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), timeout=min_interval)
                except asyncio.TimeoutError:
                    pass
                if stop.is_set():
                    break
                await _send_frame()

        async def _handle_input() -> None:
            while not stop.is_set():
                try:
                    message = await websocket.receive_text()
                except WebSocketDisconnect:
                    stop.set()
                    return
                except Exception:
                    stop.set()
                    return
                try:
                    payload = json.loads(message)
                except ValueError:
                    continue
                if not isinstance(payload, dict):
                    continue
                kind = str(payload.get("type") or "")
                try:
                    if kind == "ping":
                        await websocket.send_json({"type": "pong"})
                    elif kind == "click":
                        await app.state.browsers.click_xy(
                            browser_id,
                            float(payload.get("x") or 0),
                            float(payload.get("y") or 0),
                            button=str(payload.get("button") or "left"),
                            click_count=int(payload.get("clickCount") or 1),
                        )
                        await _send_frame()
                    elif kind == "wheel":
                        await app.state.browsers.wheel(
                            browser_id,
                            x=float(payload.get("x") or 0),
                            y=float(payload.get("y") or 0),
                            delta_x=float(payload.get("deltaX") or 0),
                            delta_y=float(payload.get("deltaY") or 0),
                        )
                        await _send_frame()
                    elif kind == "type":
                        text = str(payload.get("text") or "")
                        if text:
                            await app.state.browsers.type_raw(browser_id, text)
                            await _send_frame()
                    elif kind == "press":
                        key = str(payload.get("key") or "").strip()
                        if key:
                            await app.state.browsers.press(browser_id, key, None)
                            await _send_frame()
                    elif kind == "navigate":
                        url = str(payload.get("url") or "").strip()
                        if url:
                            await app.state.browsers.open(url, owner="ui", browser_id=browser_id)
                            await _send_frame()
                    elif kind == "refresh":
                        await _send_frame()
                except Exception as exc:  # noqa: BLE001
                    with contextlib.suppress(Exception):
                        await websocket.send_json({"type": "error", "message": str(exc)})

        pump_task = asyncio.create_task(_pump_frames())
        input_task = asyncio.create_task(_handle_input())
        try:
            done, pending = await asyncio.wait(
                {pump_task, input_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            stop.set()
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            await asyncio.gather(*done, return_exceptions=True)
        finally:
            stop.set()
            with contextlib.suppress(Exception):
                await websocket.close()

    async def _ensure_local_terminal_process(session: Any) -> None:
        async with session.local_start_lock:
            if session.local_process is not None:
                return
            if pty is None:
                raise _http_error(501, "terminal.local_unsupported", "Local PTY is unavailable on this platform")
            from ..term.shell_integration import create_local_shell_launch

            shell = session.shell if os.path.isabs(session.shell) else "/bin/zsh"
            shell_command, shell_env = create_local_shell_launch(shell)
            master_fd, slave_fd = pty.openpty()
            session.local_master_fd = master_fd
            local_io = LocalPtyIO(master_fd)
            session.local_io = local_io
            app.state.terminals.resize(session.term_id, session.cols, session.rows)
            try:
                from ..term.pty_child import main as _pty_child_main  # bundled by PyInstaller
                del _pty_child_main
                child_command = ([sys.executable, "--pty-child"] if getattr(sys, "frozen", False)
                                 else [sys.executable, "-m", "coloride_desktop.term.pty_child"])
                process = await asyncio.create_subprocess_exec(
                    *child_command, *shell_command,
                    stdin=slave_fd,
                    stdout=slave_fd,
                    stderr=slave_fd,
                    cwd=session.cwd or None,
                    env=shell_env,
                    start_new_session=True,
                )
            except BaseException:
                local_io.close()
                session.local_master_fd = None
                session.local_io = None
                raise
            finally:
                os.close(slave_fd)
            session.local_process = process

            async def _pump() -> None:
                cancelled = False
                try:
                    from ..term.local_protocol import wait_output_capacity
                    while True:
                        await wait_output_capacity(session)
                        data = await local_io.read()
                        if not data:
                            break
                        app.state.terminals.append_local_output(session, data)
                        for queue in tuple(session.local_clients):
                            # Legacy clients also exert backpressure instead of losing bytes.
                            while queue in session.local_clients:
                                try:
                                    await asyncio.wait_for(queue.put(data), 0.5)
                                    break
                                except TimeoutError:
                                    continue
                except asyncio.CancelledError:
                    cancelled = True
                    raise
                except OSError:
                    pass
                finally:
                    session.exited = True
                    session.local_output_changed.set()
                    if not cancelled and process.returncode is None:
                        with contextlib.suppress(Exception):
                            await process.wait()
                    session.local_output_changed.set()
                    for queue in tuple(session.local_clients) if not cancelled else ():
                        while queue in session.local_clients:
                            try:
                                await asyncio.wait_for(queue.put(b""), 0.5)
                                break
                            except TimeoutError:
                                continue

            session.local_pump = asyncio.create_task(_pump())


    @app.get("/api/term", response_model=list[TermSessionInfo], dependencies=[auth])
    async def term_list(
        workspaceKind: str | None = None,
        connectionId: str | None = None,
    ) -> list[TermSessionInfo]:
        result: list[TermSessionInfo] = []
        for session in app.state.terminals.list():
            kind = "local" if session.local else "ssh"
            if workspaceKind and workspaceKind != kind:
                continue
            if connectionId and session.connection_id != connectionId:
                continue
            process = session.local_process if session.local else session.process
            status_value = (
                "exited"
                if session.exited
                else "suspended"
                if session.suspended
                else "ready"
                if process is not None
                else "connecting"
            )
            result.append(TermSessionInfo(
                termId=session.term_id,
                sessionId=session.session_id,
                cwd=session.cwd,
                workspaceKind=kind,
                connectionId=session.connection_id,
                status=status_value,
                agentSessionId=session.agent_owner,
                workspacePath=session.agent_workspace,
                title=session.agent_title,
                revealed=session.agent_revealed,
            ))
        return result

    @app.post("/api/term/create", response_model=TermCreateResponse, dependencies=[auth])
    async def term_create(request: TermCreateRequest) -> TermCreateResponse:
        active_connection = app.state.ssh.snapshot.profile_id
        if request.workspace_kind == "ssh" and (
            not active_connection or request.connection_id != active_connection
        ):
            raise _http_error(409, "terminal.connection_changed", "Reconnect this terminal's VPS")
        local_cwd: Path | None = None
        if request.workspace_kind == "local":
            try:
                local_cwd = Path(request.cwd or "").expanduser().resolve(strict=True)
            except OSError as exc:
                raise _http_error(400, "terminal.local_workspace_closed", str(exc)) from exc
            if not local_cwd.is_dir():
                raise _http_error(400, "terminal.invalid_cwd", "Terminal cwd must be a local folder")
        existing = app.state.terminals.find_by_session_id(
            request.session_id or "",
            connection_id=request.connection_id,
            local=request.workspace_kind == "local",
        ) if request.session_id else None
        session = app.state.terminals.create(
            cols=request.cols,
            rows=request.rows,
            cwd=str(local_cwd) if local_cwd is not None else request.cwd,
            local=request.workspace_kind == "local",
            connection_id=request.connection_id,
            session_id=request.session_id,
        )
        if session.local:
            session.shell = os.environ.get("SHELL") or "/bin/zsh"
            await _ensure_local_terminal_process(session)
            return TermCreateResponse(termId=session.term_id, sessionId=session.session_id, restored=existing is not None)
        profile = None
        if app.state.ssh.snapshot.profile_id:
            profile = await app.state.profiles.get(app.state.ssh.snapshot.profile_id)
        session.shell = profile.default_shell if profile is not None else "default"
        # Client-supplied name can reattach across Coloride restarts (persistence).
        # Never allow two *concurrent* local tabs to share one remote tmux session:
        # that merges keystrokes/output ("two terminals stuck together").
        persistent_name = request.session_id or request.session_name
        requested = (
            f"coloride_{persistent_name}"
            if persistent_name and (profile is None or profile.terminal_persistence)
            else f"coloride_{session.term_id}"
        )
        in_use = any(
            other.tmux_session == requested and other.term_id != session.term_id
            for other in app.state.terminals._sessions.values()
        )
        session.tmux_session = f"coloride_{session.term_id}" if in_use else requested
        restored = existing is not None
        work_conn = _ssh_work_conn()
        if not restored and work_conn is not None and session.tmux_session:
            with contextlib.suppress(Exception):
                check = await work_conn.run(
                    f"tmux has-session -t {shlex.quote(session.tmux_session)} 2>/dev/null",
                    check=False,
                )
                restored = check.exit_status == 0
        return TermCreateResponse(termId=session.term_id, sessionId=session.session_id, restored=restored)

    @app.post("/api/term/session/{session_id}/attach", response_model=TermCreateResponse, dependencies=[auth])
    async def term_attach(
        session_id: str,
        workspaceKind: str | None = None,
        connectionId: str | None = None,
    ) -> TermCreateResponse:
        local = workspaceKind == "local" if workspaceKind in ("local", "ssh") else None
        session = app.state.terminals.find_by_session_id(
            session_id,
            connection_id=connectionId,
            local=local,
        )
        if session is None:
            raise _http_error(404, "terminal.session_not_found", "Terminal session not found")
        session.suspended = False
        if session.local:
            await _ensure_local_terminal_process(session)
        return TermCreateResponse(termId=session.term_id, sessionId=session.session_id, restored=True)

    @app.post("/api/term/{term_id}/suspend", dependencies=[auth])
    async def term_suspend(term_id: str) -> dict[str, bool]:
        return {"ok": app.state.terminals.suspend(term_id)}

    @app.post("/api/term/suspend", dependencies=[auth])
    async def term_suspend_all() -> dict[str, bool]:
        app.state.terminals.suspend_all()
        if not app.state.terminals.list():
            async def _exit_idle_host() -> None:
                await asyncio.sleep(60)
                os._exit(0)
            app.state.terminal_host_idle_task = asyncio.create_task(_exit_idle_host())
        return {"ok": True}

    @app.post("/api/term/{term_id}/resize", dependencies=[auth])
    async def term_resize(term_id: str, request: TermCreateRequest) -> dict[str, bool]:
        """Resize an existing terminal session.
        The frontend can call this when the user resizes the terminal window."""
        app.state.terminals.resize(term_id, request.cols, request.rows)
        session = app.state.terminals.get(term_id)
        if session and session.control:
            # In control mode the authoritative size is set via refresh-client.
            await session.control.resize(request.cols, request.rows)
        return {"ok": True}

    @app.post("/api/term/{term_id}/clear", dependencies=[auth])
    async def term_clear(term_id: str) -> dict[str, bool]:
        session = app.state.terminals.get(term_id)
        if session is None:
            return {"ok": False}
        if session.local:
            app.state.terminals.clear_local_output(session)
        elif session.tmux_session and _ssh_work_conn() is not None:
            with contextlib.suppress(Exception):
                await _ssh_work_conn().run(
                    f"tmux clear-history -t {shlex.quote(session.tmux_session)} 2>/dev/null || true",
                    check=False,
                )
        return {"ok": True}

    @app.get("/api/term/{term_id}/info", response_model=TermInfoResponse, dependencies=[auth])
    async def term_info(term_id: str) -> TermInfoResponse:
        """Report the process running in the foreground of the terminal's pane.

        Used by the UI to label the tab (e.g. "bash" when idle, "vim" while an
        editor is open). Falls back to "bash" whenever tmux can't be queried so
        the label never goes blank."""
        session = app.state.terminals.get(term_id)
        conn = _ssh_work_conn()
        if session is None:
            return TermInfoResponse(foreground="bash", cwd=None)
        if session.local:
            shell_name = Path(session.shell).name if session.shell else "zsh"
            pid = getattr(session.local_process, "pid", None)
            if isinstance(pid, int):
                if sys.platform.startswith("linux"):
                    with contextlib.suppress(OSError):
                        session.cwd = os.readlink(f"/proc/{pid}/cwd")
                elif sys.platform == "darwin":
                    with contextlib.suppress(Exception):
                        probe = await asyncio.create_subprocess_exec(
                            "/usr/sbin/lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn",
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.DEVNULL,
                        )
                        stdout, _ = await asyncio.wait_for(probe.communicate(), timeout=0.8)
                        resolved = next((line[1:] for line in stdout.decode(errors="replace").splitlines() if line.startswith("n/")), "")
                        if resolved:
                            session.cwd = resolved
            foreground = shell_name or "zsh"
            if session.local_master_fd is not None:
                with contextlib.suppress(OSError, ProcessLookupError, TimeoutError):
                    foreground_pid = os.tcgetpgrp(session.local_master_fd)
                    probe = await asyncio.create_subprocess_exec(
                        "/bin/ps", "-p", str(foreground_pid), "-o", "comm=",
                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                    )
                    try:
                        stdout, _ = await asyncio.wait_for(probe.communicate(), timeout=0.8)
                        command = stdout.decode(errors="replace").strip()
                        if command:
                            foreground = Path(command).name
                    except TimeoutError:
                        probe.kill()
                        await probe.wait()
            return TermInfoResponse(foreground=foreground, cwd=session.cwd)
        if session.tmux_session is None or conn is None:
            return TermInfoResponse(foreground="bash", cwd=session.cwd)
        try:
            safe_session = shlex.quote(session.tmux_session)
            result = await conn.run(
                f"tmux display-message -p -t {safe_session} '#{{pane_current_command}}\t#{{pane_current_path}}'",
                check=False,
            )
            raw = _as_text(result.stdout).strip()
            name, _, current_cwd = raw.partition("\t")
            if current_cwd:
                session.cwd = current_cwd
            return TermInfoResponse(foreground=name or "bash", cwd=session.cwd)
        except Exception:
            return TermInfoResponse(foreground="bash", cwd=session.cwd)

    @app.post("/api/term/{term_id}/close", dependencies=[auth])
    async def term_close(term_id: str) -> dict[str, bool]:
        session = app.state.terminals.get(term_id)
        if session and not session.local and session.connection_id != app.state.ssh.snapshot.profile_id:
            app.state.terminals.close(term_id)
            return {"ok": True}
        if session and session.tmux_session:
            await _kill_tmux_session(session.tmux_session)
        app.state.terminals.close(term_id)
        return {"ok": True}

    @app.get("/api/agents/config", response_model=AgentConfigResponse, dependencies=[auth])
    async def agent_config() -> AgentConfigResponse:
        return AgentConfigResponse.model_validate(await app.state.agent_config.status())

    @app.put("/api/agents/config", response_model=AgentConfigResponse, dependencies=[auth])
    async def agent_config_update(request: AgentConfigUpdateRequest) -> AgentConfigResponse:
        try:
            value = await app.state.agent_config.update(
                provider=request.provider,
                model=request.model,
                api_key=request.api_key,
                base_url=request.base_url,
            )
        except ValueError as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "agents.invalid_config",
                str(exc),
            ) from exc
        except Exception as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.config_failed",
                f"Unable to save the agent credential in the system Keychain: {exc}",
            ) from exc
        return AgentConfigResponse.model_validate(value)

    @app.get("/api/agents/available", response_model=list[AgentInfo], dependencies=[auth])
    async def agents_available() -> list[AgentInfo]:
        try:
            return cast(list[AgentInfo], await app.state.agents.available())
        except Exception as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.connection_required",
                str(exc),
                retryable=True,
            ) from exc

    @app.get("/api/agents/tools", response_model=list[AgentToolInfo], dependencies=[auth])
    async def agent_tools() -> list[AgentToolInfo]:
        return [AgentToolInfo.model_validate(tool) for tool in await app.state.agents.tools()]

    @app.get("/api/agents/integrations", dependencies=[auth])
    async def agent_integrations() -> list[dict[str, Any]]:
        return await app.state.agents.integrations()

    @app.get("/api/agents/metrics", dependencies=[auth])
    async def agent_metrics() -> dict[str, Any]:
        return app.state.agents.metrics()

    @app.get("/api/agents/debug-log", dependencies=[auth])
    async def agent_debug_log(
        after: int | None = None,
        tail: int = 300,
        limit: int = 400,
    ) -> dict[str, Any]:
        from ..agents.debug_log import read_agent_debug

        return read_agent_debug(after=after, tail=tail, limit=limit)

    @app.get("/api/agents/sessions/{session_id}/debug-dump", dependencies=[auth])
    async def agent_debug_dump(session_id: str) -> dict[str, Any]:
        try:
            return app.state.agents.debug_dump(session_id)
        except KeyError as exc:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            ) from exc

    @app.put("/api/agents/integrations", dependencies=[auth])
    async def agent_integrations_update(
        request: AgentIntegrationsUpdateRequest,
    ) -> list[dict[str, Any]]:
        try:
            return app.state.agents.update_integrations(
                [value.model_dump(by_alias=True) for value in request.mcp_servers]
            )
        except ValueError as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "agents.invalid_integration",
                str(exc),
            ) from exc

    @app.post("/api/agents/integrations/linear/oauth/start", dependencies=[auth])
    async def linear_oauth_start() -> dict[str, Any]:
        from ..agents.linear_oauth import LinearOAuthError

        try:
            return await app.state.agents.linear_oauth().start()
        except LinearOAuthError as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "agents.linear_oauth",
                str(exc),
            ) from exc

    @app.get("/api/agents/integrations/linear/oauth/status", dependencies=[auth])
    async def linear_oauth_status() -> dict[str, Any]:
        return app.state.agents.linear_oauth().status()

    @app.post("/api/agents/integrations/linear/oauth/cancel", dependencies=[auth])
    async def linear_oauth_cancel() -> dict[str, Any]:
        await app.state.agents.linear_oauth().cancel()
        return app.state.agents.linear_oauth().status()

    async def _linear_credentials(request: AgentLinearCredentialRequest) -> list[dict[str, Any]]:
        try:
            return await app.state.agents.apply_linear_token(request.access_token)
        except ValueError as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "agents.linear_oauth",
                str(exc),
            ) from exc

    @app.put("/api/agents/integrations/linear/credentials", dependencies=[auth])
    async def linear_credentials_put(request: AgentLinearCredentialRequest) -> list[dict[str, Any]]:
        return await _linear_credentials(request)

    @app.post("/api/agents/integrations/linear/credentials", dependencies=[auth])
    async def linear_credentials_post(request: AgentLinearCredentialRequest) -> list[dict[str, Any]]:
        return await _linear_credentials(request)

    @app.post("/api/agents/session/start", response_model=AgentSessionStartResponse, dependencies=[auth])
    async def agent_session_start(request: AgentSessionStartRequest) -> AgentSessionStartResponse:
        if request.workspace_kind == "local":
            try:
                local_allowed = Path(request.cwd).expanduser().resolve(strict=True).is_dir()
            except (OSError, RuntimeError):
                local_allowed = False
            if not local_allowed:
                raise _http_error(
                    status.HTTP_400_BAD_REQUEST,
                    "agents.invalid_request",
                    "Choose an existing local folder before starting the agent.",
                )
        else:
            await _require_active_ssh_workspace(
                connection_id=request.connection_id,
                cwd=request.cwd,
                filesystem_scope=request.filesystem_scope,
            )
            await _ensure_linux_user_for_path(request.cwd)
        try:
            attachments = (
                [item.model_dump(by_alias=True) for item in request.attachments]
                if request.attachments
                else None
            )
            session_id = await app.state.agents.start_session(
                agent=request.agent,
                task=request.task,
                cwd=request.cwd,
                budget_usd=request.budget_usd,
                budget=(request.budget.model_dump(by_alias=True) if request.budget else None),
                mode=AgentMode(request.mode),
                access_level=request.access_level,
                reasoning_effort=request.reasoning_effort,
                attachments=attachments,
                plugin_ids=request.plugin_ids,
                workspace_kind=request.workspace_kind,
                connection_id=(
                    request.connection_id
                    if request.workspace_kind == "ssh"
                    else "local"
                ),
                filesystem_scope=request.filesystem_scope,
            )
        except ValueError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "agents.invalid_request", str(exc)) from exc
        except Exception as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.start_failed",
                str(exc),
                retryable=True,
            ) from exc
        return AgentSessionStartResponse(sessionId=session_id)

    @app.post("/api/agents/session/send", dependencies=[auth])
    async def agent_session_send(request: AgentSessionSendRequest) -> dict[str, bool]:
        existing = await app.state.agents.get_session(request.session_id)
        if existing is not None and existing.workspace_kind == "ssh":
            await _require_active_ssh_workspace(
                connection_id=existing.connection_id,
                cwd=existing.cwd,
                filesystem_scope=getattr(existing, "filesystem_scope", "workspace"),
            )
            await _ensure_linux_user_for_path(existing.cwd)
        try:
            attachments = (
                [item.model_dump(by_alias=True) for item in request.attachments]
                if request.attachments
                else None
            )
            ok = await app.state.agents.send(
                request.session_id,
                request.message,
                reasoning_effort=request.reasoning_effort,
                attachments=attachments,
                plugin_ids=request.plugin_ids,
            )
        except ValueError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "agents.invalid_message", str(exc)) from exc
        except AgentTurnActiveError as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.turn_active",
                str(exc),
            ) from exc
        except Exception as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.send_failed",
                str(exc),
                retryable=True,
            ) from exc
        if not ok:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            )
        return {"ok": ok}

    @app.post("/api/agents/session/stop", dependencies=[auth])
    async def agent_session_stop(request: AgentSessionStopRequest) -> dict[str, bool]:
        ok = await app.state.agents.stop_session(request.session_id)
        if not ok:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            )
        return {"ok": ok}

    @app.post("/api/agents/session/fork", response_model=AgentSessionStartResponse, dependencies=[auth])
    async def agent_session_fork(request: AgentSessionForkRequest) -> AgentSessionStartResponse:
        existing = await app.state.agents.get_session(request.session_id)
        if existing is not None and existing.workspace_kind == "ssh":
            await _require_active_ssh_workspace(
                connection_id=existing.connection_id,
                cwd=existing.cwd,
                filesystem_scope=getattr(existing, "filesystem_scope", "workspace"),
            )
        try:
            session_id = await app.state.agents.fork_session(request.session_id)
        except ValueError as exc:
            raise _http_error(status.HTTP_404_NOT_FOUND, "agents.session_not_found", str(exc)) from exc
        except RuntimeError as exc:
            raise _http_error(status.HTTP_409_CONFLICT, "agents.turn_active", str(exc)) from exc
        return AgentSessionStartResponse(sessionId=session_id)

    @app.post(
        "/api/agents/session/mode",
        response_model=SessionSummary,
        dependencies=[auth],
    )
    async def agent_session_mode(request: AgentSessionModeRequest) -> SessionSummary:
        try:
            summary = await app.state.agents.set_mode(
                request.session_id,
                AgentMode(request.mode),
            )
        except RuntimeError as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.turn_active",
                str(exc),
            ) from exc
        if summary is None:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            )
        return cast(SessionSummary, summary)

    @app.post(
        "/api/agents/session/reasoning",
        response_model=SessionSummary,
        dependencies=[auth],
    )
    async def agent_session_reasoning(request: AgentSessionReasoningRequest) -> SessionSummary:
        try:
            summary = await app.state.agents.set_reasoning_effort(
                request.session_id,
                request.reasoning_effort,
            )
        except ValueError as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "agents.invalid_request",
                str(exc),
            ) from exc
        if summary is None:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            )
        return cast(SessionSummary, summary)

    @app.post(
        "/api/agents/session/access",
        response_model=SessionSummary,
        dependencies=[auth],
    )
    async def agent_session_access(request: AgentSessionAccessRequest) -> SessionSummary:
        try:
            summary = await app.state.agents.set_access_level(
                request.session_id,
                request.access_level,
            )
        except RuntimeError as exc:
            raise _http_error(status.HTTP_409_CONFLICT, "agents.turn_active", str(exc)) from exc
        if summary is None:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            )
        return cast(SessionSummary, summary)

    @app.post(
        "/api/agents/session/archive",
        response_model=SessionSummary,
        dependencies=[auth],
    )
    async def agent_session_archive(request: AgentSessionArchiveRequest) -> SessionSummary:
        summary = await app.state.agents.set_archived(
            request.session_id,
            bool(request.archived),
        )
        if summary is None:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            )
        return cast(SessionSummary, summary)

    @app.get(
        "/api/agents/sessions/{session_id}/plan",
        response_model=AgentPlanModel,
        dependencies=[auth],
    )
    async def agent_session_plan_get(session_id: str) -> AgentPlanModel:
        try:
            plan = await app.state.agents.get_plan(session_id)
        except KeyError as exc:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            ) from exc
        if plan is None:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.plan_not_found",
                "No plan for this session",
            )
        return AgentPlanModel.model_validate(plan)

    @app.put(
        "/api/agents/session/plan",
        response_model=AgentPlanModel,
        dependencies=[auth],
    )
    async def agent_session_plan_update(request: AgentPlanUpdateRequest) -> AgentPlanModel:
        steps = None
        if request.steps is not None:
            steps = [step.model_dump(by_alias=True, mode="json") for step in request.steps]
        try:
            plan = await app.state.agents.update_plan(
                request.session_id,
                title=request.title,
                summary=request.summary,
                steps=steps,
            )
        except KeyError as exc:
            code = "agents.plan_not_found" if str(exc) == "'plan'" or str(exc) == "plan" else "agents.session_not_found"
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                code,
                "Plan or session not found",
            ) from exc
        except RuntimeError as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.plan_not_editable",
                str(exc),
            ) from exc
        except ValueError as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "agents.invalid_plan",
                str(exc),
            ) from exc
        return AgentPlanModel.model_validate(plan)

    @app.post(
        "/api/agents/session/plan/implement",
        response_model=SessionSummary,
        dependencies=[auth],
    )
    async def agent_session_plan_implement(
        request: AgentPlanImplementRequest,
    ) -> SessionSummary:
        steps = None
        if request.steps is not None:
            steps = [step.model_dump(by_alias=True, mode="json") for step in request.steps]
        try:
            summary = await app.state.agents.implement_plan(
                request.session_id,
                title=request.title,
                summary=request.summary,
                steps=steps,
            )
        except KeyError as exc:
            code = "agents.plan_not_found" if str(exc) in {"'plan'", "plan"} else "agents.session_not_found"
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                code,
                "Plan or session not found",
            ) from exc
        except RuntimeError as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.plan_implement_blocked",
                str(exc),
            ) from exc
        except ValueError as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "agents.invalid_plan",
                str(exc),
            ) from exc
        return cast(SessionSummary, summary)

    @app.post(
        "/api/agents/session/plan/dismiss",
        response_model=AgentPlanModel,
        dependencies=[auth],
    )
    async def agent_session_plan_dismiss(request: AgentPlanDismissRequest) -> AgentPlanModel:
        try:
            plan = await app.state.agents.dismiss_plan(request.session_id)
        except KeyError as exc:
            code = "agents.plan_not_found" if str(exc) in {"'plan'", "plan"} else "agents.session_not_found"
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                code,
                "Plan or session not found",
            ) from exc
        except RuntimeError as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.plan_dismiss_blocked",
                str(exc),
            ) from exc
        return AgentPlanModel.model_validate(plan)

    @app.get("/api/agents/sessions/history", dependencies=[auth])
    async def agent_chat_history(request: Request) -> list[dict[str, Any]]:
        params = request.query_params
        sessions = await app.state.agents.list_sessions(
            cwd=params.get("cwd"), workspace_kind=params.get("workspaceKind"),
            connection_id=params.get("connectionId"), filesystem_scope=params.get("filesystemScope"),
        )
        return await app.state.agents.history_details(
            [session.session_id for session in sessions], (params.get("q") or "")[:200],
        )

    @app.get("/api/agents/sessions", response_model=list[SessionSummary], dependencies=[auth])
    async def agent_sessions(request: Request) -> list[SessionSummary]:
        cwd = request.query_params.get("cwd")
        workspace_kind = request.query_params.get("workspaceKind")
        connection_id = request.query_params.get("connectionId")
        filesystem_scope = request.query_params.get("filesystemScope")
        return cast(
            list[SessionSummary],
            await app.state.agents.list_sessions(
                cwd=cwd,
                workspace_kind=workspace_kind,
                connection_id=connection_id,
                filesystem_scope=filesystem_scope,
            ),
        )

    @app.put(
        "/api/agents/sessions/{session_id}/workspace",
        response_model=SessionSummary,
        dependencies=[auth],
    )
    async def agent_session_workspace(
        session_id: str,
        request: AgentSessionWorkspaceRequest,
    ) -> SessionSummary:
        if request.workspace_kind == "ssh":
            existing = await app.state.agents.get_session(session_id)
            session_scope = getattr(existing, "filesystem_scope", "workspace") if existing else "workspace"
            await _require_active_ssh_workspace(
                connection_id=request.connection_id,
                cwd=request.cwd,
                filesystem_scope=session_scope,
            )
        try:
            summary = await app.state.agents.set_workspace(
                session_id,
                cwd=request.cwd,
                workspace_kind=request.workspace_kind,
                connection_id=request.connection_id,
            )
        except AgentTurnActiveError as exc:
            raise _http_error(409, "agents.turn_active", str(exc)) from exc
        except (OSError, ValueError) as exc:
            raise _http_error(400, "agents.invalid_workspace", str(exc)) from exc
        if summary is None:
            raise _http_error(404, "agents.session_not_found", "Agent session not found")
        return cast(SessionSummary, summary)

    @app.get(
        "/api/agents/sessions/{session_id}",
        response_model=SessionSummary,
        dependencies=[auth],
    )
    async def agent_session(session_id: str) -> SessionSummary:
        summary = await app.state.agents.get_session(session_id)
        if summary is None:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            )
        return cast(SessionSummary, summary)

    @app.get(
        "/api/agents/sessions/{session_id}/events",
        response_model=list[AgentEventResponse],
        dependencies=[auth],
    )
    async def agent_session_events(
        session_id: str,
        limit: int = 5_000,
        before_sequence: int | None = None,
        turns: int | None = None,
    ) -> list[AgentEventResponse]:
        try:
            events = await app.state.agents.list_events(
                session_id,
                limit=max(1, min(limit, 20_000)),
                before_sequence=before_sequence,
                turn_limit=None if turns is None else max(1, min(turns, 100)),
            )
        except KeyError as exc:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            ) from exc
        return [AgentEventResponse.model_validate(event) for event in events]

    @app.get(
        "/api/agents/sessions/{session_id}/approvals",
        response_model=list[AgentApprovalResponse],
        dependencies=[auth],
    )
    async def agent_session_approvals(session_id: str) -> list[AgentApprovalResponse]:
        try:
            approvals = await app.state.agents.list_approvals(session_id)
        except KeyError as exc:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            ) from exc
        return [AgentApprovalResponse.model_validate(approval) for approval in approvals]

    @app.get(
        "/api/agents/sessions/{session_id}/checkpoints",
        dependencies=[auth],
    )
    async def agent_session_checkpoints(session_id: str) -> list[dict[str, Any]]:
        try:
            return await app.state.agents.list_checkpoints(session_id)
        except KeyError as exc:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            ) from exc

    @app.get(
        "/api/agents/sessions/{session_id}/evaluation",
        response_model=AgentEvaluationResponse,
        dependencies=[auth],
    )
    async def agent_session_evaluation(session_id: str) -> AgentEvaluationResponse:
        try:
            value = await app.state.agents.evaluate_session(session_id)
        except KeyError as exc:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.session_not_found",
                "Agent session not found",
            ) from exc
        return AgentEvaluationResponse.model_validate(value)

    @app.post("/api/agents/session/checkpoint/restore", dependencies=[auth])
    async def agent_checkpoint_restore(
        request: AgentCheckpointRestoreRequest,
    ) -> dict[str, Any]:
        try:
            return await app.state.agents.restore_checkpoint(
                request.session_id,
                request.checkpoint_id,
            )
        except KeyError as exc:
            raise _http_error(
                status.HTTP_404_NOT_FOUND,
                "agents.checkpoint_not_found",
                "Agent checkpoint not found",
            ) from exc
        except AgentTurnActiveError as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.turn_active",
                str(exc),
            ) from exc
        except Exception as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.checkpoint_restore_failed",
                str(exc),
            ) from exc

    @app.post("/api/agents/session/approval", dependencies=[auth])
    async def agent_session_approval(request: AgentApprovalRequest) -> dict[str, bool]:
        try:
            ok = await app.state.agents.resolve_approval(request.approval_id, request.decision)
        except ValueError as exc:
            raise _http_error(status.HTTP_400_BAD_REQUEST, "agents.invalid_approval", str(exc)) from exc
        if not ok:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.approval_expired",
                "This approval is no longer pending.",
            )
        return {"ok": True}

    @app.post(
        "/api/agents/sessions/{session_id}/guard/resolve",
        dependencies=[auth],
    )
    async def agent_guard_resolve(
        session_id: str,
        request: AgentGuardResolveRequest,
    ) -> dict[str, bool]:
        try:
            ok = await app.state.agents.resolve_guard(
                session_id,
                request.action,
                budget=(
                    request.budget.model_dump(by_alias=True, exclude_unset=True)
                    if request.budget
                    else None
                ),
            )
        except ValueError as exc:
            raise _http_error(
                status.HTTP_400_BAD_REQUEST,
                "agents.invalid_guard_resolution",
                str(exc),
            ) from exc
        except AgentTurnActiveError as exc:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.turn_active",
                str(exc),
            ) from exc
        if not ok:
            raise _http_error(
                status.HTTP_409_CONFLICT,
                "agents.guard_not_paused",
                "This task is no longer paused by the guard.",
            )
        return {"ok": True}

    @app.websocket("/ws/events")
    async def events_socket(websocket: WebSocket, token: str | None = None) -> None:
        if not _websocket_authorized(websocket, token, config.bearer_token):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        await websocket.accept()
        async for queue in app.state.events.subscribe():
            try:
                while True:
                    envelope = await queue.get()
                    await websocket.send_json(envelope.model_dump(by_alias=True))
            except (WebSocketDisconnect, RuntimeError):
                break

    @app.websocket("/ws/lsp/{session_id}")
    async def lsp_socket(websocket: WebSocket, session_id: str, token: str | None = None) -> None:
        if not _websocket_authorized(websocket, token, config.bearer_token):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        session = app.state.lsp.get(unquote(session_id))
        if session is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await websocket.accept()
        await session.attach_client(websocket)
        print(f"[LSP] client attached session={session_id}", file=sys.stderr)
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                    continue
                if not isinstance(payload, dict):
                    continue
                kind = payload.get("type")
                if kind == "ping":
                    await websocket.send_json({"type": "pong"})
                    continue
                if kind != "rpc":
                    continue
                message = payload.get("message")
                if not isinstance(message, dict):
                    continue
                try:
                    await session.write_rpc(message)
                except Exception as exc:  # noqa: BLE001
                    await websocket.send_json({"type": "error", "message": str(exc)})
                    if session.status in ("exited", "error"):
                        break
        except WebSocketDisconnect:
            print(f"[LSP] client disconnected session={session_id}", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            print(f"[LSP] socket error session={session_id}: {exc}", file=sys.stderr)
        finally:
            session.detach_client(websocket)

    @app.websocket("/ws/term/{term_id}")
    async def term_socket(websocket: WebSocket, term_id: str, token: str | None = None, protocol: int = 1, offset: int | None = None) -> None:
        if not _websocket_authorized(websocket, token, config.bearer_token):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        session = app.state.terminals.get(term_id)
        if session is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if not session.local and session.connection_id != app.state.ssh.snapshot.profile_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if session.local:
            if pty is None:
                await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
                return
            await _ensure_local_terminal_process(session)
            if protocol == 2:
                from ..term.local_protocol import serve_local_terminal
                await serve_local_terminal(websocket, session, offset)
                return
            await websocket.accept()
            session.suspended = False
            local_io = session.local_io
            if local_io is None:
                await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
                return
            queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=512)
            session.local_clients.add(queue)
            if session.local_output:
                await websocket.send_bytes(bytes(session.local_output))
            if session.exited:
                await websocket.close(code=4001, reason="terminal exited")
                session.local_clients.discard(queue)
                return

            async def read_output() -> None:
                while True:
                    data = await queue.get()
                    if not data:
                        await websocket.close(code=4001, reason="terminal exited")
                        return
                    await websocket.send_bytes(data)

            async def read_input() -> None:
                try:
                    while True:
                        await local_io.write(await websocket.receive_bytes())
                except (WebSocketDisconnect, EOFError, OSError):
                    return

            output_task = asyncio.create_task(read_output())
            input_task = asyncio.create_task(read_input())
            try:
                _, pending = await asyncio.wait({output_task, input_task}, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
            finally:
                session.local_clients.discard(queue)
                session.suspended = len(session.local_clients) == 0
                with contextlib.suppress(Exception):
                    await websocket.close()
            return

        ssh_mgr = app.state.ssh
        if ssh_mgr.connection is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await websocket.accept()
        print(f"[PTY] accepted term={term_id} cols={session.cols} rows={session.rows}", file=sys.stderr)

        # ── tmux control mode (-CC) ──────────────────────────────────────────
        # tmux emits its output as escaped %output lines instead of taking over
        # the screen, so xterm keeps its own smooth scrollback + scrollbar while
        # the session still lives on the server (survives SSH drops).
        if session.tmux_session:
            # Replay recent pane history before attaching control mode. This
            # restores useful scrollback after Coloride itself has restarted.
            with contextlib.suppress(Exception):
                history = await (ssh_mgr.command_connection or ssh_mgr.connection).run(
                    # Negative lines belong to tmux scrollback. Excluding the
                    # visible screen avoids replaying its prompt and padding;
                    # control mode sends the current screen when it attaches.
                    f"tmux capture-pane -p -e -S -2000 -E -1 -t {shlex.quote(session.tmux_session)}",
                    check=False,
                )
                output = _normalize_terminal_history(_as_text(history.stdout))
                if output:
                    await websocket.send_bytes(output)
            try:
                pty_handle = await ssh_mgr.open_control_pty(
                    session.cols,
                    session.rows,
                    tmux_session=session.tmux_session,
                    cwd=session.cwd,
                    shell=session.shell,
                )
            except Exception as e:
                print(f"[TMUXCC] failed to open term={term_id}: {e}", file=sys.stderr)
                with contextlib.suppress(Exception):
                    # The frontend can only distinguish an intentional close
                    # from a failed PTY open through the WebSocket code. Do
                    # not leave a tab pulsing forever after an SSH refusal.
                    await websocket.close(code=1011, reason="terminal channel unavailable")
                return

            proc = pty_handle.process

            async def _on_output(data: bytes) -> None:
                with contextlib.suppress(Exception):
                    await websocket.send_bytes(data)

            client = TmuxControlClient(proc, session.tmux_session, _on_output)
            # Mark control mode before attaching the process. TerminalRegistry
            # must not send a duplicate SSH resize to a PTY already created at
            # the requested dimensions.
            session.control = client
            app.state.terminals.attach(term_id, proc)
            print(f"[TMUXCC] started term={term_id} session={session.tmux_session}", file=sys.stderr)

            async def _read_input() -> None:
                try:
                    while True:
                        data = await websocket.receive_bytes()
                        await client.send_input(data)
                except WebSocketDisconnect:
                    print(f"[TMUXCC] client disconnected term={term_id}", file=sys.stderr)
                except Exception as e:
                    print(f"[TMUXCC] input error term={term_id}: {e}", file=sys.stderr)

            output_task = asyncio.create_task(client.start(session.cols, session.rows))
            input_task = asyncio.create_task(_read_input())
            try:
                # Whichever ends first (tmux exit or client disconnect) tears down
                # the other. The tmux session itself keeps running on the server.
                _, pending = await asyncio.wait(
                    {output_task, input_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
            finally:
                session.control = None
                await client.close()
                app.state.terminals.detach_process(term_id)
                if pty_handle.owned_connection is not None:
                    with contextlib.suppress(Exception):
                        pty_handle.owned_connection.close()
                        await pty_handle.owned_connection.wait_closed()
                with contextlib.suppress(Exception):
                    alive = await (ssh_mgr.command_connection or ssh_mgr.connection).run(
                        f"tmux has-session -t {shlex.quote(session.tmux_session or '')} 2>/dev/null",
                        check=False,
                    )
                    if alive.exit_status != 0:
                        session.exited = True
                        await websocket.close(code=4001, reason="terminal exited")
                print(f"[TMUXCC] closed term={term_id}", file=sys.stderr)
            return

        # Every terminal is created with a tmux session name (see term_create),
        # so control mode above always handles it. This is a defensive fallback.
        with contextlib.suppress(Exception):
            await websocket.close()

    # Reuse the registry, shell integration and creation path used by native tabs.
    from ..agents.terminals import AgentTerminalService

    async def _agent_terminal_remote(action: str, terminal: Any, value: Any) -> Any:
        connection_id = value if action == "validate" else terminal.connection_id
        if not connection_id or app.state.ssh.snapshot.profile_id != connection_id:
            raise PermissionError("Reconnect this terminal's SSH connection")
        conn = _ssh_work_conn()
        if conn is None:
            raise RuntimeError("SSH connection is unavailable")
        if action == "validate":
            return None
        target = shlex.quote(terminal.tmux_session)
        if action == "read":
            result = await conn.run(f"tmux capture-pane -p -S -{int(value)} -t {target}", check=False)
        elif action == "interrupt":
            result = await conn.run(f"tmux send-keys -t {target} C-c", check=False)
        else:
            result = await conn.run(
                f"tmux send-keys -t {target} -l -- {shlex.quote(value)} && tmux send-keys -t {target} Enter",
                check=False,
            )
        if result.exit_status != 0:
            raise RuntimeError("Remote terminal is unavailable")
        return _as_text(result.stdout)

    async def _agent_terminal_create(agent_session: Any, cwd: str) -> Any:
        response = await term_create(TermCreateRequest(
            cols=100, rows=28, cwd=cwd,
            workspaceKind=agent_session.workspace_kind,
            connectionId=agent_session.connection_id,
        ))
        terminal = app.state.terminals.get(response.term_id)
        if not terminal.local:
            from ..term.shell_integration import remote_install_command, remote_shell_command
            conn = _ssh_work_conn()
            try:
                await conn.run(remote_install_command(), check=False)
                shell = remote_shell_command(terminal.shell)
                command = (f"tmux new-session -d -s {shlex.quote(terminal.tmux_session)} "
                           f"-x 100 -y 28 -c {shlex.quote(cwd)} {shlex.quote('exec ' + shell)}")
                result = await conn.run(command, check=False)
                if result.exit_status != 0:
                    raise RuntimeError("Could not create remote terminal")
            except BaseException:
                app.state.terminals.close(terminal.term_id)
                raise
        return terminal

    app.state.agents.bind_terminals(AgentTerminalService(
        app.state.terminals, create=_agent_terminal_create, info=term_info,
        remote=_agent_terminal_remote, publish=app.state.events.publish,
    ))

    return app
