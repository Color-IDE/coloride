import { indentUnit } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { lineNumbers } from "@codemirror/view";
import type { EditorTheme, EditorViewOptions } from "../../../core/types";
import { colorideTheme } from "../theme";

export function formatGutterNumber(n: number) {
  // Hold 4 digits (up to 9999). Width only grows at 10000+ lines.
  return String(n).padStart(4, " ");
}

export function lineNumberExt(
  mode: EditorViewOptions["lineNumbers"],
): Extension {
  if (mode === "off") return [];
  if (mode === "relative") {
    return lineNumbers({
      formatNumber: (lineNo, state) => {
        const cursorLine = state.doc.lineAt(state.selection.main.head).number;
        if (lineNo === cursorLine) return formatGutterNumber(lineNo);
        return formatGutterNumber(Math.abs(lineNo - cursorLine));
      },
    });
  }
  return lineNumbers({
    formatNumber: (lineNo) => formatGutterNumber(lineNo),
  });
}

export function tabExt(options: EditorViewOptions): Extension {
  const unit = options.insertSpaces
    ? " ".repeat(Math.max(1, options.tabSize))
    : "\t";
  return [indentUnit.of(unit), EditorState.tabSize.of(options.tabSize)];
}

export function buildThemeExt(
  theme: EditorTheme,
  options: EditorViewOptions,
): Extension {
  return colorideTheme(theme, options);
}
