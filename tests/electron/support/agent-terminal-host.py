"""Isolated real host with a test-only entrypoint to invoke actual agent tools."""

import json
import os
from pathlib import Path

import uvicorn
from fastapi import HTTPException, Request

from coloride_desktop.agents.domain import AgentMode, AgentSession
from coloride_desktop.agents.provider import ModelToolCall
from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig

config = LaunchConfig.create()
app = create_app(config)
agent = AgentSession.create(
    agent="coloride",
    cwd=os.environ["COLORIDE_TEST_PROJECT"],
    mode=AgentMode.ACT,
    workspace_kind="local",
    access_level="full",
)
app.state.files.authorize_local_session(agent.session_id, agent.cwd)


@app.post("/test/terminal-tool")
async def tool(request: Request):
    if request.headers.get("Authorization") != f"Bearer {config.bearer_token}":
        raise HTTPException(status_code=401)
    data = await request.json()
    # This route exists only in this isolated fixture, never in the shipped host.
    with app.state.files.session_scope(agent.session_id):
        result = await app.state.agents._tools.execute(
            ModelToolCall("terminal-ui-test", data["name"], data.get("arguments", {})), agent
        )
    return result.metadata


Path(os.environ["COLORIDE_TEST_LAUNCH"]).write_text(
    json.dumps(
        dict(host=config.host, port=config.port, token=config.bearer_token, agentSessionId=agent.session_id)
    )
)
uvicorn.run(app, host=config.host, port=config.port, log_level="warning")
