from __future__ import annotations

from coloride_desktop.agents.loop_detect import (
    AgentLoopDetector,
    fingerprint_action,
    fingerprint_result,
)
from coloride_desktop.agents.task import ProgressState


def test_equivalent_fingerprints_remove_runtime_noise_and_workspace_prefix() -> None:
    first = fingerprint_result(
        "\x1b[31mError at /srv/app/src/a.ts pid=123 2026-08-27T10:20:30Z\x1b[0m",
        workspace="/srv/app",
    )
    second = fingerprint_result(
        "Error at /srv/app/src/a.ts pid=998 2026-08-27T11:21:31Z",
        workspace="/srv/app",
    )
    assert first.value == second.value

    action_a = fingerprint_action(
        "execute_command",
        {"command": "npm test", "cwd": "/srv/app"},
        workspace="/srv/app",
    )
    action_b = fingerprint_action(
        "execute_command",
        {"cwd": "/srv/app", "command": "npm   test"},
        workspace="/srv/app",
    )
    assert action_a.value == action_b.value


def test_repeated_identical_read_soft_replans_without_round_limit() -> None:
    detector = AgentLoopDetector()
    args = {"path": "/srv/app/main.py"}
    first = detector.observe("read_file", args, output="same", workspace="/srv/app")
    second = detector.observe("read_file", args, output="same", workspace="/srv/app")
    third = detector.observe("read_file", args, output="same", workspace="/srv/app")
    assert first.observation.made_progress
    assert second.action == "CONTINUE"
    assert third.action == "SOFT_REPLAN"
    assert detector.note_iteration(10_000) == []


def test_more_than_thirty_distinct_progressing_calls_keep_running() -> None:
    detector = AgentLoopDetector()
    for index in range(35):
        assessment = detector.observe(
            "read_file",
            {"path": f"/srv/app/src/file-{index}.ts"},
            output=f"export const value{index} = {index}",
            workspace="/srv/app",
        )
        assert assessment.action == "CONTINUE"
        assert assessment.observation.made_progress
    assert detector.progress.progress_events == 35
    assert detector.progress.no_progress_iterations == 0


def test_changing_failed_paths_and_errors_cannot_fake_progress() -> None:
    detector = AgentLoopDetector()
    actions = []
    for index in range(12):
        assessment = detector.observe(
            "read_file",
            {"path": f"missing-{index}.py"},
            error=f"File does not exist: missing-{index}.py",
        )
        assert not assessment.observation.made_progress
        actions.append(assessment.action)
    assert "SOFT_REPLAN" in actions
    assert "HARD_TRAJECTORY_STOP" in actions


def test_test_failure_reduction_is_real_progress_and_recovers_score() -> None:
    state = ProgressState(loop_score=8, no_progress_iterations=4, last_test_failures=8)
    detector = AgentLoopDetector(state)
    assessment = detector.observe(
        "execute_command",
        {"command": "npm test"},
        output="Tests: 3 failed, 20 passed",
    )
    assert assessment.observation.made_progress
    assert "tests_improved" in assessment.observation.progress_reasons
    assert assessment.loop_score < 8
    assert assessment.no_progress_iterations == 0


def test_known_diff_and_reversion_do_not_count_as_new_progress() -> None:
    detector = AgentLoopDetector()
    args = {"path": "src/a.ts", "content": "changed"}
    first = detector.observe("write_file", args, diff="@@ +changed")
    repeated = detector.observe("write_file", args, diff="@@ +changed")
    reverted = detector.observe("write_file", args, diff="@@ -changed")
    repeated_reversion = detector.observe("write_file", args, diff="@@ +changed")
    assert "diff_changed" in first.observation.progress_reasons
    assert "known_diff" in repeated.observation.duplicate_reasons
    assert "diff_changed" in reverted.observation.progress_reasons
    assert "known_diff" in repeated_reversion.observation.duplicate_reasons


def test_hard_stop_requires_post_replan_failures_and_rejects_first_repeated_action() -> None:
    detector = AgentLoopDetector()
    args = {"command": "npm test", "cwd": "/srv/app"}
    actions: list[str] = []
    for _ in range(8):
        assessment = detector.observe(
            "execute_command",
            args,
            output="Tests: 5 failed",
            workspace="/srv/app",
        )
        actions.append(assessment.action)
        if assessment.action == "HARD_TRAJECTORY_STOP":
            break
    assert "SOFT_REPLAN" in actions
    assert actions[-1] == "HARD_TRAJECTORY_STOP"

    previous_strategy = detector.progress.strategy_id
    detector.abandon_strategy()
    assert detector.progress.strategy_id == previous_strategy + 1
    assert detector.reject_abandoned_first_action(
        "execute_command", args, workspace="/srv/app"
    )
    assert not detector.reject_abandoned_first_action(
        "execute_command", args, workspace="/srv/app"
    )


def test_progress_state_round_trips_without_raw_commands_or_results() -> None:
    detector = AgentLoopDetector()
    detector.observe(
        "execute_command",
        {"command": "curl -H 'Authorization: secret-value' https://example.test"},
        output="token=secret-value Error pid=42",
        error="password=hunter2",
    )
    serialized = detector.progress.to_dict()
    text = str(serialized)
    assert "curl" not in text
    assert "secret-value" not in text
    assert "hunter2" not in text
    assert ProgressState.from_dict(serialized).to_dict() == serialized


def test_replan_state_survives_restart_and_supersedes_repetitive_outputs() -> None:
    detector = AgentLoopDetector()
    args = {"path": "src/a.ts"}
    detector.observe("read_file", args, output="same", metadata={"callId": "call-1"})
    detector.observe("read_file", args, output="same", metadata={"callId": "call-2"})
    soft = detector.observe(
        "read_file", args, output="same", metadata={"callId": "call-3"}
    )
    assert soft.action == "SOFT_REPLAN"

    restored = AgentLoopDetector(ProgressState.from_dict(detector.progress.to_dict()))
    hard = restored.observe(
        "read_file", args, output="same", metadata={"callId": "call-4"}
    )
    if hard.action != "HARD_TRAJECTORY_STOP":
        hard = restored.observe(
            "read_file", args, output="same", metadata={"callId": "call-5"}
        )
    assert hard.action == "HARD_TRAJECTORY_STOP"
    restored.abandon_strategy()
    assert restored.progress.superseded_call_ids
