"""Local HTTP routes for external ACP agents."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from ..models import ErrorPayload
from .models import (
    AuthenticateRequestBody,
    ConfigPatch,
    InstallRequest,
    OpenSessionRequest,
    PermissionDecision,
    PromptBody,
)
from .service import ExternalAgentError, ExternalAgentManager


def external_agent_router() -> APIRouter:
    router = APIRouter(prefix="/api/external-agents", tags=["external-agents"])

    def manager(request: Request) -> ExternalAgentManager:
        return request.app.state.external_agents

    def failure(exc: ExternalAgentError) -> JSONResponse:
        payload = ErrorPayload(code=exc.code, message=str(exc), retryable=False)
        return JSONResponse(status_code=exc.status, content=payload.model_dump(by_alias=True))

    @router.get("/registry")
    async def registry(request: Request) -> JSONResponse:
        try:
            return JSONResponse(await manager(request).catalog())
        except ExternalAgentError as exc:
            return failure(exc)

    @router.get("/installations")
    async def installations(request: Request) -> list[dict]:
        return manager(request).installations()

    @router.post("/suspend")
    async def suspend(request: Request) -> dict[str, bool]:
        await manager(request).shutdown()
        return {"ok": True}

    @router.post("/installations")
    async def install(request: Request, body: InstallRequest) -> JSONResponse:
        try:
            payload = await manager(request).install(body.agent_id, body.version)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse(payload)

    @router.delete("/installations/{installation_id}")
    async def uninstall(request: Request, installation_id: str) -> JSONResponse:
        try:
            await manager(request).uninstall(installation_id)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse({"ok": True})

    @router.post("/sessions")
    async def open_session(request: Request, body: OpenSessionRequest) -> JSONResponse:
        try:
            payload = await manager(request).open_session(body)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse(payload)

    @router.get("/sessions/{session_id}")
    async def get_session(request: Request, session_id: str) -> JSONResponse:
        try:
            payload = await manager(request).session(session_id)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse(payload)

    @router.delete("/sessions/{session_id}")
    async def delete_session(request: Request, session_id: str) -> JSONResponse:
        try:
            await manager(request).delete_session(session_id)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse({"ok": True})

    @router.get("/sessions/{session_id}/events")
    async def session_events(
        request: Request,
        session_id: str,
        after: int = Query(default=0),
    ) -> JSONResponse:
        try:
            payload = await manager(request).events(session_id, after)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse(payload)

    @router.post("/sessions/{session_id}/authenticate")
    async def authenticate(request: Request, session_id: str, body: AuthenticateRequestBody) -> JSONResponse:
        try:
            payload = await manager(request).authenticate(session_id, body.method_id)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse(payload)

    @router.patch("/sessions/{session_id}/config")
    async def set_config(request: Request, session_id: str, body: ConfigPatch) -> JSONResponse:
        try:
            payload = await manager(request).set_config(session_id, body.config_id, body.value)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse(payload)

    @router.post("/sessions/{session_id}/prompts", status_code=202)
    async def prompt(request: Request, session_id: str, body: PromptBody) -> JSONResponse:
        try:
            payload = await manager(request).prompt(session_id, body.text)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse(payload, status_code=202)

    @router.post("/sessions/{session_id}/cancel")
    async def cancel(request: Request, session_id: str) -> JSONResponse:
        try:
            await manager(request).cancel(session_id)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse({"ok": True})

    @router.post("/sessions/{session_id}/permissions/{request_id}")
    async def resolve_permission(
        request: Request,
        session_id: str,
        request_id: str,
        body: PermissionDecision,
    ) -> JSONResponse:
        try:
            await manager(request).resolve_permission(session_id, request_id, body.option_id, body.outcome)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse({"ok": True})

    @router.post("/sessions/{session_id}/close")
    async def close_session(request: Request, session_id: str) -> JSONResponse:
        try:
            await manager(request).close_execution(session_id)
        except ExternalAgentError as exc:
            return failure(exc)
        return JSONResponse({"ok": True})

    return router
