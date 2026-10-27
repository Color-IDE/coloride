import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  createTerminalSplit,
  replaceTerminalPane,
  type SplitPlacement,
} from "../terminalLayout";
import type { TerminalSplitNode } from "../terminalTypes";
import { compactLayout, resolveActiveIds } from "./layout";
import {
  type DropPreview,
  type PaneId,
  type PointerDrag,
  type TerminalTab,
} from "./types";

interface Dependencies {
  removePointerListenersRef: RefObject<(() => void) | null>;
  dragFrameRef: RefObject<number | null>;
  pendingDragPointRef: RefObject<{
    tabId: number;
    x: number;
    y: number;
  } | null>;
  pointerDragRef: RefObject<PointerDrag | null>;
  dropPreviewRef: RefObject<DropPreview | null>;
  setDraggedTabId: Dispatch<SetStateAction<number | null>>;
  setDragPosition: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setDragVisual: Dispatch<
    SetStateAction<{ grabX: number; grabY: number; width: number } | null>
  >;
  setDropPreview: Dispatch<SetStateAction<DropPreview | null>>;
  tabs: TerminalTab[];
  layout: TerminalSplitNode;
  nextPaneId: number;
  nextSplitId: number;
  activeIds: Record<string, number | null>;
  setTabs: Dispatch<SetStateAction<TerminalTab[]>>;
  setLayout: Dispatch<SetStateAction<TerminalSplitNode>>;
  setNextPaneId: Dispatch<SetStateAction<number>>;
  setNextSplitId: Dispatch<SetStateAction<number>>;
  setActiveIds: Dispatch<SetStateAction<Record<string, number | null>>>;
  setActivePaneId: Dispatch<SetStateAction<string>>;
  dragGhostRef: RefObject<HTMLDivElement | null>;
}
export function useTerminalTabDrag({
  removePointerListenersRef,
  dragFrameRef,
  pendingDragPointRef,
  pointerDragRef,
  dropPreviewRef,
  setDraggedTabId,
  setDragPosition,
  setDragVisual,
  setDropPreview,
  tabs,
  layout,
  nextPaneId,
  nextSplitId,
  activeIds,
  setTabs,
  setLayout,
  setNextPaneId,
  setNextSplitId,
  setActiveIds,
  setActivePaneId,
  dragGhostRef,
}: Dependencies) {
  const finishDrag = () => {
    removePointerListenersRef.current?.();
    removePointerListenersRef.current = null;
    if (dragFrameRef.current !== null)
      cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
    pendingDragPointRef.current = null;
    pointerDragRef.current = null;
    dropPreviewRef.current = null;
    setDraggedTabId(null);
    setDragPosition(null);
    setDragVisual(null);
    setDropPreview(null);
  };

  const commitDrop = (tabId: number, destination: DropPreview) => {
    const moved = tabs.find((tab) => tab.id === tabId);
    if (
      !moved ||
      (destination.beforeTabId === tabId && destination.placement === "center")
    ) {
      finishDrag();
      return;
    }

    let nextTabs = tabs.filter((tab) => tab.id !== tabId);
    let nextLayout = layout;
    let updatedNextPaneId = nextPaneId;
    let updatedNextSplitId = nextSplitId;
    let createdPaneId: PaneId | null = null;

    if (destination.placement === "center") {
      const movedTab = { ...moved, paneId: destination.paneId };
      const insertAt = destination.beforeTabId
        ? nextTabs.findIndex((tab) => tab.id === destination.beforeTabId)
        : -1;
      nextTabs =
        insertAt >= 0
          ? [
            ...nextTabs.slice(0, insertAt),
            movedTab,
            ...nextTabs.slice(insertAt),
          ]
          : [...nextTabs, movedTab];
    } else {
      const newPaneId = `pane-${updatedNextPaneId}`;
      updatedNextPaneId += 1;
      createdPaneId = newPaneId;

      nextTabs.push({ ...moved, paneId: newPaneId });

      const splitId = `split-${updatedNextSplitId}`;
      updatedNextSplitId += 1;
      nextLayout = replaceTerminalPane(
        nextLayout,
        destination.paneId,
        createTerminalSplit(
          splitId,
          destination.paneId,
          newPaneId,
          destination.placement,
        ),
      );
    }

    const preferred = {
      ...activeIds,
      [destination.paneId]:
        destination.placement === "center"
          ? tabId
          : activeIds[destination.paneId],
    };
    if (destination.placement !== "center") {
      preferred[createdPaneId ?? destination.paneId] = tabId;
    }

    const compactedLayout = compactLayout(nextLayout, nextTabs) ?? {
      id: nextTabs[0].paneId,
      type: "pane" as const,
    };

    setTabs(nextTabs);
    setLayout(compactedLayout);
    setNextPaneId(updatedNextPaneId);
    setNextSplitId(updatedNextSplitId);
    setActiveIds(resolveActiveIds(compactedLayout, nextTabs, preferred));
    setActivePaneId(createdPaneId ?? destination.paneId);
    finishDrag();
  };

  const updateDropPreview = (
    clientX: number,
    clientY: number,
  ) => {
    const applyPreview = (preview: DropPreview | null) => {
      const current = dropPreviewRef.current;
      if (
        current?.beforeTabId === preview?.beforeTabId &&
        current?.paneId === preview?.paneId &&
        current?.placement === preview?.placement
      )
        return;
      dropPreviewRef.current = preview;
      setDropPreview(preview);
    };
    const element = document.elementFromPoint(
      clientX,
      clientY,
    ) as HTMLElement | null;
    const tabTarget = element?.closest<HTMLElement>("[data-terminal-tab-id]");

    if (tabTarget) {
      const targetTabId = Number(tabTarget.dataset.terminalTabId);
      const preview: DropPreview = {
        beforeTabId: targetTabId,
        paneId: tabTarget.dataset.terminalPaneId ?? "pane-1",
        placement: "center",
      };
      applyPreview(preview);
      return;
    }

    const headerTarget = element?.closest<HTMLElement>(
      "[data-terminal-pane-header]",
    );
    if (headerTarget) {
      applyPreview({
        paneId: headerTarget.dataset.terminalPaneHeader ?? "pane-1",
        placement: "center",
      });
      return;
    }

    const paneTarget =
      element?.closest<HTMLElement>("[data-terminal-pane-root]") ??
      element?.closest<HTMLElement>("[data-terminal-surface-pane]");
    if (!paneTarget) {
      applyPreview(null);
      return;
    }

    const bounds = paneTarget.getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width;
    const y = (clientY - bounds.top) / bounds.height;
    const choices: Array<[SplitPlacement, number]> = [
      ["left", x],
      ["right", 1 - x],
      ["top", y],
      ["bottom", 1 - y],
    ];
    const nearest = choices.reduce((best, candidate) =>
      candidate[1] < best[1] ? candidate : best,
    );
    const preview: DropPreview = {
      paneId:
        paneTarget.dataset.terminalPaneRoot ??
        paneTarget.dataset.terminalSurfacePane ??
        "pane-1",
      placement: nearest[1] <= 0.3 ? nearest[0] : "center",
    };
    applyPreview(preview);
  };

  const scheduleDragFrame = (x: number, y: number, tabId: number) => {
    pendingDragPointRef.current = { tabId, x, y };
    const drag = pointerDragRef.current;
    if (dragGhostRef.current && drag) {
      dragGhostRef.current.style.left = `${x - drag.grabX}px`;
      dragGhostRef.current.style.top = `${y - drag.grabY}px`;
    }
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const point = pendingDragPointRef.current;
      if (!point || !pointerDragRef.current) return;
      updateDropPreview(point.x, point.y);
    });
  };

  const moveDragTo = (clientX: number, clientY: number) => {
    const drag = pointerDragRef.current;
    if (!drag) return;
    if (
      !drag.active &&
      Math.hypot(clientX - drag.startX, clientY - drag.startY) < 5
    )
      return;
    if (!drag.active) {
      drag.active = true;
      setDraggedTabId(drag.tabId);
      setDragVisual({
        grabX: drag.grabX,
        grabY: drag.grabY,
        width: drag.width,
      });
      setDragPosition({ x: clientX, y: clientY });
    }
    scheduleDragFrame(clientX, clientY, drag.tabId);
  };

  const continuePointerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const drag = pointerDragRef.current;
    if (!drag) return;
    event.preventDefault();
    moveDragTo(event.clientX, event.clientY);
  };

  const finishPointerDragAt = (clientX: number, clientY: number) => {
    const drag = pointerDragRef.current;
    if (!drag) return;
    if (drag.active) {
      if (dragFrameRef.current !== null)
        cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
      pendingDragPointRef.current = null;
      updateDropPreview(clientX, clientY);
    }
    const destination = dropPreviewRef.current;
    if (drag.active && destination) commitDrop(drag.tabId, destination);
    else finishDrag();
  };

  const startPointerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    tabId: number,
  ) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    pointerDragRef.current = {
      active: false,
      grabX: bounds ? event.clientX - bounds.left : 12,
      grabY: bounds ? event.clientY - bounds.top : 14,
      startX: event.clientX,
      startY: event.clientY,
      tabId,
      width: bounds?.width ?? 120,
    };

    removePointerListenersRef.current?.();
    const finishFromWindow = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      finishPointerDragAt(pointerEvent.clientX, pointerEvent.clientY);
    };
    const cancelFromWindow = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === event.pointerId) finishDrag();
    };
    const moveFromWindow = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      pointerEvent.preventDefault();
      moveDragTo(pointerEvent.clientX, pointerEvent.clientY);
    };
    window.addEventListener("pointermove", moveFromWindow);
    window.addEventListener("pointerup", finishFromWindow);
    window.addEventListener("pointercancel", cancelFromWindow);
    removePointerListenersRef.current = () => {
      window.removeEventListener("pointermove", moveFromWindow);
      window.removeEventListener("pointerup", finishFromWindow);
      window.removeEventListener("pointercancel", cancelFromWindow);
    };
  };

  const endPointerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    finishPointerDragAt(event.clientX, event.clientY);
  };

  return { finishDrag, startPointerDrag, continuePointerDrag, endPointerDrag };
}
