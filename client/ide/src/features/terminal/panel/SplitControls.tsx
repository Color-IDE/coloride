import { cx } from "./layout";
import { type DropPlacement } from "./types";

export function TerminalSplitDivider({
  direction,
  onRatio,
}: {
  direction: "horizontal" | "vertical";
  onRatio: (ratio: number) => void;
}) {
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    const bounds = parent.getBoundingClientRect();
    const move = (pointer: PointerEvent) => {
      const ratio =
        direction === "horizontal"
          ? (pointer.clientX - bounds.left) / Math.max(1, bounds.width)
          : (pointer.clientY - bounds.top) / Math.max(1, bounds.height);
      onRatio(ratio);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  return (
    <div
      className={cx(
        "terminal-pane-divider relative z-30 flex-shrink-0 bg-[#333333]",
        direction === "horizontal"
          ? "w-px cursor-ew-resize before:absolute before:-inset-x-1.5 before:inset-y-0"
          : "h-px cursor-ns-resize before:absolute before:inset-x-0 before:-inset-y-1.5",
      )}
      onPointerDown={startResize}
      role="separator"
    />
  );
}

export function PaneDropPreview({ placement }: { placement: DropPlacement }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div
        className={cx(
          "absolute bg-white/[0.07]",
          placement === "center" && "inset-0",
          placement === "top" && "inset-x-0 top-0 h-1/2",
          placement === "bottom" && "inset-x-0 bottom-0 h-1/2",
          placement === "left" && "inset-y-0 left-0 w-1/2",
          placement === "right" && "inset-y-0 right-0 w-1/2",
        )}
      />
    </div>
  );
}
