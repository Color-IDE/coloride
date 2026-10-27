from __future__ import annotations

from typing import Any

from .domain import AgentEvent, AgentSession

MUTATING_TOOLS = frozenset(
    {
        "write_file",
        "replace_in_file",
        "create_directory",
        "rename_path",
        "move_path",
        "delete_path",
    }
)


def evaluate_session(session: AgentSession, events: list[AgentEvent]) -> dict[str, Any]:
    """Build factual, reproducible checks for the latest persisted turn."""
    turn_events = _latest_turn_events(events)
    tool_calls = {
        _event_item_id(event): str(event.data.get("tool") or "")
        for event in turn_events
        if event.type == "tool_call" and _event_item_id(event)
    }
    tool_results = {
        _event_item_id(event): event
        for event in turn_events
        if event.type == "tool_result" and _event_item_id(event)
    }
    checkpoint_items = {
        _event_item_id(event)
        for event in turn_events
        if event.type == "checkpoint_created" and _event_item_id(event)
    }
    successful_items = {
        item_id
        for item_id, event in tool_results.items()
        if not bool(event.data.get("failed"))
    }
    mutation_items = {
        item_id
        for item_id, tool in tool_calls.items()
        if tool in MUTATING_TOOLS and item_id in successful_items
    }
    protected_mutations = mutation_items & checkpoint_items
    failed_results = [
        event for event in tool_results.values() if bool(event.data.get("failed"))
    ]
    unresolved_tools = set(tool_calls) - set(tool_results)
    approvals_requested = _count(turn_events, "approval_required")
    approvals_resolved = _count(turn_events, "approval_resolved")
    errors = _count(turn_events, "error")
    completed = any(event.type == "done" for event in turn_events)

    checks = [
        _check(
            "turn-completed",
            "Turn completed",
            completed and errors == 0,
            "A done event was persisted without a session error."
            if completed and errors == 0
            else "The current turn has not completed cleanly.",
        ),
        _check(
            "tools-resolved",
            "Tool calls resolved",
            not unresolved_tools,
            "Every tool call has a matching result."
            if not unresolved_tools
            else f"{len(unresolved_tools)} tool call(s) have no result.",
        ),
        _check(
            "no-tool-failures",
            "No tool failures",
            not failed_results,
            "No tool execution failed."
            if not failed_results
            else f"{len(failed_results)} tool execution(s) failed.",
        ),
        _check(
            "mutation-checkpoints",
            "Workspace mutations protected",
            protected_mutations == mutation_items,
            "Every file mutation has a restore checkpoint."
            if mutation_items and protected_mutations == mutation_items
            else "No workspace mutations were requested."
            if not mutation_items
            else f"{len(mutation_items - protected_mutations)} mutation(s) lack a checkpoint.",
        ),
        _check(
            "approvals-resolved",
            "Approvals resolved",
            approvals_resolved >= approvals_requested,
            "Every requested approval has a persisted decision."
            if approvals_resolved >= approvals_requested
            else f"{approvals_requested - approvals_resolved} approval(s) are unresolved.",
        ),
    ]
    passed_checks = sum(1 for check in checks if check["passed"])
    return {
        "sessionId": session.session_id,
        "state": session.state.value,
        "completed": completed,
        "toolCalls": len(tool_calls),
        "toolFailures": len(failed_results),
        "unresolvedTools": len(unresolved_tools),
        "approvalsRequested": approvals_requested,
        "approvalsResolved": approvals_resolved,
        "checkpoints": _count(turn_events, "checkpoint_created"),
        "compactions": _count(turn_events, "context_compacted"),
        "diffs": _count(turn_events, "diff"),
        "errors": errors,
        "mutationCalls": len(mutation_items),
        "protectedMutations": len(protected_mutations),
        "passedChecks": passed_checks,
        "totalChecks": len(checks),
        "checks": checks,
    }


def _event_item_id(event: AgentEvent) -> str:
    value = event.data.get("itemId")
    return value if isinstance(value, str) else ""


def _latest_turn_events(events: list[AgentEvent]) -> list[AgentEvent]:
    for index in range(len(events) - 1, -1, -1):
        if events[index].type == "user_message":
            return events[index:]
    return events


def _count(events: list[AgentEvent], event_type: str) -> int:
    return sum(1 for event in events if event.type == event_type)


def _check(identifier: str, label: str, passed: bool, detail: str) -> dict[str, Any]:
    return {
        "id": identifier,
        "label": label,
        "passed": passed,
        "detail": detail,
    }
