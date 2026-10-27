from __future__ import annotations

import re
import shlex
from typing import TYPE_CHECKING

import asyncssh

if TYPE_CHECKING:
    from asyncssh import SSHClientConnection

RESTRICTED_USERNAME = "coloride"
# Canonical Production work tree. Older installs used the singular
# /home/coloride/workspace; both remain readable, but new copies land here.
SAFE_WORKSPACE_ROOT = f"/home/{RESTRICTED_USERNAME}/workspaces"
LEGACY_SAFE_WORKSPACE_ROOT = f"/home/{RESTRICTED_USERNAME}/workspace"
# Narrow privileged helper. Not a generic root copy primitive.
COLORIDE_SYNC_HELPER = "/usr/local/lib/coloride/sync-release"

# Writable roots for a Restricted session by default.
# Project trees are added per-workspace (e.g. /var/www/my-app), never all of /var/www.
DEFAULT_ALLOWED_ROOTS: tuple[str, ...] = (
    f"/home/{RESTRICTED_USERNAME}",
    f"/tmp/{RESTRICTED_USERNAME}",
)

# Read-only / navigable anchors for Restricted "Server filesystem".
# Writable project trees are granted per-workspace (never all of /var/www).
# Home/tmp also appear here so the Explorer scope switch can list them even
# when they already sit in DEFAULT_ALLOWED_ROOTS (those stay read/write).
DEFAULT_BROWSE_ROOTS: tuple[str, ...] = (
    "/var/www",
    "/var/www/html",
    "/usr/share/nginx/html",
    "/usr/share/caddy",
    "/srv",
    "/srv/www",
    "/srv/http",
    "/opt",
    f"/home/{RESTRICTED_USERNAME}",
    f"/tmp/{RESTRICTED_USERNAME}",
)

# Log dirs the account may read (not write) when present on the VPS.
DEFAULT_LOG_ROOTS: tuple[str, ...] = (
    "/var/log/nginx",
    "/var/log/caddy",
    "/var/log/apache2",
    "/var/log/httpd",
    f"/home/{RESTRICTED_USERNAME}/.pm2/logs",
)


def normalize_remote_root(path: str) -> str:
    raw = (path or "").strip() or "/"
    if not raw.startswith("/") or "\0" in raw:
        raise ValueError("Remote paths must be absolute")
    parts = raw.split("/")
    if ".." in parts:
        raise ValueError("Remote paths cannot contain parent traversal")
    cleaned = "/".join(part for part in parts if part not in {"", "."})
    return f"/{cleaned}" if cleaned else "/"


def _workspace_slug(source_path: str) -> str:
    source = normalize_remote_root(source_path).strip("/")
    name = source.split("/")[-1] if source else "project"
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", name).strip("-._") or "project"


def safe_workspace_path_for(source_path: str) -> str:
    """Stable, human-readable isolated path for one live project."""
    return f"{SAFE_WORKSPACE_ROOT}/{_workspace_slug(source_path)[:80]}"


def legacy_safe_workspace_path_for(source_path: str) -> str:
    """Pre-unification path used by earlier Production copies."""
    return f"{LEGACY_SAFE_WORKSPACE_ROOT}/{_workspace_slug(source_path)[:80]}"


# Generated / vendor trees. Copied workspaces keep lockfiles and manifests so
# the agent can reinstall; they do not copy millions of package files.
WORKSPACE_COPY_EXCLUDE_NAMES: tuple[str, ...] = (
    "node_modules",
    "bower_components",
    "jspm_packages",
    ".pnpm-store",
    ".yarn",
    ".npm",
    "vendor",
    ".bundle",
    ".venv",
    "venv",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".nox",
    "site-packages",
    ".next",
    ".nuxt",
    ".output",
    ".svelte-kit",
    ".turbo",
    ".parcel-cache",
    ".vite",
    ".cache",
    "dist",
    "build",
    "out",
    "coverage",
    ".nyc_output",
    "target",
    "Pods",
    "Carthage",
    ".gradle",
    ".idea",
    ".terraform",
)


def workspace_copy_exclude_names() -> tuple[str, ...]:
    return WORKSPACE_COPY_EXCLUDE_NAMES


def _workspace_rsync_exclude_flags() -> str:
    return " ".join(
        f"--exclude={shlex.quote(name)}" for name in WORKSPACE_COPY_EXCLUDE_NAMES
    )


def _workspace_find_prune() -> str:
    tests = " -o ".join(f"-name {shlex.quote(name)}" for name in WORKSPACE_COPY_EXCLUDE_NAMES)
    return f"\\( {tests} \\) -prune -o"


def isolated_workspace_copy_script(
    *,
    source: str,
    work: str,
    legacy: str,
    marker: str,
    root: str | None = None,
) -> str:
    """Remote bash that snapshots production source into a coloride-owned tree."""
    owner = shlex.quote(RESTRICTED_USERNAME)
    rsync_excludes = _workspace_rsync_exclude_flags()
    find_prune = _workspace_find_prune()
    workspace_root = root or SAFE_WORKSPACE_ROOT
    return f"""
set -eu
SOURCE={shlex.quote(source)}
ROOT={shlex.quote(workspace_root)}
WORK={shlex.quote(work)}
LEGACY={shlex.quote(legacy)}
MARKER={shlex.quote(marker)}
OWNER={owner}
if [ ! -d "$SOURCE" ]; then
  echo SOURCE_MISSING
  exit 12
fi
if [ ! -e "$WORK" ] && [ -d "$LEGACY" ]; then
  LEGACY_MARKER="$LEGACY/.coloride-source"
  if [ ! -f "$LEGACY_MARKER" ] || [ "$(cat "$LEGACY_MARKER")" = "$SOURCE" ]; then
    mkdir -p "$ROOT"
    mv "$LEGACY" "$WORK"
  fi
fi
if [ -e "$WORK" ]; then
  if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$SOURCE" ]; then
    # Existing copies stay as-is. Walking vendor trees again is what used
    # to take an hour on Open as coloride.
    exit 0
  fi
  if [ ! -f "$MARKER" ] && [ -d "$WORK" ]; then
    printf '%s' "$SOURCE" > "$MARKER"
    exit 0
  fi
  echo WORKSPACE_EXISTS
  exit 13
fi
mkdir -p "$ROOT" "$WORK"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --no-owner --no-group {rsync_excludes} "$SOURCE"/ "$WORK"/
else
  # Portable fallback: walk once and skip generated/vendor directories by name.
  (cd "$SOURCE" && find . {find_prune} \\( -type d -exec mkdir -p "$WORK/{{}}" \\; \\) \\
    -o \\( \\( -type f -o -type l \\) -exec cp -a {{}} "$WORK/{{}}" \\; \\) )
fi
printf '%s' "$SOURCE" > "$MARKER"
# Own the copied source only. Never walk skipped vendor trees.
if id -u "$OWNER" >/dev/null 2>&1; then
  chown -R "$OWNER:$OWNER" "$WORK"
fi
"""


async def prepare_isolated_workspace(
    conn: SSHClientConnection,
    production_path: str,
) -> str:
    """Make a one-time editable snapshot without Git or deploy privileges.

    This runs through the initial privileged connection only. The resulting tree
    belongs to `coloride`; production is never ACL-granted for writing.
    Generated trees (node_modules, .venv, .next, dist, …) are skipped so Open
    as coloride copies source, not install artifacts.
    """
    source = normalize_remote_root(production_path)
    work = safe_workspace_path_for(source)
    legacy = legacy_safe_workspace_path_for(source)
    marker = f"{work}/.coloride-source"
    script = isolated_workspace_copy_script(
        source=source,
        work=work,
        legacy=legacy,
        marker=marker,
    )
    result = await _run(conn, f"bash -lc {shlex.quote(script)}", check=False)
    if result.exit_status != 0:
        detail = (result.stderr or result.stdout or "").strip()
        if "WORKSPACE_EXISTS" in detail:
            raise RuntimeError(
                f"Safe workspace already exists at {work} for a different project. "
                "Rename or remove it before creating this Coloride workspace."
            )
        raise RuntimeError(
            f"Could not prepare an isolated workspace from {source}"
            + (f" ({detail})" if detail else "")
        )
    return work


def is_path_under_roots(path: str, roots: list[str] | tuple[str, ...]) -> bool:
    """True if path is exactly a root or a descendant (after normalize)."""
    try:
        candidate = normalize_remote_root(path)
    except ValueError:
        return False
    for root in roots:
        try:
            base = normalize_remote_root(root)
        except ValueError:
            continue
        if candidate == base or candidate.startswith(base.rstrip("/") + "/"):
            return True
    return False


def is_safe_workspace_path(path: str) -> bool:
    """True when *path* is a Coloride-controlled Production work tree."""
    return is_path_under_roots(path, [SAFE_WORKSPACE_ROOT, LEGACY_SAFE_WORKSPACE_ROOT])


def is_ancestor_of_roots(path: str, roots: list[str] | tuple[str, ...]) -> bool:
    """True if path is a parent of an allowed root (needed to list toward a project)."""
    try:
        candidate = normalize_remote_root(path)
    except ValueError:
        return False
    if candidate == "/":
        return True
    prefix = candidate.rstrip("/") + "/"
    for root in roots:
        try:
            base = normalize_remote_root(root)
        except ValueError:
            continue
        if base.startswith(prefix) or base == candidate:
            return True
    return False


def path_allowed_for_restricted(
    path: str,
    *,
    allowed_roots: list[str] | tuple[str, ...],
    browse_roots: list[str] | tuple[str, ...] = DEFAULT_BROWSE_ROOTS,
    mutate: bool = True,
) -> bool:
    """
    Restricted path policy:
    - mutate=True: only under allowed_roots (home/tmp + granted project dirs)
    - mutate=False: also browse_roots (e.g. list /var/www) and ancestors of allowed roots
    """
    if is_path_under_roots(path, allowed_roots):
        return True
    if mutate:
        return False
    if is_path_under_roots(path, browse_roots):
        return True
    if is_ancestor_of_roots(path, (*allowed_roots, *browse_roots)):
        return True
    return False


def path_is_writable_restricted(
    path: str,
    *,
    allowed_roots: list[str] | tuple[str, ...],
) -> bool:
    """True when Restricted may mutate this path (under a granted/writable root)."""
    return is_path_under_roots(path, allowed_roots)


def server_filesystem_anchors(
    *,
    allowed_roots: list[str] | tuple[str, ...],
    browse_roots: list[str] | tuple[str, ...] = DEFAULT_BROWSE_ROOTS,
) -> list[str]:
    """
    Top-level folders shown under Restricted "Server filesystem".
    Prefer explicit browse anchors; include any allowed roots not already covered.
    """
    seen: set[str] = set()
    out: list[str] = []
    for raw in (*browse_roots, *allowed_roots):
        try:
            root = normalize_remote_root(raw)
        except ValueError:
            continue
        if root in seen or root == "/":
            continue
        # Skip allowed project dirs nested under a browse root (e.g. /var/www/app
        # when /var/www is already an anchor) — user reaches them by navigating.
        covered = False
        for existing in out:
            if root == existing or root.startswith(existing.rstrip("/") + "/"):
                covered = True
                break
        if covered:
            continue
        # Drop a broader anchor if a more specific one was added first (rare).
        out = [item for item in out if not item.startswith(root.rstrip("/") + "/")]
        seen.add(root)
        out.append(root)
    out.sort()
    return out


async def _run(conn: SSHClientConnection, script: str, *, check: bool = False):
    return await conn.run(script, check=check)


def sync_helper_script() -> str:
    """Privileged release sync. Source/destination are validated before any copy."""
    return r"""#!/bin/bash
set -euo pipefail
# Coloride release helper. Not a generic root copy primitive.
# Usage: sync-release <workspace> <production> <commit>
WORK="${1:-}"
PROD="${2:-}"
COMMIT="${3:-}"
if [ -z "$WORK" ] || [ -z "$PROD" ] || [ -z "$COMMIT" ]; then
  echo "USAGE_WORK_PROD_COMMIT" >&2
  exit 2
fi
case "$WORK" in
  /home/coloride/workspaces/*|/home/coloride/workspace/*) ;;
  *) echo "SOURCE_NOT_WORKSPACE" >&2; exit 40 ;;
esac
case "$PROD" in
  /var/www/*) ;;
  *) echo "DEST_NOT_PRODUCTION" >&2; exit 41 ;;
esac
if [ ! -d "$WORK/.git" ]; then
  echo "SOURCE_NOT_WORKSPACE" >&2
  exit 40
fi
if [ ! -d "$PROD" ]; then
  echo "PRODUCTION_MISSING" >&2
  exit 41
fi
MARKER="$WORK/.coloride-source"
if [ ! -f "$MARKER" ] || [ "$(cat "$MARKER")" != "$PROD" ]; then
  echo "PROJECT_BINDING_MISMATCH" >&2
  exit 44
fi
cd "$WORK"
FULL=$(git rev-parse "$COMMIT")
SHORT=$(git rev-parse --short "$FULL")
TMP=$(mktemp -d /tmp/coloride-deploy.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
git archive "$FULL" | tar -x -C "$TMP"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude .git --exclude node_modules --exclude .next --exclude dist --exclude build "$TMP"/ "$PROD"/
else
  find "$PROD" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} + 2>/dev/null || true
  cp -a "$TMP"/. "$PROD"/
fi
printf '%s\n' "$SHORT" > "$PROD/.coloride-deploy-commit"
echo "DEPLOYED"
echo "COMMIT=$SHORT"
"""


async def _install_sync_helper(conn: SSHClientConnection) -> None:
    """Install the validated release helper used by Production deploys."""
    helper = COLORIDE_SYNC_HELPER
    directory = helper.rsplit("/", 1)[0]
    body = sync_helper_script()
    script = (
        f"DIR={shlex.quote(directory)} && "
        f"FILE={shlex.quote(helper)} && "
        "TMP=$(mktemp) && cat > \"$TMP\" <<'COLORIDE_SYNC_HELPER'\n"
        f"{body}"
        "COLORIDE_SYNC_HELPER\n"
        "chmod 755 \"$TMP\" && "
        "(sudo -n mkdir -p \"$DIR\" 2>/dev/null || mkdir -p \"$DIR\") && "
        "(sudo -n cp \"$TMP\" \"$FILE\" 2>/dev/null || cp \"$TMP\" \"$FILE\") && "
        "(sudo -n chmod 755 \"$FILE\" 2>/dev/null || chmod 755 \"$FILE\") && "
        "rm -f \"$TMP\""
    )
    await _run(conn, script, check=False)


async def ensure_restricted_user(
    conn: SSHClientConnection,
    *,
    password: str | None,
    private_key: str | None,
    private_key_passphrase: str | None,
    extra_roots: list[str] | None = None,
) -> tuple[str, list[str]]:
    """
    Create/reuse the dedicated non-root `coloride` account and apply baseline
    sandboxing so Coloride sessions cannot freely administer the whole VPS.

    Requires the bootstrap session to create users / write authorized_keys
    (typically root, or passwordless sudo).

    Returns (username, allowed_roots).
    """
    target = RESTRICTED_USERNAME
    exists = await _run(conn, f"id -u {shlex.quote(target)}", check=False)
    if exists.exit_status != 0:
        create = await _run(
            conn,
            " ".join(
                [
                    f"(sudo -n useradd -m -s /bin/bash {shlex.quote(target)} 2>/dev/null)",
                    f"|| useradd -m -s /bin/bash {shlex.quote(target)}",
                ]
            ),
            check=False,
        )
        if create.exit_status != 0:
            detail = (create.stderr or create.stdout or "").strip()
            raise RuntimeError(
                "Could not create the restricted user 'coloride'. "
                "Sign in with root or a sudo-capable account for the one-time setup."
                + (f" ({detail})" if detail else "")
            )

    home = f"/home/{target}"
    await _run(
        conn,
        f"mkdir -p {shlex.quote(home)}/.ssh {shlex.quote(home)}/.coloride "
        f"{shlex.quote('/tmp/' + target)} && chmod 700 {shlex.quote(home)}/.ssh",
        check=False,
    )

    if private_key:
        try:
            key = asyncssh.import_private_key(
                private_key,
                passphrase=private_key_passphrase or None,
            )
            public_key = key.export_public_key("openssh")
            if isinstance(public_key, bytes):
                public_key = public_key.decode("utf-8", errors="replace")
            public_key = public_key.strip()
        except Exception as exc:
            raise RuntimeError(f"Could not derive a public key for the restricted user: {exc}") from exc

        install = await _run(
            conn,
            " ".join(
                [
                    f"AUTH={shlex.quote(home + '/.ssh/authorized_keys')}",
                    f"KEY={shlex.quote(public_key)}",
                    'touch "$AUTH" && chmod 600 "$AUTH"',
                    'grep -qxF "$KEY" "$AUTH" 2>/dev/null || printf "%s\\n" "$KEY" >> "$AUTH"',
                ]
            ),
            check=False,
        )
        if install.exit_status != 0:
            detail = (install.stderr or install.stdout or "").strip()
            raise RuntimeError(
                "Created 'coloride' but could not install SSH key access."
                + (f" ({detail})" if detail else "")
            )
    elif password:
        chpass = await _run(
            conn,
            " ".join(
                [
                    f"echo {shlex.quote(f'{target}:{password}')}",
                    "| (sudo -n chpasswd 2>/dev/null || chpasswd)",
                ]
            ),
            check=False,
        )
        if chpass.exit_status != 0:
            detail = (chpass.stderr or chpass.stdout or "").strip()
            raise RuntimeError(
                "Created 'coloride' but could not set its password."
                + (f" ({detail})" if detail else "")
            )
    else:
        raise RuntimeError(
            "Restricted Access needs a password or SSH key so the 'coloride' user can sign in."
        )

    await _run(
        conn,
        f"(sudo -n chown -R {shlex.quote(target)}:{shlex.quote(target)} {shlex.quote(home)} 2>/dev/null) "
        f"|| chown -R {shlex.quote(target)}:{shlex.quote(target)} {shlex.quote(home)}",
        check=False,
    )

    allowed = await harden_restricted_account(conn, extra_roots=extra_roots)
    return target, allowed


async def harden_restricted_account(
    conn: SSHClientConnection,
    *,
    extra_roots: list[str] | None = None,
) -> list[str]:
    """
    Lock down `coloride`: no admin groups, ACLs on project/log roots, limited sudoers.
    Runs as the bootstrap (privileged) session.
    """
    user = RESTRICTED_USERNAME
    roots: list[str] = []
    for item in (*DEFAULT_ALLOWED_ROOTS, *(extra_roots or [])):
        try:
            roots.append(normalize_remote_root(item))
        except ValueError:
            continue
    # Dedupe preserve order
    seen: set[str] = set()
    allowed: list[str] = []
    for root in roots:
        if root in seen:
            continue
        seen.add(root)
        allowed.append(root)

    # Drop privileged groups if the account was reused from an older setup.
    for group in ("sudo", "admin", "wheel", "docker", "lxd", "root"):
        await _run(
            conn,
            f"(sudo -n gpasswd -d {shlex.quote(user)} {shlex.quote(group)} 2>/dev/null) "
            f"|| gpasswd -d {shlex.quote(user)} {shlex.quote(group)} 2>/dev/null "
            f"|| true",
            check=False,
        )

    # Dedicated group for shared project trees.
    await _run(
        conn,
        f"(sudo -n groupadd -f {shlex.quote(user)} 2>/dev/null) || groupadd -f {shlex.quote(user)} 2>/dev/null || true; "
        f"(sudo -n usermod -aG {shlex.quote(user)} {shlex.quote(user)} 2>/dev/null) "
        f"|| usermod -aG {shlex.quote(user)} {shlex.quote(user)} 2>/dev/null || true",
        check=False,
    )

    for root in allowed:
        if is_path_under_roots(root, DEFAULT_ALLOWED_ROOTS):
            await _ensure_root_access(conn, root, user=user, write=True)
        else:
            await grant_workspace_access(conn, root, user=user)

    for browse_root in DEFAULT_BROWSE_ROOTS:
        # Read-only so the user can pick /var/www/<app> without owning every site.
        await _ensure_root_access(conn, browse_root, user=user, write=False, optional=True)

    for log_root in DEFAULT_LOG_ROOTS:
        # Best-effort read-only ACL — skip silently if the path does not exist.
        await _ensure_root_access(conn, log_root, user=user, write=False, optional=True)

    await _install_sync_helper(conn)

    # Limited sudo: validated release sync + restart/reload of common web
    # frontends + read their journals. No shell, no unrestricted rsync,
    # systemctl, or process-manager administration.
    sudoers_body = "\n".join(
        [
            f"# Managed by Coloride — restricted session for {user}",
            f"Cmnd_Alias COLORIDE_DEPLOY = {COLORIDE_SYNC_HELPER}",
            f"Cmnd_Alias COLORIDE_SVC = /bin/systemctl restart nginx, /bin/systemctl reload nginx, "
            f"/bin/systemctl restart caddy, /bin/systemctl reload caddy, "
            f"/bin/systemctl restart apache2, /bin/systemctl reload apache2, "
            f"/bin/systemctl restart httpd, /bin/systemctl reload httpd, "
            f"/usr/bin/systemctl restart nginx, /usr/bin/systemctl reload nginx, "
            f"/usr/bin/systemctl restart caddy, /usr/bin/systemctl reload caddy, "
            f"/usr/bin/systemctl restart apache2, /usr/bin/systemctl reload apache2, "
            f"/usr/bin/systemctl restart httpd, /usr/bin/systemctl reload httpd",
            f"Cmnd_Alias COLORIDE_LOGS = /usr/bin/journalctl -u nginx *, /usr/bin/journalctl -u caddy *, "
            f"/usr/bin/journalctl -u apache2 *, /usr/bin/journalctl -u httpd *",
            f"{user} ALL=(root) NOPASSWD: COLORIDE_DEPLOY, COLORIDE_SVC, COLORIDE_LOGS",
            "",
        ]
    )
    sudoers_path = f"/etc/sudoers.d/coloride-{user}"
    # Validate with visudo when available.
    write_sudoers = (
        f"TMP=$(mktemp) && cat > \"$TMP\" <<'COLORIDE_SUDOERS'\n"
        f"{sudoers_body}"
        f"COLORIDE_SUDOERS\n"
        f"chmod 440 \"$TMP\" && "
        f"((command -v visudo >/dev/null && visudo -cf \"$TMP\") || true) && "
        f"(sudo -n cp \"$TMP\" {shlex.quote(sudoers_path)} 2>/dev/null || cp \"$TMP\" {shlex.quote(sudoers_path)}) && "
        f"rm -f \"$TMP\""
    )
    await _run(conn, write_sudoers, check=False)

    # Persist allow-list on the VPS for operators / future sessions.
    roots_file = f"/home/{user}/.coloride/allowed-roots"
    roots_payload = "\n".join(allowed) + "\n"
    await _run(
        conn,
        f"mkdir -p {shlex.quote(f'/home/{user}/.coloride')} && "
        f"cat > {shlex.quote(roots_file)} <<'COLORIDE_ROOTS'\n"
        f"{roots_payload}"
        f"COLORIDE_ROOTS\n"
        f"chown {shlex.quote(user)}:{shlex.quote(user)} {shlex.quote(roots_file)} "
        f"{shlex.quote(f'/home/{user}/.coloride')} 2>/dev/null || true",
        check=False,
    )

    return allowed


async def grant_workspace_access(
    conn: SSHClientConnection,
    workspace_path: str,
    *,
    user: str = RESTRICTED_USERNAME,
) -> str:
    """Grant rwx through a reversible POSIX ACL without changing project ownership."""
    root = normalize_remote_root(workspace_path)
    quoted = shlex.quote(root)
    u = shlex.quote(user)
    exists = await _run(conn, f"test -d {quoted}", check=False)
    if exists.exit_status != 0:
        raise RuntimeError(f"Workspace does not exist or is not a directory: {root}")
    acl = await _run(conn, "command -v setfacl", check=False)
    if acl.exit_status != 0:
        # ACL is required for reversible per-workspace access. Bootstrap runs as
        # root/sudoer, so install the small OS package once rather than falling
        # back to changing a production tree's owner/group recursively.
        install = await _run(
            conn,
            "if command -v apt-get >/dev/null 2>&1; then "
            "(sudo -n apt-get install -y acl 2>/dev/null || apt-get install -y acl); "
            "elif command -v dnf >/dev/null 2>&1; then "
            "(sudo -n dnf install -y acl 2>/dev/null || dnf install -y acl); "
            "elif command -v yum >/dev/null 2>&1; then "
            "(sudo -n yum install -y acl 2>/dev/null || yum install -y acl); "
            "elif command -v apk >/dev/null 2>&1; then "
            "(sudo -n apk add acl 2>/dev/null || apk add acl); "
            "else exit 127; fi",
            check=False,
        )
        acl = await _run(conn, "command -v setfacl", check=False)
        if install.exit_status != 0 or acl.exit_status != 0:
            detail = (install.stderr or install.stdout or "").strip()
            raise RuntimeError(
                "Coloride needs POSIX ACL support to isolate this workspace. "
                "Could not install the 'acl' package automatically."
                + (f" ({detail})" if detail else "")
            )
    result = await _run(
        conn,
        f"(sudo -n setfacl -R -m u:{u}:rwx -m d:u:{u}:rwx {quoted} 2>/dev/null) "
        f"|| setfacl -R -m u:{u}:rwx -m d:u:{u}:rwx {quoted}",
        check=False,
    )
    if result.exit_status != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(
            f"Could not grant Coloride access to {root}" + (f" ({detail})" if detail else "")
        )
    return root


async def revoke_workspace_access(
    conn: SSHClientConnection,
    workspace_path: str,
    *,
    user: str = RESTRICTED_USERNAME,
) -> str:
    """Remove the reversible user/default ACL previously installed by Coloride."""
    root = normalize_remote_root(workspace_path)
    if is_path_under_roots(root, DEFAULT_ALLOWED_ROOTS):
        return root
    quoted = shlex.quote(root)
    u = shlex.quote(user)
    result = await _run(
        conn,
        f"if test -e {quoted} && command -v setfacl >/dev/null 2>&1; then "
        f"((sudo -n setfacl -R -x u:{u} {quoted} 2>/dev/null) "
        f"|| setfacl -R -x u:{u} {quoted}) && "
        f"((sudo -n find {quoted} -type d -exec setfacl -x d:u:{u} {{}} + 2>/dev/null) "
        f"|| find {quoted} -type d -exec setfacl -x d:u:{u} {{}} +); fi",
        check=False,
    )
    if result.exit_status != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(
            f"Could not revoke Coloride access from {root}" + (f" ({detail})" if detail else "")
        )
    return root


async def _ensure_root_access(
    conn: SSHClientConnection,
    path: str,
    *,
    user: str,
    write: bool,
    optional: bool = False,
) -> None:
    """Create path if needed and apply group + ACL access for `user`."""
    quoted = shlex.quote(path)
    u = shlex.quote(user)
    exists = await _run(conn, f"test -e {quoted}", check=False)
    if exists.exit_status != 0:
        if optional:
            return
        await _run(
            conn,
            f"(sudo -n mkdir -p {quoted} 2>/dev/null) || mkdir -p {quoted}",
            check=False,
        )

    # Traverse parents: at least +x so the user can walk into the tree.
    await _run(
        conn,
        f"p={quoted}; while [ \"$p\" != / ]; do "
        f"(sudo -n chmod a+x \"$p\" 2>/dev/null) || chmod a+x \"$p\" 2>/dev/null || true; "
        f"p=$(dirname \"$p\"); done",
        check=False,
    )

    if write:
        await _run(
            conn,
            f"(sudo -n chgrp -R {u} {quoted} 2>/dev/null) || chgrp -R {u} {quoted} 2>/dev/null || true; "
            f"(sudo -n chmod -R g+rwX {quoted} 2>/dev/null) || chmod -R g+rwX {quoted} 2>/dev/null || true; "
            f"(sudo -n find {quoted} -type d -exec chmod g+s {{}} + 2>/dev/null) || true",
            check=False,
        )
        # POSIX ACL when setfacl exists — survives odd umasks from deploy tools.
        await _run(
            conn,
            f"if command -v setfacl >/dev/null 2>&1; then "
            f"(sudo -n setfacl -R -m u:{u}:rwx -m d:u:{u}:rwx {quoted} 2>/dev/null) "
            f"|| setfacl -R -m u:{u}:rwx -m d:u:{u}:rwx {quoted} 2>/dev/null || true; "
            f"fi",
            check=False,
        )
    else:
        await _run(
            conn,
            f"if command -v setfacl >/dev/null 2>&1; then "
            f"(sudo -n setfacl -R -m u:{u}:rX {quoted} 2>/dev/null) "
            f"|| setfacl -R -m u:{u}:rX {quoted} 2>/dev/null || true; "
            f"fi",
            check=False,
        )
