"""Durable Coloride Runner primitives.

The runner is deliberately isolated from the desktop-side agent loop.  It runs
on the VPS and keeps durable state there, while the desktop only reconnects to
read its append-only event stream or explicitly stops a job.
"""

from .store import RunnerStore

__all__ = ["RunnerStore"]
