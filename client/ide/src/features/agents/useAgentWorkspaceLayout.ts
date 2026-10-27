import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import type { AgentTerminalReference } from "../../shared/api/types";
import {
  type AgentWorkspaceToolKind
} from "./AgentWorkspacePanel";
import { type AgentViewProps } from "./agentViewTypes";

interface Dependencies {
  props: AgentViewProps;
}

export function useAgentWorkspaceLayout({ props }: Dependencies) {
  const [workspaceTerminalRecovery, setWorkspaceTerminalRecovery] = useState<
    AgentTerminalReference[]
  >([]);
  const [workspaceOpenRequest, setWorkspaceOpenRequest] = useState<{
    kind: AgentWorkspaceToolKind;
    nonce: number;
    terminal?: AgentTerminalReference;
  } | null>(null);
  const [workspaceFileRequest, setWorkspaceFileRequest] = useState<{
    path: string;
    patch?: string;
    content?: string;
    line?: number;
    nonce: number;
  } | null>(null);
  const [workspaceBrowserRequest, setWorkspaceBrowserRequest] = useState<{
    url: string;
    nonce: number;
  } | null>(null);
  const [workspaceTabCount, setWorkspaceTabCount] = useState(0);
  const handledBrowserOpenKeys = useRef(new Set<string>());
  const viewActive = props.active !== false;
  const workspaceCardOpen = workspaceTabCount > 0;
  /** Browser fills the agent main area; chat column collapses until exit. */
  const [browserExpanded, setBrowserExpanded] = useState(false);
  /** Stable callback — inline lambdas re-fired child effects and could loop setState. */
  const handleWorkspaceTabsChange = useCallback((count: number) => {
    setWorkspaceTabCount((prev) => (prev === count ? prev : count));
    if (count === 0) {
      setBrowserExpanded((prev) => (prev ? false : prev));
    }
  }, []);
  /** Width of the right workspace (browser/files/terminal) when docked beside chat. */
  const [workspacePaneWidth, setWorkspacePaneWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem(
        "coloride.layout.agent-workspace-width",
      );
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n >= 280 && n <= 1200) return Math.round(n);
    } catch {
      // ignore
    }
    return 480;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "coloride.layout.agent-workspace-width",
        String(workspacePaneWidth),
      );
    } catch {
      // ignore
    }
  }, [workspacePaneWidth]);

  const startWorkspaceResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = workspacePaneWidth;
      const splitEl = (event.currentTarget as HTMLElement).closest(
        ".agent-main-split",
      );
      const splitWidth = splitEl?.clientWidth ?? 960;
      const minChat = 300;
      const minWorkspace = 280;
      const maxWidth = Math.max(minWorkspace, splitWidth - minChat);
      let finished = false;

      const onMouseMove = (moveEvent: MouseEvent) => {
        // Dragging the seam left grows the workspace (right pane).
        const delta = startX - moveEvent.clientX;
        const next = Math.max(
          minWorkspace,
          Math.min(Math.round(startWidth + delta), maxWidth),
        );
        setWorkspacePaneWidth(next);
      };

      const end = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", end);
        window.removeEventListener("blur", end);
        document.body.classList.remove("is-resizing-panel");
        document.body.style.removeProperty("user-select");
        document.body.style.removeProperty("cursor");
      };

      document.body.classList.add("is-resizing-panel");
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", end);
      window.addEventListener("blur", end);
    },
    [workspacePaneWidth],
  );
  return {
    setWorkspaceTerminalRecovery,
    setWorkspaceBrowserRequest,
    workspaceTerminalRecovery,
    workspaceOpenRequest,
    setWorkspaceOpenRequest,
    workspaceFileRequest,
    setWorkspaceFileRequest,
    workspaceBrowserRequest,
    handledBrowserOpenKeys,
    viewActive,
    workspaceCardOpen,
    browserExpanded,
    setBrowserExpanded,
    handleWorkspaceTabsChange,
    workspacePaneWidth,
    startWorkspaceResize,
  };
}
