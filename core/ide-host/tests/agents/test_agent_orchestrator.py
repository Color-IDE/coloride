from __future__ import annotations

from coloride_desktop.agents.orchestrator import AgentOrchestrator, ModelGateway, UsageLedger
from coloride_desktop.agents.engine import ColorideAgentEngine


def test_orchestrator_is_the_named_engine_surface() -> None:
    assert issubclass(AgentOrchestrator, ColorideAgentEngine)
    assert ModelGateway.cache_key("sess_1") == "coloride:sess_1"
    assert UsageLedger is not None
