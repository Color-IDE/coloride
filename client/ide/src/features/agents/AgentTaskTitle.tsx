import { useEffect, useRef, useState } from "react";

export function AgentTaskTitle({ title }: { title: string }) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    const update = () =>
      setOverflowing(element.scrollWidth > element.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [title]);

  return (
    <span
      className={`agent-session-title block min-w-0 flex-1 whitespace-nowrap text-[13px] font-medium ${overflowing ? "is-overflowing" : ""}`}
      ref={titleRef}
      title={title}
    >
      {title}
    </span>
  );
}
