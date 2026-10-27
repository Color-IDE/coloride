from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from coloride_desktop.agents.client import AgentProxyClient
from coloride_desktop.agents.domain import (
    AgentMode,
    AgentPlanStatus,
    AgentPlanStepStatus,
    AgentSession,
    AgentSessionState,
)
from coloride_desktop.agents.provider import ModelToolCall
from coloride_desktop.agents.store import AgentSessionStore
from coloride_desktop.agents.tools import RemoteWorkspaceTools


class _FakeFiles:
    async def realpath(self, path: str) -> str:
        return path


async def _noop_run(_command: str) -> object:
    return type("R", (), {"stdout": "", "stderr": "", "exit_status": 0})()


@pytest.fixture
def store(tmp_path: Path) -> AgentSessionStore:
    return AgentSessionStore(root=tmp_path / "sessions")


def test_submit_plan_only_in_plan_mode(store: AgentSessionStore) -> None:
    tools = RemoteWorkspaceTools(
        files=_FakeFiles(),  # type: ignore[arg-type]
        run_command=_noop_run,
        store=store,
    )
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.PLAN)
    store.save_session(session)

    result = asyncio.run(
        tools.execute(
            ModelToolCall(
                call_id="c1",
                name="submit_plan",
                arguments={
                    "title": "Ship checklist",
                    "summary": "Do the thing",
                    "steps": [
                        {"title": "Read entrypoint", "detail": "main.py"},
                        {"title": "Add tests", "detail": None},
                    ],
                },
            ),
            session,
        )
    )
    assert "Plan submitted" in result.output
    assert "Implement" in result.output or "same turn" in result.output.lower()
    plan = store.get_session_plan(session.session_id)
    assert plan is not None
    assert plan.status == AgentPlanStatus.READY
    assert len(plan.steps) == 2
    assert plan.steps[0].id == "step_1"
    assert plan.steps[0].status == AgentPlanStepStatus.PENDING

    # Progress updates are allowed in Plan while following the checklist.
    asyncio.run(
        tools.execute(
            ModelToolCall(
                call_id="c1b",
                name="update_plan_step",
                arguments={"step_id": "step_1", "status": "in_progress", "note": None},
            ),
            session,
        )
    )
    mid = store.get_session_plan(session.session_id)
    assert mid is not None
    assert mid.status == AgentPlanStatus.IMPLEMENTING
    assert mid.steps[0].status == AgentPlanStepStatus.IN_PROGRESS

    act = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    store.save_session(act)
    with pytest.raises(PermissionError):
        asyncio.run(
            tools.execute(
                ModelToolCall(
                    call_id="c2",
                    name="submit_plan",
                    arguments={
                        "title": "Nope",
                        "summary": None,
                        "steps": [{"title": "x", "detail": None}],
                    },
                ),
                act,
            )
        )


def test_submit_plan_rejects_empty_steps(store: AgentSessionStore) -> None:
    tools = RemoteWorkspaceTools(
        files=_FakeFiles(),  # type: ignore[arg-type]
        run_command=_noop_run,
        store=store,
    )
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.PLAN)
    store.save_session(session)
    with pytest.raises(ValueError):
        asyncio.run(
            tools.execute(
                ModelToolCall(
                    call_id="c1",
                    name="submit_plan",
                    arguments={"title": "Empty", "summary": None, "steps": []},
                ),
                session,
            )
        )


def test_update_plan_step_progress(store: AgentSessionStore) -> None:
    tools = RemoteWorkspaceTools(
        files=_FakeFiles(),  # type: ignore[arg-type]
        run_command=_noop_run,
        store=store,
    )
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.PLAN)
    store.save_session(session)
    asyncio.run(
        tools.execute(
            ModelToolCall(
                call_id="c1",
                name="submit_plan",
                arguments={
                    "title": "Two steps",
                    "summary": None,
                    "steps": [
                        {"title": "One", "detail": None},
                        {"title": "Two", "detail": None},
                    ],
                },
            ),
            session,
        )
    )
    plan = store.get_session_plan(session.session_id)
    assert plan is not None
    plan.status = AgentPlanStatus.IMPLEMENTING
    store.save_plan(plan)
    session.mode = AgentMode.ACT
    store.save_session(session)

    asyncio.run(
        tools.execute(
            ModelToolCall(
                call_id="c2",
                name="update_plan_step",
                arguments={"step_id": "step_1", "status": "in_progress", "note": None},
            ),
            session,
        )
    )
    asyncio.run(
        tools.execute(
            ModelToolCall(
                call_id="c3",
                name="update_plan_step",
                arguments={"step_id": "step_1", "status": "done", "note": None},
            ),
            session,
        )
    )
    asyncio.run(
        tools.execute(
            ModelToolCall(
                call_id="c4",
                name="update_plan_step",
                arguments={"step_id": "step_2", "status": "skipped", "note": "n/a"},
            ),
            session,
        )
    )
    final = store.get_session_plan(session.session_id)
    assert final is not None
    assert final.steps[0].status == AgentPlanStepStatus.DONE
    assert final.steps[1].status == AgentPlanStepStatus.SKIPPED
    assert final.status == AgentPlanStatus.COMPLETED


def test_implement_plan_switches_to_act_and_freezes(store: AgentSessionStore) -> None:
    async def _run() -> None:
        client = AgentProxyClient(store=store)
        sent: list[str] = []
        send_kwargs: list[dict[str, object]] = []

        async def fake_send(session_id: str, message: str, **kwargs: object) -> bool:
            sent.append(message)
            send_kwargs.append(kwargs)
            return True

        client.send = fake_send  # type: ignore[method-assign]
        session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.PLAN)
        session.state = AgentSessionState.IDLE
        store.save_session(session)
        tools = RemoteWorkspaceTools(
            files=_FakeFiles(),  # type: ignore[arg-type]
            run_command=_noop_run,
            store=store,
        )
        await tools._execute_submit_plan(  # noqa: SLF001
            {
                "title": "Ship it",
                "summary": "overview",
                "steps": [
                    {"title": "First", "detail": "a"},
                    {"title": "Second", "detail": "b"},
                ],
            },
            session,
        )
        summary = await client.implement_plan(
            session.session_id,
            steps=[
                {"id": "step_1", "title": "Edited first", "detail": "a", "status": "pending"},
                {"id": "step_2", "title": "Edited second", "detail": "b", "status": "pending"},
            ],
        )
        assert summary.mode == "act"
        plan = store.get_session_plan(session.session_id)
        assert plan is not None
        assert plan.status == AgentPlanStatus.IMPLEMENTING
        assert plan.steps[0].title == "Edited first"
        assert all(step.status == AgentPlanStepStatus.PENDING for step in plan.steps)
        assert len(sent) == 1
        assert "Edited first" in sent[0]
        assert "update_plan_step" in sent[0]
        assert send_kwargs and send_kwargs[0].get("show_in_timeline") is False
        events = store.list_events(session.session_id)
        assert any(event.type == "plan_updated" for event in events)
        assert any(event.type == "mode_changed" for event in events)

    asyncio.run(_run())


def test_update_plan_edits_ready_only(store: AgentSessionStore) -> None:
    async def _run() -> None:
        client = AgentProxyClient(store=store)
        session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.PLAN)
        store.save_session(session)
        tools = RemoteWorkspaceTools(
            files=_FakeFiles(),  # type: ignore[arg-type]
            run_command=_noop_run,
            store=store,
        )
        await tools._execute_submit_plan(  # noqa: SLF001
            {
                "title": "Original",
                "summary": None,
                "steps": [{"title": "A", "detail": None}],
            },
            session,
        )
        updated = await client.update_plan(
            session.session_id,
            title="Renamed",
            steps=[{"id": "step_1", "title": "B", "detail": "more"}],
        )
        assert updated["title"] == "Renamed"
        assert updated["steps"][0]["title"] == "B"

        plan = store.get_session_plan(session.session_id)
        assert plan is not None
        plan.status = AgentPlanStatus.IMPLEMENTING
        store.save_plan(plan)
        with pytest.raises(RuntimeError):
            await client.update_plan(session.session_id, title="Nope")

    asyncio.run(_run())
