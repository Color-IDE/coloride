import type { EditorHandle, RevealRequest } from "../../../core/types";

/**
 * Apply reveal once per token — but re-apply when the doc was empty on the
 * first try (file still loading) so go-to-definition never lands on a blank buffer.
 */
export function applyReveal(
  handle: EditorHandle,
  reveal: RevealRequest | null | undefined,
  lastTokenRef: { current: number },
  lastLenRef?: { current: number },
) {
  if (!reveal) return;
  let docLen = 0;
  try {
    docLen = handle.getValue().length;
  } catch {
    docLen = 0;
  }
  const sameToken = reveal.token === lastTokenRef.current;
  const prevLen = lastLenRef?.current ?? -1;
  // A same-token reveal is complete even for an intentionally empty file.
  // Re-run only for the one useful transition: the first empty/loading buffer
  // subsequently received its file contents. Repeating reveal on an empty doc
  // emits another cursor event and can form a React update loop.
  const becameLoaded = prevLen === 0 && docLen > 0;
  if (sameToken && prevLen >= 0 && !becameLoaded) return;
  lastTokenRef.current = reveal.token;
  if (lastLenRef) lastLenRef.current = docLen;
  handle.reveal(reveal);
  // Layout may not be ready on first paint after tab switch.
  window.requestAnimationFrame(() => {
    try {
      handle.reveal(reveal);
    } catch {
      // ignore
    }
  });
}
