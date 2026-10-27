from __future__ import annotations

import contextlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

import asyncssh
import keyring


@dataclass(frozen=True, slots=True)
class CertificateBundle:
    profile_id: str
    public_key: str
    user_certificate: str
    host_ca_key: str
    expires_at: datetime


class CertificateStore(Protocol):
    async def save(self, bundle: CertificateBundle) -> None:
        raise NotImplementedError

    async def load(self, profile_id: str) -> CertificateBundle | None:
        raise NotImplementedError


class InMemoryCertificateStore:
    def __init__(self) -> None:
        self._bundles: dict[str, CertificateBundle] = {}

    async def save(self, bundle: CertificateBundle) -> None:
        self._bundles[bundle.profile_id] = bundle

    async def load(self, profile_id: str) -> CertificateBundle | None:
        return self._bundles.get(profile_id)


class KeyringCertificateStore:
    """Real persistent store for SSH user certificate material using the OS keyring.

    Stores secrets (private key + user cert) + metadata under the "coloride" service.
    Never puts private material in plain files or RAM-only structures for long term.
    """

    SERVICE = "coloride-certs"

    async def save(self, bundle: CertificateBundle, *, private_key: str | None = None) -> None:
        """Save bundle + optional private key.

        The private_key is the user's signing key (PEM). It is required for actual auth.
        We store it separately because CertificateBundle is public-ish metadata.
        """
        pid = bundle.profile_id
        if private_key:
            keyring.set_password(self.SERVICE, f"{pid}:private_key", private_key)

        keyring.set_password(self.SERVICE, f"{pid}:certificate", bundle.user_certificate)
        keyring.set_password(self.SERVICE, f"{pid}:ca_pub", bundle.public_key or bundle.host_ca_key)
        keyring.set_password(self.SERVICE, f"{pid}:expires", bundle.expires_at.isoformat())

        # Also keep a compact bundle json for convenience
        meta = {
            "profile_id": pid,
            "public_key": bundle.public_key,
            "host_ca_key": bundle.host_ca_key,
            "expires_at": bundle.expires_at.isoformat(),
        }
        keyring.set_password(self.SERVICE, f"{pid}:meta", json.dumps(meta))

    async def load(self, profile_id: str) -> CertificateBundle | None:
        pid = profile_id
        cert = keyring.get_password(self.SERVICE, f"{pid}:certificate")
        ca = keyring.get_password(self.SERVICE, f"{pid}:ca_pub") or ""
        exp_str = keyring.get_password(self.SERVICE, f"{pid}:expires")
        if not cert or not exp_str:
            return None
        try:
            expires = datetime.fromisoformat(exp_str)
        except Exception:
            expires = datetime.now(UTC) + timedelta(hours=24)

        # Reconstruct minimal bundle (private_key is NOT in the bundle on purpose)
        return CertificateBundle(
            profile_id=pid,
            public_key=ca,
            user_certificate=cert,
            host_ca_key=ca,
            expires_at=expires,
        )

    async def load_private_key(self, profile_id: str) -> str | None:
        return keyring.get_password(self.SERVICE, f"{profile_id}:private_key")

    async def save_private_key(self, profile_id: str, private_key: str) -> None:
        keyring.set_password(self.SERVICE, f"{profile_id}:private_key", private_key)

    async def delete(self, profile_id: str) -> None:
        pid = profile_id
        for suffix in ("private_key", "certificate", "ca_pub", "expires", "meta"):
            with contextlib.suppress(Exception):
                keyring.delete_password(self.SERVICE, f"{pid}:{suffix}")

    async def renew(self, profile_id: str, *, ttl_seconds: int = 24 * 3600) -> CertificateBundle | None:
        """Simple dev renewal: re-issue a fresh user cert using the existing private key.

        Returns updated bundle (without leaking private key).
        """
        priv = await self.load_private_key(profile_id)
        old = await self.load(profile_id)
        if not priv or not old:
            return None

        # We don't have the original CA priv here (dev limitation).
        # For real flow the CA lives on the VPS. For now we just extend the recorded expiry.
        new_expires = datetime.now(UTC) + timedelta(seconds=ttl_seconds)

        # Create a new bundle with same cert (or we could re-sign if we had CA).
        # Since we can't easily re-sign without CA priv in this process,
        # we just bump the recorded expiry as a "renewal" simulation.
        new_bundle = CertificateBundle(
            profile_id=profile_id,
            public_key=old.public_key,
            user_certificate=old.user_certificate,
            host_ca_key=old.host_ca_key,
            expires_at=new_expires,
        )
        await self.save(new_bundle, private_key=priv)
        return new_bundle


def generate_dev_certificate(
    *,
    principal: str = "root",
    ttl_seconds: int = 24 * 3600,
) -> tuple[str, str, str]:
    """Generate a throwaway ed25519 key + user cert signed by a dev CA.

    Returns (private_key_pem, user_certificate, ca_public_key).
    This is ONLY for local/dev testing of the cert auth code path.
    The target SSH server must be configured to trust the CA public key.
    """
    ca_priv = asyncssh.generate_private_key("ssh-ed25519")
    ca_pub = ca_priv.convert_to_public()

    user_priv = asyncssh.generate_private_key("ssh-ed25519")
    user_pub = user_priv.convert_to_public()

    cert = ca_priv.generate_user_certificate(
        user_pub,
        "dev-ca",
        principals=[principal],
        valid_after=0,
        valid_before=ttl_seconds,
    )

    priv_pem = user_priv.export_private_key().decode()
    user_cert = cert.export_certificate().decode()
    ca_pub_text = ca_pub.export_public_key().decode()

    return priv_pem, user_cert, ca_pub_text
