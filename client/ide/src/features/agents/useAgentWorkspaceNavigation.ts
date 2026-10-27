import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import type { AgentTerminalReference } from "../../shared/api/types";
import { applyBrowserProxy } from "../explorer/browserProxy";
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
  SIDEBAR_BROWSER_TAB_ID: "coloride-agent-sidebar-browser";
  setWorkspaceBrowserRequest: Dispatch<
    SetStateAction<{ url: string; nonce: number } | null>
  >;
}
export function useAgentWorkspaceNavigation({
  agentWorkspacePath,
  isSidebar,
  props,
  setWorkspaceFileRequest,
  selectedSessionIdRef,
  setWorkspaceOpenRequest,
  SIDEBAR_BROWSER_TAB_ID,
  setWorkspaceBrowserRequest,
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

  /**
   * Open links in the agent workspace, except from the Explorer sidebar where
   * they belong in a separate Coloride Browser window (same VPS SOCKS session).
   */
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

      if (isSidebar) {
        const browserEmbed = window.colorideDesktop?.browserEmbed;
        if (browserEmbed?.popOut) {
          void (async () => {
            try {
              await applyBrowserProxy(props.workspaceKind ?? "ssh");
              let title = "Browser";
              try {
                title = new URL(url).hostname || title;
              } catch {
                // URL is already normalised above; retain the generic title.
              }
              await browserEmbed.popOut({
                tabId: SIDEBAR_BROWSER_TAB_ID,
                url,
                title,
              });
            } catch (error) {
              console.error(
                "[coloride] failed to open sidebar browser window",
                error,
              );
            }
          })();
          return;
        }

        // Browser pop-out only exists in Electron. A web build keeps a safe
        // fallback instead of silently swallowing the user click.
        if (window.colorideDesktop?.openExternal) {
          void window.colorideDesktop.openExternal(url);
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }

      setWorkspaceBrowserRequest({ url, nonce: Date.now() });
    },
    [isSidebar],
  );

  return { openWorkspaceFile, openWorkspaceTerminal, openWorkspaceBrowser };
}
