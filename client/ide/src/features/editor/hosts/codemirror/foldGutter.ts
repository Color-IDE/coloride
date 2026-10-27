/**
 * Fold gutter between line numbers and code.
 * Chevron points down when open, right when folded.
 */

import {
  codeFolding,
  foldCode,
  foldGutter as cmFoldGutter,
  unfoldCode,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { editorShortcut } from "./shortcutBinding";

const CHEVRON = `
<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
  <path d="M0 0h20v20H0z" fill="none"/>
  <path fill="currentColor" d="M10.103 12.778L16.81 6.08a.69.69 0 0 1 .99.012a.726.726 0 0 1-.012 1.012l-7.203 7.193a.69.69 0 0 1-.985-.006L2.205 6.72a.727.727 0 0 1 0-1.01a.69.69 0 0 1 .99 0z"/>
</svg>
`.trim();

function foldMarker(open: boolean): HTMLElement {
  const btn = document.createElement("span");
  btn.className = `coloride-fold-btn ${open ? "is-open" : "is-closed"}`;
  btn.innerHTML = CHEVRON;
  return btn;
}

export function foldGutter(): Extension {
  return [
    codeFolding({
      placeholderText: "…",
    }),
    cmFoldGutter({
      markerDOM: foldMarker,
    }),
    keymap.of([
      editorShortcut("editor.fold", foldCode),
      editorShortcut("editor.unfold", unfoldCode),
    ]),
  ];
}
