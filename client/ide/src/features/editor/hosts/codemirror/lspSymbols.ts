/**
 * Cmd+Shift+O — jump to a symbol in the current file.
 */

import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import { editorShortcut } from "./shortcutBinding";
import type { LspDocumentSymbol } from "../../lsp/LspSessionManager";
import { lspDocumentLanguageId } from "../../lsp/pathUri";

export type LspDocumentSymbolsFn = () => Promise<LspDocumentSymbol[]>;

type SymbolsState = {
  pos: number;
  items: LspDocumentSymbol[];
  query: string;
  selected: number;
} | null;

const setSymbols = StateEffect.define<SymbolsState>();

function visibleItems(state: Exclude<SymbolsState, null>): LspDocumentSymbol[] {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.items;
  return state.items.filter((item) => item.name.toLowerCase().includes(q) || item.kind.includes(q));
}

function renderPanel(view: EditorView, state: Exclude<SymbolsState, null>): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "coloride-refs-panel coloride-symbols-panel";
  wrap.addEventListener("mousedown", (event) => event.preventDefault());

  const input = document.createElement("input");
  input.className = "coloride-symbols-input";
  input.placeholder = "Go to symbol";
  input.value = state.query;
  input.addEventListener("mousedown", (event) => event.stopPropagation());
  input.addEventListener("input", () => {
    view.dispatch({
      effects: setSymbols.of({ ...state, query: input.value, selected: 0 }),
    });
  });
  wrap.appendChild(input);

  const items = visibleItems(state);
  const list = document.createElement("ul");
  list.className = "coloride-refs-list";
  items.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "coloride-refs-item" + (index === state.selected ? " is-active" : "");
    const name = document.createElement("div");
    name.className = "coloride-refs-path";
    name.textContent = item.name;
    const kind = document.createElement("div");
    kind.className = "coloride-refs-snip";
    kind.textContent = item.kind;
    li.append(name, kind);
    li.addEventListener("mouseup", (event) => {
      event.preventDefault();
      const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, item.line)));
      const pos = Math.min(line.to, line.from + Math.max(0, item.column - 1));
      view.dispatch({
        selection: { anchor: pos },
        effects: [setSymbols.of(null), EditorView.scrollIntoView(pos, { y: "center" })],
      });
      view.focus();
    });
    list.appendChild(li);
  });
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "coloride-refs-head";
    empty.textContent = "No symbols";
    wrap.appendChild(empty);
  } else {
    wrap.appendChild(list);
  }
  queueMicrotask(() => input.focus());
  return wrap;
}

export function lspSymbolsExtension(
  getPath: () => string,
  listSymbols: LspDocumentSymbolsFn,
): Extension {
  const field = StateField.define<SymbolsState>({
    create: () => null,
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setSymbols)) return effect.value;
      }
      if (value && tr.docChanged) {
        return { ...value, pos: tr.changes.mapPos(value.pos, 1) };
      }
      return value;
    },
    provide: (f) =>
      showTooltip.from(f, (value) => {
        if (!value) return null;
        const snapshot = value;
        return {
          pos: snapshot.pos,
          above: false,
          create(view) {
            return { dom: renderPanel(view, snapshot) };
          },
        } satisfies Tooltip;
      }),
  });

  const jumpSelected = (view: EditorView) => {
    const current = view.state.field(field, false);
    if (!current) return false;
    const items = visibleItems(current);
    const item = items[current.selected];
    if (!item) return false;
    const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, item.line)));
    const pos = Math.min(line.to, line.from + Math.max(0, item.column - 1));
    view.dispatch({
      selection: { anchor: pos },
      effects: [setSymbols.of(null), EditorView.scrollIntoView(pos, { y: "center" })],
    });
    return true;
  };

  return [
    field,
    Prec.high(
      keymap.of([
        editorShortcut("editor.go-to-symbol", (view) => {
          if (!lspDocumentLanguageId(getPath())) return false;
          const pos = view.state.selection.main.head;
          void listSymbols().then((items) => {
            view.dispatch({
              effects: setSymbols.of({ pos, items, query: "", selected: 0 }),
            });
          });
          return true;
        }),
        {
          key: "Escape",
          run: (view) => {
            if (!view.state.field(field, false)) return false;
            view.dispatch({ effects: setSymbols.of(null) });
            return true;
          },
        },
        {
          key: "ArrowDown",
          run: (view) => {
            const current = view.state.field(field, false);
            if (!current) return false;
            const max = Math.max(0, visibleItems(current).length - 1);
            view.dispatch({
              effects: setSymbols.of({ ...current, selected: Math.min(max, current.selected + 1) }),
            });
            return true;
          },
        },
        {
          key: "ArrowUp",
          run: (view) => {
            const current = view.state.field(field, false);
            if (!current) return false;
            view.dispatch({
              effects: setSymbols.of({ ...current, selected: Math.max(0, current.selected - 1) }),
            });
            return true;
          },
        },
        { key: "Enter", run: jumpSelected },
      ]),
    ),
  ];
}
