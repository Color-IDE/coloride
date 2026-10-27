import { useEffect, useMemo, useRef } from "react";
import type { EditorTheme, EditorViewOptions } from "../core/types";
import {
  createCodeMirrorDiffEditor,
  type CodeMirrorDiffHost,
} from "../hosts/codemirror/createDiffEditor";

export type CodeDiffEditorProps = {
  path: string;
  original: string;
  modified: string;
  language: string;
  theme: EditorTheme;
  options: EditorViewOptions;
  className?: string;
};

/**
 * Side-by-side diff using CodeMirror MergeView (same look as CodeEditor).
 * Replaces Monaco DiffEditor in the agent workspace.
 */
export function CodeDiffEditor({
  path,
  original,
  modified,
  language,
  theme,
  options,
  className = "",
}: CodeDiffEditorProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<CodeMirrorDiffHost | null>(null);
  const optionsKey = useMemo(() => JSON.stringify(options), [options]);

  // Recreate when path identity changes (one merge per file tab).
  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;

    const host = createCodeMirrorDiffEditor({
      parent,
      original,
      modified,
      language,
      theme,
      options,
    });
    hostRef.current = host;

    return () => {
      host.destroy();
      if (hostRef.current === host) hostRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate only on path
  }, [path]);

  useEffect(() => {
    hostRef.current?.setDocs(original, modified);
  }, [original, modified, path]);

  useEffect(() => {
    hostRef.current?.setLanguage(language);
  }, [language, path]);

  useEffect(() => {
    hostRef.current?.setTheme(theme, options);
  }, [theme, options, optionsKey, path]);

  return (
    <div
      className={`coloride-diff-editor-root h-full min-h-0 w-full overflow-hidden ${className}`}
      data-editor-path={path}
      ref={parentRef}
    />
  );
}
