import type { ColorideCodeRefSource } from "../../editor/codeRefClipboard";
import {
  formatCodeRefChipLabel,
  formatCodeRefRange,
} from "../../editor/codeRefClipboard";

export type ComposerCodeRef = {
  id: string;
  path: string;
  name: string;
  startLine: number;
  endLine: number;
  text: string;
  source: ColorideCodeRefSource;
};

export function ComposerCodeReferences({
  references,
  onRemove,
}: {
  references: ComposerCodeRef[];
  onRemove: (id: string) => void;
}) {
  return references.map((item) => {
    const terminal = item.source === "terminal";
    const title = terminal
      ? item.path.startsWith("terminal:")
        ? item.path.slice("terminal:".length) || "Terminal"
        : "Terminal"
      : item.path;

    return (
      <button
        aria-label={`Remove ${formatCodeRefChipLabel(item.name, item.startLine, item.endLine)}`}
        className={`agent-composer-code-chip${terminal ? " is-terminal" : ""}`}
        key={item.id}
        onClick={() => onRemove(item.id)}
        title={title}
        type="button"
      >
        <span aria-hidden="true" className="agent-composer-code-chip-icon">
          {terminal ? (
            <svg
              fill="none"
              height="14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
              viewBox="0 0 24 24"
              width="14"
            >
              <rect height="14" rx="2" width="18" x="3" y="5" />
              <path d="m7 10 3 2.5L7 15" />
              <path d="M12 15h5" />
            </svg>
          ) : (
            <svg
              fill="none"
              height="14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
              viewBox="0 0 24 24"
              width="14"
            >
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5" />
            </svg>
          )}
        </span>
        <span className="agent-composer-code-chip-label">
          {item.name}
          <span className="agent-composer-code-chip-range">
            {" "}({formatCodeRefRange(item.startLine, item.endLine)})
          </span>
        </span>
      </button>
    );
  });
}
