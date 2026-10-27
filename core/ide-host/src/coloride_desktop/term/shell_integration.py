from __future__ import annotations

import os
import shlex
import tempfile
from pathlib import Path

# Coloride uses private OSC 633 subcommands. xterm consumes these sequences, so
# they never become part of the user's terminal output or tmux scrollback.
BASH_INTEGRATION = r"""# Coloride shell integration. Generated; do not edit.
if [ -r "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi

__coloride_active=0
__coloride_ready=0
__coloride_emit() { printf '\033]633;%s\007' "$1"; }
__coloride_command_start() {
  local command
  command="$(HISTTIMEFORMAT= builtin history 1 2>/dev/null | sed 's/^[[:space:]]*[0-9][0-9]*[[:space:]]*//')"
  [ -n "$command" ] || command="$BASH_COMMAND"
  __coloride_emit "ColorideStart;$(printf '%s' "$command" | base64 | tr -d '\n')"
  __coloride_active=1
}
__coloride_command_end() {
  local status=$?
  if [ "$__coloride_active" = 1 ]; then
    __coloride_emit "ColorideEnd;$status"
    __coloride_active=0
  fi
  __coloride_emit "ColoridePrompt"
  return "$status"
}

__coloride_debug_start() {
  if [ "$__coloride_ready" = 1 ]; then
    __coloride_ready=0
    __coloride_command_start
  fi
}
__coloride_arm_debug_start() { __coloride_ready=1; }

# PS0 runs after a complete command has been read but before it executes. It is
# the only Bash hook which does not mistake PROMPT_COMMAND itself for a command.
if (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )); then
  PS0='$(__coloride_command_start)'
  if [ -n "${PROMPT_COMMAND:-}" ]; then
    PROMPT_COMMAND="__coloride_command_end;${PROMPT_COMMAND}"
  else
    PROMPT_COMMAND="__coloride_command_end"
  fi
else
  # macOS still ships Bash 3.2. Arm DEBUG only after all prompt hooks ran so
  # PROMPT_COMMAND itself is never presented as the user's command.
  trap '__coloride_debug_start' DEBUG
  if [ -n "${PROMPT_COMMAND:-}" ]; then
    PROMPT_COMMAND="__coloride_command_end;${PROMPT_COMMAND};__coloride_arm_debug_start"
  else
    PROMPT_COMMAND="__coloride_command_end;__coloride_arm_debug_start"
  fi
fi
"""


ZSH_INTEGRATION = r"""# Coloride shell integration. Generated; do not edit.
if [ -r "$HOME/.zshrc" ]; then source "$HOME/.zshrc"; fi

# Keep zsh's partial-line handling, but do not append an inverse "%" to
# program output. Preserve an explicitly customized end-of-line marker.
if [[ ${PROMPT_EOL_MARK-'%B%S%#%s%b'} == '%B%S%#%s%b' ]]; then
  PROMPT_EOL_MARK=''
fi

autoload -Uz add-zsh-hook
typeset -g __coloride_active=0
__coloride_emit() { printf '\033]633;%s\007' "$1"; }
__coloride_preexec() {
  local encoded="$(printf '%s' "$1" | base64 | tr -d '\n')"
  __coloride_emit "ColorideStart;$encoded"
  __coloride_active=1
}
__coloride_precmd() {
  local exit_code=$?
  if (( __coloride_active )); then
    __coloride_emit "ColorideEnd;$exit_code"
    __coloride_active=0
  fi
  __coloride_emit "ColoridePrompt"
}
add-zsh-hook preexec __coloride_preexec
add-zsh-hook precmd __coloride_precmd
"""


FISH_INTEGRATION = r"""# Coloride shell integration. Generated; do not edit.
function __coloride_emit
    printf '\033]633;%s\007' "$argv[1]"
end
function __coloride_preexec --on-event fish_preexec
    set -l command (string join ' ' $argv)
    set -l encoded (printf '%s' "$command" | base64 | string collect)
    __coloride_emit "ColorideStart;$encoded"
end
function __coloride_postexec --on-event fish_postexec
    set -l exit_code $status
    __coloride_emit "ColorideEnd;$exit_code"
    __coloride_emit "ColoridePrompt"
end
"""


# Local startup must preserve the user's shell settings. Remote snippets keep
# their existing contract; these adapters are only used by the local PTY.
LOCAL_ZSH_INTEGRATION = ZSH_INTEGRATION.replace(
    'if [ -r "$HOME/.zshrc" ]; then source "$HOME/.zshrc"; fi',
    "# Restore the user's startup directory before loading their configuration.\n"
    'if [[ -n ${COLORIDE_USER_ZDOTDIR:-} ]]; then\n'
    '  ZDOTDIR=$COLORIDE_USER_ZDOTDIR\nelse\n  unset ZDOTDIR\nfi\n'
    'unset COLORIDE_USER_ZDOTDIR\n'
    'if [ -r "${ZDOTDIR:-$HOME}/.zshrc" ]; then source "${ZDOTDIR:-$HOME}/.zshrc"; fi',
)
LOCAL_BASH_INTEGRATION = BASH_INTEGRATION.replace(
    "PS0='$(__coloride_command_start)'",
    "PS0='$(__coloride_command_start)'\"${PS0-}\"",
).replace(
    "trap '__coloride_debug_start' DEBUG",
    "if [ -z \"$(trap -p DEBUG)\" ]; then trap '__coloride_debug_start' DEBUG; fi",
)


def create_local_shell_launch(shell: str) -> tuple[list[str], dict[str, str]]:
    """Return an interactive shell command with Coloride hooks, without touching dotfiles."""
    executable = shell if os.path.isabs(shell) else "/bin/zsh"
    name = Path(executable).name
    env = os.environ.copy()
    # A locally spawned PTY inherits the sidecar's TERM (often "dumb" when
    # Coloride was launched from an IDE). `clear` needs a real terminal type.
    env["TERM"] = "xterm-256color"
    root = Path(tempfile.mkdtemp(prefix="coloride-shell-integration-"))
    root.chmod(0o700)

    if name == "bash":
        rcfile = root / "bashrc"
        rcfile.write_text(LOCAL_BASH_INTEGRATION, encoding="utf-8")
        rcfile.chmod(0o600)
        return [executable, "--rcfile", str(rcfile), "-i"], env

    if name == "zsh":
        rcfile = root / ".zshrc"
        rcfile.write_text(LOCAL_ZSH_INTEGRATION, encoding="utf-8")
        rcfile.chmod(0o600)
        # zsh reads .zshenv before .zshrc. Preserve it, including any startup
        # directory it selects, then return to our private integration rc.
        envfile = root / ".zshenv"
        # Quote every path. An unquoted assignment word-splits directories that
        # contain spaces, and Ubuntu's global zshrc then runs compinit against
        # the private startup directory and refuses to load the user's rc.
        # Use POSIX quoting: this file is sourced before zsh parameter flags work.
        private_root = shlex.quote(str(root))
        envfile.write_text(
            "if [ -n \"${COLORIDE_USER_ZDOTDIR:-}\" ]; then\n"
            "  ZDOTDIR=$COLORIDE_USER_ZDOTDIR\n"
            "else\n"
            "  unset ZDOTDIR\n"
            "fi\n"
            'if [ -r "${ZDOTDIR:-$HOME}/.zshenv" ]; then\n'
            '  . "${ZDOTDIR:-$HOME}/.zshenv"\n'
            "fi\n"
            "COLORIDE_USER_ZDOTDIR=${ZDOTDIR-}\n"
            "export COLORIDE_USER_ZDOTDIR\n"
            f"ZDOTDIR={private_root}\n"
            "export ZDOTDIR\n"
            "# Ubuntu's global zshrc runs compinit and can consume the first\n"
            "# PTY input when a completion directory is group-writable. This\n"
            "# assignment is visible to that sourced file; the user's own\n"
            "# startup can still initialize completions later.\n"
            "skip_global_compinit=1\n",
            encoding="utf-8",
        )
        envfile.chmod(0o600)
        env["COLORIDE_USER_ZDOTDIR"] = env.get("ZDOTDIR", "")
        env["ZDOTDIR"] = str(root)
        return [executable, "-i"], env

    if name == "fish":
        initfile = root / "fish.fish"
        initfile.write_text(FISH_INTEGRATION, encoding="utf-8")
        initfile.chmod(0o600)
        return [executable, "-C", f"source {shlex.quote(str(initfile))}", "-i"], env

    # Fish and unknown shells keep their normal startup until a native hook is
    # available. The frontend simply receives no command markers for them.
    return [executable, "-l"], env


def remote_install_command() -> str:
    """Idempotently install the tiny rc snippets for this SSH account."""
    import base64

    bash = base64.b64encode(BASH_INTEGRATION.encode()).decode()
    zsh = base64.b64encode(ZSH_INTEGRATION.encode()).decode()
    fish = base64.b64encode(FISH_INTEGRATION.encode()).decode()
    root = "$HOME/.coloride/shell-integration"
    return (
        "umask 077; "
        f"mkdir -p {root}/zsh; "
        f"printf %s {shlex.quote(bash)} | base64 -d > {root}/bashrc; "
        f"printf %s {shlex.quote(zsh)} | base64 -d > {root}/zsh/.zshrc; "
        f"printf %s {shlex.quote(fish)} | base64 -d > {root}/fish.fish"
    )


def remote_shell_command(shell: str) -> str:
    root = "$HOME/.coloride/shell-integration"
    explicit = {
        "bash": f"bash --rcfile {root}/bashrc -i",
        "zsh": f"env ZDOTDIR={root}/zsh zsh -i",
        "fish": f"fish -C {shlex.quote(f'source {root}/fish.fish')} -i",
    }.get(shell)
    if explicit is not None:
        return explicit
    choose_server_shell = (
        'case "${SHELL##*/}" in '
        f"zsh) exec env ZDOTDIR={root}/zsh zsh -i ;; "
        f"fish) exec fish -C {shlex.quote(f'source {root}/fish.fish')} -i ;; "
        f"*) exec bash --rcfile {root}/bashrc -i ;; "
        "esac"
    )
    return f"sh -c {shlex.quote(choose_server_shell)}"
