from types import SimpleNamespace

import pytest

from coloride_desktop.ssh.restricted import (
    DEFAULT_ALLOWED_ROOTS,
    DEFAULT_BROWSE_ROOTS,
    isolated_workspace_copy_script,
    is_ancestor_of_roots,
    is_path_under_roots,
    is_safe_workspace_path,
    normalize_remote_root,
    path_allowed_for_restricted,
    path_is_writable_restricted,
    prepare_isolated_workspace,
    safe_workspace_path_for,
    server_filesystem_anchors,
    workspace_copy_exclude_names,
)


def test_normalize_remote_root() -> None:
    assert normalize_remote_root("/var/www/my-project/") == "/var/www/my-project"
    assert normalize_remote_root("/") == "/"


@pytest.mark.parametrize(
    "path",
    ["/var/www/app/../../etc", "/var/www/../secret", "/home/coloride/.."],
)
def test_normalize_remote_root_rejects_parent_traversal(path: str) -> None:
    with pytest.raises(ValueError, match="parent traversal"):
        normalize_remote_root(path)

    assert not is_path_under_roots(path, ["/var/www/app", "/home/coloride"])


def test_default_roots_do_not_include_all_var_www() -> None:
    assert "/var/www" not in DEFAULT_ALLOWED_ROOTS
    assert any(root.endswith("/coloride") or "/home/coloride" in root for root in DEFAULT_ALLOWED_ROOTS)
    assert "/var/www" in DEFAULT_BROWSE_ROOTS
    assert "/srv" in DEFAULT_BROWSE_ROOTS
    assert "/opt" in DEFAULT_BROWSE_ROOTS


def test_is_path_under_roots_allows_descendants() -> None:
    roots = ["/home/coloride", "/var/www/my-app"]
    assert is_path_under_roots("/var/www/my-app", roots)
    assert is_path_under_roots("/var/www/my-app/app/page.tsx", roots)
    assert is_path_under_roots("/home/coloride", roots)
    assert not is_path_under_roots("/var/www/other-app", roots)
    assert not is_path_under_roots("/var/www", roots)


def test_is_path_under_roots_blocks_outside() -> None:
    roots = ["/home/coloride", "/tmp/coloride"]
    assert not is_path_under_roots("/etc/passwd", roots)
    assert not is_path_under_roots("/root", roots)
    assert not is_path_under_roots("/var/www/secret", roots)


def test_browse_var_www_read_only_until_project_granted() -> None:
    allowed = list(DEFAULT_ALLOWED_ROOTS)
    browse = list(DEFAULT_BROWSE_ROOTS)

    # Can list /var/www to pick an app, but cannot write there.
    assert path_allowed_for_restricted("/var/www", allowed_roots=allowed, browse_roots=browse, mutate=False)
    assert path_allowed_for_restricted(
        "/var/www/other-site",
        allowed_roots=allowed,
        browse_roots=browse,
        mutate=False,
    )
    assert not path_allowed_for_restricted(
        "/var/www/other-site/index.html",
        allowed_roots=allowed,
        browse_roots=browse,
        mutate=True,
    )

    # After granting the specific project, writes work only there.
    allowed_with_app = [*allowed, "/var/www/my-app"]
    assert path_allowed_for_restricted(
        "/var/www/my-app/src/page.tsx",
        allowed_roots=allowed_with_app,
        browse_roots=browse,
        mutate=True,
    )
    assert not path_allowed_for_restricted(
        "/var/www/other-site/src/page.tsx",
        allowed_roots=allowed_with_app,
        browse_roots=browse,
        mutate=True,
    )


def test_ancestor_listing_toward_granted_project() -> None:
    allowed = ["/var/www/my-app"]
    assert is_ancestor_of_roots("/var/www", allowed)
    assert is_ancestor_of_roots("/", allowed)
    assert not is_ancestor_of_roots("/var/log", allowed)


def test_server_filesystem_anchors_are_top_level() -> None:
    allowed = list(DEFAULT_ALLOWED_ROOTS) + ["/var/www/my-app"]
    browse = list(DEFAULT_BROWSE_ROOTS)
    anchors = server_filesystem_anchors(allowed_roots=allowed, browse_roots=browse)
    assert "/var/www" in anchors
    assert "/srv" in anchors
    assert "/opt" in anchors
    assert "/home/coloride" in anchors
    assert "/tmp/coloride" in anchors
    # Granted project under browse root is not a separate top-level anchor.
    assert "/var/www/my-app" not in anchors


def test_writable_only_under_allowed_roots() -> None:
    allowed = list(DEFAULT_ALLOWED_ROOTS) + ["/var/www/my-app"]
    assert path_is_writable_restricted("/var/www/my-app/src", allowed_roots=allowed)
    assert path_is_writable_restricted("/home/coloride/notes", allowed_roots=allowed)
    assert not path_is_writable_restricted("/var/www/other", allowed_roots=allowed)
    assert not path_is_writable_restricted("/etc", allowed_roots=allowed)


def test_production_workspace_is_under_coloride_home_not_var_www() -> None:
    assert safe_workspace_path_for("/var/www/my-app") == "/home/coloride/workspaces/my-app"
    assert is_safe_workspace_path("/home/coloride/workspaces/my-app")
    assert is_safe_workspace_path("/home/coloride/workspace/my-app")
    assert not is_safe_workspace_path("/var/www/my-app")


@pytest.mark.asyncio
async def test_existing_safe_workspace_repairs_ownership_before_success() -> None:
    commands: list[str] = []

    class FakeConnection:
        async def run(self, command: str, *, check: bool = False):
            commands.append(command)
            return SimpleNamespace(exit_status=0, stdout="", stderr="")

    path = await prepare_isolated_workspace(FakeConnection(), "/var/www/my-app")

    assert path == "/home/coloride/workspaces/my-app"
    script = commands[0]
    marker_match = script.index('if [ -f "$MARKER" ]')
    success = script.index("exit 0", marker_match)
    assert marker_match < success
    existing = script[marker_match:success]
    assert "chown -R" not in existing
    assert "cp -a" not in existing
    assert "rsync" not in existing


def test_isolated_copy_skips_generated_and_vendor_trees() -> None:
    script = isolated_workspace_copy_script(
        source="/var/www/my-app",
        work="/home/coloride/workspaces/my-app",
        legacy="/home/coloride/workspace/my-app",
        marker="/home/coloride/workspaces/my-app/.coloride-source",
    )
    names = workspace_copy_exclude_names()
    assert "node_modules" in names
    assert ".venv" in names
    assert ".next" in names
    assert "vendor" in names
    assert "dist" in names
    assert "build" in names
    assert "target" in names
    for name in ("node_modules", ".venv", ".next", "vendor", "dist", "build"):
        assert f"--exclude={name}" in script
        assert f"-name {name}" in script or f"-name '{name}'" in script
    assert "cp -a \"$SOURCE\"/." not in script
    assert "rsync -a --no-owner --no-group" in script


def test_isolated_copy_script_skips_vendor_trees_on_disk(tmp_path) -> None:
    import os
    import subprocess

    source = tmp_path / "live"
    work = tmp_path / "workspaces" / "app"
    (source / "src").mkdir(parents=True)
    (source / "src" / "index.ts").write_text("export const n = 1;\n", encoding="utf-8")
    (source / "package.json").write_text('{"name":"app"}\n', encoding="utf-8")
    (source / "package-lock.json").write_text("{}\n", encoding="utf-8")
    (source / "node_modules" / "left-pad").mkdir(parents=True)
    (source / "node_modules" / "left-pad" / "index.js").write_text("module.exports=1\n", encoding="utf-8")
    (source / ".venv" / "lib").mkdir(parents=True)
    (source / ".venv" / "lib" / "site.py").write_text("print(1)\n", encoding="utf-8")
    (source / ".next" / "cache").mkdir(parents=True)
    (source / ".next" / "cache" / "x").write_text("x", encoding="utf-8")
    (source / "dist").mkdir()
    (source / "dist" / "bundle.js").write_text("ok", encoding="utf-8")

    script = isolated_workspace_copy_script(
        source=str(source),
        work=str(work),
        legacy=str(tmp_path / "legacy"),
        marker=str(work / ".coloride-source"),
        root=str(tmp_path / "workspaces"),
    )
    env = os.environ.copy()
    env["PATH"] = "/usr/bin:/bin"
    completed = subprocess.run(
        ["bash", "-lc", script],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )
    assert completed.returncode == 0, completed.stderr + completed.stdout
    assert (work / "src" / "index.ts").is_file()
    assert (work / "package.json").is_file()
    assert (work / "package-lock.json").is_file()
    assert not (work / "node_modules").exists()
    assert not (work / ".venv").exists()
    assert not (work / ".next").exists()
    assert not (work / "dist").exists()
    assert (work / ".coloride-source").read_text(encoding="utf-8") == str(source)
