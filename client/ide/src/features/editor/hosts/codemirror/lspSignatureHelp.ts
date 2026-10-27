/**
 * LSP signature help — tooltip when typing `(` / `,` inside a call.
 */

import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  showTooltip,
  ViewPlugin,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import type { LspSignatureHelp } from "../../lsp/LspSessionManager";
import { lspDocumentLanguageId } from "../../lsp/pathUri";

export type LspSignatureQuery = {
  path: string;
  line: number;
  column: number;
  text: string;
  triggerCharacter?: string;
  retrigger?: boolean;
};

export type LspSignatureFn = (query: LspSignatureQuery) => Promise<LspSignatureHelp | null>;

type SigState = {
  pos: number;
  help: LspSignatureHelp;
} | null;

const setSig = StateEffect.define<SigState>();

function paramRange(
  label: string,
  param: { label: string | [number, number] },
): [number, number] | null {
  if (Array.isArray(param.label) && param.label.length === 2) {
    const from = Math.max(0, param.label[0]);
    const to = Math.min(label.length, param.label[1]);
    return to > from ? [from, to] : null;
  }
  if (typeof param.label === "string" && param.label) {
    const index = label.indexOf(param.label);
    if (index >= 0) return [index, index + param.label.length];
  }
  return null;
}

function renderHelp(help: LspSignatureHelp): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "coloride-sig-help";
  const index = Math.min(help.activeSignature, help.signatures.length - 1);
  const sig = help.signatures[index];
  if (!sig) return wrap;

  const labelEl = document.createElement("div");
  labelEl.className = "coloride-sig-help-label";
  const active = Math.min(help.activeParameter, Math.max(0, sig.parameters.length - 1));
  const range = sig.parameters[active] ? paramRange(sig.label, sig.parameters[active]!) : null;

  if (!range) {
    labelEl.textContent = sig.label;
  } else {
    if (range[0] > 0) labelEl.appendChild(document.createTextNode(sig.label.slice(0, range[0])));
    const mark = document.createElement("span");
    mark.className = "coloride-sig-help-active";
    mark.textContent = sig.label.slice(range[0], range[1]);
    labelEl.appendChild(mark);
    if (range[1] < sig.label.length) {
      labelEl.appendChild(document.createTextNode(sig.label.slice(range[1])));
    }
  }
  wrap.appendChild(labelEl);

  const paramDoc = sig.parameters[active]?.documentation?.trim();
  if (paramDoc) {
    const doc = document.createElement("div");
    doc.className = "coloride-sig-help-doc";
    doc.textContent = paramDoc.slice(0, 280);
    wrap.appendChild(doc);
  }

  if (help.signatures.length > 1) {
    const count = document.createElement("div");
    count.className = "coloride-sig-help-count";
    count.textContent = `${index + 1}/${help.signatures.length}`;
    wrap.appendChild(count);
  }
  return wrap;
}

function tooltipFor(state: SigState): Tooltip | null {
  if (!state) return null;
  const help = state.help;
  return {
    pos: state.pos,
    above: true,
    strictSide: true,
    create() {
      return { dom: renderHelp(help) };
    },
  };
}

const sigField = StateField.define<SigState>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSig)) return effect.value;
    }
    if (value && tr.docChanged) {
      return { ...value, pos: tr.changes.mapPos(value.pos, 1) };
    }
    return value;
  },
  provide: (field) => showTooltip.from(field, tooltipFor),
});

function insertedTrigger(update: ViewUpdate): string | "close" | null {
  let found: string | "close" | null = null;
  update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    if (!text) return;
    if (text.includes("(") || text.includes("<")) found = text.includes("(") ? "(" : "<";
    else if (text.includes(",")) found = ",";
    else if (text === ")") found = "close";
  });
  return found;
}

export function lspSignatureHelpExtension(
  getPath: () => string,
  request: LspSignatureFn,
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      timer = -1;
      seq = 0;

      update(update: ViewUpdate) {
        if (update.view.state.readOnly) return;
        const path = getPath();
        if (!lspDocumentLanguageId(path)) return;

        const trigger = update.docChanged ? insertedTrigger(update) : null;
        if (trigger === "close") {
          this.scheduleClose(update.view);
          return;
        }
        const open = update.view.state.field(sigField, false);
        if (trigger) {
          this.schedule(update.view, trigger, false);
          return;
        }
        if (open && update.selectionSet && !update.docChanged) {
          this.schedule(update.view, undefined, true);
        }
      }

      destroy() {
        if (this.timer !== -1) window.clearTimeout(this.timer);
      }

      scheduleClose(view: EditorView) {
        if (this.timer !== -1) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.timer = -1;
          this.clear(view);
        }, 0);
      }

      clear(view: EditorView) {
        if (this.timer !== -1) window.clearTimeout(this.timer);
        this.timer = -1;
        if (view.state.field(sigField, false)) {
          view.dispatch({ effects: setSig.of(null) });
        }
      }

      schedule(view: EditorView, triggerCharacter: string | undefined, retrigger: boolean) {
        if (this.timer !== -1) window.clearTimeout(this.timer);
        const seq = ++this.seq;
        this.timer = window.setTimeout(() => {
          this.timer = -1;
          void this.query(view, triggerCharacter, retrigger, seq);
        }, retrigger ? 90 : 40);
      }

      async query(
        view: EditorView,
        triggerCharacter: string | undefined,
        retrigger: boolean,
        seq: number,
      ) {
        const path = getPath();
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        const help = await request({
          path,
          line: line.number,
          column: pos - line.from + 1,
          text: view.state.doc.toString(),
          triggerCharacter,
          retrigger,
        });
        if (seq !== this.seq) return;
        if (view.state.readOnly) return;
        view.dispatch({
          effects: setSig.of(help && help.signatures.length ? { pos, help } : null),
        });
      }
    },
  );

  const keys = Prec.high(
    keymap.of([
      {
        key: "Escape",
        run: (view) => {
          if (!view.state.field(sigField, false)) return false;
          view.dispatch({ effects: setSig.of(null) });
          return true;
        },
      },
      {
        key: "Mod-Shift-Space",
        run: (view) => {
          const pos = view.state.selection.main.head;
          const line = view.state.doc.lineAt(pos);
          void request({
            path: getPath(),
            line: line.number,
            column: pos - line.from + 1,
            text: view.state.doc.toString(),
          }).then((help) => {
            view.dispatch({
              effects: setSig.of(help && help.signatures.length ? { pos, help } : null),
            });
          });
          return true;
        },
      },
    ]),
  );

  return [sigField, plugin, keys];
}
