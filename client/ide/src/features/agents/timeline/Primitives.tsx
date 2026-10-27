import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";

export const COLLAPSE_TRANSITION = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1] as const,
};

/** User bubbles stay compact: 3 lines max, soft bottom fade instead of "...". */
export const USER_MESSAGE_CLAMP_LINES = 3;

/** True when the user just finished (or still has) a non-empty text selection. */
export function hasNonEmptyTextSelection(): boolean {
  if (typeof window === "undefined") return false;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return false;
  return Boolean(selection.toString());
}

/** Height collapse without layout jump: margins live on the inner node. */
export function CollapsibleSection({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement>(null);

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          ref={shellRef}
          animate={{ height: "auto", opacity: 1 }}
          className="agent-collapse"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          onAnimationComplete={(definition) => {
            const height =
              definition === "auto"
                ? "auto"
                : typeof definition === "object" &&
                    definition !== null &&
                    "height" in definition
                  ? definition.height
                  : undefined;
            // Pixel height from the open animation would clip nested expands.
            if (height !== "auto") return;
            const node = shellRef.current;
            if (node) node.style.height = "auto";
          }}
          transition={COLLAPSE_TRANSITION}
        >
          <div
            className={
              className
                ? `agent-collapse-inner ${className}`
                : "agent-collapse-inner"
            }
          >
            {children}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function ExploreTraceRail({ children }: { children: ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const rail = railRef.current;
    const list = listRef.current;
    const line = lineRef.current;
    if (!rail || !list || !line) return;

    const update = () => {
      const items = list.querySelectorAll<HTMLElement>(
        ":scope > .agent-explore-group-item",
      );
      if (items.length === 0) {
        line.style.opacity = "0";
        line.style.height = "0px";
        return;
      }
      const railBox = rail.getBoundingClientRect();
      const startBox = items[0].getBoundingClientRect();
      const endBox = items[items.length - 1].getBoundingClientRect();
      const top = Math.max(0, startBox.top - railBox.top);
      const height = Math.max(0, endBox.bottom - railBox.top - top);
      line.style.opacity = "1";
      line.style.top = `${top}px`;
      line.style.bottom = "auto";
      line.style.height = `${height}px`;
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(rail);
    ro.observe(list);
    const watchItems = () => {
      for (const item of list.querySelectorAll(
        ":scope > .agent-explore-group-item",
      )) {
        ro.observe(item);
      }
    };
    watchItems();
    const mo = new MutationObserver(() => {
      watchItems();
      update();
    });
    mo.observe(list, { subtree: true, childList: true });
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [children]);

  return (
    <div className="agent-explore-trace-rail" ref={railRef}>
      <span
        aria-hidden="true"
        className="agent-explore-trace-line"
        ref={lineRef}
      />
      <div className="agent-explore-trace-list" ref={listRef}>
        {children}
      </div>
    </div>
  );
}

export function ShimmerActionLabel({
  className,
  detail,
  running,
  text,
  title,
  verb,
}: {
  className: string;
  detail?: string;
  running: boolean;
  text: string;
  title?: string;
  verb: string;
}) {
  if (running) {
    return (
      <span
        className={`${className} agent-text-shimmer`}
        data-text={text}
        title={title ?? text}
      >
        {text}
      </span>
    );
  }
  return (
    <span className={className} title={title}>
      <span className="agent-tool-verb">{verb}</span>
      {detail ? <span className="agent-tool-rest"> {detail}</span> : null}
    </span>
  );
}
