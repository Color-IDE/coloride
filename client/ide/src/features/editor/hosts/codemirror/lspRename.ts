/**
 * F2 rename — extra line under the symbol (no line number), then vtsls edit.
 */

import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import type { LspFileEdits, LspPrepareRename } from "../../lsp/LspSessionManager";
import { lspDocumentLanguageId } from "../../lsp/pathUri";
import { symbolRangeAt } from "./gotoDefinition";
import { editorShortcut } from "./shortcutBinding";

export type LspPrepareRenameFn = (
  line: number,
  column: number,
) => Promise<LspPrepareRename | null>;

export type LspRenameFn = (
  line: number,
  column: number,
  newName: string,
) => Promise<LspFileEdits[]>;

export type LspApplyRenameFn = (files: LspFileEdits[]) => void | Promise<void>;

type RenameState = {
  from: number;
  to: number;
  placeholder: string;
  line: number;
  column: number;
} | null;

const setRename = StateEffect.define<RenameState>();

function posAt(doc: { line: (n: number) => { from: number; to: number } }, line1: number, col1: number): number {
  const line = doc.line(Math.max(1, line1));
  return Math.min(line.to, line.from + Math.max(1, col1) - 1);
}

type RenameHandlers = {
  getPath: () => string;
  rename: LspRenameFn;
  applyFiles?: LspApplyRenameFn;
};

class RenameWidget extends WidgetType {
  constructor(
    readonly state: Exclude<RenameState, null>,
    readonly handlers: RenameHandlers,
  ) {
    super();
  }

  eq(other: RenameWidget) {
    return (
      this.state.from === other.state.from
      && this.state.to === other.state.to
      && this.state.placeholder === other.state.placeholder
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "coloride-rename";
    wrap.addEventListener("mousedown", (event) => event.stopPropagation());

    const input = document.createElement("input");
    input.className = "coloride-rename-input";
    input.type = "text";
    input.value = this.state.placeholder;
    input.spellcheck = false;
    input.setAttribute("aria-label", "Rename symbol");

    const close = () => view.dispatch({ effects: setRename.of(null) });
    const { state, handlers } = this;

    const submit = () => {
      const next = input.value.trim();
      if (!next || next === state.placeholder || !/^[A-Za-z_$][\w$]*$/.test(next)) {
        close();
        return;
      }
      void handlers.rename(state.line, state.column, next).then((files) => {
        if (!files.length) {
          close();
          return;
        }
        const path = handlers.getPath();
        const current = files.filter((file) => file.path === path);
        const others = files.filter((file) => file.path !== path);
        const changes = current.flatMap((file) =>
          file.edits.map((edit) => {
            const from = posAt(view.state.doc, edit.startLine, edit.startColumn);
            const to = posAt(view.state.doc, edit.endLine, edit.endColumn);
            return { from, to, insert: edit.newText };
          }),
        ).sort((a, b) => b.from - a.from);
        view.dispatch({
          ...(changes.length ? { changes } : {}),
          effects: setRename.of(null),
          userEvent: "input.rename",
        });
        if (others.length) void handlers.applyFiles?.(others);
      });
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });

    const align = () => {
      const start = view.coordsAtPos(state.from);
      const end = view.coordsAtPos(state.to);
      const lineStart = view.coordsAtPos(view.state.doc.lineAt(state.from).from);
      if (!start || !lineStart) return;
      wrap.style.paddingLeft = `${Math.max(0, start.left - lineStart.left)}px`;
      const wordW = end ? Math.max(end.left - start.left, 0) : 0;
      const typed = Math.max(input.value.length, state.placeholder.length, 4);
      input.style.minWidth = `${Math.max(wordW, typed * (view.defaultCharacterWidth || 8))}px`;
    };
    input.addEventListener("input", align);
    wrap.appendChild(input);
    requestAnimationFrame(() => {
      align();
      input.focus();
      input.select();
    });
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function decorationsFor(
  value: RenameState,
  handlers: RenameHandlers,
  doc: { length: number; lineAt: (pos: number) => { to: number } },
): DecorationSet {
  if (!value) return Decoration.none;
  const lineTo = doc.lineAt(Math.max(0, Math.min(value.from, doc.length))).to;
  const at = Math.max(0, Math.min(lineTo, doc.length));
  return Decoration.set([
    Decoration.widget({
      widget: new RenameWidget(value, handlers),
      block: true,
      side: 1,
    }).range(at),
  ]);
}

export function lspRenameExtension(options: {
  getPath: () => string;
  prepare: LspPrepareRenameFn;
  rename: LspRenameFn;
  applyFiles?: LspApplyRenameFn;
}): Extension {
  const handlers: RenameHandlers = {
    getPath: options.getPath,
    rename: options.rename,
    applyFiles: options.applyFiles,
  };

  const field = StateField.define<RenameState>({
    create: () => null,
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setRename)) return effect.value;
      }
      if (value && tr.docChanged && !tr.isUserEvent("input.rename")) {
        return null;
      }
      return value;
    },
  });

  const decoField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(_value, tr) {
      const rename = tr.state.field(field, false);
      return decorationsFor(rename ?? null, handlers, tr.state.doc);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const startRename = (view: EditorView) => {
    const path = handlers.getPath();
    if (!lspDocumentLanguageId(path) || view.state.readOnly) return false;
    const pos = view.state.selection.main.head;
    const range = symbolRangeAt(view.state, pos);
    const target = range?.from ?? pos;
    const line = view.state.doc.lineAt(target);
    const column = target - line.from + 1;
    const fallback = range
      ? {
          from: range.from,
          to: range.to,
          placeholder: view.state.doc.sliceString(range.from, range.to),
          line: line.number,
          column,
        }
      : null;
    void options.prepare(line.number, column).then((prepared) => {
      let next = fallback;
      if (prepared) {
        const from = posAt(view.state.doc, prepared.startLine, prepared.startColumn);
        const to = posAt(view.state.doc, prepared.endLine, prepared.endColumn);
        next = {
          from,
          to,
          placeholder:
            prepared.placeholder
            || view.state.doc.sliceString(from, to)
            || fallback?.placeholder
            || "",
          line: line.number,
          column,
        };
      }
      if (!next?.placeholder) return;
      view.dispatch({
        selection: { anchor: next.from, head: next.to },
        effects: setRename.of(next),
      });
    });
    return true;
  };

  const keys = Prec.high(
    keymap.of([
      editorShortcut("editor.rename", startRename),
      {
        key: "Escape",
        run: (view) => {
          if (!view.state.field(field, false)) return false;
          view.dispatch({ effects: setRename.of(null) });
          return true;
        },
      },
    ]),
  );

  return [
    field,
    decoField,
    keys,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!view.state.field(field, false)) return false;
        const target = event.target as HTMLElement | null;
        if (target?.closest(".coloride-rename")) return false;
        view.dispatch({ effects: setRename.of(null) });
        return false;
      },
    }),
  ];
}
