import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** Pace incoming bursts without delaying restored history or dropping the final chunk. */
export function useSmoothStreamingText(text: string, streaming: boolean) {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(streaming && !reducedMotion ? "" : text);
  const shownRef = useRef(shown);
  const targetRef = useRef(text);
  const liveRef = useRef(streaming);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    targetRef.current = text;
    liveRef.current ||= streaming;
    const publish = (value: string) => {
      shownRef.current = value;
      setShown(value);
    };
    if (reducedMotion || !liveRef.current) {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      publish(text);
      return;
    }
    if (!text.startsWith(shownRef.current)) publish("");
    if (timerRef.current !== null || shownRef.current === text) return;
    const tick = () => {
      const target = targetRef.current;
      const remaining = target.slice(shownRef.current.length);
      // Catch up faster for large provider batches, keeping word boundaries and Unicode intact.
      const words = remaining.match(/\s*\S+\s*|\s+/gu) ?? [];
      const count = Math.max(1, Math.min(8, Math.ceil(words.length / 12)));
      publish(shownRef.current + words.slice(0, count).join(""));
      timerRef.current = shownRef.current === target ? null : setTimeout(tick, 24);
    };
    timerRef.current = setTimeout(tick, 24);
  }, [text, streaming, reducedMotion]);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  return reducedMotion || !liveRef.current ? text : shown;
}
