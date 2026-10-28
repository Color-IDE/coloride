import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ComposerInput } from "./ComposerInput";
import { ComposerSurface } from "./ComposerSurface";

export type SharedComposerProps = {
  draft: string;
  disabled: boolean;
  running: boolean;
  placeholder?: string;
  onDraftChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
  controls: ReactNode;
};

/** Visual composer shared by Coloride and external ACP agents. Behavior stays in the caller. */
export function SharedComposer({
  draft,
  disabled,
  running,
  placeholder = "Message Codex",
  onDraftChange,
  onSubmit,
  onCancel,
  controls,
}: SharedComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (disabled || running || !draft.trim()) return;
    onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <ComposerSurface disabled={disabled} inputRef={inputRef}>
      <ComposerInput
        aria-label="Message"
        disabled={disabled}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        ref={inputRef}
        value={draft}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">{controls}</div>
        {running ? (
          <button className="agent-composer-send" onClick={onCancel} type="button">
            Stop
          </button>
        ) : (
          <button
            className="agent-composer-send"
            disabled={disabled || !draft.trim()}
            onClick={submit}
            type="button"
          >
            Send
          </button>
        )}
      </div>
    </ComposerSurface>
  );
}
