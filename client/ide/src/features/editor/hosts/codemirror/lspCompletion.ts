/**
 * LSP autocomplete for CodeMirror.
 *
 * Typing is never blocked: CodeMirror waits ~90ms, we flush didChange, then
 * query vtsls. Further identifier keystrokes reuse the list (`validFor`).
 */

/** Completions list is on; snippet expansion (if-templates) stays off. */
export const LSP_AUTOCOMPLETE_ENABLED = true;

import {
  autocompletion,
  acceptCompletion,
  closeCompletion,
  completionStatus,
  insertCompletionText,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { Prec, type Extension, type Text } from "@codemirror/state";
import { keymap, tooltips, type EditorView, type Rect } from "@codemirror/view";
import type { LspCompletionItem, LspCompletionList } from "../../lsp/LspSessionManager";
import { localKeywordCompletion } from "./localCompletion";
import { completionLabel, completionOffset, hasSnippetPlaceholders } from "./completionText";
import { lspDocumentLanguageId } from "../../lsp/pathUri";

export type LspCompletionQuery = {
  path: string;
  line: number;
  column: number;
  text: string;
  explicit: boolean;
  triggerCharacter?: string;
};

export type LspCompleteFn = (query: LspCompletionQuery) => Promise<LspCompletionList | null>;
export type LspResolveFn = (item: LspCompletionItem) => Promise<LspCompletionItem | null>;

const KIND_TYPE: Record<number, string> = {
  1: "text",
  2: "method",
  3: "function",
  4: "class",
  5: "property",
  6: "variable",
  7: "class",
  8: "interface",
  9: "module",
  10: "property",
  11: "text",
  12: "constant",
  13: "enum",
  14: "keyword",
  15: "text",
  17: "text",
  20: "constant",
  21: "constant",
  22: "class",
  25: "type",
};

function looksLikeModule(text: string): boolean {
  const s = text.trim();
  if (!s || s.length > 80) return false;
  if (s.startsWith("(") || s.includes(": ") || s.includes("=>") || /\s/.test(s)) return false;
  if (s.startsWith(".") || s.startsWith("@") || s.startsWith("/") || s.includes("/")) return true;
  return /^[\w.-]+$/.test(s);
}

function offsetAt(doc: Text, pos: { line: number; character: number }): number | null {
  if (pos.line < 0 || pos.line >= doc.lines) return null;
  const line = doc.line(pos.line + 1);
  return Math.min(line.from + Math.max(0, pos.character), line.to);
}

function isSnippetText(text: string, format?: number): boolean {
  return format === 2 && hasSnippetPlaceholders(text);
}

export function applyItem(item: LspCompletionItem, queryDoc: Text, queryFrom: number, queryTo: number) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    // LSP ranges refer to the request document, while from/to track subsequent typing.
    const currentOffset = (pos: { line: number; character: number }) => {
      const offset = offsetAt(queryDoc, pos);
      return offset == null ? null : completionOffset(offset, queryFrom, queryTo, from, to);
    };
    const raw = item.textEdit?.newText ?? item.insertText ?? completionLabel(item.label);
    // Insert the identifier as-is — never expand clangd/vtsls snippets
    // (`if (${1:condition}) { $0 }`).
    const insert = isSnippetText(raw, item.insertTextFormat) ? completionLabel(item.label) : raw;
    let start = from;
    let end = to;
    if (item.textEdit && !isSnippetText(raw, item.insertTextFormat)) {
      const a = currentOffset(item.textEdit.range.start);
      const b = currentOffset(item.textEdit.range.end);
      if (a != null && b != null && b >= a) {
        start = a;
        end = b;
      }
    }
    // Accepting a suggestion only applies its primary edit. Imports, includes,
    // and other additionalTextEdits are not automatic, for any language server.
    view.dispatch({
      ...insertCompletionText(view.state, insert, start, end),
      annotations: pickedCompletion.of(completion),
    });
  };
}

const resolveCache = new Map<string, Promise<LspCompletionItem | null>>();

function resolveKey(item: LspCompletionItem): string {
  try {
    return `${item.label}\0${JSON.stringify(item.data ?? null)}`;
  } catch {
    return item.label;
  }
}

function appendText(parent: HTMLElement, text: string) {
  const parts = text.split("\n");
  parts.forEach((line, index) => {
    if (index > 0) parent.appendChild(document.createElement("br"));
    if (line) parent.appendChild(document.createTextNode(line));
  });
}

function appendMarkdown(parent: HTMLElement, md: string) {
  const chunks = md.split(/(```[\s\S]*?```)/);
  for (const chunk of chunks) {
    if (!chunk) continue;
    const fence = chunk.match(/^```(?:\w+)?\r?\n?([\s\S]*?)```$/);
    if (fence) {
      const pre = document.createElement("pre");
      pre.className = "coloride-completion-docs-sig";
      pre.textContent = fence[1].replace(/\n$/, "");
      parent.appendChild(pre);
      continue;
    }
    const body = document.createElement("div");
    body.className = "coloride-completion-docs-body";
    const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(chunk))) {
      if (match.index > last) appendText(body, chunk.slice(last, match.index));
      const href = match[2];
      const a = document.createElement("a");
      a.className = "coloride-completion-docs-link";
      a.href = href;
      a.textContent = match[1];
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (window.colorideDesktop?.openExternal) void window.colorideDesktop.openExternal(href);
        else window.open(href, "_blank", "noopener,noreferrer");
      });
      body.appendChild(a);
      last = match.index + match[0].length;
    }
    if (last < chunk.length) appendText(body, chunk.slice(last));
    if (body.childNodes.length) parent.appendChild(body);
  }
}

function renderDocs(detail?: string, documentation?: string): HTMLElement | null {
  const wrap = document.createElement("div");
  wrap.className = "coloride-completion-docs";
  const hasFence = Boolean(documentation?.includes("```"));
  if (detail && !hasFence && !looksLikeModule(detail)) {
    const sig = document.createElement("pre");
    sig.className = "coloride-completion-docs-sig";
    sig.textContent = detail;
    wrap.appendChild(sig);
  }
  if (documentation?.trim()) appendMarkdown(wrap, documentation.trim());
  return wrap.childNodes.length ? wrap : null;
}

async function loadInfo(
  item: LspCompletionItem,
  resolve?: LspResolveFn,
): Promise<{ dom: HTMLElement } | null> {
  let resolved = item;
  if (resolve) {
    const key = resolveKey(item);
    let pending = resolveCache.get(key);
    if (!pending) {
      pending = resolve(item);
      resolveCache.set(key, pending);
    }
    resolved = (await pending) ?? item;
    if (resolved.additionalTextEdits?.length) item.additionalTextEdits = resolved.additionalTextEdits;
  }
  const dom = renderDocs(resolved.detail, resolved.documentation);
  return dom ? { dom } : null;
}

function sourceSuffix(source: string): string {
  const s = source.trim();
  if (!s) return "";
  if (s.startsWith("@")) return ` ${s}`;
  return ` @${s}`;
}

function boostFor(item: LspCompletionItem, prefix: string): number {
  const p = prefix.toLowerCase();
  const l = completionLabel(item.label).toLowerCase();
  let n = item.preselect ? 8 : 0;
  if (!p) return n;
  if (l === p) n += 42;
  else if (l.startsWith(p)) n += 30;
  else {
    const idx = l.indexOf(p);
    if (idx > 0) n += 6;
  }
  // Auto-import that matches what you typed (useState @react) sits with locals, not at the bottom.
  if (item.source && p.length >= 2 && l.startsWith(p)) n += 10;
  return Math.max(-99, Math.min(99, n));
}

function toCompletion(
  item: LspCompletionItem,
  prefix: string,
  queryDoc: Text,
  queryFrom: number,
  queryTo: number,
  resolve?: LspResolveFn,
): Completion {
  let source = item.source?.trim() || undefined;
  let typeInfo = item.detail?.trim() || undefined;
  if (!source && typeInfo && looksLikeModule(typeInfo)) {
    source = typeInfo;
    typeInfo = undefined;
  }
  const canInfo = Boolean(resolve) || Boolean(item.documentation?.trim()) || Boolean(typeInfo);
  return {
    label: completionLabel(item.label),
    detail: source ? sourceSuffix(source) : undefined,
    type: item.kind != null ? KIND_TYPE[item.kind] : undefined,
    boost: boostFor(item, prefix),
    commitCharacters: item.commitCharacters,
    info: canInfo ? () => loadInfo(item, resolve) : undefined,
    apply: applyItem(item, queryDoc, queryFrom, queryTo),
  };
}

function createSource(
  getPath: () => string,
  complete: LspCompleteFn,
  resolve?: LspResolveFn,
): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (context.state.readOnly) return null;
    const path = getPath();
    if (!lspDocumentLanguageId(path)) return null;

    const ident = context.matchBefore(/[A-Za-z_$][\w$]*/);
    const trigger = context.matchBefore(/[.\("'\/@<]/);
    if (!ident && !trigger && !context.explicit) return null;

    const from = ident ? ident.from : context.pos;
    const line = context.state.doc.lineAt(context.pos);
    const triggerCharacter =
      trigger && !ident ? trigger.text : undefined;

    const list = await complete({
      path,
      line: line.number,
      column: context.pos - line.from + 1,
      text: context.state.doc.toString(),
      explicit: context.explicit,
      triggerCharacter,
    });

    if (context.aborted || !list?.items.length) return null;

    const prefix = ident?.text ?? "";
    return {
      from,
      options: list.items.map((item) => toCompletion(item, prefix, context.state.doc, from, context.pos, resolve)),
      // Reuse the list while typing more identifier characters. Re-querying
      // clangd on every keystroke was stalling the editor (line highlight gone).
      validFor: ident && !list.isIncomplete ? /^[\w$]*$/ : undefined,
    };
  };
}

function pinInfoTop(
  _view: EditorView,
  list: Rect,
  _option: Rect,
  info: Rect,
  space: Rect,
): { style: string; class: string } {
  const gap = 8;
  const infoWidth = Math.max(1, info.right - info.left);
  const spaceLeft = list.left - space.left;
  const spaceRight = space.right - list.right;
  const left = spaceRight < infoWidth + gap && spaceLeft > spaceRight;
  const maxWidth = Math.min(360, Math.max(160, (left ? spaceLeft : spaceRight) - gap));
  return {
    style: `top: 0px; max-width: ${maxWidth}px`,
    class: left ? "cm-completionInfo-left" : "cm-completionInfo-right",
  };
}

export function lspCompletionExtension(
  getPath: () => string,
  complete: LspCompleteFn,
  resolve?: LspResolveFn,
): Extension {
  return [
    tooltips({ parent: document.body }),
    autocompletion({
      override: [
        (context) => localKeywordCompletion(context, lspDocumentLanguageId(getPath()) ?? ""),
        createSource(getPath, complete, resolve),
      ],
      updateSyncTime: 50,
      activateOnTyping: true,
      activateOnTypingDelay: 60,
      icons: false,
      defaultKeymap: true,
      closeOnBlur: true,
      maxRenderedOptions: 24,
      positionInfo: pinInfoTop,
      optionClass: (completion) =>
        completion.type ? `cm-completion-kind-${completion.type.split(/\s+/)[0]}` : "",
    }),
    // Accept the selected suggestion without also inserting a newline.
    Prec.highest(
      keymap.of([
        {
          key: "Enter",
          run: (view) => {
            if (completionStatus(view.state) === "active" && acceptCompletion(view)) return true;
            closeCompletion(view);
            return insertNewlineAndIndent(view);
          },
        },
      ]),
    ),
  ];
}
