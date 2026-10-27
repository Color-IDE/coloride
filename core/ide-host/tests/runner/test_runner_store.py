from __future__ import annotations

from coloride_desktop.runner.store import RunnerStore


def test_runner_events_are_ordered_and_survive_reopen(tmp_path):
    store = RunnerStore(tmp_path / "runner")
    job = store.create_job(
        job_id="job_1",
        session_id="sess_1",
        workspace="/srv/app",
        model="grok-4.5",
        payload={"jobToken": "scoped-token"},
    )
    store.append_event(job.job_id, "text", {"text": "hello"})
    store.close()

    restored = RunnerStore(tmp_path / "runner")
    events = restored.events("job_1")
    assert [event["sequence"] for event in events] == [1, 2]
    assert events[-1]["data"] == {"text": "hello"}
    assert restored.get_job("job_1").payload == {"jobToken": "scoped-token"}
    restored.close()


def test_runner_stalls_after_three_identical_no_progress_operations(tmp_path):
    store = RunnerStore(tmp_path / "runner")
    store.create_job(
        job_id="job_1", session_id="sess_1", workspace="/srv/app", model="grok-4.5", payload={}
    )
    operation = {"tool": "read_file", "arguments": {"path": "/srv/app/a.py"}, "result": {"text": "same"}}
    assert not store.record_operation("job_1", **operation, state_changed=False)
    assert not store.record_operation("job_1", **operation, state_changed=False)
    assert store.record_operation("job_1", **operation, state_changed=False)
    assert store.get_job("job_1").state == "stalled"
    assert "three identical" in (store.get_job("job_1").stop_reason or "")
    store.close()


def test_runner_progress_resets_the_loop_guard(tmp_path):
    store = RunnerStore(tmp_path / "runner")
    store.create_job(
        job_id="job_1", session_id="sess_1", workspace="/srv/app", model="grok-4.5", payload={}
    )
    operation = {"tool": "read_file", "arguments": {"path": "/srv/app/a.py"}, "result": {"text": "same"}}
    store.record_operation("job_1", **operation, state_changed=False)
    store.record_operation("job_1", **operation, state_changed=True)
    assert not store.record_operation("job_1", **operation, state_changed=False)
    assert store.get_job("job_1").state == "running_remote"
    store.close()
