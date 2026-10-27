/**
 * Shift+F12 — find references (vtsls). Peek list under the symbol.
 */

import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  showTooltip,
  type Tooltip,
} from "@codemirror/view";
import type { LspReferenceHit } from "../../lsp/LspSessionManager";
import { lspDocumentLanguageId } from "../../lsp/pathUri";
import { symbolRangeAt } from "./gotoDefinition";
import { editorShortcut } from "./shortcutBinding";

export type LspFindReferencesFn = (
  line: number,
  column: number,
) => Promise<LspReferenceHit[]>;

export type LspOpenLocationFn = (
  path: string,
  location: { line: number; column: number },
) => void;

type RefsState = {
  pos: number;
  hits: LspReferenceHit[];
  selected: number;
} | null;

const setRefs = StateEffect.define<RefsState>();

function shortPath(path: string, root?: string | null): string {
  const base = root && path.startsWith(root) ? path.slice(root.length).replace(/^\//, "") : path;
  const parts = base.split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/") || path;
  return parts.slice(-2).join("/");
}

function lineSnippet(view: EditorView, currentPath: string, hit: LspReferenceHit): string {
  try {
    if (hit.path !== currentPath) return "";
    return view.state.doc.line(hit.line).text.trim().slice(0, 88);
  } catch {
    return "";
  }
}

function renderPanel(
  view: EditorView,
  state: Exclude<RefsState, null>,
  currentPath: string,
  root: string | null | undefined,
  open: LspOpenLocationFn,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "coloride-refs-panel";
  wrap.addEventListener("mousedown", (event) => event.preventDefault());

  const head = document.createElement("div");
  head.className = "coloride-refs-head";
  head.textContent =
    state.hits.length === 1 ? "1 reference" : `${state.hits.length} references`;
  wrap.appendChild(head);

  const list = document.createElement("ul");
  list.className = "coloride-refs-list";
  state.hits.forEach((hit, index) => {
    const li = document.createElement("li");
    li.className = "coloride-refs-item" + (index === state.selected ? " is-active" : "");
    const pathEl = document.createElement("div");
    pathEl.className = "coloride-refs-path";
    pathEl.textContent = `${shortPath(hit.path, root)} :${hit.line}`;
    li.appendChild(pathEl);
    const snip = lineSnippet(view, currentPath, hit);
    if (snip) {
      const snipEl = document.createElement("div");
      snipEl.className = "coloride-refs-snip";
      snipEl.textContent = snip;
      li.appendChild(snipEl);
    }
    li.addEventListener("mouseup", (event) => {
      event.preventDefault();
      open(hit.path, { line: hit.line, column: hit.column });
      view.dispatch({ effects: setRefs.of(null) });
    });
    list.appendChild(li);
  });
  wrap.appendChild(list);
  return wrap;
}

export function lspReferencesExtension(options: {
  getPath: () => string;
  workspaceRoot?: string | null;
  find: LspFindReferencesFn;
  open: LspOpenLocationFn;
}): Extension {
  const { getPath, find, open } = options;
  const root = options.workspaceRoot ?? null;

  const field = StateField.define<RefsState>({
    create: () => null,
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setRefs)) return effect.value;
      }
      if (value && tr.docChanged) {
        return { ...value, pos: tr.changes.mapPos(value.pos, 1) };
      }
      return value;
    },
    provide: (f) =>
      showTooltip.from(f, (value) => {
        if (!value || value.hits.length === 0) return null;
        const snapshot = value;
        return {
          pos: snapshot.pos,
          above: false,
          create(view) {
            return { dom: renderPanel(view, snapshot, getPath(), root, open) };
          },
        } satisfies Tooltip;
      }),
  });

  const runFind = (view: EditorView) => {
    const path = getPath();
    if (!lspDocumentLanguageId(path)) return false;
    const pos = view.state.selection.main.head;
    const range = symbolRangeAt(view.state, pos);
    const target = range?.from ?? pos;
    const line = view.state.doc.lineAt(target);
    const column = target - line.from + 1;
    void find(line.number, column).then((hits) => {
      view.dispatch({
        effects: setRefs.of(hits.length ? { pos: target, hits, selected: 0 } : null),
      });
    });
    return true;
  };

  const keys = Prec.high(
    keymap.of([
      editorShortcut("editor.find-references", runFind),
      {
        key: "Escape",
        run: (view) => {
          if (!view.state.field(field, false)) return false;
          view.dispatch({ effects: setRefs.of(null) });
          return true;
        },
      },
      {
        key: "ArrowDown",
        run: (view) => {
          const current = view.state.field(field, false);
          if (!current?.hits.length) return false;
          const selected = (current.selected + 1) % current.hits.length;
          view.dispatch({ effects: setRefs.of({ ...current, selected }) });
          return true;
        },
      },
      {
        key: "ArrowUp",
        run: (view) => {
          const current = view.state.field(field, false);
          if (!current?.hits.length) return false;
          const selected = (current.selected - 1 + current.hits.length) % current.hits.length;
          view.dispatch({ effects: setRefs.of({ ...current, selected }) });
          return true;
        },
      },
      {
        key: "Enter",
        run: (view) => {
          const current = view.state.field(field, false);
          if (!current?.hits.length) return false;
          const hit = current.hits[current.selected];
          if (!hit) return false;
          open(hit.path, { line: hit.line, column: hit.column });
          view.dispatch({ effects: setRefs.of(null) });
          return true;
        },
      },
    ]),
  );

  return [field, keys];
}
