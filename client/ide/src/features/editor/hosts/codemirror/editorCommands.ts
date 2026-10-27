/**
 * VS Code-style editing keys: comment, move/duplicate line, expand selection.
 */

import {
  copyLineDown,
  copyLineUp,
  moveLineDown,
  moveLineUp,
  selectParentSyntax,
  simplifySelection,
  toggleComment,
} from "@codemirror/commands";
import { EditorState, type Extension, Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { editorShortcut } from "./shortcutBinding";

export function editorCommands(): Extension {
  return [
    EditorState.languageData.of(() => [
      { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
    ]),
    Prec.high(
      keymap.of([
        editorShortcut("editor.toggle-comment", (view) => toggleComment(view)),
        editorShortcut("editor.move-line-up", (view) => moveLineUp(view)),
        editorShortcut("editor.move-line-down", (view) => moveLineDown(view)),
        editorShortcut("editor.duplicate-line-up", (view) => copyLineUp(view)),
        editorShortcut("editor.duplicate-line-down", (view) => copyLineDown(view)),
        editorShortcut("editor.expand-selection", (view) => selectParentSyntax(view)),
        editorShortcut("editor.shrink-selection", (view) => simplifySelection(view)),
      ]),
    ),
  ];
}
