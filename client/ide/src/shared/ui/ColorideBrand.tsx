import { useEffect, useState, type CSSProperties } from "react";
import markUrl from "../../../../desktop/resources/branding/coloride-mark.svg";
import loadingMarkUrl from "../../../../desktop/resources/branding/coloride-loading.svg";
import reducedLoadingMarkUrl from "../../../../desktop/resources/branding/coloride-loading-reduced.svg";
import wordmarkUrl from "../../../../desktop/resources/branding/coloride-wordmark.svg";

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

function useReducedMotion(enabled: boolean) {
  const [reduced, setReduced] = useState(() => (
    enabled && typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ));
  useEffect(() => {
    if (!enabled) return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [enabled]);
  return enabled && reduced;
}

/** Full Coloride wordmark (mark + outlined type). */
export function ColorideWordmark({
  className,
  glow: _glow = false,
}: {
  className?: string;
  /** @deprecated No-op — hover light effect removed. */
  glow?: boolean;
} = {}) {
  return (
    <span className={cx("coloride-brand", className)}>
      <img
        alt="Coloride"
        className="coloride-brand-svg h-auto w-full"
        src={wordmarkUrl}
      />
    </span>
  );
}

/** Original Coloride artwork; loading reveals its colors over a muted gray base. */
export function ColorideMark({
  className = "h-7 w-7",
  glow: _glow = false,
  shimmer = false,
  style,
}: {
  className?: string;
  /** @deprecated Retained for existing callers. */
  glow?: boolean;
  /** Reveal the original palette with a moving diagonal mask while loading. */
  shimmer?: boolean;
  style?: CSSProperties;
} = {}) {
  const reducedMotion = useReducedMotion(shimmer);
  return (
    <span className={cx("coloride-brand coloride-brand-mark", className)} style={style}>
      <img
        alt=""
        aria-hidden="true"
        className="coloride-brand-svg h-full w-full object-contain"
        src={shimmer ? (reducedMotion ? reducedLoadingMarkUrl : loadingMarkUrl) : markUrl}
      />
    </span>
  );
}
