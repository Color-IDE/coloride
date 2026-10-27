import { RangeSet, RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter, keymap } from "@codemirror/view";
import { editorShortcut } from "./shortcutBinding";
import { loadBreakpoints, saveBreakpoints } from "./breakpointStore";

const toggleBreakpoint = StateEffect.define<number>();

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("span");
    el.className = "coloride-breakpoint";
    el.title = "Breakpoint";
    return el;
  }
}

class BreakpointSpacer extends GutterMarker {
  toDOM() {
    const el = document.createElement("span");
    el.className = "coloride-breakpoint-spacer";
    return el;
  }
}

const breakpointMarker = new BreakpointMarker();
const breakpointSpacer = new BreakpointSpacer();

function setFromLines(doc: EditorView["state"]["doc"], lines: number[]) {
  const builder = new RangeSetBuilder<GutterMarker>();
  const unique = [...new Set(lines)].sort((a, b) => a - b);
  for (const lineNo of unique) {
    if (lineNo < 1 || lineNo > doc.lines) continue;
    const line = doc.line(lineNo);
    builder.add(line.from, line.from, breakpointMarker);
  }
  return builder.finish();
}

function linesFromSet(doc: EditorView["state"]["doc"], set: RangeSet<GutterMarker>) {
  const lines: number[] = [];
  const iter = set.iter();
  while (iter.value) {
    if (iter.from <= doc.length) lines.push(doc.lineAt(iter.from).number);
    iter.next();
  }
  return lines;
}

function hasAt(set: RangeSet<GutterMarker>, pos: number) {
  let found = false;
  set.between(pos, pos, () => {
    found = true;
  });
  return found;
}

function createBreakpointField(getPath: () => string) {
  return StateField.define<RangeSet<GutterMarker>>({
  create(state) {
    return setFromLines(state.doc, loadBreakpoints(getPath()));
  },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(toggleBreakpoint)) continue;
      const pos = effect.value;
      next = hasAt(next, pos)
        ? next.update({ filter: (from) => from !== pos })
        : next.update({ add: [breakpointMarker.range(pos)] });
    }
    return next;
  },
});
}

function persist(view: EditorView, path: string, field: StateField<RangeSet<GutterMarker>>) {
  saveBreakpoints(path, linesFromSet(view.state.doc, view.state.field(field)));
}

export function breakpointGutter(getPath: () => string): Extension {
  const breakpointField = createBreakpointField(getPath);
  const toggleAt = (view: EditorView, pos: number) => {
    const line = view.state.doc.lineAt(pos);
    view.dispatch({ effects: toggleBreakpoint.of(line.from) });
    persist(view, getPath(), breakpointField);
    return true;
  };
  return [
    breakpointField,
    gutter({
      class: "cm-gutter-coloride-bp",
      renderEmptyElements: true,
      markers: (view) => view.state.field(breakpointField),
      initialSpacer: () => breakpointSpacer,
      domEventHandlers: {
        mousedown(view, line, event) {
          event.preventDefault();
          toggleAt(view, line.from);
          return true;
        },
      },
    }),
    keymap.of([
      editorShortcut("editor.toggle-breakpoint", (view) =>
        toggleAt(view, view.state.selection.main.head),
      ),
    ]),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      persist(update.view, getPath(), breakpointField);
    }),
  ];
}
