from __future__ import annotations

import shlex
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from ..ssh.restricted import (
    COLORIDE_SYNC_HELPER,
    SAFE_WORKSPACE_ROOT,
    is_safe_workspace_path,
    normalize_remote_root,
    safe_workspace_path_for,
)

RunCommand = Callable[[str], Awaitable[Any]]

WORKSPACES_ROOT = SAFE_WORKSPACE_ROOT


def _workspace_path_for(production_path: str) -> str:
    return safe_workspace_path_for(production_path)


@dataclass(frozen=True, slots=True)
class GitChangedFile:
    path: str
    status: str  # M | A | D | U | R | ?
    insertions: int
    deletions: int


@dataclass(frozen=True, slots=True)
class GitSafeStatus:
    production_path: str
    workspace_path: str
    ready: bool
    is_git_repo: bool
    branch: str | None
    production_commit: str | None
    workspace_commit: str | None
    dirty: bool
    files_changed: int
    insertions: int
    deletions: int
    ahead: int
    behind: int
    can_deploy: bool
    message: str | None = None
    files: tuple[GitChangedFile, ...] = ()
    last_deploy_commit: str | None = None
    last_deploy_status: str | None = None
    health: str | None = None
    drift: bool = False
    deployed_commits: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DeployStep:
    id: str
    label: str
    ok: bool
    detail: str = ""


@dataclass(frozen=True, slots=True)
class DeployResult:
    status: GitSafeStatus
    commit: str
    steps: tuple[DeployStep, ...] = ()
    health_ok: bool | None = None
    needs_rollback: bool = False
    message: str | None = None


class SafeGitDeployService:
    """
    Isolated Git workspaces under /home/coloride/workspaces.

    - Agent edits only the workspace copy (writable).
    - Production stays read-only for the restricted user.
    - Deploy uses a narrow privileged path (sudo when available).
    """

    def __init__(self, run_command: RunCommand) -> None:
        self._run = run_command

    async def _sh(self, script: str) -> tuple[int, str, str]:
        result = await self._run(f"bash -lc {shlex.quote(script)}")
        code = int(getattr(result, "exit_status", 1) or 0)
        out = (getattr(result, "stdout", None) or "")
        err = (getattr(result, "stderr", None) or "")
        if isinstance(out, bytes):
            out = out.decode("utf-8", errors="replace")
        if isinstance(err, bytes):
            err = err.decode("utf-8", errors="replace")
        return code, str(out).strip(), str(err).strip()

    async def ensure_workspace(self, production_path: str) -> GitSafeStatus:
        prod = normalize_remote_root(production_path)
        work = _workspace_path_for(prod)
        workspaces = WORKSPACES_ROOT

        # Prepare isolated workspace from production (read production, write only under home).
        script = f"""
set -euo pipefail
PROD={shlex.quote(prod)}
WORK={shlex.quote(work)}
ROOT={shlex.quote(workspaces)}
mkdir -p "$ROOT"
if [ ! -d "$PROD" ]; then
  echo "PRODUCTION_MISSING"
  exit 12
fi
if [ ! -d "$WORK/.git" ]; then
  rm -rf "$WORK"
  if [ -d "$PROD/.git" ]; then
    # Prefer local clone so history is preserved without network.
    git clone --local "$PROD" "$WORK" 2>/dev/null || git clone "$PROD" "$WORK"
  else
    mkdir -p "$WORK"
    # Seed files without requiring git on production.
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --exclude node_modules --exclude .next --exclude dist --exclude build "$PROD"/ "$WORK"/
    else
      cp -a "$PROD"/. "$WORK"/ 2>/dev/null || true
    fi
    cd "$WORK"
    git init -b main >/dev/null 2>&1 || git init >/dev/null 2>&1
    git config user.email "coloride@local" >/dev/null 2>&1 || true
    git config user.name "Coloride" >/dev/null 2>&1 || true
    git add -A >/dev/null 2>&1 || true
    git commit -m "coloride: initial workspace snapshot" --allow-empty >/dev/null 2>&1 || true
  fi
fi
printf '%s' "$PROD" > "$WORK/.coloride-source"
# Branch for agent work when on a detached or main branch.
cd "$WORK"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 13
CUR=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)
if [ "$CUR" = "HEAD" ] || [ "$CUR" = "main" ] || [ "$CUR" = "master" ]; then
  BR="coloride/work-$(date +%Y%m%d-%H%M%S)"
  git checkout -B "$BR" >/dev/null 2>&1 || git checkout -b "$BR" >/dev/null 2>&1 || true
fi
echo "OK"
"""
        code, out, err = await self._sh(script)
        if code != 0 and "OK" not in out:
            msg = err or out or "Could not prepare Git workspace"
            if "PRODUCTION_MISSING" in out or "PRODUCTION_MISSING" in err:
                msg = f"Production path not found: {prod}"
            return GitSafeStatus(
                production_path=prod,
                workspace_path=work,
                ready=False,
                is_git_repo=False,
                branch=None,
                production_commit=None,
                workspace_commit=None,
                dirty=False,
                files_changed=0,
                insertions=0,
                deletions=0,
                ahead=0,
                behind=0,
                can_deploy=False,
                message=msg,
            )
        return await self.status(prod)

    async def status(self, production_path: str) -> GitSafeStatus:
        prod = normalize_remote_root(production_path)
        work = _workspace_path_for(prod)
        script = f"""
set +e
PROD={shlex.quote(prod)}
WORK={shlex.quote(work)}
if [ ! -d "$WORK/.git" ]; then
  printf 'ready=0\\n'
  exit 0
fi
cd "$WORK" || exit 0
BR=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
WC=$(git rev-parse --short HEAD 2>/dev/null)
DIRTY=0
git diff --quiet 2>/dev/null; D1=$?
git diff --cached --quiet 2>/dev/null; D2=$?
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | head -1)
if [ "$D1" != "0" ] || [ "$D2" != "0" ] || [ -n "$UNTRACKED" ]; then DIRTY=1; fi
STAT=$(git diff --shortstat HEAD 2>/dev/null)
# Also count unstaged+staged vs HEAD
if [ -z "$STAT" ]; then
  STAT=$(git diff --shortstat 2>/dev/null)
fi
FILES=$(echo "$STAT" | sed -n 's/.*\\([0-9][0-9]*\\) file.*/\\1/p')
INS=$(echo "$STAT" | sed -n 's/.*\\([0-9][0-9]*\\) insertion.*/\\1/p')
DEL=$(echo "$STAT" | sed -n 's/.*\\([0-9][0-9]*\\) deletion.*/\\1/p')
[ -z "$FILES" ] && FILES=0
[ -z "$INS" ] && INS=0
[ -z "$DEL" ] && DEL=0
PC=""
if [ -d "$PROD/.git" ]; then
  PC=$(git -C "$PROD" rev-parse --short HEAD 2>/dev/null)
elif [ -f "$PROD/.coloride-deploy-commit" ]; then
  PC=$(cat "$PROD/.coloride-deploy-commit" 2>/dev/null | head -c 40)
fi
HIST="$WORK/.coloride/deploy-history"
LAST=""
STATUS=""
DRIFT=0
if [ -f "$HIST" ]; then
  LAST=$(awk -F'\\t' 'NF {{ print $1; exit }}' "$HIST" 2>/dev/null)
  STATUS=$(awk -F'\\t' 'NF {{ print $3; exit }}' "$HIST" 2>/dev/null)
fi
[ -z "$PC" ] && PC="$LAST"
if [ -n "$LAST" ] && [ -n "$PC" ] && [ "$LAST" != "$PC" ] && [ "${{LAST#${{PC}}}}" = "$LAST" ] && [ "${{PC#${{LAST}}}}" = "$PC" ]; then
  DRIFT=1
fi
AHEAD=0
BEHIND=0
if [ -n "$PC" ] && git cat-file -e "$PC" 2>/dev/null; then
  AHEAD=$(git rev-list --count "$PC"..HEAD 2>/dev/null || echo 0)
  BEHIND=$(git rev-list --count HEAD.."$PC" 2>/dev/null || echo 0)
fi
CAN=0
if [ "$DIRTY" = "0" ] && [ -n "$WC" ] && [ "$WC" != "$PC" ]; then CAN=1; fi
if [ "$DIRTY" = "0" ] && [ -n "$WC" ] && [ -z "$PC" ]; then CAN=1; fi
printf 'ready=1\\nis_git=1\\nbranch=%s\\nwork=%s\\nprod=%s\\ndirty=%s\\nfiles=%s\\nins=%s\\ndel=%s\\nahead=%s\\nbehind=%s\\ncan=%s\\nlast=%s\\nstatus=%s\\ndrift=%s\\n' \
  "$BR" "$WC" "$PC" "$DIRTY" "$FILES" "$INS" "$DEL" "$AHEAD" "$BEHIND" "$CAN" "$LAST" "$STATUS" "$DRIFT"
"""
        _code, out, _err = await self._sh(script)
        data: dict[str, str] = {}
        for line in out.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                data[k.strip()] = v.strip()

        ready = data.get("ready") == "1"
        dirty = data.get("dirty") == "1"
        files = int(data.get("files") or 0)
        # If dirty but shortstat empty, still mark as changed.
        if dirty and files == 0:
            files = 1

        changed = await self.list_changes(prod) if ready else ()
        total_ins = sum(f.insertions for f in changed) or int(data.get("ins") or 0)
        total_del = sum(f.deletions for f in changed) or int(data.get("del") or 0)
        file_count = len(changed) if changed else files
        if dirty and file_count == 0:
            file_count = 1
        deployed = await self.list_deployed_commits(prod) if ready else ()
        last_deploy = data.get("last") or None
        drift = data.get("drift") == "1"

        return GitSafeStatus(
            production_path=prod,
            workspace_path=work,
            ready=ready,
            is_git_repo=data.get("is_git") == "1" or ready,
            branch=data.get("branch") or None,
            production_commit=data.get("prod") or last_deploy,
            workspace_commit=data.get("work") or None,
            dirty=dirty,
            files_changed=file_count,
            insertions=total_ins,
            deletions=total_del,
            ahead=int(data.get("ahead") or 0),
            behind=int(data.get("behind") or 0),
            can_deploy=data.get("can") == "1" and not dirty and not drift,
            message=(
                None
                if ready
                else "Git workspace not prepared yet."
            ) if not drift else "Production drift detected. Review live files before deploying.",
            files=changed,
            last_deploy_commit=last_deploy,
            last_deploy_status=data.get("status") or None,
            health=data.get("status") or None,
            drift=drift,
            deployed_commits=deployed,
        )

    async def list_changes(self, production_path: str) -> tuple[GitChangedFile, ...]:
        """Working tree changes in the isolated workspace (vs HEAD)."""
        prod = normalize_remote_root(production_path)
        work = _workspace_path_for(prod)
        script = f"""
set +e
cd {shlex.quote(work)} 2>/dev/null || exit 0
# name-status + numstat merged by path
git status --porcelain=v1 -uall 2>/dev/null | head -n 500
echo '---NUM---'
git diff --numstat HEAD 2>/dev/null | head -n 500
git diff --numstat --cached HEAD 2>/dev/null | head -n 500
"""
        _code, out, _err = await self._sh(script)
        if "---NUM---" not in out:
            return ()
        status_part, num_part = out.split("---NUM---", 1)
        stats: dict[str, tuple[int, int]] = {}
        for line in num_part.splitlines():
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            ins_s, del_s, path = parts[0], parts[1], parts[2]
            if path.startswith("{"):  # rename weirdness
                continue
            try:
                ins = 0 if ins_s == "-" else int(ins_s)
                dele = 0 if del_s == "-" else int(del_s)
            except ValueError:
                continue
            prev = stats.get(path, (0, 0))
            stats[path] = (prev[0] + ins, prev[1] + dele)

        files: list[GitChangedFile] = []
        seen: set[str] = set()
        for line in status_part.splitlines():
            if len(line) < 4:
                continue
            xy = line[:2]
            rest = line[3:]
            # renames: "R  old -> new"
            if " -> " in rest:
                rest = rest.split(" -> ", 1)[-1]
            path = rest.strip()
            if not path or path in seen:
                continue
            seen.add(path)
            code = (xy.strip() or "?")[0]
            if code in {" ", "?"}:
                code = "U" if "?" in xy else "M"
            if code == "?":
                code = "U"
            ins, dele = stats.get(path, (0, 0))
            files.append(GitChangedFile(path=path, status=code, insertions=ins, deletions=dele))

        # numstat-only paths (rare)
        for path, (ins, dele) in stats.items():
            if path in seen:
                continue
            files.append(GitChangedFile(path=path, status="M", insertions=ins, deletions=dele))

        files.sort(key=lambda f: f.path.lower())
        return tuple(files)

    async def list_deployed_commits(self, production_path: str) -> tuple[str, ...]:
        """Commits Coloride has actually promoted, newest first."""
        prod = normalize_remote_root(production_path)
        work = _workspace_path_for(prod)
        script = f"""
set +e
HIST={shlex.quote(work)}/.coloride/deploy-history
[ -f "$HIST" ] || exit 0
awk -F'\\t' 'NF {{ print $1 }}' "$HIST" | awk 'NF && !seen[$0]++' | head -n 20
"""
        _code, out, _err = await self._sh(script)
        return tuple(line.strip() for line in out.splitlines() if line.strip())

    async def _record_deployment(
        self,
        production_path: str,
        commit: str,
        status: str,
    ) -> None:
        prod = normalize_remote_root(production_path)
        work = _workspace_path_for(prod)
        stamp = status.strip()[:40] or "unknown"
        short = commit.strip()[:40]
        script = f"""
set -euo pipefail
WORK={shlex.quote(work)}
DIR="$WORK/.coloride"
HIST="$DIR/deploy-history"
mkdir -p "$DIR"
LINE=$(printf '%s\\t%s\\t%s\\n' {shlex.quote(short)} "$(date -u +%Y-%m-%dT%H:%M:%SZ)" {shlex.quote(stamp)})
if [ -f "$HIST" ]; then
  printf '%s\\n' "$LINE" | cat - "$HIST" > "$HIST.tmp"
  mv "$HIST.tmp" "$HIST"
else
  printf '%s\\n' "$LINE" > "$HIST"
fi
"""
        await self._sh(script)

    async def list_history(
        self,
        production_path: str,
        *,
        limit: int = 40,
    ) -> list[dict[str, str]]:
        """Recent commits in the workspace repo (newest first)."""
        prod = normalize_remote_root(production_path)
        work = _workspace_path_for(prod)
        n = max(1, min(int(limit), 100))
        # Use a rare delimiter so subject can contain spaces/pipes.
        sep = "\x1f"
        script = f"""
set +e
cd {shlex.quote(work)} 2>/dev/null || exit 0
git log -n {n} --format='%h{sep}%H{sep}%s{sep}%cr{sep}%an' 2>/dev/null
"""
        _code, out, _err = await self._sh(script)
        rows: list[dict[str, str]] = []
        for line in out.splitlines():
            parts = line.split(sep)
            if len(parts) < 5:
                continue
            rows.append(
                {
                    "short": parts[0].strip(),
                    "hash": parts[1].strip(),
                    "subject": parts[2].strip(),
                    "relative": parts[3].strip(),
                    "author": parts[4].strip(),
                }
            )
        return rows

    async def file_diff(self, production_path: str, file_path: str) -> str:
        """Unified diff for one path in the workspace (unstaged+staged vs HEAD)."""
        prod = normalize_remote_root(production_path)
        work = _workspace_path_for(prod)
        rel = file_path.lstrip("/")
        # Prevent path escape
        if ".." in rel.split("/"):
            raise RuntimeError("Invalid path")
        script = f"""
set +e
cd {shlex.quote(work)} || exit 1
# Prefer tracked diff; for untracked show as new file.
if git cat-file -e "HEAD:{rel}" 2>/dev/null; then
  git diff HEAD -- {shlex.quote(rel)}
  git diff --cached HEAD -- {shlex.quote(rel)}
else
  if [ -f {shlex.quote(rel)} ]; then
    git diff --no-index /dev/null {shlex.quote(rel)} 2>/dev/null | tail -n +3
  fi
fi
"""
        _code, out, err = await self._sh(script)
        return out or err or "(no changes)"

    async def commit_workspace(self, production_path: str, message: str) -> GitSafeStatus:
        prod = normalize_remote_root(production_path)
        work = _workspace_path_for(prod)
        msg = (message or "coloride: workspace changes").strip()[:200]
        script = f"""
set -euo pipefail
cd {shlex.quote(work)}
git config user.email "coloride@local" >/dev/null 2>&1 || true
git config user.name "Coloride" >/dev/null 2>&1 || true
git add -A
if git diff --cached --quiet; then
  echo "NO_CHANGES"
  exit 0
fi
git commit -m {shlex.quote(msg)}
echo "OK"
"""
        await self._sh(script)
        return await self.status(prod)

    async def deploy(
        self,
        production_path: str,
        commit: str | None = None,
        *,
        runtime: dict[str, str] | None = None,
        capabilities: dict[str, bool] | None = None,
    ) -> DeployResult:
        """Promote one workspace commit through the privileged deploy boundary."""
        return await self.deploy_commit(
            production_path,
            commit,
            runtime=runtime,
            capabilities=capabilities,
        )

    async def deploy_commit(
        self,
        production_path: str,
        commit: str | None = None,
        *,
        runtime: dict[str, str] | None = None,
        capabilities: dict[str, bool] | None = None,
        ignore_drift: bool = False,
        allow_dirty: bool = False,
    ) -> DeployResult:
        """Promote one workspace commit. Source must be the Coloride workspace."""
        prod = normalize_remote_root(production_path)
        if not prod.startswith("/var/www/"):
            raise RuntimeError("Production path must be a project inside /var/www.")
        work = _workspace_path_for(prod)
        if not is_safe_workspace_path(work):
            raise RuntimeError("Deploy source is not a Coloride-controlled workspace.")
        st = await self.status(prod)
        if not st.ready:
            raise RuntimeError(st.message or "Workspace not ready")
        if st.dirty and not allow_dirty:
            raise RuntimeError("Commit workspace changes before deploying.")
        if st.drift and not ignore_drift:
            raise RuntimeError(
                "Production drift detected. Live files no longer match the last Coloride deploy. "
                "Review production before overwriting it."
            )

        target = (commit or st.workspace_commit or "").strip()
        if not target:
            raise RuntimeError("No workspace commit to deploy.")
        caps = capabilities or {}
        if caps.get("deploy") is False:
            raise RuntimeError("Deploy is disabled for this Production workspace.")
        runtime = runtime or {}
        steps: list[DeployStep] = []
        helper = COLORIDE_SYNC_HELPER

        script = f"""
set -euo pipefail
PROD={shlex.quote(prod)}
WORK={shlex.quote(work)}
COMMIT={shlex.quote(target)}
HELPER={shlex.quote(helper)}
LOCK=/tmp/coloride-deploy-$(printf '%s' "$PROD" | tr '/ ' '__').lock
if [ ! -d "$WORK/.git" ]; then
  echo "SOURCE_NOT_WORKSPACE"
  exit 40
fi
if [ ! -d "$PROD" ]; then
  echo "PRODUCTION_MISSING"
  exit 41
fi
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  flock -n 9 || {{ echo "DEPLOY_LOCKED"; exit 43; }}
fi
MARKER="$WORK/.coloride-source"
if [ ! -f "$MARKER" ] || [ "$(cat "$MARKER")" != "$PROD" ]; then
  echo "PROJECT_BINDING_MISMATCH"
  exit 44
fi
if [ -x "$HELPER" ] && command -v sudo >/dev/null 2>&1; then
  sudo -n "$HELPER" "$WORK" "$PROD" "$COMMIT"
elif [ -w "$PROD" ] && [ -x "$HELPER" ]; then
  "$HELPER" "$WORK" "$PROD" "$COMMIT"
else
  echo "DEPLOY_NEEDS_PRIVILEGE"
  exit 42
fi
"""
        code, out, err = await self._sh(script)
        if code != 0:
            if "DEPLOY_NEEDS_PRIVILEGE" in out or code == 42:
                raise RuntimeError(
                    "Deploy needs the Coloride release helper. Reconnect once as an admin "
                    "so Coloride can install /usr/local/lib/coloride/sync-release. "
                    "Workspace is ready; production was not modified."
                )
            if "DEPLOY_LOCKED" in out:
                raise RuntimeError("Another deployment is already running for this project.")
            if "PROJECT_BINDING_MISMATCH" in out:
                raise RuntimeError("Workspace is not bound to this production path.")
            if "SOURCE_NOT_WORKSPACE" in out or "DEST_NOT_PRODUCTION" in out:
                raise RuntimeError("Deploy helper rejected this source or production path.")
            raise RuntimeError(err or out or "Deploy failed")
        short = ""
        for line in out.splitlines():
            if line.startswith("COMMIT="):
                short = line.split("=", 1)[1].strip()
        steps.append(DeployStep("sync", "Code deployed", True, short or target))

        build_command = (runtime.get("buildCommand") or "").strip()
        if build_command:
            build_code, build_out, build_err = await self._sh(
                f"cd {shlex.quote(prod)} && {build_command}"
            )
            ok = build_code == 0
            steps.append(
                DeployStep(
                    "build",
                    "Build completed" if ok else "Build failed",
                    ok,
                    (build_out or build_err)[-400:],
                )
            )
            if not ok:
                return DeployResult(
                    status=await self.status(prod),
                    commit=short or target,
                    steps=tuple(steps),
                    health_ok=None,
                    needs_rollback=True,
                    message="Build failed after the files were copied.",
                )

        if caps.get("restart") or (runtime.get("kind") or "none") != "none":
            restart_ok, restart_detail = await self._restart_runtime(prod, runtime, caps)
            steps.append(
                DeployStep(
                    "restart",
                    "Application restarted" if restart_ok else "Application restart failed",
                    bool(restart_ok),
                    restart_detail,
                )
            )

        if caps.get("nginx"):
            nginx_code, nginx_out, nginx_err = await self._sh("sudo -n systemctl reload nginx")
            nginx_ok = nginx_code == 0
            steps.append(
                DeployStep(
                    "nginx",
                    "Nginx reloaded" if nginx_ok else "Nginx reload failed",
                    nginx_ok,
                    (nginx_out or nginx_err)[-400:],
                )
            )

        health_ok: bool | None = None
        health_url = (runtime.get("healthCheck") or "").strip()
        if health_url:
            health_ok, health_detail = await self._health_check(health_url)
            steps.append(
                DeployStep(
                    "health",
                    "Health check passed" if health_ok else "Health check failed",
                    bool(health_ok),
                    health_detail,
                )
            )

        failed = any(not step.ok for step in steps if step.id in {"build", "health"})
        final_status = "healthy" if health_ok else "unhealthy" if health_ok is False else "deployed"
        if failed:
            final_status = "failed"
        await self._record_deployment(prod, short or target, final_status)
        return DeployResult(
            status=await self.status(prod),
            commit=short or target,
            steps=tuple(steps),
            health_ok=health_ok,
            needs_rollback=bool(failed),
            message=None if not failed else "Deployment completed but a check failed.",
        )

    async def _restart_runtime(
        self,
        production_path: str,
        runtime: dict[str, str],
        capabilities: dict[str, bool],
    ) -> tuple[bool, str]:
        kind = (runtime.get("kind") or "none").strip().lower()
        process = (runtime.get("process") or "").strip()
        if kind == "none":
            return True, "No runtime configured."
        if kind == "pm2":
            if not capabilities.get("pm2") and not capabilities.get("restart"):
                return False, "PM2 is not enabled for this project."
            if not process:
                return False, "Configure the PM2 process name before restarting."
            code, out, err = await self._sh(f"pm2 restart {shlex.quote(process)}")
            return code == 0, (out or err or f"pm2 restart {process}")
        if kind == "systemd":
            if not capabilities.get("systemd") and not capabilities.get("restart"):
                return False, "systemd is not enabled for this project."
            if not process:
                return False, "Configure the systemd unit name before restarting."
            code, out, err = await self._sh(
                f"sudo -n systemctl try-reload-or-restart {shlex.quote(process)}"
            )
            return code == 0, (out or err or process)
        if kind == "docker-compose":
            if not capabilities.get("docker"):
                return False, "Docker Compose is not enabled for this project."
            code, out, err = await self._sh(
                f"cd {shlex.quote(production_path)} && docker compose up -d"
            )
            return code == 0, (out or err or "docker compose up -d")
        if kind == "custom":
            command = (runtime.get("customCommand") or "").strip()
            if not command:
                return False, "Configure a custom restart command first."
            code, out, err = await self._sh(command)
            return code == 0, (out or err or command)
        return False, f"Unknown runtime: {kind}"

    async def _health_check(self, url: str) -> tuple[bool, str]:
        target = url.strip()
        if not target.startswith(("http://127.0.0.1", "http://localhost", "https://127.0.0.1", "https://localhost")):
            return False, "Health checks must target localhost on the VPS."
        quoted = shlex.quote(target)
        script = f"""
if command -v curl >/dev/null 2>&1; then
  curl -fsS -o /tmp/coloride-health.out -w '%{{http_code}}' --max-time 15 {quoted}
else
  python3 -c "import urllib.request; print(urllib.request.urlopen({target!r}, timeout=15).status)"
fi
"""
        code, out, err = await self._sh(script)
        status_code = "".join(ch for ch in (out or "") if ch.isdigit())[-3:]
        ok = code == 0 and status_code.startswith("2")
        return ok, status_code or (err or out or "health check failed")

    async def rollback(
        self,
        production_path: str,
        commit: str | None = None,
        *,
        runtime: dict[str, str] | None = None,
        capabilities: dict[str, bool] | None = None,
    ) -> DeployResult:
        """Redeploy a previously known production commit — not agent Undo."""
        prod = normalize_remote_root(production_path)
        history = await self.list_deployed_commits(prod)
        target = (commit or "").strip()
        if not target:
            if len(history) < 2:
                raise RuntimeError("No previous production commit is recorded for rollback.")
            target = history[1]
        elif history and target not in history and not any(item.startswith(target) or target.startswith(item) for item in history):
            raise RuntimeError(
                "Rollback can only redeploy a commit Coloride has already promoted to production."
            )
        return await self.deploy_commit(
            production_path,
            commit=target,
            runtime=runtime,
            capabilities=capabilities,
            ignore_drift=True,
            allow_dirty=True,
        )
