/**
 * Cmd/Ctrl + hover or click opens the definition.
 *
 * Hover/click targets in code files:
 *   - identifiers (variables, properties, types, methods, JSX components)
 *   - module specifiers in import / export / require / import()
 * Keywords, comments, and lowercase DOM tags are not targets.
 * Resolution itself is LSP (vtsls) — this file only decides what is clickable.
 */

import { syntaxTree } from "@codemirror/language";
import {
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";

export type GoToDefinitionHandler = (line: number, column: number) => void;
export type CanJumpHandler = (
  line: number,
  column: number,
  from: number,
  to: number,
) => boolean | Promise<boolean>;

// ── decorations ────────────────────────────────────────────────────────────

const setLink = StateEffect.define<{ from: number; to: number } | null>();

const linkMark = Decoration.mark({ class: "cm-goto-definition-underline" });

const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (!e.is(setLink)) continue;
      const r = e.value;
      if (!r || r.from >= r.to || r.to - r.from > 400) return Decoration.none;
      try {
        if (tr.state.doc.lineAt(r.from).number !== tr.state.doc.lineAt(r.to - 1).number) {
          return Decoration.none;
        }
      } catch {
        return Decoration.none;
      }
      return Decoration.set([linkMark.range(r.from, r.to)]);
    }
    if (tr.docChanged) {
      const mapped = value.map(tr.changes);
      let empty = true;
      mapped.between(0, tr.state.doc.length, () => {
        empty = false;
      });
      return empty ? Decoration.none : mapped;
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── token resolution ───────────────────────────────────────────────────────

const TEXTUAL = new Set([
  "LineComment", "BlockComment", "Comment", "String", "TemplateString",
  "TemplateLiteral", "RegExp", "JSXText", "Escape", "Number", "Bool", "Boolean",
]);

/** Only real code identifiers from the syntax tree — never plain “any word”. */
const SYMBOL = new Set([
  "VariableName", "VariableDefinition", "TypeName", "TypeDefinition",
  "PropertyName", "PropertyDefinition", "PrivatePropertyName", "PrivatePropertyDefinition",
  "MethodName", "ClassName", "Label", "LabelName", "Identifier", "Name",
  "JSXIdentifier", "JSXMemberName", "EnumMember",
  "FieldIdentifier", "PropertyIdentifier", "NamespaceName",
  "AttributeName", "TagName",
]);

/** Keywords only — not library names (map, use) or TS types (string, this). */
const SKIP = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
  "return", "function", "const", "let", "var", "class", "extends", "implements",
  "new", "import", "export", "from", "default", "async", "await",
  "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of", "as",
  "type", "interface", "enum", "public", "private", "protected", "static",
  "readonly", "true", "false", "null",
  "with", "yield", "delete", "debugger", "arguments", "eval",
]);

const IDENT_RE = /^#?[A-Za-z_$][A-Za-z0-9_$]*$/;

export type IdentifierToken = {
  from: number;
  to: number;
  text: string;
  line: number;
  column: number;
};

function inTextualContext(state: EditorState, pos: number): boolean {
  try {
    const tree = syntaxTree(state);
    let walk: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1);
    for (let i = 0; walk && i < 14; i += 1) {
      if (TEXTUAL.has(walk.name)) return true;
      if (/Comment|String|Template|RegExp|JSXText/i.test(walk.name) && !SYMBOL.has(walk.name)) {
        return true;
      }
      walk = walk.parent;
    }
  } catch {
    // ignore
  }
  return false;
}

function tokenFromRange(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): IdentifierToken | null {
  try {
    const line = state.doc.lineAt(from);
    if (to > line.to) return null;
    return {
      from,
      to,
      text,
      line: line.number,
      column: from - line.from + 1,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a syntax-tree identifier at pos. No plain-word fallback —
 * that was painting underline on every English word under Cmd.
 */
export function resolveIdentifierToken(
  state: EditorState,
  pos: number,
): IdentifierToken | null {
  if (pos < 0 || pos > state.doc.length) return null;
  if (inTextualContext(state, pos)) return null;

  const tree = syntaxTree(state);
  for (const side of [-1, 1, 0] as const) {
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side);
    for (let d = 0; node && d < 10; d += 1) {
      if (TEXTUAL.has(node.name)) break;
      if (SYMBOL.has(node.name)) {
        const len = node.to - node.from;
        if (len < 1 || len > 80) break;
        if (pos < node.from || pos > node.to) {
          node = node.parent;
          continue;
        }
        const text = state.doc.sliceString(node.from, node.to);
        if (!IDENT_RE.test(text)) break;
        if (SKIP.has(text)) break;
        // Lowercase DOM tags (div, span) — not <Button /> or JSX props (onClick).
        if (text === text.toLowerCase()) {
          if (node.name === "TagName") break;
          if (node.name === "JSXIdentifier" && node.parent?.name !== "JSXAttribute") break;
        }
        return tokenFromRange(state, node.from, node.to, text);
      }
      node = node.parent;
    }
  }
  return null;
}

const SPECIFIER_PARENTS = new Set([
  "ImportDeclaration",
  "ExportDeclaration",
  "DynamicImport",
  "ImportType",
]);

function calleeName(state: EditorState, call: { firstChild: { from: number; to: number } | null }): string {
  const callee = call.firstChild;
  if (!callee) return "";
  return state.doc.sliceString(callee.from, callee.to);
}

/** import/export/require/import() module specifier under the cursor. */
function resolveModuleSpecifier(
  state: EditorState,
  pos: number,
): IdentifierToken | null {
  if (pos < 0 || pos > state.doc.length) return null;
  try {
    const tree = syntaxTree(state);
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1);
    let str: ReturnType<typeof tree.resolveInner> | null = null;
    for (let i = 0; node && i < 14; i += 1) {
      if (node.name === "LineComment" || node.name === "BlockComment" || node.name === "Comment") {
        return null;
      }
      if (node.name === "String" || node.name === "TemplateString" || node.name === "TemplateLiteral") {
        str = node;
        break;
      }
      node = node.parent;
    }
    if (!str || pos < str.from || pos > str.to) return null;

    let parent = str.parent;
    let ok = false;
    for (let i = 0; parent && i < 8; i += 1) {
      if (SPECIFIER_PARENTS.has(parent.name)) {
        ok = true;
        break;
      }
      if (parent.name === "CallExpression") {
        const name = calleeName(state, parent);
        if (name === "import" || name === "require" || name.endsWith(".require") || name === "require.resolve") {
          ok = true;
        }
        break;
      }
      parent = parent.parent;
    }
    if (!ok) return null;

    const raw = state.doc.sliceString(str.from, str.to);
    const inner = raw.replace(/^['"`]/, "").replace(/['"`]$/, "");
    if (!inner || inner.length > 400) return null;
    return tokenFromRange(state, str.from, str.to, inner);
  } catch {
    return null;
  }
}

/** Identifier or import specifier — what Cmd+click / underline may target. */
export function resolveGotoTarget(
  state: EditorState,
  pos: number,
): IdentifierToken | null {
  return resolveIdentifierToken(state, pos) ?? resolveModuleSpecifier(state, pos);
}

export function symbolRangeAt(
  state: EditorState,
  pos: number,
): { from: number; to: number } | null {
  const t = resolveGotoTarget(state, pos);
  return t ? { from: t.from, to: t.to } : null;
}

function modHeld(e: MouseEvent | KeyboardEvent) {
  return (e.metaKey || e.ctrlKey) && !e.altKey;
}

// ── plugin ─────────────────────────────────────────────────────────────────

function definitionLinkPlugin(): Extension {
  return ViewPlugin.fromClass(
    class implements PluginValue {
      view: EditorView;
      mod = false;
      hasMouse = false;
      mx = 0;
      my = 0;
      raf = 0;
      linkRaf = 0;
      destroyed = false;
      shown: { from: number; to: number } | null = null;
      sticky: IdentifierToken | null = null;

      constructor(view: EditorView) {
        this.view = view;
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onWinBlur = this.onWinBlur.bind(this);
        window.addEventListener("keydown", this.onKeyDown, true);
        window.addEventListener("keyup", this.onKeyUp, true);
        window.addEventListener("blur", this.onWinBlur);
      }

      update(u: ViewUpdate) {
        if (u.docChanged) this.clear();
      }

      destroy() {
        this.destroyed = true;
        window.removeEventListener("keydown", this.onKeyDown, true);
        window.removeEventListener("keyup", this.onKeyUp, true);
        window.removeEventListener("blur", this.onWinBlur);
        if (this.raf) cancelAnimationFrame(this.raf);
        if (this.linkRaf) cancelAnimationFrame(this.linkRaf);
        this.shown = null;
        this.sticky = null;
      }

      onKeyDown(e: KeyboardEvent) {
        if (e.key !== "Meta" && e.key !== "Control") return;
        const was = this.mod;
        this.mod = true;
        if (!was && this.hasMouse) this.schedule(false);
      }

      onKeyUp(e: KeyboardEvent) {
        if (e.key === "Meta" || e.key === "Control" || (!e.metaKey && !e.ctrlKey)) {
          this.mod = false;
          this.clear();
        }
      }

      onWinBlur() {
        this.mod = false;
        this.clear();
      }

      schedule(immediate = false) {
        if (immediate) {
          if (this.raf) {
            cancelAnimationFrame(this.raf);
            this.raf = 0;
          }
          this.resolve();
          return;
        }
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => {
          this.raf = 0;
          this.resolve();
        });
      }

      resolve() {
        if (!this.mod || !this.hasMouse) {
          this.clear();
          return;
        }

        const pos = this.view.posAtCoords({ x: this.mx, y: this.my }, false);
        if (pos == null) {
          this.clear();
          return;
        }

        let token = resolveGotoTarget(this.view.state, pos);
        if (
          !token
          && this.sticky
          && pos >= this.sticky.from
          && pos <= this.sticky.to
        ) {
          token = this.sticky;
        }

        if (!token) {
          this.clear();
          return;
        }

        this.sticky = token;
        this.paint(token.from, token.to);
      }

      queueLink(link: { from: number; to: number } | null) {
        if (this.destroyed) return;
        if (this.linkRaf) cancelAnimationFrame(this.linkRaf);
        this.linkRaf = requestAnimationFrame(() => {
          this.linkRaf = 0;
          if (this.destroyed) return;
          this.view.dispatch({ effects: setLink.of(link) });
        });
      }

      paint(from: number, to: number) {
        if (this.shown && this.shown.from === from && this.shown.to === to) return;
        this.shown = { from, to };
        this.queueLink({ from, to });
      }

      clear() {
        this.sticky = null;
        if (!this.shown) return;
        this.shown = null;
        this.queueLink(null);
      }
    },
    {
      eventHandlers: {
        mousemove(event) {
          this.hasMouse = true;
          this.mx = event.clientX;
          this.my = event.clientY;
          if (modHeld(event)) {
            this.mod = true;
            this.schedule(false);
          } else if (this.mod) {
            this.mod = false;
            this.clear();
          }
        },
        mouseleave() {
          this.hasMouse = false;
          this.clear();
        },
      },
    },
  );
}

/**
 * Go-to-def only for real programming languages — never markdown / plain text /
 * config prose (that was underlining English words in AGENTS.md).
 */
export function supportsGotoDefinition(
  language?: string | null,
  path?: string | null,
): boolean {
  const lang = (language ?? "").toLowerCase();
  if (
    lang === "typescript"
    || lang === "typescriptreact"
    || lang === "javascript"
    || lang === "javascriptreact"
    || lang === "python"
    || lang === "go"
    || lang === "rust"
    || lang === "java"
    || lang === "c"
    || lang === "cpp"
    || lang === "csharp"
  ) {
    return true;
  }
  const p = (path ?? "").toLowerCase();
  if (/\.(tsx?|jsx?|mjs|cjs|mts|cts|py|pyi|go|rs)$/.test(p)) return true;
  // Explicitly exclude docs / config prose
  if (/\.(md|mdx|markdown|txt|json|jsonc|ya?ml|toml|ini|csv)$/.test(p)) return false;
  if (/(^|\/)(agents\.md|readme|license|changelog)/i.test(p)) return false;
  return false;
}

/**
 * Public extension.
 * Hover/click: identifiers + import specifiers in code files.
 * Returns empty extension for markdown / plain text.
 */
export function gotoDefinitionExtension(
  onGoToDefinition?: GoToDefinitionHandler,
  _canJump?: CanJumpHandler,
  options?: { path?: string; language?: string; showCandidate?: boolean },
): Extension {
  if (!supportsGotoDefinition(options?.language, options?.path)) {
    return [];
  }

  let lastJumpAt = 0;

  const clickCatcher = Prec.highest(
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!modHeld(event) || event.button !== 0) return false;
        const pos = view.posAtCoords(
          { x: event.clientX, y: event.clientY },
          false,
        );
        if (pos == null) return false;
        const token = resolveGotoTarget(view.state, pos);
        if (!token) return false;
        const now = performance.now();
        if (now - lastJumpAt < 280) return true;
        lastJumpAt = now;
        event.preventDefault();
        event.stopPropagation();
        const line = view.state.doc.lineAt(pos);
        onGoToDefinition?.(line.number, pos - line.from + 1);
        return true;
      },
    }),
  );

  return [linkField, definitionLinkPlugin(), clickCatcher];
}
