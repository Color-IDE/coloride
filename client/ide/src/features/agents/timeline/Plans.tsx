import type {
  AgentPlan,
  AgentPlanStep,
  AgentPlanStepStatus,
} from "@coloride/contracts";
import {
  Forward01Icon,
  Loading03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import { CollapsibleSection, ShimmerActionLabel } from "./Primitives";
import { ExpandChevronIcon } from "./icons";

export function planStepStatusIcon(status: AgentPlanStepStatus) {
  if (status === "done")
    return (
      <Icon icon={Tick02Icon} aria-hidden="true" size={12} strokeWidth={2.5} />
    );
  if (status === "in_progress") {
    return (
      <Icon
        icon={Loading03Icon}
        aria-hidden="true"
        className="agent-plan-step-spin"
        size={12}
        strokeWidth={2}
      />
    );
  }
  if (status === "skipped")
    return (
      <Icon icon={Forward01Icon} aria-hidden="true" size={11} strokeWidth={2} />
    );
  return null;
}

export function planTriggerLabel(
  plan: AgentPlan,
  done: number,
  total: number,
): {
  verb: string;
  detail: string;
  running: boolean;
  compact: boolean;
} {
  if (plan.status === "implementing") {
    // No meta on the right while live — just the shimmer label.
    return {
      verb: "Following plan…",
      detail: "",
      running: true,
      compact: false,
    };
  }
  if (plan.status === "completed") {
    // Short collapsed chip once finished.
    return {
      verb: "Done.",
      detail: `${done}/${total}`,
      running: false,
      compact: true,
    };
  }
  if (plan.status === "ready") {
    return {
      verb: "Plan",
      detail: `${total} steps`,
      running: false,
      compact: false,
    };
  }
  return {
    verb: "Plan",
    detail: `${done}/${total}`,
    running: false,
    compact: false,
  };
}

/** Vertical rail of plan steps — ChatReasoning timeline, Coloride plan tokens. */
export function AgentPlanRail({
  steps,
  className,
}: {
  steps: AgentPlanStep[];
  className?: string;
}) {
  if (!steps.length) return null;
  return (
    <ol
      className={className ? `agent-plan-rail ${className}` : "agent-plan-rail"}
    >
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li
            className={`agent-plan-rail-step is-${step.status}`}
            key={step.id}
          >
            <div className="agent-plan-rail-track" aria-hidden="true">
              <span className="agent-plan-rail-dot">
                {planStepStatusIcon(step.status)}
              </span>
              <span
                className={`agent-plan-rail-line${last ? " is-fade" : ""}`}
              />
            </div>
            <div className="agent-plan-rail-body">
              <span className="agent-plan-rail-title">{step.title}</span>
              {step.detail ? (
                <span className="agent-plan-rail-detail">{step.detail}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function AgentPlanHistoryCard({ plan }: { plan: AgentPlan }) {
  const done = plan.steps.filter(
    (step) => step.status === "done" || step.status === "skipped",
  ).length;
  const active = plan.status === "implementing" || plan.status === "ready";
  const [expanded, setExpanded] = useState(active);

  useEffect(() => {
    // Stay open while following; collapse when the run finishes (user can re-open).
    if (plan.status === "implementing" || plan.status === "ready") {
      setExpanded(true);
    } else if (plan.status === "completed") {
      setExpanded(false);
    }
  }, [plan.status]);

  const trigger = planTriggerLabel(plan, done, plan.steps.length);
  const titleText = trigger.detail
    ? `${trigger.verb} ${trigger.detail}`
    : trigger.verb;

  return (
    <div
      className={`agent-plan-card mb-4 is-${plan.status}${trigger.compact ? " is-compact" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-plan-card-toggle"
        onClick={() => setExpanded((current) => !current)}
        title={plan.title}
        type="button"
      >
        <ShimmerActionLabel
          className="agent-plan-card-toggle-label"
          detail={trigger.detail}
          running={trigger.running}
          text={titleText}
          verb={trigger.verb}
        />
        <span className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}>
          <ExpandChevronIcon />
        </span>
      </button>
      <CollapsibleSection className="agent-plan-card-body" open={expanded}>
        {plan.summary ? (
          <p className="agent-plan-card-summary">{plan.summary}</p>
        ) : null}
        <AgentPlanRail steps={plan.steps} />
      </CollapsibleSection>
    </div>
  );
}

export function AgentPlanDock({
  plan,
  draftSteps,
  draftTitle,
  busy,
  onDismiss,
  onImplement,
}: {
  plan: AgentPlan;
  draftSteps: AgentPlanStep[];
  draftTitle: string;
  busy: boolean;
  onChangeTitle?: (title: string) => void;
  onChangeStepTitle?: (stepId: string, title: string) => void;
  onAddStep?: () => void;
  onRemoveStep?: (stepId: string) => void;
  onMoveStep?: (stepId: string, direction: -1 | 1) => void;
  onDismiss: () => void;
  onImplement?: () => void;
}) {
  const steps = draftSteps.length ? draftSteps : plan.steps;
  const done = steps.filter(
    (step) => step.status === "done" || step.status === "skipped",
  ).length;
  const pending = steps.filter(
    (step) => step.status === "pending" || step.status === "in_progress",
  ).length;
  // Ready + leftover steps → user can Implement (build/fix). Pure analysis often completes alone.
  const canImplement =
    Boolean(onImplement) &&
    (plan.status === "ready" || plan.status === "implementing") &&
    pending > 0 &&
    !busy;

  const [expanded, setExpanded] = useState(true);

  const headerLabel =
    plan.status === "completed"
      ? `Done · ${done}/${steps.length}`
      : plan.status === "implementing"
        ? `Following · ${done}/${steps.length}`
        : pending > 0
          ? `${steps.length} steps · ${pending} left`
          : `Plan · ${steps.length} steps`;

  if (plan.status === "dismissed") return null;

  return (
    <div className="agent-approval agent-approval-dock agent-plan-dock">
      <div className="agent-plan-dock-main">
        <div className="agent-plan-dock-header">
          <button
            aria-expanded={expanded}
            className="agent-plan-dock-toggle"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            <span className="agent-approval-label">
              <span className="agent-tool-verb">
                {draftTitle || plan.title}
              </span>
              <span className="agent-tool-rest"> · {headerLabel}</span>
            </span>
            <span
              className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
            >
              <ExpandChevronIcon />
            </span>
          </button>
          <div className="agent-approval-actions agent-plan-dock-actions">
            <button
              className="agent-approval-skip"
              disabled={busy}
              onClick={onDismiss}
              type="button"
            >
              Dismiss
            </button>
            {canImplement ? (
              <button
                className="primary"
                disabled={busy}
                onClick={onImplement}
                type="button"
              >
                Implement
              </button>
            ) : null}
          </div>
        </div>
        <CollapsibleSection className="agent-plan-dock-body" open={expanded}>
          <AgentPlanRail className="agent-plan-dock-rail" steps={steps} />
        </CollapsibleSection>
      </div>
    </div>
  );
}
