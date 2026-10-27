import { useLayoutEffect, useRef, useState } from "react";

type Point = { x: number; y: number } | null;

/** Keep a fixed menu in the viewport after its actual contents are measured. */
export function useContextMenuPosition(anchor: Point) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const menu = ref.current;
    const measure = () => {
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const maxLeft = Math.max(8, window.innerWidth - width - 8);
      const maxTop = Math.max(8, window.innerHeight - height - 8);
      const left = Math.max(8, Math.min(anchor.x, maxLeft));
      const preferredTop = anchor.y + height + 8 > window.innerHeight
        ? anchor.y - height
        : anchor.y;
      const top = Math.max(8, Math.min(preferredTop, maxTop));
      setPosition((previous) => previous.left === left && previous.top === top
        ? previous : { left, top });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(menu);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [anchor?.x, anchor?.y]);

  return { ref, style: position };
}
