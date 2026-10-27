import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const overflowListeners = new WeakMap<Element, () => void>();
let sharedOverflowObserver: ResizeObserver | null = null;

const getOverflowObserver = () => {
  if (!sharedOverflowObserver) {
    sharedOverflowObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => overflowListeners.get(entry.target)?.());
    });
  }
  return sharedOverflowObserver;
};

export function OverflowFadeText({ children, className = "" }: { children: ReactNode; className?: string }) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const updateOverflow = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    const next = element.scrollWidth > element.clientWidth + 1;
    setOverflowing((prev) => (prev === next ? prev : next));
  }, []);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    updateOverflow();
    const observer = getOverflowObserver();
    overflowListeners.set(element, updateOverflow);
    observer.observe(element);
    return () => {
      observer.unobserve(element);
      overflowListeners.delete(element);
    };
  }, [children, updateOverflow]);

  return (
    <span
      className={`min-w-0 overflow-hidden whitespace-nowrap ${overflowing ? "text-end-fade" : ""} ${className}`}
      ref={elementRef}
    >
      {children}
    </span>
  );
}
