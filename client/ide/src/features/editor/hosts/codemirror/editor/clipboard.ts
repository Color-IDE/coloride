import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  COLORIDE_CODE_REF_MIME,
  serializeCodeRef,
} from "../../../codeRefClipboard";

export function codeRefCopyExtension(getPath: () => string): Extension {
  const writeClipboard = (event: ClipboardEvent, view: EditorView) => {
    const sel = view.state.selection.main;
    if (sel.empty) return false;
    const text = view.state.sliceDoc(sel.from, sel.to);
    if (!text) return false;
    const path = getPath();
    if (!path || path.startsWith("browser:")) return false;
    const startLine = view.state.doc.lineAt(sel.from).number;
    // Selection ending exactly at a line start counts the previous line as last.
    const endPos =
      sel.to > sel.from && view.state.doc.lineAt(sel.to).from === sel.to
        ? sel.to - 1
        : sel.to;
    const endLine = view.state.doc.lineAt(Math.max(sel.from, endPos)).number;
    try {
      event.clipboardData?.setData("text/plain", text);
      event.clipboardData?.setData(
        COLORIDE_CODE_REF_MIME,
        serializeCodeRef({ path, startLine, endLine, text }),
      );
      event.preventDefault();
      return true;
    } catch {
      return false;
    }
  };
  return EditorView.domEventHandlers({
    copy(event, view) {
      return writeClipboard(event, view);
    },
    cut(event, view) {
      if (!writeClipboard(event, view)) return false;
      // Default cut after writing custom clipboard payload.
      const sel = view.state.selection.main;
      if (!sel.empty && !view.state.readOnly) {
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: "" },
          selection: { anchor: sel.from },
          userEvent: "delete.cut",
        });
      }
      return true;
    },
  });
}
