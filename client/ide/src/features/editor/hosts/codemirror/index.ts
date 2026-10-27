export {
  applyReveal,
  createCodeMirrorEditor,
  type CodeMirrorHost,
  type CreateCodeMirrorEditorParams,
} from "./createEditor";
export {
  createCodeMirrorDiffEditor,
  type CodeMirrorDiffHost,
  type CreateDiffEditorParams,
} from "./createDiffEditor";
export { errorDiagnosticsUi } from "./errorGutter";
export { languageExtension } from "./languages";
export { MarkerStore, markersToDiagnostics } from "./markers";
export { collectSyntaxMarkers, SYNTAX_OWNER, syntaxDiagnosticsOwnedByServer } from "./syntaxLint";
export { colorideTheme } from "./theme";
