import type { AgentTerminalReference } from "@coloride/contracts";
import { motion, useReducedMotion } from "motion/react";
import { memo, useMemo, useState, type ReactNode } from "react";
import { useAppPreferences } from "../../settings/preferences";
import { phaseGroupMeta, presentTurnItems } from "../presentAgentTimeline";
import { AgentDiffViewer } from "./DiffViewer";
import { AgentMessageText } from "./Markdown";
import { AgentAssistantMessage, AgentUserMessage } from "./Messages";
import { AgentPlanHistoryCard } from "./Plans";
import {
  COLLAPSE_TRANSITION,
  CollapsibleSection,
  ExploreTraceRail,
  ShimmerActionLabel,
} from "./Primitives";
import { AgentThinkingRow } from "./Reasoning";
import {
  AgentBrowserToolRow,
  AgentChangeWorkspaceRow,
  AgentCreateDirectoryRow,
  AgentDeletePathRow,
  AgentDiagnosticsRow,
  AgentFetchUrlRow,
  AgentGitDiffRow,
  AgentGitStatusRow,
  AgentListFilesRow,
  AgentMcpToolRow,
  AgentMovePathRow,
  AgentReadFileRow,
  AgentReviewRow,
  AgentReadProcessRow,
  AgentRenamePathRow,
  AgentSearchFilesRow,
  AgentSessionRecoveryRow,
  AgentStartProcessRow,
  AgentStopProcessRow,
  AgentSwitchUserRow,
  AgentToolRow,
  AgentWriteFileRow,
} from "./Tools";
import { formatThoughtDuration } from "./formatting";
import { ExpandChevronIcon } from "./icons";
import { isExploreItemRunning } from "./model";
import {
  type AgentOpenFileRequest,
  type AgentTimelineEntry,
  type AgentTimelineItemProps,
  type AgentUserTimelineEntry,
} from "./types";

export function AgentTimelineItem(props: AgentTimelineItemProps) {
  const { entry } = props;
  const reducedMotion = useReducedMotion();
  let node: ReactNode = null;

  if (entry.kind === "user") {
    node = (
      <AgentUserMessage
        attachments={entry.attachments}
        pluginIds={entry.pluginIds}
        sticky={false}
        text={entry.text}
      />
    );
  } else if (entry.kind === "assistant") {
    // Mount (and animate) only once there is visible text — avoids empty enter flash.
    if (entry.text.trim()) {
      node = (
        <AgentAssistantMessage
          entry={entry}
          onOpenBrowserUrl={props.onOpenBrowserUrl}
          turnActive={props.turnActive}
        />
      );
    }
  } else if (entry.kind === "plan") {
    if (entry.plan) {
      node = <AgentPlanHistoryCard plan={entry.plan} />;
    } else if (entry.text) {
      node = (
        <div className="agent-plan mb-4 border-l-2 pl-3 text-sm leading-6">
          <AgentMessageText
            onOpenBrowserUrl={props.onOpenBrowserUrl}
            text={entry.text}
          />
        </div>
      );
    }
  } else if (entry.kind === "activity") {
    node = <AgentThinkingRow entry={entry} />;
  } else if (entry.kind === "explore_group") {
    node = <AgentExploreGroupRow entry={entry} onOpenFile={props.onOpenFile} />;
  } else if (entry.kind === "tool") {
    // Plan lifecycle and task completion are engine protocols — don't spam tool rows for those calls.
    if (
      entry.tool === "submit_plan" ||
      entry.tool === "update_plan_step" ||
      entry.tool === "complete_task"
    ) {
      node = null;
    } else if (entry.tool === "guardian_review") {
      node = <AgentReviewRow entry={entry} />;
    } else if (entry.tool === "read_file") {
      node = <AgentReadFileRow entry={entry} onOpenFile={props.onOpenFile} />;
    } else if (entry.tool === "search_files") {
      node = <AgentSearchFilesRow entry={entry} />;
    } else if (entry.tool === "list_files") {
      node = <AgentListFilesRow entry={entry} />;
    } else if (
      entry.tool === "write_file" ||
      entry.tool === "replace_in_file"
    ) {
      node = <AgentWriteFileRow entry={entry} onOpenFile={props.onOpenFile} />;
    } else if (entry.tool === "create_directory") {
      node = <AgentCreateDirectoryRow entry={entry} />;
    } else if (entry.tool === "rename_path") {
      node = <AgentRenamePathRow entry={entry} />;
    } else if (entry.tool === "move_path") {
      node = <AgentMovePathRow entry={entry} />;
    } else if (entry.tool === "delete_path") {
      node = <AgentDeletePathRow entry={entry} />;
    } else if (entry.tool === "fetch_url") {
      node = <AgentFetchUrlRow entry={entry} />;
    } else if (entry.tool.startsWith("browser_")) {
      node = <AgentBrowserToolRow entry={entry} />;
    } else if (entry.tool === "git_status") {
      node = <AgentGitStatusRow entry={entry} />;
    } else if (entry.tool === "git_diff") {
      node = <AgentGitDiffRow entry={entry} />;
    } else if (entry.tool === "get_diagnostics") {
      node = <AgentDiagnosticsRow entry={entry} />;
    } else if (entry.tool === "start_process") {
      node = (
        <AgentStartProcessRow
          entry={entry}
          onOpenTerminal={props.onOpenTerminal}
        />
      );
    } else if (entry.tool === "read_process") {
      node = <AgentReadProcessRow entry={entry} />;
    } else if (entry.tool === "stop_process") {
      node = <AgentStopProcessRow entry={entry} />;
    } else if (entry.tool === "change_workspace") {
      node = <AgentChangeWorkspaceRow entry={entry} />;
    } else if (entry.tool === "switch_user") {
      node = <AgentSwitchUserRow entry={entry} />;
    } else if (entry.tool.startsWith("mcp__")) {
      node = <AgentMcpToolRow entry={entry} />;
    } else if (entry.tool === "search_chat_history") {
      node = <AgentSessionRecoveryRow entry={entry} />;
    } else {
      node = <AgentToolRow entry={entry} />;
    }
  } else if (entry.kind === "mode") {
    node = (
      <div className="agent-muted mb-4 text-center text-[11px]">
        {entry.text}
      </div>
    );
  } else if (entry.kind === "status") {
    node = (
      <div className="agent-status mb-4 text-center text-[11px]">
        {entry.text}
      </div>
    );
  } else if (entry.kind === "error") {
    node = (
      <div className="agent-error mb-4 rounded-lg px-3 py-2 text-xs">
        {entry.text}
      </div>
    );
  } else if (entry.kind === "diff") {
    node = <AgentDiffViewer patch={entry.patch} />;
  }
  // Checkpoints and approvals render above the composer, not as chat cards.

  if (!node) return null;
  // One-shot enter (CSS). Keyed by entry.id in the parent map so stream updates
  // re-render children without restarting the animation.
  return (
    <motion.div
      className="agent-timeline-reveal"
      initial={
        props.turnActive && !reducedMotion
          ? { height: 0, opacity: 0, overflow: "hidden" }
          : false
      }
      animate={{
        height: "auto",
        opacity: 1,
        transitionEnd: { overflow: "visible" },
      }}
      transition={COLLAPSE_TRANSITION}
    >
      {node}
    </motion.div>
  );
}

export const AgentTimelineTurn = memo(function AgentTimelineTurn({
  user,
  items,
  turnActive,
  onOpenFile,
  onOpenBrowserUrl,
  onOpenTerminal,
  checkpointCard = null,
}: {
  user: AgentUserTimelineEntry | null;
  items: AgentTimelineEntry[];
  turnActive: boolean;
  onOpenFile?: (request: AgentOpenFileRequest) => void;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenTerminal?: (terminal: AgentTerminalReference) => void;
  checkpointCard?: ReactNode;
}) {
  const { agentActivityDetail } = useAppPreferences();
  const visibleItems = useMemo(
    () => presentTurnItems(items, agentActivityDetail, turnActive),
    [items, agentActivityDetail, turnActive],
  );
  return (
    <section
      className={`agent-turn agent-timeline-enter${user ? " has-user" : ""}`}
    >
      {user ? (
        <AgentUserMessage
          attachments={user.attachments}
          pluginIds={user.pluginIds}
          sticky
          text={user.text}
        />
      ) : null}
      <div className="agent-turn-body">
        {visibleItems.map((entry) => (
          <AgentTimelineItem
            entry={entry}
            key={entry.id}
            onOpenBrowserUrl={onOpenBrowserUrl}
            onOpenFile={onOpenFile}
            onOpenTerminal={onOpenTerminal}
            turnActive={turnActive}
          />
        ))}
        {checkpointCard}
      </div>
    </section>
  );
});

export function AgentExploreGroupRow({
  entry,
  onOpenFile,
}: {
  entry: Extract<AgentTimelineEntry, { kind: "explore_group" }>;
  onOpenFile?: (request: AgentOpenFileRequest) => void;
}) {
  const tools = entry.items.filter((item) => item.kind === "tool");
  const running =
    tools.length > 0
      ? tools.some(isExploreItemRunning)
      : entry.items.some(isExploreItemRunning);
  const label = phaseGroupMeta(entry.items, running);
  const duration =
    label.durationMs > 0 ? formatThoughtDuration(label.durationMs) : "";
  const meta = [label.detail, duration].filter(Boolean).join(" · ");
  const title = meta ? `${label.verb}  ${meta}` : label.verb;
  const [expanded, setExpanded] = useState(false);
  const children = label.hideThoughts
    ? entry.items.filter((item) => item.kind !== "activity")
    : entry.items;

  return (
    <div
      className={`agent-thinking agent-explore-group ${running ? "is-running" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        onClick={() => setExpanded((current) => !current)}
        title={title}
        type="button"
      >
        <ShimmerActionLabel
          className="agent-thinking-label agent-explore-group-label"
          detail={meta}
          running={running}
          text={title}
          verb={label.verb}
        />
        <span className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}>
          <ExpandChevronIcon />
        </span>
      </button>
      <CollapsibleSection className="agent-explore-group-items" open={expanded}>
        <ExploreTraceRail>
          {children.map((item) => (
            <div className="agent-explore-group-item" key={item.id}>
              {item.kind === "activity" ? (
                <AgentThinkingRow entry={item} />
              ) : item.tool === "read_file" ? (
                <AgentReadFileRow entry={item} onOpenFile={onOpenFile} />
              ) : item.tool === "search_files" ? (
                <AgentSearchFilesRow entry={item} />
              ) : item.tool === "list_files" ? (
                <AgentListFilesRow entry={item} />
              ) : item.tool === "search_chat_history" ? (
                <AgentSessionRecoveryRow entry={item} nested />
              ) : item.tool === "write_file" ||
                item.tool === "replace_in_file" ? (
                <AgentWriteFileRow entry={item} onOpenFile={onOpenFile} />
              ) : (
                <AgentToolRow entry={item} />
              )}
            </div>
          ))}
        </ExploreTraceRail>
      </CollapsibleSection>
    </div>
  );
}
