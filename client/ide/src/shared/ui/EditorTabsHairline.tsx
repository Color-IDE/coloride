import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type EditorTabsScrollMetrics = {
  left: number;
  width: number;
  client: number;
};

type EditorTabsHairlineProps = {
  metrics: EditorTabsScrollMetrics;
  onScrollTo: (left: number) => void;
};

export function EditorTabsHairline({ metrics, onScrollTo }: EditorTabsHairlineProps) {
  const trackRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<{ pointerId: number; grabRatio: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const overflow = metrics.width > metrics.client + 1;
  const maxScroll = Math.max(1, metrics.width - metrics.client);
  const thumbWidthPct = overflow ? Math.max(8, (metrics.client / metrics.width) * 100) : 0;
  const leftPct = overflow ? (metrics.left / metrics.width) * 100 : 0;

  const scrollFromClientX = useCallback((clientX: number, grabRatio: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const thumbWidth = Math.max(8, (metrics.client / metrics.width) * rect.width);
    const maxThumbLeft = Math.max(1, rect.width - thumbWidth);
    const thumbLeft = Math.max(0, Math.min(maxThumbLeft, clientX - rect.left - grabRatio * thumbWidth));
    onScrollTo((thumbLeft / maxThumbLeft) * Math.max(0, metrics.width - metrics.client));
  }, [metrics.client, metrics.width, onScrollTo]);

  const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0 || !overflow) return;
    event.preventDefault();
    event.stopPropagation();
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const thumbWidth = Math.max(8, (metrics.client / metrics.width) * rect.width);
    const thumbLeft = (metrics.left / metrics.width) * rect.width;
    const x = event.clientX - rect.left;
    const onThumb = x >= thumbLeft && x <= thumbLeft + thumbWidth;
    const grabRatio = onThumb ? (x - thumbLeft) / thumbWidth : 0.5;
    dragRef.current = { pointerId: event.pointerId, grabRatio };
    setDragging(true);
    track.setPointerCapture(event.pointerId);
    scrollFromClientX(event.clientX, grabRatio);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    scrollFromClientX(event.clientX, drag.grabRatio);
  };

  const endDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (trackRef.current?.hasPointerCapture(event.pointerId)) {
      trackRef.current.releasePointerCapture(event.pointerId);
    }
  };

  if (!overflow) return null;

  return (
    <span
      aria-orientation="horizontal"
      aria-valuemax={maxScroll}
      aria-valuemin={0}
      aria-valuenow={metrics.left}
      className={`editor-tabs-hairline${dragging ? " is-dragging" : ""}`}
      onPointerCancel={endDrag}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      ref={trackRef}
      role="scrollbar"
    >
      <span
        className="editor-tabs-hairline-thumb"
        style={{
          width: `${thumbWidthPct}%`,
          left: `${leftPct}%`,
        }}
      />
    </span>
  );
}
