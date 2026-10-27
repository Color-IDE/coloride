/** Public contract for the Coloride code editor (engine-agnostic). */

export type EditorTheme = "light" | "dark";

export type EditorViewOptions = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontLigatures: boolean;
  cursorStyle: "line" | "block" | "underline";
  lineNumbers: "on" | "relative" | "off";
  minimap: boolean;
  renderWhitespace: "none" | "selection" | "all";
  smoothScrolling: boolean;
  stickyScroll: boolean;
  inlayHints: boolean;
  tabSize: number;
  insertSpaces: boolean;
  bracketPairColorization: boolean;
  wordWrap: "off" | "on" | "bounded";
  wordWrapColumn?: number;
  readOnly?: boolean;
  paddingTop?: number;
};

/** 1-based line/column reveal; apply once per token (search / go-to-def). */
export type RevealRequest = {
  line: number;
  column?: number;
  token: number;
};

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

/** 1-based ranges (same convention as UI / LSP-mapped markers). */
export type DiagnosticMarker = {
  severity: DiagnosticSeverity;
  message: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  source?: string;
  code?: string;
};

export type EditorCursor = {
  line: number;
  column: number;
};

export type EditorDiagnosticCounts = {
  errors: number;
  warnings: number;
};

export type EditorFindOptions = {
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
  /** Replacement text for replace / replace-all. */
  replace?: string;
  /** Limit matches to this document range (CodeMirror positions). */
  range?: { from: number; to: number } | null;
};

export type EditorSelectionRange = {
  from: number;
  to: number;
};

export type EditorFindStatus = {
  /** 1-based index of the active match; 0 when none. */
  current: number;
  total: number;
};

export type EditorCommandId =
  | "expandSelection" | "shrinkSelection" | "selectNextSibling" | "selectPreviousSibling"
  | "addCursorAbove" | "addCursorBelow" | "selectPrevious" | "selectAllOccurrences"
  | "moveLineUp" | "moveLineDown" | "duplicateSelection" | "goToLine" | "nextProblem" | "previousProblem"
  | "goToDefinition"
  | "findReferences"
  | "goToSymbol"
  | "rename"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "selectNext"
  | "find"
  | "toggleComment"
  | "format"
  | "organizeImports"
  | "fold"
  | "unfold"
  | "undo"
  | "redo"
  | "toggleBreakpoint";

export type EditorHandle = {
  focus(): void;
  runCommand(command: EditorCommandId): boolean;
  reveal(req: Omit<RevealRequest, "token"> & { token?: number }): void;
  getValue(): string;
  /** Non-empty main selection text, or "". */
  getSelectedText(): string;
  /** Main selection as document offsets; null if empty. */
  getSelectionRange(): EditorSelectionRange | null;
  setMarkers(owner: string, markers: DiagnosticMarker[]): void;
  clearMarkers(owner: string): void;
  getCursor(): EditorCursor | null;
  getDiagnosticCounts(): EditorDiagnosticCounts;
  getMarkers(): DiagnosticMarker[];
  /** Remote POSIX path this handle is bound to (for LSP identity). */
  getPath(): string | null;
  /** Update in-file find query + highlight; does not move caret unless jump. */
  setFindQuery(options: EditorFindOptions, jump?: "next" | "none"): EditorFindStatus;
  findNext(): EditorFindStatus;
  findPrevious(): EditorFindStatus;
  replaceNext(): EditorFindStatus;
  replaceAll(): EditorFindStatus;
  clearFind(): void;
  getFindStatus(): EditorFindStatus;
  /** Green/red decorations for an agent-applied buffer change. */
  highlightAgentEdit(before: string, after: string): void;
  /** Roll back a failed review write only if the buffer has not changed since. */
  restoreAgentEditReview(before: string, after: string, expected: string): void;
  clearAgentEditHighlight(): void;
  acceptAgentEditHunk(hunkId: number): { remaining: number; content: string; changed: boolean };
  rejectAgentEditHunk(hunkId: number): { remaining: number; content: string; changed: boolean };
  acceptAllAgentEditHunks(): { remaining: number; content: string; changed: boolean };
  rejectAllAgentEditHunks(): { remaining: number; content: string; changed: boolean };
  hasAgentEditHunks(): boolean;
  /** Treat the current buffer as the saved baseline (clears green/yellow ticks). */
  markChangeBaseline(): void;
};

export type CodeEditorProps = {
  path: string;
  value: string;
  language: string;
  theme: EditorTheme;
  options: EditorViewOptions;
  reveal?: RevealRequest | null;
  className?: string;
  /** Workspace root for resolving relative / alias path links. */
  workspaceRoot?: string | null;
  /** Cmd+click a file path inside the buffer. */
  onOpenPath?: (absolutePath: string) => void;
  /** Open a location from go-to-definition (1-based line/column). */
  onOpenLocation?: (path: string, options?: { line?: number; column?: number }) => void;
  /** Apply rename edits in files other than the current buffer. */
  onApplyRenameFiles?: (files: Array<{
    path: string;
    edits: Array<{
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
      newText: string;
    }>;
  }>) => void | Promise<void>;
  onChange?: (value: string) => void;
  onCursorChange?: (cursor: EditorCursor) => void;
  onDiagnosticsChange?: (counts: EditorDiagnosticCounts) => void;
  /** Cmd/Ctrl+F — open the app find bar (not CodeMirror's default panel). */
  onFindRequest?: () => void;
  onContextMenu?: (menu: {
    x: number;
    y: number;
    hasSelection: boolean;
    readOnly: boolean;
  }) => void;
  /** Per-hunk Accept/Reject finished or buffer changed. */
  onAgentEditHunkResult?: (result: {
    remaining: number;
    content: string;
    baseline: string;
    changed: boolean;
  }) => void;
  onReady?: (handle: EditorHandle) => void;
  /** Called when the handle is disposed (path change / unmount). */
  onDispose?: (handle: EditorHandle) => void;
};
