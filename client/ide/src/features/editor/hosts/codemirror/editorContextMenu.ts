import { EditorView } from "@codemirror/view";

export type EditorContextMenuRequest = {
  x: number;
  y: number;
  hasSelection: boolean;
  readOnly: boolean;
};

export function editorContextMenuExtension(
  onOpen: (request: EditorContextMenuRequest) => void,
) {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos != null) {
        const sel = view.state.selection.main;
        if (pos < Math.min(sel.from, sel.to) || pos > Math.max(sel.from, sel.to)) {
          view.dispatch({ selection: { anchor: pos } });
        }
      }
      const next = view.state.selection.main;
      onOpen({
        x: event.clientX,
        y: event.clientY,
        hasSelection: !next.empty,
        readOnly: view.state.readOnly,
      });
      return true;
    },
  });
}
