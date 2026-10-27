import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";

/** Local terminals use xterm's DOM renderer; WebGL remains an optional layer.
 * A valid GPU context can still have a stale/blank glyph atlas, with no loss
 * event to trigger fallback. Keep local text independent of that cache.
 */
export function installTerminalRenderer(term: Terminal, renderer: "dom" | "webgl" = "webgl"): () => void {
  if (renderer === "dom") return () => {};
  let addon: WebglAddon | null = null;
  let contextLoss: { dispose(): void } | null = null;
  const fallback = () => {
    contextLoss?.dispose();
    contextLoss = null;
    const previous = addon;
    addon = null;
    try { previous?.dispose(); } catch { /* context already lost */ }
    if (term.element && term.rows > 0) term.refresh(0, term.rows - 1);
  };
  try {
    addon = new WebglAddon();
    contextLoss = addon.onContextLoss(fallback);
    term.loadAddon(addon);
  } catch {
    fallback();
  }
  return () => {
    contextLoss?.dispose();
    contextLoss = null;
    try { addon?.dispose(); } catch { /* renderer already disposed */ }
    addon = null;
  };
}
