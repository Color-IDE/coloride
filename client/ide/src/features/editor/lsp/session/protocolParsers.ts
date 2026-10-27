import type { DiagnosticSeverity } from "../../core/types";
import { uriToPath } from "../pathUri";
import type { LineTextEdit } from "../textEdits";
import {
  type LspCompletionItem,
  type LspCompletionList,
  type LspDefinitionHit,
  type LspDocumentSymbol,
  type LspFileEdits,
  type LspInlayHint,
  type LspPrepareRename,
  type LspRange,
  type LspSignature,
  type LspSignatureHelp,
  type LspSignatureParameter,
} from "./types";

export const SYMBOL_KINDS = [
  "",
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enum member",
  "struct",
  "event",
  "operator",
  "type",
];

export function kindName(kind: unknown): string {
  const n = typeof kind === "number" ? kind : 0;
  return SYMBOL_KINDS[n] || "symbol";
}

export function posOfSymbol(
  raw: Record<string, unknown>,
): { line: number; column: number } | null {
  const selection = raw.selectionRange as
    { start?: { line?: number; character?: number } } | undefined;
  const range = raw.range as
    { start?: { line?: number; character?: number } } | undefined;
  const location = raw.location as
    { range?: { start?: { line?: number; character?: number } } } | undefined;
  const start = selection?.start ?? range?.start ?? location?.range?.start;
  if (start?.line == null) return null;
  return { line: start.line + 1, column: (start.character ?? 0) + 1 };
}

export function parseDocumentSymbols(
  raw: unknown,
  prefix = "",
): LspDocumentSymbol[] {
  if (!Array.isArray(raw)) return [];
  const out: LspDocumentSymbol[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "";
    if (!name) continue;
    const pos = posOfSymbol(rec);
    if (pos) {
      out.push({
        name: prefix ? `${prefix}.${name}` : name,
        kind: kindName(rec.kind),
        line: pos.line,
        column: pos.column,
      });
    }
    if (Array.isArray(rec.children)) {
      out.push(
        ...parseDocumentSymbols(
          rec.children,
          prefix ? `${prefix}.${name}` : name,
        ),
      );
    }
  }
  return out;
}

export function hintLabel(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return "";
  return raw
    .map((part) =>
      part &&
      typeof part === "object" &&
      typeof (part as { value?: unknown }).value === "string"
        ? (part as { value: string }).value
        : "",
    )
    .join("");
}

export function parseInlayHints(raw: unknown): LspInlayHint[] {
  if (!Array.isArray(raw)) return [];
  const out: LspInlayHint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const pos = rec.position as
      { line?: number; character?: number } | undefined;
    const label = hintLabel(rec.label).trim();
    if (!label || pos?.line == null) continue;
    out.push({
      line: pos.line + 1,
      column: (pos.character ?? 0) + 1,
      label,
      paddingLeft: rec.paddingLeft === true,
      paddingRight: rec.paddingRight === true,
    });
  }
  return out;
}

export function normalizePath(path: string): string {
  try {
    return decodeURIComponent(path).replace(/\/+$/, "") || "/";
  } catch {
    return path.replace(/\/+$/, "") || "/";
  }
}

export function parseLocations(result: unknown): LspDefinitionHit[] {
  if (!result) return [];
  const list = Array.isArray(result) ? result : [result];
  const out: LspDefinitionHit[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const loc = item as {
      uri?: string;
      targetUri?: string;
      range?: { start?: { line?: number; character?: number } };
      targetSelectionRange?: { start?: { line?: number; character?: number } };
      targetRange?: { start?: { line?: number; character?: number } };
    };
    const uri = loc.uri || loc.targetUri;
    const start =
      loc.range?.start ||
      loc.targetSelectionRange?.start ||
      loc.targetRange?.start;
    if (!uri || !start) continue;
    const dest = uriToPath(uri);
    if (!dest) continue;
    out.push({
      path: dest,
      line: (start.line ?? 0) + 1,
      column: (start.character ?? 0) + 1,
    });
  }
  return out;
}

export function firstDefinition(result: unknown): LspDefinitionHit | null {
  return parseLocations(result)[0] ?? null;
}

export function asLspRange(value: unknown): LspRange | null {
  if (!value || typeof value !== "object") return null;
  const range = value as {
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
  if (!range.start || !range.end) return null;
  return {
    start: {
      line: range.start.line ?? 0,
      character: range.start.character ?? 0,
    },
    end: { line: range.end.line ?? 0, character: range.end.character ?? 0 },
  };
}

export function asTextEdit(
  value: unknown,
): { range: LspRange; newText: string } | null {
  if (!value || typeof value !== "object") return null;
  const edit = value as {
    newText?: string;
    range?: unknown;
    insert?: unknown;
    replace?: unknown;
  };
  if (typeof edit.newText !== "string") return null;
  const range =
    asLspRange(edit.range) ??
    asLspRange(edit.replace) ??
    asLspRange(edit.insert);
  if (!range) return null;
  return { range, newText: edit.newText };
}

export function documentationText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in value) {
    const text = (value as { value?: unknown }).value;
    return typeof text === "string" ? text : undefined;
  }
  return undefined;
}

export function displayPartsText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
  return text.trim() || undefined;
}

export function completionSourceOf(
  item: Record<string, unknown>,
): string | undefined {
  const details = item.labelDetails;
  if (details && typeof details === "object") {
    const description = (details as { description?: unknown }).description;
    if (typeof description === "string" && description.trim())
      return description.trim();
  }
  if (item.label && typeof item.label === "object") {
    const description = (item.label as { description?: unknown }).description;
    if (typeof description === "string" && description.trim())
      return description.trim();
  }
  const fromField =
    displayPartsText(item.source) ?? displayPartsText(item.sourceDisplay);
  if (fromField) return fromField;
  const data = item.data;
  if (data && typeof data === "object") {
    const body = data as Record<string, unknown>;
    const nested =
      displayPartsText(body.source) ??
      displayPartsText(body.moduleSpecifier) ??
      displayPartsText(body.sourceDisplay) ??
      (body.data && typeof body.data === "object"
        ? displayPartsText((body.data as Record<string, unknown>).source)
        : undefined);
    if (nested) return nested;
  }
  return undefined;
}

export function parseCompletionItem(value: unknown): LspCompletionItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const labelRaw = item.label;
  const label =
    typeof labelRaw === "string"
      ? labelRaw
      : labelRaw &&
          typeof labelRaw === "object" &&
          typeof (labelRaw as { label?: unknown }).label === "string"
        ? (labelRaw as { label: string }).label
        : "";
  if (!label) return null;
  const additional = Array.isArray(item.additionalTextEdits)
    ? item.additionalTextEdits
        .map(asTextEdit)
        .filter((edit): edit is { range: LspRange; newText: string } =>
          Boolean(edit),
        )
    : undefined;
  const commit = Array.isArray(item.commitCharacters)
    ? item.commitCharacters.filter((ch): ch is string => typeof ch === "string")
    : undefined;
  const labelDetail =
    item.labelDetails && typeof item.labelDetails === "object"
      ? (item.labelDetails as { detail?: unknown }).detail
      : undefined;
  return {
    label,
    kind: typeof item.kind === "number" ? item.kind : undefined,
    detail:
      typeof item.detail === "string"
        ? item.detail
        : typeof labelDetail === "string"
          ? labelDetail
          : undefined,
    documentation: documentationText(item.documentation),
    source: completionSourceOf(item),
    insertText:
      typeof item.insertText === "string" ? item.insertText : undefined,
    insertTextFormat:
      typeof item.insertTextFormat === "number"
        ? item.insertTextFormat
        : undefined,
    sortText: typeof item.sortText === "string" ? item.sortText : undefined,
    filterText:
      typeof item.filterText === "string" ? item.filterText : undefined,
    preselect: item.preselect === true,
    commitCharacters: commit?.length ? commit : undefined,
    textEdit: asTextEdit(item.textEdit) ?? undefined,
    additionalTextEdits: additional?.length ? additional : undefined,
    data: item.data,
  };
}

export function parseCompletionList(result: unknown): LspCompletionList | null {
  if (!result) return null;
  const rawItems = Array.isArray(result)
    ? result
    : typeof result === "object" &&
        Array.isArray((result as { items?: unknown }).items)
      ? (result as { items: unknown[] }).items
      : null;
  if (!rawItems) return null;
  const items: LspCompletionItem[] = [];
  for (const entry of rawItems) {
    const item = parseCompletionItem(entry);
    if (item) items.push(item);
  }
  if (items.length === 0) return null;
  const isIncomplete =
    !Array.isArray(result) &&
    Boolean((result as { isIncomplete?: boolean }).isIncomplete);
  return { items, isIncomplete };
}

export function parseLspTextEdit(value: unknown): LineTextEdit | null {
  if (!value || typeof value !== "object") return null;
  const edit = value as { newText?: unknown; range?: unknown };
  if (typeof edit.newText !== "string") return null;
  const range = asLspRange(edit.range);
  if (!range) return null;
  return {
    startLine: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.character + 1,
    newText: edit.newText,
  };
}

export function parsePrepareRename(result: unknown): LspPrepareRename | null {
  if (!result || typeof result !== "object") return null;
  const body = result as {
    range?: unknown;
    placeholder?: unknown;
    defaultBehavior?: unknown;
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
  if (body.defaultBehavior === true) return null;
  const range = asLspRange(body.range) ?? asLspRange(body);
  if (!range) return null;
  return {
    startLine: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.character + 1,
    placeholder:
      typeof body.placeholder === "string" ? body.placeholder : undefined,
  };
}

export function parseWorkspaceEdit(result: unknown): LspFileEdits[] {
  if (!result || typeof result !== "object") return [];
  const body = result as {
    changes?: Record<string, unknown[]>;
    documentChanges?: unknown[];
  };
  const byPath = new Map<string, LineTextEdit[]>();
  const add = (uri: string, edits: unknown[]) => {
    const path = uriToPath(uri);
    if (!path) return;
    const list = byPath.get(path) ?? [];
    for (const item of edits) {
      const edit = parseLspTextEdit(item);
      if (edit) list.push(edit);
    }
    if (list.length) byPath.set(path, list);
  };
  if (body.changes) {
    for (const [uri, edits] of Object.entries(body.changes)) {
      if (Array.isArray(edits)) add(uri, edits);
    }
  }
  if (Array.isArray(body.documentChanges)) {
    for (const change of body.documentChanges) {
      if (!change || typeof change !== "object") continue;
      const doc = change as {
        textDocument?: { uri?: string };
        edits?: unknown[];
      };
      if (doc.textDocument?.uri && Array.isArray(doc.edits)) {
        add(doc.textDocument.uri, doc.edits);
      }
    }
  }
  return [...byPath.entries()].map(([path, edits]) => ({ path, edits }));
}

export function editsFromCodeActions(result: unknown): LspFileEdits[] {
  if (!Array.isArray(result)) return [];
  const out: LspFileEdits[] = [];
  for (const item of result) {
    if (!item || typeof item !== "object") continue;
    const action = item as { edit?: unknown };
    if (action.edit) out.push(...parseWorkspaceEdit(action.edit));
  }
  return out;
}

export function parseSignatureHelp(result: unknown): LspSignatureHelp | null {
  if (!result || typeof result !== "object") return null;
  const body = result as {
    signatures?: unknown[];
    activeSignature?: number;
    activeParameter?: number;
  };
  if (!Array.isArray(body.signatures) || body.signatures.length === 0)
    return null;
  const signatures: LspSignature[] = [];
  for (const raw of body.signatures) {
    if (!raw || typeof raw !== "object") continue;
    const sig = raw as {
      label?: unknown;
      documentation?: unknown;
      parameters?: unknown[];
    };
    if (typeof sig.label !== "string" || !sig.label) continue;
    const parameters: LspSignatureParameter[] = [];
    for (const param of sig.parameters ?? []) {
      if (!param || typeof param !== "object") continue;
      const p = param as { label?: unknown; documentation?: unknown };
      if (typeof p.label === "string") {
        parameters.push({
          label: p.label,
          documentation: documentationText(p.documentation),
        });
      } else if (
        Array.isArray(p.label) &&
        p.label.length >= 2 &&
        typeof p.label[0] === "number" &&
        typeof p.label[1] === "number"
      ) {
        parameters.push({
          label: [p.label[0], p.label[1]],
          documentation: documentationText(p.documentation),
        });
      }
    }
    signatures.push({
      label: sig.label,
      documentation: documentationText(sig.documentation),
      parameters,
    });
  }
  if (signatures.length === 0) return null;
  return {
    signatures,
    activeSignature: Math.max(0, body.activeSignature ?? 0),
    activeParameter: Math.max(0, body.activeParameter ?? 0),
  };
}

export function lspSeverity(value?: number): DiagnosticSeverity {
  if (value === 2) return "warning";
  if (value === 3) return "info";
  if (value === 4) return "hint";
  return "error";
}
