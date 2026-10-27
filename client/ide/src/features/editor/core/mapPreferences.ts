import {
  getCodeFontFamily,
  type AppPreferences,
} from "../../settings/preferences";
import type { EditorViewOptions } from "./types";

/** Map app preferences → engine-agnostic editor view options. */
export function mapEditorPreferences(
  prefs: AppPreferences,
  overrides?: Partial<EditorViewOptions>,
): EditorViewOptions {
  return {
    fontFamily: getCodeFontFamily(prefs.codeFontFamily),
    fontSize: prefs.codeFontSize,
    lineHeight: 1.5,
    fontLigatures: prefs.editorFontLigatures,
    cursorStyle: prefs.editorCursorStyle,
    lineNumbers: prefs.editorLineNumbers,
    minimap: prefs.editorMinimap,
    renderWhitespace: prefs.editorRenderWhitespace,
    smoothScrolling: prefs.editorSmoothScrolling,
    stickyScroll: prefs.editorStickyScroll,
    inlayHints: prefs.editorInlayHints,
    tabSize: prefs.editorTabSize,
    insertSpaces: prefs.editorInsertSpaces,
    bracketPairColorization: prefs.editorBracketPairColorization,
    wordWrap: prefs.editorWordWrap,
    wordWrapColumn: 100,
    paddingTop: 0,
    ...overrides,
  };
}
