import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  moveLineDown,
  moveLineUp,
  redo,
  selectAll,
  selectParentSyntax,
  toggleComment,
  undo,
  undoSelection,
} from "@codemirror/commands";
import { foldCode, syntaxTree, unfoldCode } from "@codemirror/language";
import { forEachDiagnostic } from "@codemirror/lint";
import {
  gotoLine,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  getShortcutBindings,
  type ShortcutActionId,
} from "../../../../settings/shortcuts";
import type { EditorCommandId } from "../../../core/types";
import { type CreateCodeMirrorEditorParams } from "./types";

export function fireEditorBinding(view: EditorView, id: ShortcutActionId) {
  const binding = getShortcutBindings()[id];
  if (!binding) return false;
  const parts = binding.split("+");
  const last = parts[parts.length - 1] ?? "";
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const letter = last.length === 1;
  const event = new KeyboardEvent("keydown", {
    key: letter ? last : last.toUpperCase(),
    code: letter ? `Key${last.toUpperCase()}` : last.toUpperCase(),
    metaKey: parts.includes("mod") && mac,
    ctrlKey: parts.includes("ctrl") || (parts.includes("mod") && !mac),
    altKey: parts.includes("alt"),
    shiftKey: parts.includes("shift"),
    bubbles: true,
    cancelable: true,
  });
  return view.contentDOM.dispatchEvent(event);
}

export function runEditorCommand(
  view: EditorView,
  command: EditorCommandId,
  params: CreateCodeMirrorEditorParams,
): boolean {
  const readOnly = view.state.readOnly;
  const sel = view.state.selection.main;
  switch (command) {
    case "goToDefinition": {
      const pos = sel.head;
      const line = view.state.doc.lineAt(pos);
      params.onGoToDefinition?.(line.number, pos - line.from + 1);
      return true;
    }
    case "findReferences":
      return fireEditorBinding(view, "editor.find-references");
    case "goToSymbol":
      return fireEditorBinding(view, "editor.go-to-symbol");
    case "rename":
      if (readOnly) return false;
      return fireEditorBinding(view, "editor.rename");
    case "cut":
      if (readOnly || sel.empty) return false;
      view.contentDOM.focus();
      return document.execCommand("cut");
    case "copy":
      if (sel.empty) return false;
      view.contentDOM.focus();
      return document.execCommand("copy");
    case "paste":
      if (readOnly) return false;
      view.contentDOM.focus();
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (!text) return;
          const current = view.state.selection.main;
          view.dispatch({
            changes: { from: current.from, to: current.to, insert: text },
            selection: { anchor: current.from + text.length },
            userEvent: "input.paste",
          });
        })
        .catch(() => {
          document.execCommand("paste");
        });
      return true;
    case "expandSelection":
      return selectParentSyntax(view);
    case "shrinkSelection":
      return undoSelection(view);
    case "selectNextSibling":
    case "selectPreviousSibling": {
      let node = syntaxTree(view.state).resolveInner(sel.from, 1);
      while (node.parent && (node.from > sel.from || node.to < sel.to))
        node = node.parent;
      const sibling =
        command === "selectNextSibling" ? node.nextSibling : node.prevSibling;
      if (!sibling) return false;
      view.dispatch({
        selection: EditorSelection.single(sibling.from, sibling.to),
        scrollIntoView: true,
        userEvent: "select",
      });
      return true;
    }
    case "addCursorAbove":
      return addCursorAbove(view);
    case "addCursorBelow":
      return addCursorBelow(view);
    case "selectAllOccurrences":
      return selectSelectionMatches(view);
    case "moveLineUp":
      return !readOnly && moveLineUp(view);
    case "moveLineDown":
      return !readOnly && moveLineDown(view);
    case "duplicateSelection": {
      if (readOnly) return false;
      if (sel.empty) return copyLineDown(view);
      view.dispatch(
        view.state.changeByRange((range) => {
          const text = view.state.sliceDoc(range.from, range.to);
          return {
            changes: { from: range.to, insert: text },
            range: EditorSelection.range(range.to, range.to + text.length),
          };
        }),
        { scrollIntoView: true, userEvent: "input" },
      );
      return true;
    }
    case "goToLine":
      return gotoLine(view);
    case "nextProblem":
    case "previousProblem": {
      const positions: number[] = [];
      forEachDiagnostic(view.state, (_diagnostic, from) =>
        positions.push(from),
      );
      positions.sort((a, b) => a - b);
      const target =
        command === "nextProblem"
          ? (positions.find((pos) => pos > sel.head) ?? positions[0])
          : (positions.filter((pos) => pos < sel.head).pop() ??
            positions.at(-1));
      if (target === undefined) return false;
      view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
      return true;
    }
    case "selectPrevious": {
      if (sel.empty) return selectNextOccurrence(view);
      const text = view.state.sliceDoc(sel.from, sel.to);
      const doc = view.state.doc.toString();
      const from = doc.lastIndexOf(text, sel.from - 1);
      if (from < 0) return false;
      const ranges = view.state.selection.ranges;
      if (
        ranges.some(
          (range) => range.from === from && range.to === from + text.length,
        )
      )
        return false;
      view.dispatch({
        selection: EditorSelection.create(
          [...ranges, EditorSelection.range(from, from + text.length)],
          ranges.length,
        ),
        scrollIntoView: true,
      });
      return true;
    }
    case "selectAll":
      return selectAll(view);
    case "selectNext":
      return selectNextOccurrence(view);
    case "find":
      params.onFindRequest?.();
      return true;
    case "toggleComment":
      if (readOnly) return false;
      return toggleComment(view);
    case "format":
      if (readOnly) return false;
      return fireEditorBinding(view, "editor.format");
    case "organizeImports":
      if (readOnly) return false;
      return fireEditorBinding(view, "editor.organize-imports");
    case "fold":
      return foldCode(view);
    case "unfold":
      return unfoldCode(view);
    case "undo":
      if (readOnly) return false;
      return undo(view);
    case "redo":
      if (readOnly) return false;
      return redo(view);
    case "toggleBreakpoint":
      return fireEditorBinding(view, "editor.toggle-breakpoint");
    default:
      return false;
  }
}
