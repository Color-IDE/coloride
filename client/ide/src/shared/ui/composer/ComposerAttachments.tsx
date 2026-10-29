export type ComposerAttachment = {
  id: string;
  file: File;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file";
  previewUrl: string | null;
};

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtensionLabel(name: string): string {
  const extension = name.includes(".")
    ? name.split(".").pop()?.toUpperCase()
    : "";
  return !extension || extension.length > 5 ? "FILE" : extension;
}

export function ComposerAttachments({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div
      aria-label="Attached files"
      className="agent-composer-attachments mb-2 flex gap-2 overflow-x-auto px-0.5 pb-0.5"
      role="list"
    >
      {attachments.map((item) => (
        <div
          className="agent-composer-attachment relative flex min-w-[148px] max-w-[196px] flex-none items-center gap-2 py-1.5 pl-1.5 pr-7"
          key={item.id}
          role="listitem"
          title={`${item.name} · ${formatAttachmentSize(item.size)}`}
        >
          {item.kind === "image" && item.previewUrl ? (
            <img
              alt=""
              className="agent-composer-attachment-thumb size-10 flex-none object-cover"
              draggable={false}
              src={item.previewUrl}
            />
          ) : (
            <div
              aria-hidden="true"
              className="agent-composer-attachment-file flex size-10 flex-none items-center justify-center"
            >
              <span className="agent-composer-attachment-ext">
                {fileExtensionLabel(item.name)}
              </span>
            </div>
          )}
          <div className="agent-composer-attachment-meta flex min-w-0 flex-auto flex-col gap-0.5">
            <span className="agent-composer-attachment-name">{item.name}</span>
            <span className="agent-composer-attachment-size">
              {formatAttachmentSize(item.size)}
            </span>
          </div>
          <button
            aria-label={`Remove ${item.name}`}
            className="agent-composer-attachment-remove"
            onClick={() => onRemove(item.id)}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="12"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="12"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
