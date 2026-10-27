import type {
  AgentApproval,
  AgentEvent,
  AgentMode,
  AgentPlan,
  AgentPlanStep,
  AgentSessionSummary,
  TaskBudget,
} from "@coloride/contracts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { api } from "../../shared/api/client";

interface Dependencies {
  selectedSession: AgentSessionSummary | null;
  planBusy: boolean;
  setPlanBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setActivePlan: Dispatch<SetStateAction<AgentPlan | null>>;
  setSessions: Dispatch<SetStateAction<AgentSessionSummary[]>>;
  messageFromError: (error: unknown) => string;
  planDraftSteps: AgentPlanStep[];
  turnActive: boolean;
  planDraftTitle: string;
  setMode: Dispatch<SetStateAction<AgentMode>>;
  setResolvingApproval: Dispatch<SetStateAction<string | null>>;
  lastAgentEventAtRef: RefObject<number>;
  setEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  setResolvingGuard: Dispatch<SetStateAction<string | null>>;
}
export function useAgentPlanActions({
  selectedSession,
  planBusy,
  setPlanBusy,
  setError,
  setActivePlan,
  setSessions,
  messageFromError,
  planDraftSteps,
  turnActive,
  planDraftTitle,
  setMode,
  setResolvingApproval,
  lastAgentEventAtRef,
  setEvents,
  setResolvingGuard,
}: Dependencies) {

  const dismissPlan = async () => {
    if (!selectedSession || planBusy) return;
    setPlanBusy(true);
    setError("");
    try {
      const plan = await api.dismissAgentPlan(selectedSession.sessionId);
      setActivePlan(null);
      setSessions((current) =>
        current.map((session) =>
          session.sessionId === selectedSession.sessionId
            ? { ...session, plan: null }
            : session,
        ),
      );
      // Keep timeline history; dock hides because status is dismissed.
      void plan;
    } catch (reason) {
      setError(messageFromError(reason));
    } finally {
      setPlanBusy(false);
    }
  };

  const implementPlan = async () => {
    if (!selectedSession || planBusy) return;
    const steps = planDraftSteps
      .map((step, index) => ({
        ...step,
        id: step.id || `step_${index + 1}`,
        title: step.title.trim(),
        status: "pending" as const,
      }))
      .filter((step) => step.title.length > 0);
    if (!steps.length) {
      setError("Add at least one step before implementing.");
      return;
    }
    if (turnActive) {
      setError("Stop the active turn before implementing the plan.");
      return;
    }
    setPlanBusy(true);
    setError("");
    try {
      const updated = await api.implementAgentPlan(selectedSession.sessionId, {
        title: planDraftTitle.trim() || "Plan",
        steps,
      });
      setSessions((current) =>
        current.map((session) =>
          session.sessionId === updated.sessionId ? updated : session,
        ),
      );
      if (updated.plan) setActivePlan(updated.plan);
      setMode("act");
    } catch (reason) {
      setError(messageFromError(reason));
    } finally {
      setPlanBusy(false);
    }
  };

  const resolveApproval = async (
    approval: AgentApproval,
    decision: "approve" | "approve-session" | "decline",
  ) => {
    setResolvingApproval(approval.id);
    // Keep stall watchdog asleep while the user is authorizing.
    lastAgentEventAtRef.current = Date.now();
    try {
      await api.resolveAgentApproval(approval.id, decision);
      setEvents((current) =>
        current.map((event) =>
          event.type === "approval_required" && event.data.id === approval.id
            ? {
              ...event,
              data: {
                ...event.data,
                state: decision.startsWith("approve")
                  ? "approved"
                  : "declined",
              },
            }
            : event,
        ),
      );
      lastAgentEventAtRef.current = Date.now();
    } catch (reason) {
      const message = messageFromError(reason);
      // Stale card after restart: dismiss quietly — no "cooldown expired" nag.
      if (/approval_expired|no longer pending|expired/i.test(message)) {
        setEvents((current) =>
          current.map((event) =>
            event.type === "approval_required" && event.data.id === approval.id
              ? { ...event, data: { ...event.data, state: "declined" } }
              : event,
          ),
        );
      } else {
        setError(message);
      }
    } finally {
      setResolvingApproval(null);
    }
  };

  const resolveGuard = async (
    action: "retry-strategy" | "continue-once" | "update-budget" | "stop",
    budget?: TaskBudget,
  ) => {
    if (!selectedSession) return;
    setResolvingGuard(action);
    setError("");
    try {
      await api.resolveAgentGuard(selectedSession.sessionId, action, budget);
      const updated = await api.agentSession(selectedSession.sessionId);
      setSessions((current) =>
        current.map((session) =>
          session.sessionId === updated.sessionId ? updated : session,
        ),
      );
    } catch (reason) {
      setError(messageFromError(reason));
    } finally {
      setResolvingGuard(null);
    }
  };

  return { dismissPlan, implementPlan, resolveApproval, resolveGuard };
}
