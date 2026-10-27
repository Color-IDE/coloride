from types import SimpleNamespace

import pytest

from coloride_desktop.agents.domain import AgentMode, AgentSession
from coloride_desktop.agents.tools import RemoteWorkspaceTools, ToolRisk
from coloride_desktop.git.safe_deploy import SafeGitDeployService
from coloride_desktop.profiles.store import (
    ConnectionProfile,
    default_production_capabilities,
    normalize_production_runtime,
)
from coloride_desktop.ssh.restricted import (
    COLORIDE_SYNC_HELPER,
    is_safe_workspace_path,
    safe_workspace_path_for,
    sync_helper_script,
)


class FakeFiles:
    mode = "ssh"

    def __init__(self, paths: dict[str, str] | None = None) -> None:
        self.paths = paths or {}

    async def realpath(self, path: str) -> str:
        return self.paths.get(path, path)

    async def exists(self, path: str) -> bool:
        return True

    async def stat_path(self, path: str) -> dict[str, str]:
        return {"kind": "dir"}

    async def read(self, path: str):
        raise FileNotFoundError(path)


class FakeRunner:
    def __init__(self) -> None:
        self.commands: list[str] = []

    async def __call__(self, command: str):
        self.commands.append(command)
        return SimpleNamespace(exit_status=0, stdout="OK", stderr="")


def test_opening_any_vps_folder_uses_coloride_home() -> None:
    live = "/home/user/project"
    work = safe_workspace_path_for(live)
    assert work == "/home/coloride/workspaces/project"
    assert is_safe_workspace_path(work)
    assert not is_safe_workspace_path(live)


def test_safe_workspace_is_never_the_live_tree() -> None:
    live = "/var/www/my-api"
    work = safe_workspace_path_for(live)
    assert work == "/home/coloride/workspaces/my-api"
    assert is_safe_workspace_path(work)
    assert not is_safe_workspace_path(live)


@pytest.mark.asyncio
async def test_deploy_rejects_non_production_destination() -> None:
    service = SafeGitDeployService(FakeRunner())
    with pytest.raises(RuntimeError, match="/var/www"):
        await service.deploy_commit("/home/coloride/workspaces/my-api")


@pytest.mark.asyncio
async def test_agent_can_work_in_the_selected_live_folder() -> None:
    async def resolver(_session: AgentSession) -> dict[str, object]:
        return {
            "productionPath": "/var/www/my-api",
            "workspacePath": "/home/coloride/workspaces/my-api",
            "access": "always-ask",
            "capabilities": default_production_capabilities(),
            "runtime": normalize_production_runtime({}),
        }

    tools = RemoteWorkspaceTools(files=FakeFiles(), run_command=FakeRunner())
    tools.bind_production(resolver=resolver, controller=None)
    session = AgentSession.create(
        agent="coloride",
        cwd="/home/coloride/workspaces/my-api",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
    )
    result = await tools._execute_change_workspace({"path": "/var/www/my-api"}, session)
    assert session.cwd == "/var/www/my-api"
    assert "Workspace changed" in result.output
    assert "connected Linux user" in result.output


def test_agent_does_not_expose_production_deploy_tools() -> None:
    from coloride_desktop.agents.tools import DEFINITIONS_BY_NAME

    assert "deploy_application" not in DEFINITIONS_BY_NAME
    assert "restart_application" not in DEFINITIONS_BY_NAME
    assert "get_application_logs" not in DEFINITIONS_BY_NAME
    assert "check_application_health" not in DEFINITIONS_BY_NAME
    assert DEFINITIONS_BY_NAME["write_file"].risk is not ToolRisk.PRODUCTION
    assert DEFINITIONS_BY_NAME["execute_command"].risk is not ToolRisk.PRODUCTION


def test_production_access_defaults_to_always_ask() -> None:
    profile = ConnectionProfile(id="prof_x", name="box", host="example.test")
    assert profile.production_access == "always-ask"
    assert profile.production_capabilities["deploy"] is True
    assert profile.production_runtime["kind"] == "none"


def test_sync_helper_is_not_a_generic_copy() -> None:
    script = sync_helper_script()
    assert COLORIDE_SYNC_HELPER.endswith("sync-release")
    assert "/home/coloride/workspaces/" in script
    assert "/var/www/" in script
    assert ".coloride-source" in script
    assert "PROJECT_BINDING_MISMATCH" in script
    assert "SOURCE_NOT_WORKSPACE" in script
    assert "DEST_NOT_PRODUCTION" in script


@pytest.mark.asyncio
async def test_deploy_refuses_dirty_workspace() -> None:
    class StatusService(SafeGitDeployService):
        async def status(self, production_path: str):
            from coloride_desktop.git.safe_deploy import GitSafeStatus

            return GitSafeStatus(
                production_path=production_path,
                workspace_path="/home/coloride/workspaces/my-api",
                ready=True,
                is_git_repo=True,
                branch="coloride/work",
                production_commit="aaa1111",
                workspace_commit="bbb2222",
                dirty=True,
                files_changed=2,
                insertions=4,
                deletions=1,
                ahead=1,
                behind=0,
                can_deploy=False,
            )

    service = StatusService(FakeRunner())
    with pytest.raises(RuntimeError, match="Commit workspace"):
        await service.deploy_commit("/var/www/my-api")


@pytest.mark.asyncio
async def test_deploy_refuses_production_drift() -> None:
    class StatusService(SafeGitDeployService):
        async def status(self, production_path: str):
            from coloride_desktop.git.safe_deploy import GitSafeStatus

            return GitSafeStatus(
                production_path=production_path,
                workspace_path="/home/coloride/workspaces/my-api",
                ready=True,
                is_git_repo=True,
                branch="coloride/work",
                production_commit="aaa1111",
                workspace_commit="bbb2222",
                dirty=False,
                files_changed=0,
                insertions=0,
                deletions=0,
                ahead=1,
                behind=0,
                can_deploy=False,
                drift=True,
            )

    service = StatusService(FakeRunner())
    with pytest.raises(RuntimeError, match="drift"):
        await service.deploy_commit("/var/www/my-api")


@pytest.mark.asyncio
async def test_rollback_only_redeploys_known_production_commits() -> None:
    class HistoryService(SafeGitDeployService):
        async def list_deployed_commits(self, production_path: str):
            return ("ccc3333", "bbb2222", "aaa1111")

        async def deploy_commit(self, production_path, commit=None, **kwargs):
            return SimpleNamespace(commit=commit, kwargs=kwargs)

    service = HistoryService(FakeRunner())
    result = await service.rollback("/var/www/my-api")
    assert result.commit == "bbb2222"
    assert result.kwargs["ignore_drift"] is True
    assert result.kwargs["allow_dirty"] is True

    with pytest.raises(RuntimeError, match="already promoted"):
        await service.rollback("/var/www/my-api", "deadbeef")


def test_full_access_is_not_automatic_production_access() -> None:
    profile = ConnectionProfile(
        id="prof_full",
        name="box",
        host="example.test",
        production_access="always-ask",
    )
    assert profile.production_access == "always-ask"
    assert profile.production_capabilities["pm2"] is False
    assert profile.production_capabilities["restart"] is False
