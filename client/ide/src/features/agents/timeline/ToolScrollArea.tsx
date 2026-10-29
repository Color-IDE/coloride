import { createElement, useCallback, useEffect, useRef, useState, type HTMLAttributes, type Ref } from "react";
import { EditorTabsHairline } from "../../../shared/ui/EditorTabsHairline";
import { VerticalScrollHairline } from "../../../shared/ui/VerticalScrollHairline";

type Props = HTMLAttributes<HTMLElement> & { as?: "div" | "pre"; ref?: Ref<HTMLElement> };

/** Tool content keeps native scrolling, with the same overlay rails as the tree and tabs. */
export function ToolScrollArea({ as = "div", ref, className = "", ...props }: Props) {
  const targetRef = useRef<HTMLElement | null>(null);
  const [metrics, setMetrics] = useState({ left: 0, width: 0, client: 0 });
  useEffect(() => {
    const node = targetRef.current;
    if (!node) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = { left: node.scrollLeft, width: node.scrollWidth, client: node.clientWidth };
      setMetrics(old => old.left === next.left && old.width === next.width && old.client === next.client ? old : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    const observe = () => {
      resize.disconnect();
      resize.observe(node);
      for (const child of node.children) resize.observe(child);
      schedule();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(node, { childList: true, subtree: true, characterData: true });
    node.addEventListener("scroll", schedule, { passive: true });
    observe();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); node.removeEventListener("scroll", schedule); };
  }, []);
  const attachRef = useCallback((node: HTMLElement | null) => {
    targetRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);
  return <div className="agent-tool-scroll-surface vertical-scroll-surface">
    {createElement(as, { ...props, className: `${className} agent-tool-scroll-content`, ref: attachRef })}
    <VerticalScrollHairline targetRef={targetRef} label="Tool content vertical scroll" />
    <EditorTabsHairline metrics={metrics} onScrollTo={left => { if (targetRef.current) targetRef.current.scrollLeft = left; }} />
  </div>;
}
