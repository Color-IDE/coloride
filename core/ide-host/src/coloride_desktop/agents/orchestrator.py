from __future__ import annotations

"""Named core: Orchestrator → ContextEngine → ModelGateway → ToolRouter → Ledger.

The turn loop still lives in ColorideAgentEngine so Plan-mode, approvals, and
streaming stay in one place. This module is the stable import surface.
"""

from .engine import AgentLoopError, ColorideAgentEngine
from .gateway import ModelGateway
from .ledger import UsageLedger
from .memory import ConversationMemory
from .retrieval import TurnRetrievalState, classify_user_intent
from .task import AgentTask, AgentTaskStatus

__all__ = [
    "AgentLoopError",
    "AgentOrchestrator",
    "AgentTask",
    "AgentTaskStatus",
    "ConversationMemory",
    "ModelGateway",
    "TurnRetrievalState",
    "UsageLedger",
    "classify_user_intent",
]


class AgentOrchestrator(ColorideAgentEngine):
    """Task-driven agent core. LLM is one step, not the whole agent."""
