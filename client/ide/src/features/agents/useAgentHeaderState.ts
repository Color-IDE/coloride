import type {
  AgentSessionSummary
} from "@coloride/contracts";
import type { Dispatch, SetStateAction } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { useContextMenuPosition } from "../../shared/ui/useContextMenuPosition";
import { api } from "../../shared/api/client";
import { readChatTabs } from "./agentStorage";
import { normalizeWorkspaceCwd } from "./agentWorkspacePaths";
import type { AgentViewProps } from "./agentViewTypes";

interface Dependencies {
  openChatTabs: (string | null)[];
  sessions: AgentSessionSummary[];
  isSidebar: boolean;
  setOpenChatTabs: Dispatch<SetStateAction<(string | null)[]>>;
  selectedSessionId: string | null;
  chatTabsKey: string;
  props: AgentViewProps;
}

export function useAgentHeaderState({ openChatTabs, sessions, isSidebar, setOpenChatTabs, selectedSessionId, chatTabsKey, props }: Dependencies) {
  const [activeHeaderTerminal, setActiveHeaderTerminal] = useState<
    string | null
  >(() => readChatTabs(chatTabsKey)?.terminal ?? null);
  const storedKey = useRef(chatTabsKey);
  useEffect(() => {
    if (storedKey.current !== chatTabsKey) {
      storedKey.current = chatTabsKey;
      const saved = readChatTabs(chatTabsKey);
      setOpenChatTabs(saved?.tabs ?? [selectedSessionId]);
      setActiveHeaderTerminal(saved?.terminal ?? null);
      return;
    }
    try { window.localStorage.setItem(chatTabsKey, JSON.stringify({ tabs: openChatTabs, terminal: activeHeaderTerminal })); } catch { /* Storage may be unavailable. */ }
  }, [chatTabsKey, openChatTabs, activeHeaderTerminal]);
  // Recover terminals left by older renderers even when their tab list was lost.
  useEffect(() => {
    if (!props.connected) return;
    let cancelled = false;
    const savedTabs = new Set(openChatTabs);
    void api.listTerminals({ workspaceKind: props.workspaceKind ?? "ssh", connectionId: props.connectionId }).then(terminals => {
      if (cancelled) return;
      const recovered = terminals.filter(terminal => terminal.status !== "exited" && terminal.sessionId.startsWith("header-terminal-") && normalizeWorkspaceCwd(terminal.cwd) === normalizeWorkspaceCwd(props.workspacePath)).map(terminal => terminal.sessionId);
      setOpenChatTabs(tabs => {
        const chats = tabs.filter(id => !id?.startsWith("header-terminal-") || !savedTabs.has(id) || recovered.includes(id));
        return [...new Set([...chats, ...recovered])];
      });
      setActiveHeaderTerminal(current => current && savedTabs.has(current) && !recovered.includes(current) ? null : current);
    }).catch(() => { /* Preserve saved tabs on a temporary host failure. */ });
    return () => { cancelled = true; };
  }, [props.connected, props.workspaceKind, props.connectionId, props.workspacePath]);
  const agentContextRootRef = useRef<HTMLDivElement>(null);
  const [headerTabMenu, setHeaderTabMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const headerTabMenuPlacement = useContextMenuPosition(headerTabMenu);
  useEffect(() => {
    if (!headerTabMenu) return;
    const close = () => setHeaderTabMenu(null);
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
    };
  }, [headerTabMenu]);
  const chatTabsScrollRef = useRef<HTMLDivElement>(null);
  const [chatTabScroll, setChatTabScroll] = useState({
    left: 0,
    width: 0,
    client: 0,
  });
  const updateChatTabScroll = useCallback(() => {
    const element = chatTabsScrollRef.current;
    if (!element) return;
    const left = element.scrollLeft;
    const client = element.clientWidth;
    const width = element.scrollWidth;
    // A fractional subpixel can leave scrollWidth 1px over clientWidth when
    // every tab already fits, which keeps the hairline up with nothing to scroll.
    const fits = width <= client + 1;
    const next = {
      left: fits ? 0 : left,
      width: fits ? client : width,
      client,
    };
    if (fits && left > 0) element.scrollLeft = 0;
    setChatTabScroll((current) =>
      current.left === next.left &&
        current.width === next.width &&
        current.client === next.client
        ? current
        : next,
    );
  }, []);
  useLayoutEffect(() => {
    updateChatTabScroll();
  }, [openChatTabs, sessions, isSidebar, updateChatTabScroll]);
  useEffect(() => {
    const element = chatTabsScrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(updateChatTabScroll);
    // The scroller's own box can stay the same while a late title widens a tab.
    observer.observe(element);
    for (const tab of element.querySelectorAll("[data-active]")) {
      observer.observe(tab);
    }
    return () => observer.disconnect();
  }, [isSidebar, openChatTabs, sessions, updateChatTabScroll]);
  useEffect(() => {
    setOpenChatTabs((tabs) =>
      tabs.includes(selectedSessionId) ? tabs : [...tabs, selectedSessionId],
    );
  }, [selectedSessionId]);
  return {
    activeHeaderTerminal,
    setActiveHeaderTerminal,
    agentContextRootRef,
    headerTabMenu,
    setHeaderTabMenu,
    headerTabMenuPlacement,
    chatTabsScrollRef,
    chatTabScroll,
    updateChatTabScroll,
  };
}
