import {
  type Diagnostic,
  forEachDiagnostic,
  setDiagnostics,
} from "@codemirror/lint";
import type { ChangeDesc, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { DiagnosticMarker } from "../../core/types";

/** Drop junk diagnostics (JSX expression comments, lone braces, etc.). */
function isNoiseDiagnostic(
  doc: EditorView["state"]["doc"],
  from: number,
  to: number,
  message: string,
): boolean {
  if (from >= doc.length) return true;
  const span = Math.max(0, to - from);
  const text = doc.sliceString(from, Math.min(to, doc.length)).trim();

  // Lone recovery punctuation.
  if (span <= 4 && /^[}\])>`'"`,;:.]+$/.test(text)) return true;

  // Line is a JSX expression comment: { /* ... */ }
  try {
    const line = doc.lineAt(from);
    const lineText = line.text;
    if (/\{\s*\/\*/.test(lineText) && /\*\/\s*\}/.test(lineText)) return true;
    if (/^\s*\{\s*\/\*[\s\S]*?\*\/\s*\}\s*$/.test(lineText)) return true;
  } catch {
    // ignore
  }

  // Generic "Syntax error" on tiny spans is almost always Lezer noise.
  if ((message === "Syntax error" || /syntax error/i.test(message)) && span <= 6) {
    return true;
  }

  return false;
}

/** Convert 1-based marker → CodeMirror Diagnostic (0-based offsets). */
export function markersToDiagnostics(markers: DiagnosticMarker[], doc: EditorView["state"]["doc"]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const marker of markers) {
    const from = posFromLineCol(doc, marker.startLine, marker.startColumn);
    const to = posFromLineCol(doc, marker.endLine, marker.endColumn);
    if (from == null || to == null) continue;
    const a = Math.min(from, to);
    const b = Math.max(from + 1, to); // at least 1 char so wavy underline shows
    const span = expandToName(doc, a, b, marker.message || "");
    if (isNoiseDiagnostic(doc, span.from, span.to, marker.message || "")) continue;
    const severity =
      marker.severity === "error"
        ? "error"
        : marker.severity === "warning"
          ? "warning"
          : marker.severity === "info"
            ? "info"
            : "hint";
    out.push({
      from: span.from,
      to: span.to,
      severity,
      message: marker.message,
      source: marker.code
        ? `${marker.source || "ts"}(${marker.code})`
        : marker.source,
    });
  }
  return out;
}

/** If the server marks only the first letter of `hola`, underline the whole name. */
function expandToName(
  doc: EditorView["state"]["doc"],
  from: number,
  to: number,
  message: string,
): { from: number; to: number } {
  const quoted = /'([^']+)'|"([^"]+)"/.exec(message);
  const name = quoted?.[1] ?? quoted?.[2];
  if (name && name.length > to - from) {
    const slice = doc.sliceString(from, Math.min(doc.length, from + name.length));
    if (slice === name) return { from, to: from + name.length };
  }
  if (to - from <= 1 && from < doc.length) {
    try {
      const line = doc.lineAt(from);
      const ident = /^[A-Za-z_$][\w$]*/.exec(line.text.slice(from - line.from));
      if (ident && ident[0].length > 1) return { from, to: from + ident[0].length };
    } catch {
      // ignore
    }
  }
  return { from, to };
}

function posFromLineCol(
  doc: EditorView["state"]["doc"],
  line1: number,
  col1: number,
): number | null {
  const lineNumber = Math.max(1, Math.min(line1, doc.lines));
  try {
    const line = doc.line(lineNumber);
    const col = Math.max(1, col1);
    return Math.min(line.from + col - 1, line.to);
  } catch {
    return null;
  }
}

/**
 * Multi-owner marker store. CodeMirror lint only has one diagnostic set,
 * so we merge all owners when applying.
 */
export class MarkerStore {
  private byOwner = new Map<string, DiagnosticMarker[]>();

  set(owner: string, markers: DiagnosticMarker[]) {
    this.byOwner.set(owner, markers);
  }

  clear(owner: string) {
    this.byOwner.delete(owner);
  }

  clearAll() {
    this.byOwner.clear();
  }

  all(): DiagnosticMarker[] {
    const out: DiagnosticMarker[] = [];
    for (const list of this.byOwner.values()) out.push(...list);
    return out;
  }

  /** Markers that would actually paint (same filter as `apply`). */
  visible(doc: EditorView["state"]["doc"]): DiagnosticMarker[] {
    return this.all().filter((marker) => {
      const from = posFromLineCol(doc, marker.startLine, marker.startColumn);
      const to = posFromLineCol(doc, marker.endLine, marker.endColumn);
      if (from == null || to == null) return false;
      const a = Math.min(from, to);
      const b = Math.max(from + 1, to);
      const span = expandToName(doc, a, b, marker.message || "");
      return !isNoiseDiagnostic(doc, span.from, span.to, marker.message || "");
    });
  }

  apply(view: EditorView) {
    const diagnostics = markersToDiagnostics(this.all(), view.state.doc);
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }

  /**
   * Drop diagnostics that overlap an edit (stale underlines after delete)
   * and remap the rest onto the new document.
   */
  pruneTouched(startDoc: Text, changes: ChangeDesc, endDoc: Text, skipOwner?: string) {
    for (const [owner, list] of this.byOwner) {
      if (skipOwner && owner === skipOwner) continue;
      const next: DiagnosticMarker[] = [];
      for (const marker of list) {
        const from = posFromLineCol(startDoc, marker.startLine, marker.startColumn);
        const to = posFromLineCol(startDoc, marker.endLine, marker.endColumn);
        if (from == null || to == null) continue;
        const start = Math.min(from, to);
        const stop = Math.max(from, to);
        if (changes.touchesRange(start, stop)) continue;
        const mappedFrom = changes.mapPos(start, 1);
        const mappedTo = changes.mapPos(stop, 1);
        if (mappedFrom >= mappedTo) continue;
        if (mappedFrom < 0 || mappedFrom > endDoc.length) continue;
        const startLine = endDoc.lineAt(mappedFrom);
        const endAt = Math.min(Math.max(mappedTo, mappedFrom + 1), endDoc.length);
        const endLine = endDoc.lineAt(Math.max(mappedFrom, endAt - 1));
        next.push({
          ...marker,
          startLine: startLine.number,
          startColumn: mappedFrom - startLine.from + 1,
          endLine: endLine.number,
          endColumn: Math.max(1, endAt - endLine.from + 1),
        });
      }
      this.byOwner.set(owner, next);
    }
  }

  /** Debug / tests */
  count(): number {
    let n = 0;
    for (const list of this.byOwner.values()) n += list.length;
    return n;
  }
}

/** Read current CM diagnostics count (for tests). */
export function countViewDiagnostics(view: EditorView): number {
  let n = 0;
  forEachDiagnostic(view.state, () => {
    n += 1;
  });
  return n;
}
