import { forEachDiagnostic, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { hoverTooltip, type Tooltip } from "@codemirror/view";

const COPY_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M7 11V9C7 5.70017 7 4.05025 8.02513 3.02513C9.05025 2 10.7002 2 14 2C17.2998 2 18.9497 2 19.9749 3.02513C21 4.05025 21 5.70017 21 9V11C21 14.2998 21 15.9497 19.9749 16.9749C18.9497 18 17.2998 18 14 18C10.7002 18 9.05025 18 8.02513 16.9749C7 15.9497 7 14.2998 7 11Z"></path>
  <path d="M3 6V15C3 18.2998 3 19.9497 4.02513 20.9749C5.05025 22 6.70017 22 10 22H17"></path>
</svg>`.trim();

const CHECK_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 13.2592L7.58583 15.9568C8.2525 16.6523 8.58583 17 9.00004 17C9.41425 17 9.74759 16.6523 10.4143 15.9568L19 7"></path>
</svg>`.trim();

let copiedKey = "";
let copiedUntil = 0;
const tooltipErrors = new WeakMap<Tooltip, string[]>();

function formatDiagnosticLine(diag: Diagnostic): string {
  const message = (diag.message || "").replace(/\s+/g, " ").trim();
  const source = (diag.source || "").trim();
  if (!source) return message;
  const pretty = source.replace(/^ts\((\d+)\)$/i, "ts $1").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  return pretty ? `${message} (${pretty})` : message;
}

/** Hover card for LSP/syntax diagnostics — no red chrome, copy on the right. */
export function errorDiagnosticsUi(): Extension {
  return hoverTooltip(
    (view, pos) => {
      const hits: Diagnostic[] = [];
      let from = pos;
      let to = pos;
      forEachDiagnostic(view.state, (diag, start, end) => {
        if (pos >= start && pos <= end) {
          hits.push(diag);
          from = Math.min(from, start);
          to = Math.max(to, end);
        }
      });
      if (hits.length === 0) return null;
      const lines = [...new Set(hits.map(formatDiagnosticLine).filter(Boolean))];
      if (lines.length === 0) return null;
      const payload = lines.join("\n");
      const tooltip: Tooltip = {
        pos: from,
        end: to,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "coloride-error-tooltip";
          const body = document.createElement("div");
          body.className = "coloride-error-tooltip-body";
          for (const line of lines) {
            const row = document.createElement("div");
            row.className = "coloride-error-tooltip-text";
            row.textContent = line;
            body.appendChild(row);
          }
          const copy = document.createElement("button");
          copy.type = "button";
          copy.className = "coloride-error-tooltip-copy";
          copy.title = "Copy";
          copy.setAttribute("aria-label", "Copy");
          const copyGlyph = document.createElement("span");
          copyGlyph.className = "coloride-error-tooltip-copy-icon";
          copyGlyph.innerHTML = COPY_ICON;
          const checkGlyph = document.createElement("span");
          checkGlyph.className = "coloride-error-tooltip-check-icon";
          checkGlyph.innerHTML = CHECK_ICON;
          copy.append(copyGlyph, checkGlyph);
          if (copiedKey === payload && Date.now() < copiedUntil) {
            copy.classList.add("is-copied");
          }
          const copyText = () => {
            copiedKey = payload;
            copiedUntil = Date.now() + 1600;
            copy.classList.add("is-copied");
            if (navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(payload);
            }
          };
          copy.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            copyText();
          }, true);
          copy.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
          }, true);
          dom.append(body, copy);
          return { dom };
        },
      };
      tooltipErrors.set(tooltip, lines);
      return tooltip;
    },
    {
      hoverTime: 180,
      hideOn(tr, tooltip) {
        const end = tooltip.end ?? tooltip.pos;
        if (tr.docChanged && tr.changes.touchesRange(tooltip.pos, end)) return true;
        const keys = tooltipErrors.get(tooltip);
        if (!keys?.length) return false;
        let pos = tooltip.pos;
        try {
          pos = tr.changes.mapPos(tooltip.pos, 0);
        } catch {
          return true;
        }
        if (pos == null || pos < 0 || pos > tr.state.doc.length) return true;
        const still = new Set<string>();
        forEachDiagnostic(tr.state, (diag, start, stop) => {
          if (pos >= start && pos <= stop) still.add(formatDiagnosticLine(diag));
        });
        return !keys.some((key) => still.has(key));
      },
    },
  );
}
