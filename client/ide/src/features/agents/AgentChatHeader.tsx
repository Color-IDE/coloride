import type {
  AgentChatHistoryEntry,
  AgentSessionSummary,
} from "@coloride/contracts";
import { useLayoutEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { EditorTabsHairline } from "../../shared/ui/EditorTabsHairline";
import { IconButton } from "../../shared/ui/IconButton";
import { Tab } from "../../shared/ui/Tab";
import { notify } from "../../shared/ui/notifications";
import { closeManagedTerminalSession } from "../terminal/TerminalSessionManager";
import { AgentMark } from "../external-agents";
import { chatTitle } from "./ChatHistoryDialog";

interface Props {
  chatTabsScrollRef: RefObject<HTMLDivElement | null>;
  updateChatTabScroll: () => void;
  openChatTabs: (string | null)[];
  activeHeaderTerminal: string | null;
  selectedSessionId: string | null;
  sessions: AgentSessionSummary[];
  chatTitles: Record<string, string>;
  chatHistoryDetails: Record<string, AgentChatHistoryEntry>;
  sessionTitle: string;
  setActiveHeaderTerminal: Dispatch<SetStateAction<string | null>>;
  selectSession: (
    sessionId: string | null,
    options?: { preferNewTask?: boolean },
  ) => void;
  setOpenChatTabs: Dispatch<SetStateAction<(string | null)[]>>;
  chatTabScroll: { left: number; width: number; client: number };
  headerTabMenu: { x: number; y: number } | null;
  setHeaderTabMenu: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setChatHistoryOpen: Dispatch<SetStateAction<boolean>>;
  onCloseSidebar?: () => void;
  externalAgentTabs?: Array<{
    id: string;
    agentId: string;
    title: string;
    icon?: string | null;
  }>;
  activeExternalAgentId?: string | null;
  onSelectExternalAgent?: (id: string) => void;
  onCloseExternalAgent?: (id: string) => void;
}
export function AgentChatHeader({
  chatTabsScrollRef,
  updateChatTabScroll,
  openChatTabs,
  activeHeaderTerminal,
  selectedSessionId,
  sessions,
  chatTitles,
  chatHistoryDetails,
  sessionTitle,
  setActiveHeaderTerminal,
  selectSession,
  setOpenChatTabs,
  chatTabScroll,
  headerTabMenu,
  setHeaderTabMenu,
  setChatHistoryOpen,
  onCloseSidebar,
  externalAgentTabs = [],
  activeExternalAgentId = null,
  onSelectExternalAgent,
  onCloseExternalAgent,
}: Props) {
  // Titles replace "Chat" after the tab row has already been measured.
  useLayoutEffect(() => {
    updateChatTabScroll();
  }, [
    chatHistoryDetails,
    chatTitles,
    openChatTabs,
    externalAgentTabs,
    activeExternalAgentId,
    sessionTitle,
    sessions,
    updateChatTabScroll,
  ]);
  return (
    <header className="agent-sidebar-header explorer-editor-header relative flex h-10 shrink-0 items-center gap-1 overflow-hidden bg-[#1e1e1e] px-1.5">
      <div className="relative h-full min-w-0 flex-1">
        <div
          ref={chatTabsScrollRef}
          onScroll={updateChatTabScroll}
          className="editor-tabs-scroll flex h-full min-w-0 items-center overflow-x-auto overflow-y-hidden"
          role="tablist"
          aria-label="Open chats"
        >
          {openChatTabs.map((id, index) => {
            const terminal = id?.startsWith("header-terminal-") ?? false;
            const external = externalAgentTabs.find((tab) => tab.id === id);
            if (id?.startsWith("external-agent:") && !external) return null;
            const next = openChatTabs
              .slice(index + 1)
              .find((item) => !item?.startsWith("external-agent:") || externalAgentTabs.some((tab) => tab.id === item));
            const nextActive = next
              ? next.startsWith("external-agent:")
                ? next === activeExternalAgentId
                : next.startsWith("header-terminal-")
                  ? !activeExternalAgentId && next === activeHeaderTerminal
                  : !activeExternalAgentId &&
                    !activeHeaderTerminal &&
                    next === selectedSessionId
              : false;
            const active = external
              ? id === activeExternalAgentId
              : terminal
                ? !activeExternalAgentId && id === activeHeaderTerminal
                : !activeExternalAgentId &&
                  !activeHeaderTerminal &&
                  id === selectedSessionId;
            const title = external
              ? external.title
              : terminal
                ? "Terminal"
                : id === null
                ? "New chat"
                : (() => {
                    const session = sessions.find(
                      (item) => item.sessionId === id,
                    );
                    return session
                      ? chatTitle(
                          session,
                          chatTitles,
                          chatHistoryDetails[session.sessionId],
                        )
                      : active
                        ? sessionTitle
                        : "Chat";
                  })();
            return (
              <div className="flex shrink-0 items-center" key={id ?? "new-chat"}>
              <Tab
                active={active}
                className="agent-sidebar-tab editor-file-tab"
              >
                <button
                  role="tab"
                  aria-selected={active}
                  className="absolute inset-0 rounded-[4px]"
                  title={title}
                  type="button"
                  onClick={() => {
                    if (external) {
                      setActiveHeaderTerminal(null);
                      onSelectExternalAgent?.(external.id);
                      return;
                    }
                    onSelectExternalAgent?.("");
                    if (terminal) setActiveHeaderTerminal(id);
                    else {
                      setActiveHeaderTerminal(null);
                      selectSession(id);
                    }
                  }}
                />
                <span className="agent-sidebar-header-title pointer-events-none relative flex min-w-0 items-center gap-1.5">
                  {external ? (
                    <AgentMark
                      agentId={external.agentId}
                      icon={external.icon}
                      name={external.title}
                    />
                  ) : null}
                  <span className="min-w-0 truncate">{title}</span>
                </span>
                <IconButton
                  label={`Close chat: ${title}`}
                  size="sm"
                  className="absolute right-1.5 z-10"
                  onClick={async () => {
                    if (external) {
                      setOpenChatTabs((tabs) =>
                        tabs.filter((tab) => tab !== external.id),
                      );
                      onCloseExternalAgent?.(external.id);
                      return;
                    }
                    if (terminal && id) {
                      try { await closeManagedTerminalSession(id); }
                      catch {
                        notify({ id: `close-terminal-${id}`, kind: "error", title: "Unable to close terminal", description: "The terminal is still open. Reconnect and try again." });
                        return;
                      }
                    }
                    const remaining = openChatTabs.filter((tab) => tab !== id);
                    if (remaining.length === 0) {
                      setOpenChatTabs([null]);
                      selectSession(null);
                      setActiveHeaderTerminal(null);
                      onCloseSidebar?.();
                      return;
                    }
                    setOpenChatTabs(remaining);
                    if (active) {
                      const next =
                        remaining[Math.max(0, openChatTabs.indexOf(id) - 1)] ??
                        null;
                      if (next?.startsWith("header-terminal-"))
                        setActiveHeaderTerminal(next);
                      else selectSession(next);
                    }
                  }}
                  title="Close chat"
                >
                  <svg
                    aria-hidden="true"
                    className="size-3"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </IconButton>
              </Tab>
              {next ? (
                <span
                  aria-hidden="true"
                  className={`editor-tab-separator mx-0.5 h-3 w-px flex-shrink-0 bg-white/[0.06] transition-opacity duration-150 ${
                    active || nextActive ? "opacity-0" : ""
                  }`}
                />
              ) : null}
              </div>
            );
          })}
        </div>
        <span
          aria-hidden="true"
          data-edge="left"
          className={`scroll-edge-fade editor-tabs-fade pointer-events-none absolute bottom-1 left-0 top-1.5 z-20 w-5 transition-opacity duration-150 ${chatTabScroll.left > 1 ? "opacity-100" : "opacity-0"}`}
        />
        <span
          aria-hidden="true"
          data-edge="right"
          className={`scroll-edge-fade editor-tabs-fade pointer-events-none absolute bottom-1 right-0 top-1.5 z-20 w-5 transition-opacity duration-150 ${chatTabScroll.width - chatTabScroll.client - chatTabScroll.left > 1 ? "opacity-100" : "opacity-0"}`}
        />
        <EditorTabsHairline
          metrics={chatTabScroll}
          onScrollTo={(left) => chatTabsScrollRef.current?.scrollTo({ left })}
        />
      </div>
      <IconButton
        label="Add tab"
        active={Boolean(headerTabMenu)}
        aria-haspopup="menu"
        aria-expanded={Boolean(headerTabMenu)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHeaderTabMenu((current) =>
            current ? null : { x: rect.right - 180, y: rect.bottom + 4 },
          );
        }}
      >
        <svg
          aria-hidden="true"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </IconButton>
      <IconButton
        label="Chat history"
        onClick={() => {
          setChatHistoryOpen(true);
        }}
      >
        <svg
          aria-hidden="true"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
        >
          <path d="M4.43186 14.9656C5.65759 18.4791 9.00032 21 12.9318 21C17.9024 21 21.9318 16.9706 21.9318 12C21.9318 7.02944 17.9024 3 12.9318 3C9.23111 3 5.83124 5.6756 4.62227 8.5" />
          <path d="M12.9319 7V12L15.9319 14" />
          <path d="M8.43054 8.74363C8.43054 8.74363 4.74691 9.3026 4.1879 8.7436C3.62888 8.1846 4.18791 4.50098 4.18791 4.50098" />
        </svg>
      </IconButton>
    </header>
  );
}
