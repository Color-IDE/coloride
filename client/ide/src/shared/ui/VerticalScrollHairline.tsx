import { useEffect, useId, useRef, useState, type PointerEvent, type RefObject } from "react";

export type VerticalScrollMetrics = { top: number; height: number; client: number };

type Props = {
  targetRef?: RefObject<HTMLElement | null>;
  metrics?: VerticalScrollMetrics;
  onScrollTo?: (top: number) => void;
  onWheelScroll?: (event: WheelEvent) => void;
  controlsId?: string;
  label: string;
};

/** The editor tab strip's 2px overlay, connected to a native vertical scroller. */
export function VerticalScrollHairline({ targetRef, controlsId, label, metrics: suppliedMetrics, onScrollTo, onWheelScroll }: Props) {
  const trackRef = useRef<HTMLSpanElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; grabRatio: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [nativeMetrics, setMetrics] = useState({ top: 0, height: 0, client: 0 });
  const controlledId = useId();
  const [scrollerId, setScrollerId] = useState(controlledId);

  useEffect(() => {
    const host = targetRef?.current;
    if (!host) return;
    let frame = 0;
    let assignedId = false;
    let observed: HTMLElement | null = null;
    const observedChildren = new Set<Element>();
    const resize = new ResizeObserver(() => schedule());
    const update = () => {
      frame = 0;
      const scroller = host;
      if (scroller !== observed) {
        resize.disconnect();
        observedChildren.clear();
        if (assignedId && observed?.id === controlledId) observed.removeAttribute("id");
        assignedId = false;
        observed = scroller;
        scrollerRef.current = scroller;
        if (scroller) {
          if (!scroller.id) {
            scroller.id = controlledId;
            assignedId = true;
          }
          setScrollerId(scroller.id);
        }
      }
      if (!scroller) return;
      resize.observe(scroller);
      // Content height can change without the viewport itself resizing.
      for (const child of observedChildren) {
        if (child.parentElement !== scroller) {
          resize.unobserve(child);
          observedChildren.delete(child);
        }
      }
      for (const child of scroller.children) {
        if (!observedChildren.has(child)) {
          resize.observe(child);
          observedChildren.add(child);
        }
      }
      const next = { top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight };
      setMetrics((previous) => previous.top === next.top && previous.height === next.height
        && previous.client === next.client ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const mutation = new MutationObserver(schedule);
    mutation.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    host.addEventListener("scroll", schedule, true);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      host.removeEventListener("scroll", schedule, true);
      if (assignedId && observed?.id === controlledId) observed.removeAttribute("id");
      scrollerRef.current = null;
    };
  }, [targetRef, controlledId]);

  const metrics = suppliedMetrics ?? nativeMetrics;
  const scrollTo = (top: number) => {
    if (onScrollTo) onScrollTo(top);
    else if (scrollerRef.current) scrollerRef.current.scrollTop = top;
  };
  const maxScroll = Math.max(0, metrics.height - metrics.client);
  // The overlay is a sibling of the scroller, so wheel events over its hit
  // area must be forwarded explicitly. A native listener can prevent default
  // scrolling (React's wheel listener is passive).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (onWheelScroll) {
        onWheelScroll(event);
        return;
      }
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
      scroller.scrollTop += event.deltaY * unit;
    };
    track.addEventListener("wheel", onWheel, { passive: false });
    return () => track.removeEventListener("wheel", onWheel);
  }, [maxScroll > 0 && metrics.client > 0, onWheelScroll]);
  const thumbFraction = metrics.height > 0 ? Math.min(1, Math.max(0.08, metrics.client / metrics.height)) : 1;
  const topFraction = maxScroll > 0 ? Math.min(1, Math.max(0, metrics.top / maxScroll)) * (1 - thumbFraction) : 0;
  const scrollFromPointer = (clientY: number, grabRatio: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const thumbHeight = rect.height * thumbFraction;
    const travel = rect.height - thumbHeight;
    if (travel <= 0) return;
    scrollTo(Math.max(0, Math.min(1, (clientY - rect.top - grabRatio * thumbHeight) / travel)) * maxScroll);
  };
  const endDrag = (event: PointerEvent<HTMLSpanElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (maxScroll <= 0 || metrics.client <= 0) return null;
  return (
    <span
      aria-controls={controlsId ?? scrollerId}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={maxScroll}
      aria-valuemin={0}
      aria-valuenow={Math.max(0, Math.min(maxScroll, metrics.top))}
      className={`vertical-scroll-hairline${dragging ? " is-dragging" : ""}`}
      onKeyDown={(event) => {
        const step = suppliedMetrics ? 1 : 40;
        const positions: Record<string, number> = {
          ArrowUp: metrics.top - step, ArrowDown: metrics.top + step,
          PageUp: metrics.top - metrics.client, PageDown: metrics.top + metrics.client,
          Home: 0, End: maxScroll,
        };
        if (!(event.key in positions)) return;
        event.preventDefault();
        event.stopPropagation();
        scrollTo(positions[event.key]!);
      }}
      onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onLostPointerCapture={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        const rect = event.currentTarget.getBoundingClientRect();
        const thumbHeight = rect.height * thumbFraction;
        const thumbTop = rect.height * topFraction;
        const y = event.clientY - rect.top;
        const grabRatio = y >= thumbTop && y <= thumbTop + thumbHeight ? (y - thumbTop) / thumbHeight : 0.5;
        dragRef.current = { pointerId: event.pointerId, grabRatio };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        scrollFromPointer(event.clientY, grabRatio);
      }}
      onPointerMove={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) scrollFromPointer(event.clientY, dragRef.current.grabRatio);
      }}
      onPointerUp={endDrag}
      ref={trackRef}
      role="scrollbar"
      tabIndex={0}
    >
      <span className="vertical-scroll-hairline-thumb" style={{ height: `${thumbFraction * 100}%`, top: `${topFraction * 100}%` }} />
    </span>
  );
}
