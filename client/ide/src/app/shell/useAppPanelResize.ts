import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  SetStateAction,
} from "react";
import { useCallback } from "react";

interface Dependencies {
  activeTab: string | null;
  serverWidth: number;
  settingsWidth: number;
  treeWidth: number;
  setServerWidth: Dispatch<SetStateAction<number>>;
  setSettingsWidth: Dispatch<SetStateAction<number>>;
  setTreeWidth: Dispatch<SetStateAction<number>>;
  agentPanelWidth: number;
  setAgentPanelWidth: Dispatch<SetStateAction<number>>;
  terminalHeight: number;
  setTerminalHeight: Dispatch<SetStateAction<number>>;
}
export function useAppPanelResize({
  activeTab,
  serverWidth,
  settingsWidth,
  treeWidth,
  setServerWidth,
  setSettingsWidth,
  setTreeWidth,
  agentPanelWidth,
  setAgentPanelWidth,
  terminalHeight,
  setTerminalHeight,
}: Dependencies) {
  const startPanelResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();

      const startX = event.clientX;
      const isServer = activeTab === "server";
      const isSettings = activeTab === "settings";
      const startWidth = isServer
        ? serverWidth
        : isSettings
          ? settingsWidth
          : treeWidth;
      const minWidth = 180;
      const maxWidth = 520;
      let finished = false;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = Math.max(
          minWidth,
          Math.min(Math.round(startWidth + delta), maxWidth),
        );

        if (isServer) {
          setServerWidth(nextWidth);
        } else if (isSettings) {
          setSettingsWidth(nextWidth);
        } else {
          setTreeWidth(nextWidth);
        }
      };

      const end = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", end);
        window.removeEventListener("blur", end);
        document.removeEventListener("visibilitychange", onVisibility);
        document.body.classList.remove("is-resizing-panel");
        // removeProperty clears inline styles even if empty-string restore fails mid-drag.
        document.body.style.removeProperty("user-select");
        document.body.style.removeProperty("cursor");
      };

      const onVisibility = () => {
        if (document.visibilityState === "hidden") end();
      };

      document.body.classList.add("is-resizing-panel");
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", end);
      // Escape hatches: lost mouseup (alt-tab, DevTools, OS gesture) used to leave
      // body { cursor: ew-resize } stuck for the rest of the session.
      window.addEventListener("blur", end);
      document.addEventListener("visibilitychange", onVisibility);
    },
    [activeTab, serverWidth, settingsWidth, treeWidth],
  );

  const startAgentPanelResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = agentPanelWidth;
      const minWidth = 280;
      const maxWidth = 640;
      let finished = false;

      const onMouseMove = (moveEvent: MouseEvent) => {
        // Dragging the left edge of the right panel → invert delta.
        const delta = startX - moveEvent.clientX;
        const nextWidth = Math.max(
          minWidth,
          Math.min(Math.round(startWidth + delta), maxWidth),
        );
        setAgentPanelWidth(nextWidth);
      };

      const end = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", end);
        window.removeEventListener("blur", end);
        document.removeEventListener("visibilitychange", onVisibility);
        document.body.classList.remove("is-resizing-panel");
        document.body.style.removeProperty("user-select");
        document.body.style.removeProperty("cursor");
      };

      const onVisibility = () => {
        if (document.visibilityState === "hidden") end();
      };

      document.body.classList.add("is-resizing-panel");
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", end);
      window.addEventListener("blur", end);
      document.addEventListener("visibilitychange", onVisibility);
    },
    [agentPanelWidth],
  );

  const startTerminalResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();

      const startY = event.clientY;
      const startHeight = terminalHeight;
      const minHeight = 100;
      const maxHeight = 600;
      let finished = false;

      document.body.classList.add("is-resizing-terminal");

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientY - startY;
        const nextHeight = Math.max(
          minHeight,
          Math.min(Math.round(startHeight - delta), maxHeight),
        );
        setTerminalHeight(nextHeight);
      };

      const end = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", end);
        window.removeEventListener("blur", end);
        document.removeEventListener("visibilitychange", onVisibility);
        document.body.classList.remove("is-resizing-terminal");
        document.body.style.removeProperty("user-select");
        document.body.style.removeProperty("cursor");
      };

      const onVisibility = () => {
        if (document.visibilityState === "hidden") end();
      };

      document.body.style.userSelect = "none";
      document.body.style.cursor = "ns-resize";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", end);
      window.addEventListener("blur", end);
      document.addEventListener("visibilitychange", onVisibility);
    },
    [terminalHeight],
  );

  return { startPanelResize, startAgentPanelResize, startTerminalResize };
}
