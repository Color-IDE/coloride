import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import type { AgentTerminalReference } from "../../shared/api/types";
import { type AgentOpenFileRequest } from "./AgentTimeline";
import { type AgentWorkspaceToolKind } from "./AgentWorkspacePanel";
import type { AgentViewProps } from "./agentViewTypes";

interface Dependencies {
  agentWorkspacePath: string | null;
  isSidebar: boolean;
  props: AgentViewProps;
  setWorkspaceFileRequest: Dispatch<
    SetStateAction<{
      path: string;
      patch?: string;
      content?: string;
      line?: number;
      nonce: number;
    } | null>
  >;
  selectedSessionIdRef: RefObject<string | null>;
  setWorkspaceOpenRequest: Dispatch<
    SetStateAction<{
      kind: AgentWorkspaceToolKind;
      nonce: number;
      terminal?: AgentTerminalReference;
    } | null>
  >;

}
export function useAgentWorkspaceNavigation({
  agentWorkspacePath,
  isSidebar,
  props,
  setWorkspaceFileRequest,
  selectedSessionIdRef,
  setWorkspaceOpenRequest,
}: Dependencies) {
  const openWorkspaceFile = useCallback(
    (request: AgentOpenFileRequest | string) => {
      const path = typeof request === "string" ? request : request.path;
      const patch = typeof request === "string" ? undefined : request.patch;
      const trimmed = path.trim();
      if (!trimmed) return;
      // Resolve relative agent paths against the selected workspace so /api/files/read works.
      const root = (agentWorkspacePath ?? "").replace(/\/+$/, "");
      const resolved =
        trimmed.startsWith("/") || !root
          ? trimmed
          : trimmed === "."
            ? root
            : `${root}/${trimmed.replace(/^\/+/, "")}`;

      if (isSidebar && props.onOpenExplorerFile) {
        // Optional first-line jump from unified diff header (best-effort).
        let line = typeof request === "string" ? undefined : request.line;
        if (line == null && typeof patch === "string" && patch.trim()) {
          const m = /^@@ -\d+(?:,\d+)? \+(\d+)/m.exec(patch);
          if (m?.[1]) {
            const n = Number(m[1]);
            if (Number.isFinite(n) && n >= 1) line = n;
          }
        }
        void props.onOpenExplorerFile(
          resolved,
          line != null ? { line } : undefined,
        );
        return;
      }

      setWorkspaceFileRequest({
        path: resolved,
        line: typeof request === "string" ? undefined : request.line,
        patch: typeof patch === "string" && patch.trim() ? patch : undefined,
        nonce: Date.now(),
      });
    },
    [agentWorkspacePath, isSidebar, props.onOpenExplorerFile],
  );

  const openWorkspaceTerminal = useCallback(
    (terminal: AgentTerminalReference) => {
      if (
        terminal.agentSessionId &&
        terminal.agentSessionId !== selectedSessionIdRef.current
      )
        return;
      const revealed = { ...terminal, revealed: true };
      if (isSidebar) {
        window.dispatchEvent(
          new CustomEvent("coloride:agent-terminal", { detail: revealed }),
        );
      } else {
        setWorkspaceOpenRequest({
          kind: "terminal",
          nonce: Date.now(),
          terminal: revealed,
        });
      }
    },
    [isSidebar],
  );

  /** Open chat links in the system browser. */
  const openWorkspaceBrowser = useCallback(
    (rawUrl: string) => {
      const trimmed = String(rawUrl || "").trim();
      if (!trimmed) return;
      let url = trimmed;
      if (!/^https?:\/\//i.test(url)) {
        // Bare host/path from chat — prefer http for localhost VPS apps.
        if (/^(localhost|127\.0\.0\.1|\[?::1\]?)(:|\/|$)/i.test(url)) {
          url = `http://${url}`;
        } else {
          url = `https://${url}`;
        }
      } else {
        // Force http on loopback — local dev servers rarely use TLS.
        try {
          const parsed = new URL(url);
          const host = parsed.hostname.toLowerCase();
          if (
            (host === "localhost" || host === "127.0.0.1" || host === "::1") &&
            parsed.protocol === "https:"
          ) {
            parsed.protocol = "http:";
            url = parsed.toString();
          }
        } catch {
          // keep url
        }
      }

      if (window.colorideDesktop?.openExternal) {
        void window.colorideDesktop.openExternal(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    [],
  );

  return { openWorkspaceFile, openWorkspaceTerminal, openWorkspaceBrowser };
}
