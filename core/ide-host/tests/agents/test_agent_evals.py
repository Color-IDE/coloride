from __future__ import annotations

from coloride_desktop.agents.domain import AgentEvent, AgentMode, AgentSession
from coloride_desktop.agents.evals import evaluate_session


def _event(session_id: str, sequence: int, event_type: str, **data: object) -> AgentEvent:
    return AgentEvent.create(
        session_id=session_id,
        sequence=sequence,
        type=event_type,
        data=dict(data),
    )


def test_session_evaluation_reports_protected_successful_mutation() -> None:
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    events = [
        _event(session.session_id, 1, "tool_call", itemId="call-1", tool="write_file"),
        _event(session.session_id, 2, "approval_required", id="approval-1"),
        _event(session.session_id, 3, "approval_resolved", approvalId="approval-1"),
        _event(session.session_id, 4, "checkpoint_created", itemId="call-1"),
        _event(session.session_id, 5, "diff", itemId="call-1"),
        _event(session.session_id, 6, "tool_result", itemId="call-1", failed=False),
        _event(session.session_id, 7, "done"),
    ]

    result = evaluate_session(session, events)

    assert result["completed"] is True
    assert result["mutationCalls"] == 1
    assert result["protectedMutations"] == 1
    assert result["passedChecks"] == result["totalChecks"]


def test_session_evaluation_exposes_unresolved_and_unprotected_tools() -> None:
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    events = [
        _event(session.session_id, 1, "tool_call", itemId="call-1", tool="delete_path"),
        _event(session.session_id, 2, "approval_required", id="approval-1"),
    ]

    result = evaluate_session(session, events)
    checks = {check["id"]: check for check in result["checks"]}

    assert result["completed"] is False
    assert result["unresolvedTools"] == 1
    assert checks["mutation-checkpoints"]["passed"] is True
    assert checks["approvals-resolved"]["passed"] is False


def test_session_evaluation_only_checks_latest_turn() -> None:
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    events = [
        _event(session.session_id, 1, "user_message", content="First turn"),
        _event(session.session_id, 2, "done"),
        _event(session.session_id, 3, "user_message", content="Second turn"),
        _event(session.session_id, 4, "tool_call", itemId="call-2", tool="read_file"),
    ]

    result = evaluate_session(session, events)

    assert result["completed"] is False
    assert result["toolCalls"] == 1
    assert result["unresolvedTools"] == 1


def test_failed_mutation_does_not_require_checkpoint() -> None:
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    events = [
        _event(session.session_id, 1, "user_message", content="Delete a file"),
        _event(session.session_id, 2, "tool_call", itemId="call-1", tool="delete_path"),
        _event(session.session_id, 3, "tool_result", itemId="call-1", failed=True),
        _event(session.session_id, 4, "done"),
    ]

    result = evaluate_session(session, events)
    checks = {check["id"]: check for check in result["checks"]}

    assert result["mutationCalls"] == 0
    assert result["toolFailures"] == 1
    assert checks["mutation-checkpoints"]["passed"] is True
    assert checks["no-tool-failures"]["passed"] is False
