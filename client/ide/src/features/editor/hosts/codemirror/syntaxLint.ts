import { forceParsing, syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import type { DiagnosticMarker } from "../../core/types";
const MAX_SYNTAX_MARKERS = 30;
/** Cap parse work so huge files stay responsive (ms). */
const PARSE_BUDGET_MS = 100;

/**
 * The highlighter is not a compiler. It marks `#include <vector>` and
 * `std::vector<int>` as errors, and it misses a broken `if`. Languages with
 * a real server (clangd, vtsls, pyright, gopls, …) own diagnostics.
 */
const SKIP_SYNTAX_LINT_LANGS = new Set([
  "c",
  "cpp",
  "cuda",
  "objective-c",
  "objective-cpp",
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
  "tsx",
  "jsx",
  "python",
  "go",
  "rust",
  "java",
  "csharp",
  "php",
  "ruby",
  "kotlin",
  "lua",
]);

/** True when the highlighter must not invent diagnostics for this language. */
export function syntaxDiagnosticsOwnedByServer(language?: string): boolean {
  const lang = (language || "").toLowerCase();
  return SKIP_SYNTAX_LINT_LANGS.has(lang);
}

function isErrorNodeName(name: string): boolean {
  return name === "⚠" || name === "Error" || name === "ParseError" || name.endsWith("Error");
}

function lineAround(docText: string, from: number): string {
  const lineStart = docText.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const lineEndIdx = docText.indexOf("\n", from);
  const lineEnd = lineEndIdx === -1 ? docText.length : lineEndIdx;
  return docText.slice(lineStart, lineEnd);
}

/**
 * Drop Lezer recovery noise that is not a real syntax problem.
 */
function isLikelyFalsePositive(
  docText: string,
  from: number,
  to: number,
  parentName: string | null,
): boolean {
  const span = Math.max(0, to - from);
  if (span === 0) return true;

  const slice = docText.slice(from, Math.min(to, docText.length));
  const trimmed = slice.trim();
  if (!trimmed) return true;

  // Tiny recovery tokens (closing braces etc.) — almost never real.
  if (span <= 4 && /^[}\])>`'"`,;:.]+$/.test(trimmed)) return true;

  const line = lineAround(docText, from);

  // JSX/TS expression comments: { slash-star ... star-slash }
  if (/\{\s*\/\*/.test(line) && /\*\/\s*\}/.test(line)) return true;
  if (/^\s*\{\s*\/\*[\s\S]*?\*\/\s*\}\s*$/.test(line)) return true;

  // Normal comments.
  if (/^\s*\/\//.test(line) || /^\s*\/\*[\s\S]*\*\/\s*$/.test(line)) return true;

  if (parentName && /Comment|JSXText|JSX|TemplateString|String|Script/.test(parentName)) {
    // Parent named JSX* or Comment — recovery inside is usually noise.
    if (span <= 8) return true;
    if (/Comment|JSXText|String|TemplateString/.test(parentName)) return true;
  }

  // Tag closers while the line still looks like a tag.
  if ((trimmed === ">" || trimmed === "/>") && (/<\/?[A-Za-z]/.test(line) || /\/>/.test(line))) {
    return true;
  }

  // Pure punctuation recovery.
  if (span <= 6 && /^[\s{}\[\]()<>/*="'`,;:.!?\-+|\\]+$/.test(slice)) return true;

  // Error covers a whole balanced-looking brace group on one line — often recovery.
  if (span <= 40 && /^\{\s*\/\*[\s\S]*\*\/\s*\}$/.test(trimmed)) return true;

  return false;
}

/**
 * Collect parse errors from the Lezer syntax tree.
 * Offline only — no language server. Filtered hard against false positives.
 */
export function collectSyntaxMarkers(
  view: EditorView,
  language?: string,
): DiagnosticMarker[] {
  if (syntaxDiagnosticsOwnedByServer(language)) return [];

  try {
    forceParsing(view, view.state.doc.length, PARSE_BUDGET_MS);
  } catch {
    // ignore
  }

  const tree = syntaxTree(view.state);
  if (!tree || tree.length === 0) return [];

  const doc = view.state.doc;
  const docText = doc.toString();
  const raw: Array<{ from: number; to: number; parent: string | null }> = [];

  tree.iterate({
    enter(node) {
      if (raw.length >= MAX_SYNTAX_MARKERS * 4) return false;

      const typedError = Boolean((node.type as { isError?: boolean }).isError);
      if (!typedError && !isErrorNodeName(node.name)) return;

      const from = node.from;
      const to = Math.max(node.from, node.to);
      if (from > doc.length) return;

      const parent = node.node.parent;
      raw.push({
        from,
        to,
        parent: parent ? parent.name : null,
      });
    },
  });

  const filtered = raw.filter((a, i) => {
    if (isLikelyFalsePositive(docText, a.from, a.to, a.parent)) return false;
    // Drop nested errors inside a larger error span.
    for (let j = 0; j < raw.length; j++) {
      if (i === j) continue;
      const b = raw[j]!;
      if (a.from >= b.from && a.to <= b.to && a.to - a.from < b.to - b.from) {
        return false;
      }
    }
    return true;
  });

  const out: DiagnosticMarker[] = [];
  for (const err of filtered) {
    if (out.length >= MAX_SYNTAX_MARKERS) break;
    const from = Math.min(err.from, doc.length);
    const to = Math.min(Math.max(err.to, from + 1), doc.length);
    if (from >= doc.length && doc.length > 0) continue;

    const startLine = doc.lineAt(from);
    const endLine = doc.lineAt(to > 0 ? Math.min(to, doc.length) : 0);

    out.push({
      severity: "error",
      message: "Syntax error",
      startLine: startLine.number,
      startColumn: from - startLine.from + 1,
      endLine: endLine.number,
      endColumn: Math.max(1, to - endLine.from + 1),
      source: "syntax",
    });
  }

  return out;
}

/** Owner key used in MarkerStore for local parse diagnostics. */
export const SYNTAX_OWNER = "coloride-syntax";
