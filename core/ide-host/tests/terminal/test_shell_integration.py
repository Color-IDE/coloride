from __future__ import annotations

import shlex
from pathlib import Path

from coloride_desktop.term.shell_integration import (
    BASH_INTEGRATION,
    FISH_INTEGRATION,
    LOCAL_BASH_INTEGRATION,
    ZSH_INTEGRATION,
    create_local_shell_launch,
    remote_install_command,
    remote_shell_command,
)


def test_local_zsh_uses_private_zdotdir(monkeypatch) -> None:
    monkeypatch.setenv("HOME", "/Users/example")
    monkeypatch.setenv("TERM", "dumb")
    command, env = create_local_shell_launch("/bin/zsh")

    assert command == ["/bin/zsh", "-i"]
    assert env["TERM"] == "xterm-256color"
    rcfile = Path(env["ZDOTDIR"]) / ".zshrc"
    assert rcfile.stat().st_mode & 0o777 == 0o600
    assert "ColorideStart" in rcfile.read_text()
    assert 'source "${ZDOTDIR:-$HOME}/.zshrc"' in rcfile.read_text()


def test_local_bash_uses_private_rcfile() -> None:
    command, _ = create_local_shell_launch("/bin/bash")

    assert command[:2] == ["/bin/bash", "--rcfile"]
    assert Path(command[2]).read_text() == LOCAL_BASH_INTEGRATION
    assert command[-1] == "-i"


def test_remote_scripts_emit_coloride_osc_markers() -> None:
    install = remote_install_command()

    assert "base64 -d" in install
    assert "shell-integration/bashrc" in install
    assert "ColorideStart" in BASH_INTEGRATION
    assert "ColorideEnd" in ZSH_INTEGRATION
    assert "fish_postexec" in FISH_INTEGRATION
    assert remote_shell_command("bash").endswith("/bashrc -i")
    assert "ZDOTDIR" in remote_shell_command("zsh")
    assert "fish.fish" in remote_shell_command("fish")
    assert "${SHELL##*/}" in remote_shell_command("default")


def test_local_zsh_preserves_custom_startup_directory(monkeypatch, tmp_path):
    monkeypatch.setenv("ZDOTDIR", str(tmp_path / "custom config"))
    _, env = create_local_shell_launch("/bin/zsh")
    assert env["COLORIDE_USER_ZDOTDIR"] == str(tmp_path / "custom config")
    assert env["ZDOTDIR"] != env["COLORIDE_USER_ZDOTDIR"]


def test_local_zsh_loads_user_zshenv_and_its_redirected_rc(monkeypatch, tmp_path):
    import os
    import pty
    import subprocess

    original = tmp_path / "original config"
    redirected = tmp_path / "redirected config"
    original.mkdir()
    redirected.mkdir()
    (original / ".zshenv").write_text(f'export USER_ENV_MARKER=loaded\nZDOTDIR="{redirected}"\n')
    (redirected / ".zshrc").write_text("export USER_RC_MARKER=loaded\n")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("ZDOTDIR", str(original))
    command, env = create_local_shell_launch("/bin/zsh")
    startup = (Path(env["ZDOTDIR"]) / ".zshenv").read_text()
    assert "skip_global_compinit=1" in startup
    assert f"ZDOTDIR={shlex.quote(env['ZDOTDIR'])}" in startup
    master, slave = pty.openpty()
    proc = subprocess.Popen(command, env=env, stdin=slave, stdout=slave, stderr=slave, close_fds=True)
    os.close(slave)
    # Queue the command before zsh enables its line editor. A later write can
    # land in the middle of that switch and leave the shell waiting.
    os.write(master, b'printf "ENV=%s RC=%s\\n" "$USER_ENV_MARKER" "$USER_RC_MARKER"\nexit\n')
    output = b""
    while True:
        try:
            data = os.read(master, 1024)
            if not data:
                break
            output += data
        except OSError:
            break
    proc.wait(timeout=5)
    os.close(master)
    text = output.decode("utf-8", errors="ignore")
    assert "ENV=loaded RC=loaded" in text
    assert "insecure directories" not in text
