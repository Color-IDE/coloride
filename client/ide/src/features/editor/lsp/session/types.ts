import type { LineTextEdit } from "../textEdits";

export type DocState = {
  uri: string;
  path: string;
  languageId: string;
  version: number;
  opened: boolean;
  text: string;
  /** Last text the language server has seen (didOpen / didChange). */
  syncedText: string;
  /** Highest document version whose diagnostics we already painted. */
  appliedDiagVersion: number;
};

export type LspDefinitionHit = {
  path: string;
  line: number;
  column: number;
};

export type LspReferenceHit = LspDefinitionHit;

export type LspDocumentSymbol = {
  name: string;
  kind: string;
  line: number;
  column: number;
};

export type LspInlayHint = {
  line: number;
  column: number;
  label: string;
  paddingLeft: boolean;
  paddingRight: boolean;
};

export type LspPrepareRename = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  placeholder?: string;
};

export type LspFileEdits = {
  path: string;
  edits: LineTextEdit[];
};

export type LspRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

export type LspCompletionItem = {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  /** Module specifier shown on the right (`react`, `./foo`). */
  source?: string;
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
  commitCharacters?: string[];
  textEdit?: { range: LspRange; newText: string };
  additionalTextEdits?: Array<{ range: LspRange; newText: string }>;
  /** Opaque server payload — required for completionItem/resolve. */
  data?: unknown;
};

export type LspCompletionList = {
  items: LspCompletionItem[];
  isIncomplete: boolean;
};

export type LspSignatureParameter = {
  label: string | [number, number];
  documentation?: string;
};

export type LspSignature = {
  label: string;
  documentation?: string;
  parameters: LspSignatureParameter[];
};

export type LspSignatureHelp = {
  activeSignature: number;
  activeParameter: number;
  signatures: LspSignature[];
};
