import { EditorView } from "@codemirror/view";
import type {
  EditorHandle,
  EditorTheme,
  EditorViewOptions,
} from "../../../core/types";
import type { LineTextEdit } from "../../../lsp/textEdits";
import { type CanJumpHandler } from "../gotoDefinition";
import { type LspCompleteFn, type LspResolveFn } from "../lspCompletion";
import { type LspFormatFn } from "../lspFormat";
import { type LspInlayHintsFn } from "../lspInlayHints";
import {
  type LspFindReferencesFn,
  type LspOpenLocationFn,
} from "../lspReferences";
import {
  type LspApplyRenameFn,
  type LspPrepareRenameFn,
  type LspRenameFn,
} from "../lspRename";
import { type LspSignatureFn } from "../lspSignatureHelp";
import { type LspDocumentSymbolsFn } from "../lspSymbols";

export type CreateCodeMirrorEditorParams = {
  parent: HTMLElement;
  path: string;
  doc: string;
  language: string;
  theme: EditorTheme;
  options: EditorViewOptions;
  /** Workspace root for resolving @/ and relative path links. */
  workspaceRoot?: string | null;
  onChange?: (value: string) => void;
  /** 1-based cursor; fired on selection / doc changes. */
  onCursorChange?: (cursor: { line: number; column: number }) => void;
  onDiagnosticsChange?: (counts: { errors: number; warnings: number }) => void;
  onGoToDefinition?: (line: number, column: number) => void;
  onCompletion?: LspCompleteFn;
  onResolveCompletion?: LspResolveFn;
  onSignatureHelp?: LspSignatureFn;
  onFindReferences?: LspFindReferencesFn;
  onOpenLocation?: LspOpenLocationFn;
  onPrepareRename?: LspPrepareRenameFn;
  onRenameSymbol?: LspRenameFn;
  onApplyRenameFiles?: LspApplyRenameFn;
  onFormatDocument?: LspFormatFn;
  onOrganizeImports?: () => Promise<LineTextEdit[]>;
  onDocumentSymbols?: LspDocumentSymbolsFn;
  onInlayHints?: LspInlayHintsFn;
  /** Gate Cmd-hover underline: only real jump targets (LSP / local def). */
  canJumpToDefinition?: CanJumpHandler;
  /** Cmd+click file path string → open remote file. */
  onOpenPath?: (absolutePath: string) => void;
  /** Cmd+click http(s) URL → open externally / in-app browser. */
  onOpenUrl?: (url: string) => void;
  /** Cmd/Ctrl+F — open the custom React find bar. */
  onFindRequest?: () => void;
  onContextMenu?: (menu: {
    x: number;
    y: number;
    hasSelection: boolean;
    readOnly: boolean;
  }) => void;
  /** Fired when a per-hunk Accept/Reject changes the buffer or finishes the review. */
  onAgentEditHunkResult?: (result: {
    remaining: number;
    content: string;
    baseline: string;
    changed: boolean;
  }) => void;
};

export type CodeMirrorHost = {
  view: EditorView;
  handle: EditorHandle;
  setPath(path: string): void;
  setLanguage(language: string): void;
  setTheme(theme: EditorTheme, options: EditorViewOptions): void;
  setOptions(options: EditorViewOptions): void;
  setDoc(doc: string): void;
  destroy(): void;
};
