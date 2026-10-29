import { useMemo, useRef, useState } from "react";
import type { AgentCheckpoint } from "@coloride/contracts";
import { api, decodeBase64ToText, encodeTextToBase64 } from "../../shared/api/client";
import { notify } from "../../shared/ui/notifications";
import { AgentCheckpointDock, parseUnifiedDiff, type AgentOpenFileRequest, type AgentTimelineEntry, type CheckpointFileStat } from "../agents/AgentTimeline";
import { clearAgentEditReview, getAgentEditReview, queueAgentEditHighlight } from "../editor/agentEditBridge";
import { filePatch } from "./presentExternalTimeline";
import { workspaceFilePath } from "./workspaceFilePath";

type Change = { path: string; before: string; after: string; created: boolean };

function changesFrom(entries: AgentTimelineEntry[], workspace?: string | null, agentWorkspace?: string | null) {
  const changes = new Map<string, Change>();
  for (const entry of entries) {
    if (entry.kind !== "tool" || !entry.complete || entry.failed || entry.metadata.interrupted
      || !["write_file", "replace_in_file"].includes(entry.tool)) continue;
    const args = entry.arguments;
    if (typeof args.path !== "string" || typeof args.old_text !== "string" || typeof args.new_text !== "string") continue;
    const path = workspaceFilePath(args.path, workspace, agentWorkspace);
    if (!path) continue;
    const previous = changes.get(path);
    changes.set(path, {path, before:previous?.before ?? args.old_text, after:args.new_text,
      created:previous?.created ?? entry.tool === "write_file"});
  }
  return [...changes.values()].filter(change => change.before !== change.after);
}

export function ExternalAgentChanges({entries, sessionId, turnId, workspacePath, agentWorkspacePath, turnActive, onOpenFile}: {
  entries: AgentTimelineEntry[];
  sessionId: string;
  turnId: string;
  workspacePath?: string | null;
  agentWorkspacePath?: string | null;
  turnActive: boolean;
  onOpenFile?: (request: AgentOpenFileRequest) => void;
}) {
  const changes = useMemo(() => changesFrom(entries, workspacePath, agentWorkspacePath), [entries, workspacePath, agentWorkspacePath]);
  const storageKey = `coloride.external-review:${sessionId}:${turnId}:${changes.map(change => change.path).join("|")}`;
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set());
  const undonePaths = useRef(new Set<string>());
  let persisted = false;
  try { persisted = localStorage.getItem(storageKey) === "done"; } catch { /* Storage is optional. */ }
  const [restoring, setRestoring] = useState(false);
  const [expanded, setExpanded] = useState(false);
  if (turnActive || !changes.length || dismissedKeys.has(storageKey) || persisted) return null;

  const checkpoints: AgentCheckpoint[] = [{id:storageKey, sessionId, tool:"replace_in_file", callId:turnId,
    cwd:workspacePath ?? "", createdAt:"", paths:changes.map(change => ({path:change.path, kind:"file"}))}];
  const stats = new Map<string, CheckpointFileStat>();
  for (const change of changes) {
    const patch = filePatch(change.path, change.before, change.after);
    const parsed = parseUnifiedDiff(patch, change.path);
    stats.set(change.path, {patch, additions:parsed.additions, deletions:parsed.deletions});
  }
  const finish = () => {
    for (const change of changes) {
      const review = getAgentEditReview(change.path);
      if (review?.before === change.before && review.after === change.after) clearAgentEditReview(change.path);
    }
    try { localStorage.setItem(storageKey, "done"); } catch { /* Session-only dismissal still works. */ }
    setDismissedKeys(current => new Set(current).add(storageKey));
  };
  const showError = (reason: unknown) => notify({id:`external-review:${sessionId}:${turnId}`, kind:"error",
    title:"Could not review changes", description:reason instanceof Error ? reason.message : "The file operation failed."});
  const reviewFile = async (request: AgentOpenFileRequest) => {
    const change = changes.find(change => change.path === request.path);
    if (!change || !onOpenFile) return;
    try {
      const current = await api.readFile(change.path);
      if (current.truncated || decodeBase64ToText(current.content) !== change.after)
        throw new Error("This file has changed since this turn. Open its latest version in the explorer.");
      queueAgentEditHighlight(change.path, change.before, change.after);
      onOpenFile(request);
    } catch (reason) { showError(reason); }
  };
  const undo = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      // Preflight every file before writing any: never replace a newer user/agent edit.
      const prepared = [];
      for (const change of changes) {
        if (undonePaths.current.has(change.path)) continue;
        const {entries:stat} = await api.statFiles(change.path);
        if (!stat.length) throw new Error("Could not check the current file.");
        if (!stat[0]?.exists) {
          if (change.created) continue;
          throw new Error(`"${change.path.split("/").at(-1)}" was deleted after this turn.`);
        }
        const current = await api.readFile(change.path);
        if (current.truncated || decodeBase64ToText(current.content) !== change.after)
          throw new Error(`"${change.path.split("/").at(-1)}" has newer changes. Undo was stopped to preserve them.`);
        prepared.push({change, etag:current.etag});
      }
      for (const {change, etag} of prepared) {
        if (change.created) {
          const current = await api.readFile(change.path);
          if (current.etag !== etag || decodeBase64ToText(current.content) !== change.after)
            throw new Error("The file changed while undoing. Its newer content was preserved.");
          await api.deleteFile(change.path, false);
        } else await api.writeFile(change.path, encodeTextToBase64(change.before), etag);
        undonePaths.current.add(change.path);
      }
      finish();
      window.dispatchEvent(new Event("coloride:workspace-files-changed"));
    } catch (reason) { showError(reason); }
    finally { setRestoring(false); }
  };
  return <div className="agent-turn-checkpoint-card">
    <AgentCheckpointDock checkpoints={checkpoints} fileStats={stats} variant="full"
      onKeepAll={finish} onUndoAll={() => void undo()} onReview={() => setExpanded(open => !open)}
      onOpenFile={onOpenFile ? request => void reviewFile(request) : undefined}
      restoring={restoring} reviewOpen={expanded} turnActive={turnActive} />
  </div>;
}
