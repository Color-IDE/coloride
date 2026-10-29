import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { placeBesideRect, type FloatingBox } from "./modelMenuPosition";

export function ComposerModelTooltip({
  description,
  children,
  side = "left",
  caretOffsetY,
  style,
  name,
  stats,
  tokenPrice,
  details,
  tokenPriceLabel = "Token price",
  anchor,
}: {
  description: string;
  children?: ReactNode;
  side?: "left" | "right";
  caretOffsetY?: number;
  style?: CSSProperties;
  name?: string;
  stats?: { label: string; value: number | null }[];
  tokenPrice?: { input: number | null; output: number | null };
  details?: { label: string; value: string }[];
  tokenPriceLabel?: string;
  anchor?: DOMRect;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<FloatingBox | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const element = ref.current;
    const reposition = () =>
      setPlacement(
        placeBesideRect(
          anchor,
          element.offsetWidth,
          element.offsetHeight,
          12,
          side,
        ),
      );
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(element);
    window.addEventListener("resize", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
    };
  }, [anchor, side]);
  const resolvedSide = anchor && placement ? placement.side : side;
  const resolvedCaret =
    anchor && placement ? placement.caretOffsetY : caretOffsetY;
  return (
    <div
      ref={ref}
      className={`agent-model-hover-tip is-visible is-side-${resolvedSide}`}
      role="tooltip"
      style={{
        ...style,
        ...(anchor && placement
          ? { top: placement.top, left: placement.left }
          : {}),
        maxHeight: "calc(100vh - 16px)",
      }}
    >
      <div style={{ maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>
        {name ? <div className="mb-2 text-sm font-semibold">{name}</div> : null}
        <p className="agent-model-tip-desc">{description}</p>
        {stats?.length ? (
          <div className="agent-model-tip-stats">
            {stats.map(({ label, value }) => (
              <div className="agent-model-tip-row" key={label}>
                <span className="agent-model-tip-key">{label}</span>
                <span
                  role="img"
                  aria-label={
                    value === null
                      ? `${label}: unavailable`
                      : `${label}: ${value} of 4`
                  }
                  title={
                    value === null ? "Not provided by this agent" : undefined
                  }
                  className="agent-model-tip-bars"
                >
                  {Array.from({ length: 4 }, (_, index) => (
                    <span
                      key={index}
                      className={`agent-model-tip-bar${value !== null && index < value ? " is-on" : ""}`}
                    />
                  ))}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {details?.length ? (
          <>
            <div className="agent-model-tip-divider" />
            <div className="agent-model-tip-stats">
              {details.map(({ label, value }) => (
                <div className="agent-model-tip-row" key={label}>
                  <span className="agent-model-tip-key">{label}</span>
                  <span className="text-right">{value}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {tokenPrice ? (
          <>
            <div className="agent-model-tip-divider" />
            <div className="agent-model-tip-token-head">{tokenPriceLabel}</div>
            <div className="agent-model-tip-token-row">
              <span>
                In:{" "}
                {tokenPrice.input === null ? "—" : `$${tokenPrice.input}/M tok`}
              </span>
              <span>
                Out:{" "}
                {tokenPrice.output === null
                  ? "—"
                  : `$${tokenPrice.output}/M tok`}
              </span>
            </div>
          </>
        ) : null}
        {children}
      </div>
      <span
        aria-hidden="true"
        className="agent-model-hover-tip-caret"
        style={
          typeof resolvedCaret === "number"
            ? {
                top: resolvedCaret,
                transform: "translateY(-50%) rotate(45deg)",
              }
            : undefined
        }
      />
    </div>
  );
}
