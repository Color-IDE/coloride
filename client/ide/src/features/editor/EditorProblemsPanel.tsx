import { useMemo } from "react";
import { useAppPreferences } from "../settings/preferences";
import { mapEditorPreferences } from "./core";
import type { DiagnosticMarker } from "./core/types";

type EditorProblemsPanelProps = {
  markers: DiagnosticMarker[];
  onReveal: (line: number, column: number) => void;
};

const rank = { error: 0, warning: 1, info: 2, hint: 3 } as const;

export function EditorProblemsPanel({ markers, onReveal }: EditorProblemsPanelProps) {
  const appPreferences = useAppPreferences();
  const editorOptions = useMemo(() => mapEditorPreferences(appPreferences), [appPreferences]);
  const rows = [...markers].sort((a, b) => {
    const bySev = rank[a.severity] - rank[b.severity];
    if (bySev !== 0) return bySev;
    return a.startLine - b.startLine || a.startColumn - b.startColumn;
  });

  return (
    <section
      className="editor-problems"
      aria-label="Problems"
      style={{
        ["--editor-code-font" as string]: editorOptions.fontFamily,
        ["--editor-code-size" as string]: `${editorOptions.fontSize}px`,
      }}
    >
      <ul className="editor-problems-list">
        {rows.length === 0 ? (
          <li className="editor-problems-empty">No problems in this file.</li>
        ) : (
          rows.map((marker, index) => (
            <li key={`${marker.startLine}:${marker.startColumn}:${marker.message}:${index}`}>
              <button
                type="button"
                className={`editor-problems-row is-${marker.severity}`}
                onClick={() => onReveal(marker.startLine, marker.startColumn)}
              >
                <span className="editor-problems-sev" aria-hidden="true" />
                <span className="editor-problems-msg">{marker.message}</span>
                <span className="editor-problems-loc">
                  {marker.startLine}:{marker.startColumn}
                  {marker.source ? ` · ${marker.source}` : ""}
                  {marker.code ? `(${marker.code})` : ""}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
