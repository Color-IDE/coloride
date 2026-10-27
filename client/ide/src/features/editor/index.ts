/** Coloride Editor — public surface. Prefer these imports outside editor/. */

export { languageFromPath, mapEditorPreferences } from "./core";
export type {
  CodeEditorProps,
  DiagnosticMarker,
  DiagnosticSeverity,
  EditorCommandId,
  EditorCursor,
  EditorHandle,
  EditorTheme,
  EditorViewOptions,
  RevealRequest
} from "./core";

export { ExplorerEditor } from "./ExplorerEditor";
export { CodeDiffEditor } from "./react/CodeDiffEditor";
export { CodeEditor } from "./react/CodeEditor";

export { EditorProblemsPanel } from "./EditorProblemsPanel";
