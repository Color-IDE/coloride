import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { OverflowFadeText } from "../../../shared/components/OverflowFadeText";
import { IconButton } from "../../../shared/ui/IconButton";
import { Menu, MenuItem as SharedMenuItem } from "../../../shared/ui/Menu";
import { Tab } from "../../../shared/ui/Tab";
import type { TerminalSessionStatus } from "../terminalTypes";
import {
  CloseIcon,
  PlusIcon,
  ProblemsTabIcon,
  TerminalTabIcon,
} from "./MenuControls";
import { DEFAULT_SHELL, cx, isProblemsTab } from "./layout";
import { type PaneId, type TerminalTab } from "./types";

export const TERMINAL_TAB_CLASS =
  "group relative flex h-7 w-fit max-w-56 shrink-0 items-center justify-start rounded-[4px] py-0 pl-2.5 pr-6 text-[12px] transition-all active:scale-[0.98]";

export function TerminalGroupHeader({
  activeId,
  contextName,
  enableProblems,
  foreground,
  onAddProblems,
  onAddTerminal,
  onClose,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onSelect,
  paneId,
  problemsCount,
  statuses,
  tabs,
  userTitles,
}: {
  activeId: number | null;
  contextName: string;
  enableProblems: boolean;
  foreground: Record<number, string>;
  onAddProblems: () => void;
  onAddTerminal: () => void;
  onClose: (id: number) => void;
  onPointerCancel: () => void;
  onPointerDown: (
    event: React.PointerEvent<HTMLButtonElement>,
    id: number,
  ) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onSelect: (id: number) => void;
  paneId: PaneId;
  problemsCount: number;
  statuses: Record<number, TerminalSessionStatus>;
  tabs: TerminalTab[];
  userTitles: Record<number, string>;
}) {
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addPaneRef = useRef<HTMLElement | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [fadeEdges, setFadeEdges] = useState({ left: false, right: false });
  const updateFadeEdges = useCallback(() => {
    const element = tabsScrollRef.current;
    if (!element) return;

    const maxScrollLeft = Math.max(
      0,
      element.scrollWidth - element.clientWidth,
    );
    const next = {
      left: maxScrollLeft > 1 && element.scrollLeft > 1,
      right: maxScrollLeft > 1 && element.scrollLeft < maxScrollLeft - 1,
    };
    setFadeEdges((current) =>
      current.left === next.left && current.right === next.right
        ? current
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    updateFadeEdges();
  }, [contextName, foreground, tabs, updateFadeEdges]);

  useEffect(() => {
    const element = tabsScrollRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver(updateFadeEdges);
    resizeObserver.observe(element);
    window.addEventListener("resize", updateFadeEdges);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateFadeEdges);
    };
  }, [updateFadeEdges]);

  const closeAddMenu = useCallback(() => {
    setAddMenuOpen(false);
    setAddMenuPos(null);
  }, []);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        addButtonRef.current?.contains(target) ||
        addMenuRef.current?.contains(target)
      )
        return;
      closeAddMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAddMenu();
    };
    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", onPointerDown);
    }, 0);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeAddMenu);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeAddMenu);
    };
  }, [addMenuOpen, closeAddMenu]);

  return (
    <header
      className="terminal-pane-header explorer-editor-header relative z-10 flex h-10 flex-shrink-0 items-center gap-1 overflow-hidden bg-[#171717] px-1.5"
      data-terminal-pane-header={paneId}
    >
      <div className="relative min-h-0 min-w-0 flex-1 self-stretch">
        <div
          className="editor-tabs-scroll flex h-full min-w-0 items-center overflow-x-auto overflow-y-hidden"
          onScroll={updateFadeEdges}
          ref={tabsScrollRef}
        >
          {tabs.map((tab, index) => {
            const problems = isProblemsTab(tab);
            const fullLabel = problems
              ? problemsCount > 0
                ? `Problems ${problemsCount}`
                : "Problems"
              : userTitles[tab.id] ||
                `${contextName} - ${foreground[tab.id] ?? DEFAULT_SHELL}`;
            const separatorTouchesActive =
              tab.id === activeId || tabs[index + 1]?.id === activeId;
            return (
              <Fragment key={tab.id}>
                <Tab
                  active={tab.id === activeId}
                  className="terminal-header-tab"
                  data-terminal-pane-id={paneId}
                  data-terminal-tab-id={tab.id}
                >
                  <button
                    aria-label={`Select ${fullLabel}`}
                    className={cx(
                      "absolute inset-0 touch-none select-none rounded-[4px]",
                      problems
                        ? "cursor-pointer"
                        : "cursor-grab active:cursor-grabbing",
                    )}
                    onClick={() => onSelect(tab.id)}
                    onPointerCancel={problems ? undefined : onPointerCancel}
                    onPointerDown={(event) => {
                      onSelect(tab.id);
                      if (!problems) onPointerDown(event, tab.id);
                    }}
                    onPointerMove={problems ? undefined : onPointerMove}
                    onPointerUp={problems ? undefined : onPointerUp}
                    title={fullLabel}
                    type="button"
                  />
                  <span className="pointer-events-none relative flex min-w-0 items-center gap-1.5">
                    {problems ? <ProblemsTabIcon /> : <TerminalTabIcon />}
                    <OverflowFadeText className="min-w-0">
                      {fullLabel}
                    </OverflowFadeText>
                    {!problems &&
                    statuses[tab.id] &&
                    statuses[tab.id] !== "ready" ? (
                      <span
                        aria-label={statuses[tab.id]}
                        className={cx(
                          "size-1.5 flex-shrink-0 rounded-full",
                          statuses[tab.id] === "connecting" &&
                            "animate-pulse bg-amber-400",
                          statuses[tab.id] === "disconnected" &&
                            "bg-neutral-500",
                          (statuses[tab.id] === "error" ||
                            statuses[tab.id] === "exited") &&
                            "bg-red-400",
                        )}
                      />
                    ) : null}
                  </span>
                  <IconButton
                    label={`Close ${fullLabel}`}
                    size="sm"
                    className="absolute right-1.5 z-10"
                    onClick={() => onClose(tab.id)}
                  >
                    <CloseIcon />
                  </IconButton>
                </Tab>
                <span
                  aria-hidden="true"
                  className={cx(
                    "terminal-tab-separator mx-0.5 h-3 w-px flex-shrink-0 bg-white/[0.06] transition-opacity duration-150",
                    separatorTouchesActive && "opacity-0",
                  )}
                />
              </Fragment>
            );
          })}
        </div>
        <span
          aria-hidden="true"
          data-edge="left"
          className={`scroll-edge-fade editor-tabs-fade pointer-events-none absolute bottom-1 left-0 top-1.5 z-20 w-5 transition-opacity duration-150 ${fadeEdges.left ? "opacity-100" : "opacity-0"}`}
        />
        <span
          aria-hidden="true"
          data-edge="right"
          className={`scroll-edge-fade editor-tabs-fade pointer-events-none absolute bottom-1 right-0 top-1.5 z-20 w-5 transition-opacity duration-150 ${fadeEdges.right ? "opacity-100" : "opacity-0"}`}
        />
      </div>
      <IconButton
        ref={addButtonRef}
        aria-expanded={enableProblems ? addMenuOpen : undefined}
        aria-haspopup={enableProblems ? "menu" : undefined}
        label={enableProblems ? "Add tab" : "New terminal"}
        active={addMenuOpen}
        onClick={(event) => {
          if (!enableProblems) {
            onAddTerminal();
            return;
          }
          if (addMenuOpen) {
            closeAddMenu();
            return;
          }
          const pane = event.currentTarget.closest("[data-terminal-pane-root]");
          if (!(pane instanceof HTMLElement)) return;
          const menuWidth = 180;
          const paneBox = pane.getBoundingClientRect();
          const buttonBox = event.currentTarget.getBoundingClientRect();
          addPaneRef.current = pane;
          setAddMenuPos({
            left: Math.max(
              8,
              Math.min(
                buttonBox.right - paneBox.left - menuWidth,
                paneBox.width - menuWidth - 8,
              ),
            ),
            top: buttonBox.bottom - paneBox.top + 4,
          });
          setAddMenuOpen(true);
        }}
      >
        <PlusIcon />
      </IconButton>
      {enableProblems && addMenuOpen && addMenuPos && addPaneRef.current
        ? createPortal(
            <Menu
              ref={addMenuRef}
              className="terminal-add-dropdown absolute w-[180px]"
              onMouseDown={(event) => event.stopPropagation()}
              style={{ left: addMenuPos.left, top: addMenuPos.top }}
            >
              <SharedMenuItem
                compact
                onClick={() => {
                  closeAddMenu();
                  onAddTerminal();
                }}
              >
                Terminal
              </SharedMenuItem>
              <SharedMenuItem
                compact
                onClick={() => {
                  closeAddMenu();
                  onAddProblems();
                }}
              >
                Problems
              </SharedMenuItem>
            </Menu>,
            addPaneRef.current,
          )
        : null}
    </header>
  );
}
