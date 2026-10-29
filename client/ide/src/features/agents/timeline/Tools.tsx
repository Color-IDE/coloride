import type { AgentTerminalReference } from "@coloride/contracts";
import {
  Alert02Icon,
  BubbleChatSearchIcon,
  Loading03Icon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import { FileIcon } from "../../explorer/filetree/FileTree";
import { historySearchQuery } from "../presentAgentTimeline";
import {
  ArgumentDetails,
  CommandOutput,
  CommandSourceBlock,
  ListFilesOutput,
  ToolOutput,
} from "./CommandOutput";
import { AgentDiffViewer } from "./DiffViewer";
import { CollapsibleSection, ShimmerActionLabel } from "./Primitives";
import {
  fileBaseName,
  formatListFilesActionParts,
  formatReadFileActionParts,
  formatSearchFilesActionParts,
  looksLikeUnifiedDiff,
  mcpPluginId,
  numberValue,
  parseUnifiedDiff,
  recordValue,
  stringArgument,
  stripExitCodePrefix,
  switchUserName,
  toolActionParts,
  toolTarget,
} from "./formatting";
import {
  AnalyzeBrowserIcon,
  ChangeWorkspaceIcon,
  CreateDirectoryIcon,
  DeletePathIcon,
  DiagnosticsIcon,
  ExpandChevronIcon,
  FetchUrlIcon,
  GitDiffIcon,
  GitStatusIcon,
  ListFilesIcon,
  MovePathIcon,
  pluginToolMark,
  ReadFileIcon,
  ReadProcessIcon,
  RenamePathIcon,
  SearchFilesIcon,
  StartProcessIcon,
  StopProcessIcon,
  SwitchUserIcon,
  ThoughtIcon,
  toolIcon,
} from "./icons";
import {
  type AgentOpenFileRequest,
  type LiveEditPayload,
  type ToolTimelineEntry,
} from "./types";

export function AgentReadFileRow({
  entry,
  onOpenFile,
}: {
  entry: ToolTimelineEntry;
  onOpenFile?: (request: AgentOpenFileRequest) => void;
}) {
  const { path, start, end, range, verb } = formatReadFileActionParts(entry);
  const name = path.replace(/^.*[/\\]/, "") || path;
  const hasDetail = Boolean(entry.output.trim()) || entry.failed;
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`agent-thinking agent-read-file ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <div className="agent-read-file-card relative flex min-w-0 max-w-full items-center gap-1">
        <button
          aria-expanded={expanded && hasDetail}
          aria-label={`${expanded ? "Hide" : "Show"} read contents for ${name}`}
          className="agent-read-file-toggle"
          disabled={!hasDetail}
          onClick={() => setExpanded((current) => !current)}
          type="button"
        />
        <span className="agent-thinking-icon" aria-hidden="true">
          <ReadFileIcon />
        </span>
        <span className="agent-read-file-verb">{verb}</span>
        <button
          className="agent-read-file-open"
          disabled={!onOpenFile || path === "file"}
          onClick={() =>
            onOpenFile?.({
              path,
              line: start !== null ? Math.max(1, Math.trunc(start)) : undefined,
            })
          }
          title={`Open ${path}${range}`}
          type="button"
        >
          <FileIcon className="agent-read-file-icon" name={name} />
          <span className="agent-read-file-name">{name}</span>
        </button>
        {range && (
          <span className="agent-read-file-range">
            ,{" "}
            {start !== null && end !== null
              ? `lines ${Math.trunc(start)} to ${Math.trunc(end)}`
              : `line ${Math.trunc(start ?? end!)}`}
          </span>
        )}
        {hasDetail && (
          <span
            aria-hidden="true"
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </div>
      <CollapsibleSection
        className="agent-thinking-detail agent-read-file-detail"
        open={expanded && hasDetail}
      >
        {entry.failed && !entry.output ? "Failed to read file" : entry.output}
      </CollapsibleSection>
    </div>
  );
}

export function AgentSearchFilesRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = formatSearchFilesActionParts(entry);
  const action = `${parts.verb} ${parts.detail}`.trim();
  const hasDetail = Boolean(entry.output.trim()) || entry.failed;
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(running && hasDetail);

  useEffect(() => {
    setExpanded(running && hasDetail);
  }, [hasDetail, running]);

  return (
    <div
      className={`agent-thinking agent-search-files ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <SearchFilesIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-search-files-label"
          detail={parts.detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-search-files-detail"
        open={expanded && hasDetail}
      >
        {entry.failed && !entry.output
          ? "Failed to search files"
          : entry.output}
      </CollapsibleSection>
    </div>
  );
}

export function AgentListFilesRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = formatListFilesActionParts(entry);
  const action = `${parts.verb} ${parts.detail}`.trim();
  const hasDetail = Boolean(entry.output.trim()) || entry.failed;
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`agent-thinking agent-list-files-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <ListFilesIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-list-files-label"
          detail={parts.detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-list-files-inline"
        open={expanded && hasDetail}
      >
        <ListFilesOutput
          expanded
          output={
            entry.failed && !entry.output
              ? "Failed to list files"
              : entry.output
          }
        />
      </CollapsibleSection>
    </div>
  );
}

export function AgentCreateDirectoryRow({
  entry,
}: {
  entry: ToolTimelineEntry;
}) {
  const parts = toolActionParts(entry);
  const path = stringArgument(entry.arguments.path) || parts.detail;
  const action =
    `${parts.verb}${parts.detail ? ` ${parts.detail}` : ""}`.trim();
  const hasDetail =
    Boolean(path) || Boolean(entry.output.trim()) || entry.failed;
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`agent-thinking agent-create-directory-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <CreateDirectoryIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-create-directory-label"
          detail={parts.detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-create-directory-detail"
        open={expanded && hasDetail}
      >
        {path ? (
          <div className="agent-create-directory-path">{path}</div>
        ) : null}
        {entry.failed && !entry.output ? (
          <div className="agent-create-directory-note">
            Failed to create directory
          </div>
        ) : null}
        {entry.output.trim() ? (
          <div className="agent-create-directory-note">
            {entry.output.trim()}
          </div>
        ) : null}
      </CollapsibleSection>
    </div>
  );
}

export function AgentRenamePathRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = toolActionParts(entry);
  const from = stringArgument(entry.arguments.path);
  const name = stringArgument(entry.arguments.new_name);
  const to =
    from && name
      ? `${from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : ""}${name}`
      : name;
  const detail = from && to ? `${from} to ${to}` : from || to || parts.detail;
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") || "Failed to rename path"
    : "";
  // Only expand when there is an error note — success stays a single text line.
  const hasDetail = Boolean(errorText);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-rename-path-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <RenamePathIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-rename-path-label"
          detail={detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-rename-path-detail"
        open={expanded && hasDetail}
      >
        <div className="agent-rename-path-note is-error">{errorText}</div>
      </CollapsibleSection>
    </div>
  );
}

export function AgentMovePathRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = toolActionParts(entry);
  const from = stringArgument(entry.arguments.old_path);
  const to = stringArgument(entry.arguments.new_path);
  const detail = from && to ? `${from} to ${to}` : from || to || parts.detail;
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") || "Failed to move path"
    : "";
  const hasDetail = Boolean(errorText);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-move-path-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <MovePathIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-move-path-label"
          detail={detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-move-path-detail"
        open={expanded && hasDetail}
      >
        <div className="agent-move-path-note is-error">{errorText}</div>
      </CollapsibleSection>
    </div>
  );
}

export function AgentDeletePathRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = toolActionParts(entry);
  const path = stringArgument(entry.arguments.path) || parts.detail;
  const detail = path || "path";
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") || "Failed to delete path"
    : "";
  const hasDetail = Boolean(errorText);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-delete-path-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <DeletePathIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-delete-path-label"
          detail={detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-delete-path-detail"
        open={expanded && hasDetail}
      >
        <div className="agent-delete-path-note is-error">{errorText}</div>
      </CollapsibleSection>
    </div>
  );
}

export function AgentChangeWorkspaceRow({
  entry,
}: {
  entry: ToolTimelineEntry;
}) {
  const parts = toolActionParts(entry);
  const requested = stringArgument(entry.arguments.path);
  const cwd = stringArgument(entry.metadata.cwd) || requested;
  const previous = stringArgument(entry.metadata.previousCwd);
  const detail = cwd || parts.detail || "workspace";
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") ||
    "Failed to change workspace"
    : "";
  const successNote =
    !entry.failed && previous && cwd && previous !== cwd
      ? `${previous} → ${cwd}`
      : "";
  const hasDetail = Boolean(errorText) || Boolean(successNote);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-change-workspace-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <ChangeWorkspaceIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-change-workspace-label"
          detail={detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-change-workspace-detail"
        open={expanded && hasDetail}
      >
        {errorText ? (
          <div className="agent-change-workspace-note is-error">
            {errorText}
          </div>
        ) : successNote ? (
          <div className="agent-change-workspace-note">{successNote}</div>
        ) : null}
      </CollapsibleSection>
    </div>
  );
}

export function AgentSwitchUserRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = toolActionParts(entry);
  const user = switchUserName(entry);
  const detail = user || parts.detail;
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") || "Failed to switch user"
    : "";
  const reason = stringArgument(entry.arguments.reason);
  const hasDetail = Boolean(errorText) || Boolean(reason);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-switch-user-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <SwitchUserIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-switch-user-label"
          detail={detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-switch-user-detail"
        open={expanded && hasDetail}
      >
        {errorText ? (
          <div className="agent-switch-user-note is-error">{errorText}</div>
        ) : reason ? (
          <div className="agent-switch-user-note">{reason}</div>
        ) : null}
      </CollapsibleSection>
    </div>
  );
}

export function AgentGitStatusRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = toolActionParts(entry);
  const detail = parts.detail || "Git status";
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") ||
    "Failed to check Git status"
    : "";
  const bodyText = errorText || stripExitCodePrefix(entry.output.trim());
  const hasDetail = Boolean(bodyText);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-git-status-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <GitStatusIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-git-status-label"
          detail={detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-git-status-detail"
        open={expanded && hasDetail}
      >
        <div className={`agent-git-status-note${errorText ? " is-error" : ""}`}>
          {bodyText}
        </div>
      </CollapsibleSection>
    </div>
  );
}

export function AgentGitDiffRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = toolActionParts(entry);
  const detail = parts.detail || "Git diff";
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") ||
    "Failed to read Git diff"
    : "";
  const bodyText = errorText || stripExitCodePrefix(entry.output.trim());
  const hasDetail = Boolean(bodyText);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-git-diff-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <GitDiffIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-git-diff-label"
          detail={detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-git-diff-detail"
        open={expanded && hasDetail}
      >
        {errorText ? (
          <div className="agent-git-diff-note is-error">{errorText}</div>
        ) : entry.diff || looksLikeUnifiedDiff(bodyText) ? (
          <AgentDiffViewer
            hideHeader
            patch={entry.diff || bodyText}
            preferredPath={stringArgument(entry.arguments.path)}
            preview={!entry.diff}
          />
        ) : (
          <div className="agent-git-diff-note">
            {bodyText || "(no changes)"}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

export function AgentDiagnosticsRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = toolActionParts(entry);
  const rawPath = stringArgument(entry.arguments.path);
  const path = rawPath === "." ? "" : rawPath;
  const detail = path ? `diagnostics ${path}` : "diagnostics";
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") ||
    "Failed to check diagnostics"
    : "";
  const bodyText = errorText || stripExitCodePrefix(entry.output.trim());
  const hasDetail = Boolean(bodyText);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-diagnostics-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <DiagnosticsIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-diagnostics-label"
          detail={detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-diagnostics-detail"
        open={expanded && hasDetail}
      >
        <div
          className={`agent-diagnostics-note${errorText ? " is-error" : ""}`}
        >
          {bodyText}
        </div>
      </CollapsibleSection>
    </div>
  );
}

export function AgentStartProcessRow({
  entry,
  onOpenTerminal,
}: {
  entry: ToolTimelineEntry;
  onOpenTerminal?: (terminal: AgentTerminalReference) => void;
}) {
  const parts = toolActionParts(entry);
  const command =
    stringArgument(entry.arguments.command) || parts.detail || "process";
  const detail = parts.detail || command;
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") ||
    "Failed to start process"
    : "";
  const bodyText = errorText || entry.output.trim();
  const hasDetail = Boolean(bodyText);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);
  const terminalValue = recordValue(entry.metadata.terminal);
  const terminal =
    stringArgument(terminalValue.termId) &&
      stringArgument(terminalValue.sessionId)
      ? {
        termId: stringArgument(terminalValue.termId),
        sessionId: stringArgument(terminalValue.sessionId),
        title: stringArgument(terminalValue.title) || null,
        cwd: stringArgument(terminalValue.cwd) || null,
        workspaceKind:
          terminalValue.workspaceKind === "ssh"
            ? ("ssh" as const)
            : ("local" as const),
        connectionId: stringArgument(terminalValue.connectionId) || null,
        agentSessionId: stringArgument(terminalValue.agentSessionId) || null,
        workspacePath: stringArgument(terminalValue.workspacePath) || null,
        revealed: Boolean(terminalValue.revealed),
      }
      : null;

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-start-process-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <div className="agent-start-process-head">
        <button
          aria-expanded={expanded}
          className="agent-thinking-toggle"
          disabled={!hasDetail}
          onClick={() => setExpanded((current) => !current)}
          title={action}
          type="button"
        >
          <span className="agent-thinking-icon" aria-hidden="true">
            <StartProcessIcon />
          </span>
          <ShimmerActionLabel
            className="agent-thinking-label agent-start-process-label"
            detail={detail}
            running={running}
            text={action}
            verb={parts.verb}
          />
          {hasDetail && (
            <span
              className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
            >
              <ExpandChevronIcon />
            </span>
          )}
        </button>
        {terminal && onOpenTerminal ? (
          <button
            aria-label={`Open ${terminal.title || command} in terminal`}
            className="agent-start-process-open"
            onClick={() => onOpenTerminal(terminal)}
            title="Open this process in the terminal"
            type="button"
          >
            <span aria-hidden="true">
              <StartProcessIcon />
            </span>
            Open in terminal
          </button>
        ) : null}
      </div>
      <CollapsibleSection
        className="agent-thinking-detail agent-start-process-detail"
        open={expanded && hasDetail}
      >
        <div
          className={`agent-start-process-note${errorText ? " is-error" : ""}`}
        >
          {bodyText}
        </div>
      </CollapsibleSection>
    </div>
  );
}

export function AgentReadProcessRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = toolActionParts(entry);
  const processId =
    stringArgument(entry.arguments.process_id) || parts.detail || "process";
  const detail = processId;
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") || "Failed to read process"
    : "";
  const bodyText = errorText || entry.output.trim();
  const hasDetail = Boolean(bodyText);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-read-process-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <ReadProcessIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-read-process-label"
          detail={detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-read-process-detail"
        open={expanded && hasDetail}
      >
        <div
          className={`agent-read-process-note${errorText ? " is-error" : ""}`}
        >
          {bodyText}
        </div>
      </CollapsibleSection>
    </div>
  );
}

export function AgentStopProcessRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = toolActionParts(entry);
  const processId =
    stringArgument(entry.arguments.process_id) || parts.detail || "process";
  const detail = processId;
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") || "Failed to stop process"
    : "";
  const hasDetail = Boolean(errorText);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-stop-process-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <StopProcessIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-stop-process-label"
          detail={detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-stop-process-detail"
        open={expanded && hasDetail}
      >
        <div className="agent-stop-process-note is-error">{errorText}</div>
      </CollapsibleSection>
    </div>
  );
}

export function AgentFetchUrlRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = toolActionParts(entry);
  const url = stringArgument(entry.arguments.url) || parts.detail;
  const detail = url || "web page";
  const action = `${parts.verb}${detail ? ` ${detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") ||
    "Failed to read web page"
    : "";
  const bodyText = errorText || entry.output.trim();
  const hasDetail = Boolean(bodyText);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-fetch-url-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <FetchUrlIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-fetch-url-label"
          detail={detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-fetch-url-detail"
        open={expanded && hasDetail}
      >
        <div className={`agent-fetch-url-note${errorText ? " is-error" : ""}`}>
          {bodyText}
        </div>
      </CollapsibleSection>
    </div>
  );
}

/** Browser tools as plain thought-style text (no card chrome). */
export function AgentBrowserToolRow({ entry }: { entry: ToolTimelineEntry }) {
  const parts = toolActionParts(entry);
  const action =
    `${parts.verb}${parts.detail ? ` ${parts.detail}` : ""}`.trim();
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") || "Browser action failed"
    : "";
  // Keep output collapsible only on failure / rare long bodies — default is text-only like Thought.
  const bodyText = errorText || (entry.failed ? entry.output.trim() : "");
  const hasDetail = Boolean(bodyText);
  const running = !entry.complete && !entry.failed;
  const [expanded, setExpanded] = useState(entry.failed);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-browser-tool-row ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span className="agent-thinking-icon" aria-hidden="true">
          <AnalyzeBrowserIcon />
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label agent-browser-tool-label"
          detail={parts.detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail && (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        )}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail agent-browser-tool-detail"
        open={expanded && hasDetail}
      >
        <div
          className={`agent-browser-tool-note${errorText ? " is-error" : ""}`}
        >
          {bodyText}
        </div>
      </CollapsibleSection>
    </div>
  );
}

export function AgentWriteFileRow({
  entry,
  onOpenFile,
}: {
  entry: ToolTimelineEntry;
  onOpenFile?: (request: AgentOpenFileRequest) => void;
}) {
  const patch = entry.diff || entry.preview;
  const path = stringArgument(entry.arguments.path);
  const name = fileBaseName(path) || "file";
  const stats = useMemo(
    () => (patch ? parseUnifiedDiff(patch, path) : null),
    [patch, path],
  );
  const running = !entry.complete && !entry.failed;
  const canOpen = Boolean(path && onOpenFile);
  const livePayload = liveEditPayload(entry);
  const runningVerb = entry.tool === "write_file" ? "Writing" : "Editing";
  const errorText = entry.failed
    ? entry.output.trim().replace(/^Error:\s*/i, "") || "Edit failed"
    : "";

  const isFreshLiveEditRef = useRef<boolean | null>(null);
  if (isFreshLiveEditRef.current === null) {
    const rawCreatedAt =
      typeof entry.metadata.createdAt === "string"
        ? entry.metadata.createdAt
        : "";
    const createdMs = rawCreatedAt ? Date.parse(rawCreatedAt) : NaN;
    isFreshLiveEditRef.current =
      running ||
      entry.metadata.liveWrite === true ||
      (Number.isFinite(createdMs) && Date.now() - createdMs < 4_500);
  } else if (running) {
    isFreshLiveEditRef.current = true;
  }

  const [revealProgress, setRevealProgress] = useState<{
    revealing: boolean;
    additions: number;
    deletions: number;
  } | null>(null);

  const effectivelyWriting = running || Boolean(revealProgress?.revealing);
  const displayedAdditions = revealProgress?.revealing
    ? revealProgress.additions
    : (stats?.additions ?? 0);
  const displayedDeletions = revealProgress?.revealing
    ? revealProgress.deletions
    : (stats?.deletions ?? 0);

  return (
    <div
      className={`agent-edit-card${effectivelyWriting ? " is-running" : ""}${entry.failed ? " is-failed" : ""}`}
    >
      <button
        className="agent-edit-card-head"
        disabled={!canOpen}
        onClick={() => {
          if (!canOpen) return;
          onOpenFile?.({ path, patch: patch || undefined });
        }}
        title={path ? `Open ${path}` : name}
        type="button"
      >
        <span className="agent-edit-card-icon" aria-hidden="true">
          <FileIcon className="agent-edit-card-file-icon" name={name} />
        </span>
        <span className="agent-edit-card-copy">
          {effectivelyWriting ? (
            <span className="agent-edit-card-running-label">
              <span className="agent-edit-card-running-verb">
                {runningVerb}
              </span>
              <span className="agent-edit-card-title" title={path || name}>
                {name}
              </span>
              <Icon
                aria-hidden="true"
                className="agent-edit-card-spinner"
                icon={Loading03Icon}
                size={14}
                strokeWidth={2}
              />
            </span>
          ) : (
            <span className="agent-edit-card-title">{name}</span>
          )}
          {!entry.failed &&
            (displayedAdditions > 0 || displayedDeletions > 0) ? (
            <span className="agent-write-file-stats" aria-hidden="true">
              {displayedAdditions > 0 && (
                <span className="agent-diff-additions">
                  +{displayedAdditions}
                </span>
              )}
              {displayedDeletions > 0 && (
                <span className="agent-diff-deletions">
                  -{displayedDeletions}
                </span>
              )}
            </span>
          ) : null}
        </span>
      </button>
      {running && livePayload ? (
        <StreamingEditCode payload={livePayload} />
      ) : patch ? (
        <div className="agent-edit-card-diff">
          <AgentDiffViewer
            animateReveal={Boolean(isFreshLiveEditRef.current)}
            hideHeader
            onRevealStateChange={setRevealProgress}
            patch={patch}
            preferredPath={path}
            preview={!entry.diff}
          />
        </div>
      ) : livePayload && !entry.failed ? (
        <StreamingEditCode payload={livePayload} />
      ) : entry.failed ? (
        <div className="agent-edit-card-note">{errorText}</div>
      ) : entry.output.trim() ? (
        <div className="agent-edit-card-diff">
          <ToolOutput output={entry.output} />
        </div>
      ) : null}
    </div>
  );
}

export function liveEditPayload(
  entry: ToolTimelineEntry,
): LiveEditPayload | null {
  if (entry.tool === "replace_in_file") {
    const streamedOld =
      typeof entry.metadata.streamedOldText === "string"
        ? entry.metadata.streamedOldText
        : stringArgument(entry.arguments.old_text);
    const streamedNew =
      typeof entry.metadata.streamedNewText === "string"
        ? entry.metadata.streamedNewText
        : stringArgument(entry.arguments.new_text);
    if (streamedOld || streamedNew) {
      return { kind: "replace", oldText: streamedOld, newText: streamedNew };
    }
  }
  const streamed = entry.metadata.streamedContent;
  if (typeof streamed === "string" && streamed) {
    return { kind: "write", code: streamed };
  }
  const content = stringArgument(entry.arguments.content);
  if (content) {
    return { kind: "write", code: content };
  }
  const fallbackNew = stringArgument(entry.arguments.new_text);
  const fallbackOld = stringArgument(entry.arguments.old_text);
  if (fallbackOld || fallbackNew) {
    return { kind: "replace", oldText: fallbackOld, newText: fallbackNew };
  }
  return null;
}

export function StreamingEditCode({ payload }: { payload: LiveEditPayload }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => {
    if (payload.kind === "replace") {
      const result: Array<{
        kind: "deletion" | "addition";
        lineNo: number;
        text: string;
      }> = [];
      if (payload.oldText) {
        const oldLines = payload.oldText.split("\n");
        for (let i = 0; i < oldLines.length; i += 1) {
          result.push({
            kind: "deletion",
            lineNo: i + 1,
            text: oldLines[i] ?? "",
          });
        }
      }
      if (payload.newText) {
        const newLines = payload.newText.split("\n");
        for (let i = 0; i < newLines.length; i += 1) {
          result.push({
            kind: "addition",
            lineNo: i + 1,
            text: newLines[i] ?? "",
          });
        }
      }
      return result.length > 0
        ? result
        : [{ kind: "addition" as const, lineNo: 1, text: "" }];
    }
    const lines = payload.code ? payload.code.split("\n") : [""];
    return lines.map((text, index) => ({
      kind: "addition" as const,
      lineNo: index + 1,
      text,
    }));
  }, [payload]);

  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(rows.length, 6),
  );

  useEffect(() => {
    if (visibleCount >= rows.length) return;
    const raf = window.requestAnimationFrame(() => {
      setVisibleCount((current) => {
        if (current >= rows.length) return rows.length;
        const remaining = rows.length - current;
        const step = Math.max(2, Math.min(10, Math.ceil(remaining * 0.16)));
        return Math.min(rows.length, current + step);
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [rows.length, visibleCount]);

  const displayedRows = rows.slice(
    0,
    Math.max(1, Math.min(visibleCount, rows.length)),
  );
  const highlightFrom = Math.max(0, displayedRows.length - 4);

  useLayoutEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    node.scrollLeft = 0;
  }, [displayedRows.length, payload]);

  return (
    <div className="agent-edit-stream" ref={scrollerRef}>
      <div className="agent-edit-stream-inner">
        {displayedRows.map((row, index) => (
          <div
            className={`agent-edit-stream-line${row.kind === "deletion"
              ? " is-deletion"
              : index >= highlightFrom
                ? " is-new"
                : ""
              }`}
            key={`el-${row.kind}-${index}`}
          >
            <span className="agent-edit-stream-no">
              {row.kind === "deletion" ? `-${row.lineNo}` : row.lineNo}
            </span>
            <code>{row.text || " "}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentMcpToolRow({ entry }: { entry: ToolTimelineEntry }) {
  const pluginId = mcpPluginId(entry.tool);
  const parts = toolActionParts(entry);
  const action =
    `${parts.verb}${parts.detail ? ` ${parts.detail}` : ""}`.trim();
  const running = !entry.complete && !entry.failed;
  const hasDetail = Boolean(entry.output.trim()) || entry.failed;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (entry.failed) setExpanded(true);
  }, [entry.failed]);

  return (
    <div
      className={`agent-thinking agent-mcp-tool ${running ? "is-running" : entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => setExpanded((current) => !current)}
        title={action}
        type="button"
      >
        <span
          className="agent-thinking-icon agent-mcp-tool-icon"
          aria-hidden="true"
        >
          {pluginToolMark(pluginId)}
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label"
          detail={parts.detail}
          running={running}
          text={action}
          verb={parts.verb}
        />
        {hasDetail ? (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        ) : null}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail"
        open={expanded && hasDetail}
      >
        {entry.failed && !entry.output ? "Failed to call plugin" : entry.output}
      </CollapsibleSection>
    </div>
  );
}

export function AgentSessionRecoveryRow({
  entry,
  nested = false,
}: {
  entry: ToolTimelineEntry;
  nested?: boolean;
}) {
  const running = !entry.complete && !entry.failed;
  const scanned = numberValue(entry.metadata.scanned);
  const hits = numberValue(entry.metadata.hits);
  const already = Boolean(entry.metadata.already);
  const query = historySearchQuery(entry);
  const [expanded, setExpanded] = useState(false);
  let verb = running
    ? "Recovering session context"
    : "Session context recovered";
  if (nested)
    verb = running ? "Searching chat history" : "Searched chat history";
  if (already && !running)
    verb = nested ? "Already in context" : "Session context already available";
  const detailParts: string[] = [];
  if (nested && query) detailParts.push(`“${query}”`);
  if (!nested && scanned !== null && scanned > 0) {
    detailParts.push(`${scanned} previous event${scanned === 1 ? "" : "s"}`);
  } else if (!nested && hits !== null && hits > 0) {
    detailParts.push(`${hits} hit${hits === 1 ? "" : "s"}`);
  }
  const title = detailParts.length
    ? `${verb} · ${detailParts.join(", ")}`
    : verb;
  const hasDetail = Boolean(entry.output.trim());
  return (
    <div
      className={`agent-thinking agent-session-recovery ${running ? "is-running" : ""} ${entry.failed ? "is-failed" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => {
          if (!hasDetail) return;
          setExpanded((current) => !current);
        }}
        title={title}
        type="button"
      >
        <span
          className={`agent-thinking-icon agent-phase-icon is-recovery${running ? " is-live" : ""}${entry.failed ? " is-failed" : ""}`}
          aria-hidden="true"
        >
          {entry.failed ? (
            <Icon icon={Alert02Icon} size={15} strokeWidth={1.8} />
          ) : running ? (
            <Icon
              icon={nested ? Search01Icon : BubbleChatSearchIcon}
              size={15}
              strokeWidth={1.8}
            />
          ) : (
            <Icon icon={Tick02Icon} size={14} strokeWidth={2.2} />
          )}
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label"
          detail={detailParts.join(", ")}
          running={running}
          text={title}
          verb={verb}
        />
        {hasDetail ? (
          <span
            className={`agent-thinking-chevron ${expanded ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        ) : null}
      </button>
      <CollapsibleSection
        className="agent-thinking-detail"
        open={expanded && hasDetail}
      >
        {entry.output}
      </CollapsibleSection>
    </div>
  );
}

export function AgentToolRow({ entry }: { entry: ToolTimelineEntry }) {
  const command = stringArgument(entry.arguments.command);
  const patch = entry.diff || entry.preview;
  const isCommand = entry.tool === "execute_command" || Boolean(command);
  const informational =
    !isCommand &&
    [
      "git_status",
      "get_diagnostics",
      "list_files",
      "search_files",
      "read_tool_output",
      "read_process",
      "list_terminals",
      "read_terminal",
    ].includes(entry.tool);
  const waitingApproval = entry.waitingApproval;
  // Commands stay collapsed by default (header + $ cmd). Expand only on click / failure.
  // Other tools open while running, on failure, or when they have body content.
  const defaultExpanded = waitingApproval
    ? false
    : isCommand
      ? entry.failed
      : !entry.complete || entry.failed || Boolean(command) || Boolean(patch);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasDetails = Boolean(
    command || entry.output || patch || Object.keys(entry.arguments).length,
  );
  const parts = toolActionParts(entry);
  const action =
    `${parts.verb}${parts.detail ? ` ${parts.detail}` : ""}`.trim();
  const target = toolTarget(entry);
  const showBody = expanded && hasDetails;
  // Always show the $ command body in chat (including while waiting Allow) so the user
  // can read the full command before approving from the composer dock.
  const showCommandShell = isCommand && Boolean(command);
  const showCommandOutput = isCommand && expanded;

  useEffect(() => {
    // While waiting for Allow, keep output collapsed (command source stays visible).
    if (waitingApproval) setExpanded(false);
  }, [waitingApproval]);

  useEffect(() => {
    // Non-command tools still open on failure; commands open only when they fail.
    if (isCommand) {
      if (entry.failed) setExpanded(true);
      return;
    }
    if (!entry.complete || entry.failed) setExpanded(true);
  }, [entry.complete, entry.failed, isCommand]);

  const pending = !entry.complete && !entry.failed;
  // Shimmer on command header while waiting for allow or while the command runs.
  const commandPending = isCommand && pending;
  // Text-style tools (browser, etc.) also shimmer while in progress.
  const labelRunning = pending && !waitingApproval;

  return (
    <div
      className={`agent-tool-row ${informational ? "is-informational" : ""} ${isCommand ? "is-command" : ""} ${entry.failed ? "is-failed" : entry.complete ? "is-complete" : "is-running"}${commandPending ? " is-command-pending" : ""}${waitingApproval ? " is-waiting-approval" : ""}${!expanded && !waitingApproval && isCommand ? " is-command-collapsed" : ""}${expanded && isCommand ? " is-command-expanded" : ""}`}
    >
      <button
        aria-expanded={expanded}
        className="agent-tool-header"
        disabled={!hasDetails}
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        {entry.tool !== "execute_command" && (
          <span className="agent-tool-icon">{toolIcon(entry.tool)}</span>
        )}
        <span className="agent-tool-copy">
          <ShimmerActionLabel
            className="agent-tool-title"
            detail={parts.detail}
            running={labelRunning}
            text={action}
            title={action}
            verb={parts.verb}
          />
          {target && !parts.detail ? (
            <span className="agent-tool-target agent-tool-rest" title={target}>
              {target}
            </span>
          ) : null}
        </span>
        {hasDetails && (
          <span className={`agent-tool-chevron ${expanded ? "is-open" : ""}`}>
            <ExpandChevronIcon />
          </span>
        )}
      </button>

      {showCommandShell && (
        <div className="agent-tool-body agent-command-shell-body">
          <div className="agent-command-block">
            <CommandSourceBlock command={command} />
            <CollapsibleSection
              className="agent-command-output-shell"
              open={showCommandOutput}
            >
              <CommandOutput entry={entry} />
            </CollapsibleSection>
          </div>
        </div>
      )}

      {!isCommand && (
        <CollapsibleSection className="agent-tool-body" open={showBody}>
          {patch && (
            <AgentDiffViewer
              patch={patch}
              preferredPath={stringArgument(entry.arguments.path)}
              preview={!entry.diff}
            />
          )}
          {entry.output && <ToolOutput output={entry.output} />}
          {!patch && !entry.output && (
            <ArgumentDetails arguments={entry.arguments} />
          )}
        </CollapsibleSection>
      )}
    </div>
  );
}


/** Agent-side reviews use the same compact activity shell as other IDE work. */
export function AgentReviewRow({ entry }: { entry: ToolTimelineEntry }) {
  const [expanded, setExpanded] = useState(false);
  const running = !entry.complete && !entry.failed;
  const status = String(entry.metadata.reviewStatus ?? (running ? "Reviewing" : entry.failed ? "Not approved" : "Approved"));
  const hasDetail = Boolean(entry.output.trim());
  return (
    <div className={`agent-thinking agent-review-row${running ? " is-running" : ""}${entry.failed ? " is-failed" : ""}`}>
      <button className="agent-thinking-toggle" type="button" disabled={!hasDetail}
        aria-expanded={hasDetail ? expanded : undefined} onClick={() => setExpanded(value => !value)}>
        <span className="agent-thinking-icon" aria-hidden="true"><ThoughtIcon /></span>
        <ShimmerActionLabel className="agent-thinking-label" running={running}
          text={`Guardian Review · ${status}`} verb="Guardian Review" detail={running ? "" : status} />
        {hasDetail ? <span className={`agent-thinking-chevron${expanded ? " is-open" : ""}`}><ExpandChevronIcon /></span> : null}
      </button>
      <CollapsibleSection className="agent-thinking-detail" open={expanded && hasDetail}>
        <div className="agent-browser-tool-note whitespace-pre-wrap">{entry.output}</div>
      </CollapsibleSection>
    </div>
  );
}
