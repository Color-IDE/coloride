from __future__ import annotations

import stat

import asyncssh

from coloride_desktop.ssh.host_keys import HostKeyStore


def test_host_key_store_tracks_unknown_trusted_and_changed(tmp_path) -> None:
    store_path = tmp_path / "host_keys.json"
    store = HostKeyStore(store_path)
    first = asyncssh.generate_private_key("ssh-ed25519").convert_to_public()
    replacement = asyncssh.generate_private_key("ssh-ed25519").convert_to_public()

    assert store.inspect("Example.COM", 2222, first).status == "unknown"

    trusted = store.trust("example.com", 2222, first)
    assert trusted.status == "trusted"
    assert store.inspect("EXAMPLE.com", 2222, first).status == "trusted"

    changed = store.inspect("example.com", 2222, replacement)
    assert changed.status == "changed"
    assert changed.trusted_fingerprint == first.get_fingerprint("sha256")
    assert stat.S_IMODE(store_path.stat().st_mode) == 0o600


def test_host_key_store_scopes_keys_by_port(tmp_path) -> None:
    store = HostKeyStore(tmp_path / "host_keys.json")
    key = asyncssh.generate_private_key("ssh-ed25519").convert_to_public()
    store.trust("server.test", 22, key)

    assert store.get("server.test", 22) is not None
    assert store.get("server.test", 2222) is None


def test_host_key_store_can_forget_a_trusted_identity(tmp_path) -> None:
    store_path = tmp_path / "host_keys.json"
    store = HostKeyStore(store_path)
    key = asyncssh.generate_private_key("ssh-ed25519").convert_to_public()
    store.trust("server.test", 22, key)

    assert store.forget("server.test", 22) is True
    assert store.get("server.test", 22) is None
    assert HostKeyStore(store_path).get("server.test", 22) is None
    assert store.forget("server.test", 22) is False
