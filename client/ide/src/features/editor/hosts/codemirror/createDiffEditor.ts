import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { MergeView } from "@codemirror/merge";
import {
  Compartment,
  EditorState,
  type Extension,
} from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  lineNumbers,
} from "@codemirror/view";
import type { EditorTheme, EditorViewOptions } from "../../core/types";
import { languageExtension } from "./languages";
import { colorideTheme } from "./theme";

export type CreateDiffEditorParams = {
  parent: HTMLElement;
  original: string;
  modified: string;
  language: string;
  theme: EditorTheme;
  options: EditorViewOptions;
};

export type CodeMirrorDiffHost = {
  merge: MergeView;
  setDocs(original: string, modified: string): void;
  setLanguage(language: string): void;
  setTheme(theme: EditorTheme, options: EditorViewOptions): void;
  destroy(): void;
};

const langA = new Compartment();
const langB = new Compartment();
const themeA = new Compartment();
const themeB = new Compartment();
const wrapA = new Compartment();
const wrapB = new Compartment();
const lineA = new Compartment();
const lineB = new Compartment();

function lineNumberExt(mode: EditorViewOptions["lineNumbers"]): Extension {
  if (mode === "off") return [];
  return lineNumbers();
}

function wrapExt(mode: EditorViewOptions["wordWrap"]): Extension {
  return mode === "off" ? [] : EditorView.lineWrapping;
}

function baseExtensions(readOnly: boolean): Extension[] {
  return [
    highlightSpecialChars(),
    drawSelection(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorView.editable.of(!readOnly),
    EditorState.readOnly.of(readOnly),
    // Do NOT set editorAttributes.class here — MergeView adds cm-merge-a / cm-merge-b.
  ];
}

/** Side-by-side CodeMirror diff — same theme/fonts as the main editor. */
export function createCodeMirrorDiffEditor(params: CreateDiffEditorParams): CodeMirrorDiffHost {
  let currentTheme = params.theme;
  let currentOptions = params.options;
  let currentLanguage = params.language;

  const sharedTheme = () => colorideTheme(currentTheme, currentOptions);

  const merge = new MergeView({
    a: {
      doc: params.original,
      extensions: [
        ...baseExtensions(true),
        langA.of(languageExtension(currentLanguage)),
        themeA.of(sharedTheme()),
        wrapA.of(wrapExt(currentOptions.wordWrap === "off" ? "off" : "on")),
        lineA.of(lineNumberExt(currentOptions.lineNumbers)),
      ],
    },
    b: {
      doc: params.modified,
      extensions: [
        ...baseExtensions(true),
        langB.of(languageExtension(currentLanguage)),
        themeB.of(sharedTheme()),
        wrapB.of(wrapExt(currentOptions.wordWrap === "off" ? "off" : "on")),
        lineB.of(lineNumberExt(currentOptions.lineNumbers)),
      ],
    },
    parent: params.parent,
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: { margin: 3, minSize: 6 },
  });

  merge.dom.classList.add("coloride-diff-view");

  return {
    merge,
    setDocs(original, modified) {
      const a = merge.a.state.doc.toString();
      const b = merge.b.state.doc.toString();
      if (a !== original) {
        merge.a.dispatch({
          changes: { from: 0, to: merge.a.state.doc.length, insert: original },
        });
      }
      if (b !== modified) {
        merge.b.dispatch({
          changes: { from: 0, to: merge.b.state.doc.length, insert: modified },
        });
      }
    },
    setLanguage(language) {
      if (language === currentLanguage) return;
      currentLanguage = language;
      const ext = languageExtension(language);
      merge.a.dispatch({ effects: langA.reconfigure(ext) });
      merge.b.dispatch({ effects: langB.reconfigure(ext) });
    },
    setTheme(theme, options) {
      currentTheme = theme;
      currentOptions = options;
      const t = sharedTheme();
      const wrap = wrapExt(options.wordWrap === "off" ? "off" : "on");
      const lines = lineNumberExt(options.lineNumbers);
      merge.a.dispatch({
        effects: [
          themeA.reconfigure(t),
          wrapA.reconfigure(wrap),
          lineA.reconfigure(lines),
        ],
      });
      merge.b.dispatch({
        effects: [
          themeB.reconfigure(t),
          wrapB.reconfigure(wrap),
          lineB.reconfigure(lines),
        ],
      });
    },
    destroy() {
      merge.destroy();
    },
  };
}
