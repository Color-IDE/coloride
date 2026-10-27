import type { Extension } from "@codemirror/state";
import { showMinimap } from "@replit/codemirror-minimap";

/** Right-side CodeMirror minimap. Toggle via options.minimap / Editor settings. */
export function minimapExtension(enabled: boolean): Extension {
  if (!enabled) return [];

  return showMinimap.of({
    create: () => {
      const dom = document.createElement("div");
      dom.className = "coloride-minimap";
      return { dom };
    },
    displayText: "blocks",
    showOverlay: "always",
  });
}
