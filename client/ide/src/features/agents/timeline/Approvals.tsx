import { ToolScrollArea } from "./ToolScrollArea";
import type { AgentApproval } from "@coloride/contracts";
import { Plug01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import { pluginArtworkSrc } from "../SlashCommandMenu";
import { resolveAgentPlugin } from "../sessionPlugins";
import { CommandSourceBlock } from "./CommandOutput";
import { AgentDiffViewer } from "./DiffViewer";
import {
  commandName,
  fileBaseName,
  fileEditTitle,
  fileEditVerb,
  looksLikeUnifiedDiff,
  mcpPluginId,
  WRITE_APPROVAL_TOOLS,
} from "./formatting";
import { CreateDirectoryIcon, LinearToolMark, WriteFileIcon } from "./icons";

export function AgentApprovalCard({
  approval,
  onResolve,
  resolvingApproval,
  variant = "full",
}: {
  approval: AgentApproval;
  onResolve: (
    approval: AgentApproval,
    decision: "approve" | "approve-session" | "decline",
  ) => void;
  resolvingApproval: string | null;
  /** Explorer sidebar keeps the old Allow bar. Agents tab uses the command card. */
  variant?: "full" | "sidebar";
}) {
  const pending = approval.state === "pending";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const busy = resolvingApproval === approval.id;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [menuOpen]);

  useEffect(() => {
    if (!pending || variant !== "full" || busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(false);
        onResolve(approval, "decline");
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      onResolve(
        approval,
        event.metaKey || event.ctrlKey ? "approve-session" : "approve",
      );
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [approval, busy, onResolve, pending, variant]);

  if (!pending) return null;

  const command =
    typeof approval.details.command === "string"
      ? approval.details.command
      : "";
  const tool =
    typeof approval.details.tool === "string" ? approval.details.tool : "";
  const wantedUser =
    typeof approval.details.wantedUser === "string"
      ? approval.details.wantedUser
      : "";
  const filePath =
    typeof approval.details.path === "string" ? approval.details.path : "";
  const oldPath =
    typeof approval.details.oldPath === "string"
      ? approval.details.oldPath
      : "";
  const newPath =
    typeof approval.details.newPath === "string"
      ? approval.details.newPath
      : "";
  const diff =
    typeof approval.details.diff === "string" ? approval.details.diff : "";
  const isUserSwitch = tool === "switch_user";
  const pluginId =
    mcpPluginId(tool) ||
    (typeof approval.details.plugin === "string"
      ? approval.details.plugin
      : "") ||
    (typeof approval.details.server === "string"
      ? approval.details.server
      : "");
  const isMcp =
    tool.startsWith("mcp__") ||
    Boolean(pluginId && approval.details.remoteTool);
  const plugin = pluginId ? resolveAgentPlugin(pluginId) : undefined;
  const isFileEdit =
    WRITE_APPROVAL_TOOLS.has(tool) ||
    (!isUserSwitch &&
      !isMcp &&
      !command &&
      Boolean(filePath || oldPath || newPath));
  const fileLabel = fileBaseName(filePath || newPath || oldPath);
  const remoteTool =
    typeof approval.details.remoteTool === "string"
      ? approval.details.remoteTool.replaceAll("_", " ")
      : "";
  const name = isUserSwitch
    ? wantedUser || "admin"
    : isFileEdit
      ? fileLabel || "file"
      : isMcp
        ? plugin?.name || pluginId || "plugin"
        : commandName(command) || "command";
  const isCommandApproval = !isUserSwitch && !isFileEdit && !isMcp;

  if (variant === "sidebar") {
    return (
      <div className="agent-approval agent-approval-dock agent-command-approval">
        <div className="agent-approval-label">
          <span className="agent-tool-verb">
            {isUserSwitch
              ? "Switch user"
              : isFileEdit
                ? fileEditVerb(tool)
                : isMcp
                  ? "Allow"
                  : "Allow command"}
          </span>
          <span className="agent-tool-rest">
            {" "}
            {isMcp ? `${name}${remoteTool ? ` · ${remoteTool}` : ""}` : name}
          </span>
        </div>
        <div className="agent-approval-actions">
          <button
            className="agent-approval-skip"
            disabled={busy}
            onClick={() => onResolve(approval, "decline")}
            type="button"
          >
            Skip
          </button>
          <button
            className="agent-approval-skip"
            disabled={busy}
            onClick={() => onResolve(approval, "approve-session")}
            type="button"
          >
            {isCommandApproval ? "Allow all commands" : "Allow for session"}
          </button>
          <button
            className="agent-approval-skip"
            disabled={busy}
            onClick={() => onResolve(approval, "approve")}
            type="button"
          >
            Allow once
          </button>
        </div>
      </div>
    );
  }

  const title = isUserSwitch
    ? `Do you want to switch to ${wantedUser || "admin"}?`
    : isFileEdit
      ? fileEditTitle(tool, name)
      : isMcp
        ? `Do you want to use ${name}?`
        : `Do you want to run ${name}?`;

  return (
    <div
      className={`agent-approval agent-approval-dock agent-command-approval is-card${isFileEdit ? " is-edit" : ""}${isMcp ? " is-plugin" : ""}`}
    >
      <div className="agent-command-approval-title">{title}</div>
      {isMcp ? (
        <div className="agent-command-approval-plugin">
          <span
            className="agent-command-approval-plugin-mark"
            aria-hidden="true"
          >
            {pluginId === "linear" ? (
              <LinearToolMark size={32} />
            ) : pluginArtworkSrc(pluginId) ? (
              <img alt="" src={pluginArtworkSrc(pluginId)} />
            ) : (
              <Icon icon={Plug01Icon} size={28} />
            )}
          </span>
          <span className="agent-command-approval-plugin-copy">
            <span className="agent-command-approval-plugin-name">{name}</span>
            {remoteTool ? (
              <span className="agent-command-approval-plugin-tool">
                {remoteTool}
              </span>
            ) : null}
          </span>
        </div>
      ) : isFileEdit && looksLikeUnifiedDiff(diff) ? (
        <div className="agent-command-approval-diff">
          <AgentDiffViewer
            hideHeader
            patch={diff}
            preferredPath={filePath}
            preview
          />
        </div>
      ) : isFileEdit ? (
        <div className="agent-command-approval-file">
          <span className="agent-command-approval-file-icon" aria-hidden="true">
            {tool === "create_directory" ? (
              <CreateDirectoryIcon />
            ) : (
              <WriteFileIcon />
            )}
          </span>
          <span
            className="agent-command-approval-file-path"
            title={filePath || `${oldPath} → ${newPath}`}
          >
            {tool === "rename_path" || tool === "move_path"
              ? `${oldPath || filePath} → ${newPath || name}`
              : filePath || oldPath || name}
          </span>
        </div>
      ) : isUserSwitch ? (
        <ToolScrollArea as="pre" className="agent-command-approval-cmd">
          <code>{`Switch to ${wantedUser || "admin"}`}</code>
        </ToolScrollArea>
      ) : (
        <div className="agent-command-approval-term">
          <CommandSourceBlock command={command.trim() || name} />
        </div>
      )}
      <div className="agent-command-approval-footer">
        <div className="agent-command-approval-split" ref={menuRef}>
          <button
            className="agent-command-approval-accept"
            disabled={busy}
            onClick={() => onResolve(approval, "approve")}
            type="button"
          >
            Accept
          </button>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="More accept options"
            className={`agent-command-approval-caret${menuOpen ? " is-open" : ""}`}
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
              <path
                d="m6 9 6 6 6-6"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </button>
          {menuOpen ? (
            <div className="agent-command-approval-menu" role="menu">
              <button
                className="agent-command-approval-menu-item"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  onResolve(approval, "approve");
                }}
                role="menuitem"
                type="button"
              >
                <span>Accept</span>
                <span className="agent-command-approval-shortcut">⏎</span>
              </button>
              <button
                className="agent-command-approval-menu-item"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  onResolve(approval, "approve-session");
                }}
                role="menuitem"
                type="button"
              >
                <span>
                  {isCommandApproval
                    ? "Accept and never ask again"
                    : "Accept for session"}
                </span>
                <span className="agent-command-approval-shortcut">⌘⏎</span>
              </button>
              <button
                className="agent-command-approval-menu-item"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  onResolve(approval, "decline");
                }}
                role="menuitem"
                type="button"
              >
                <span>Skip</span>
                <span className="agent-command-approval-shortcut">Esc</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
