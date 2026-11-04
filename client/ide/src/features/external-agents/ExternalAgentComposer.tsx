import type { ExternalAgentConfigOption } from "@coloride/contracts";
import { useRef, useState, type KeyboardEvent } from "react";
import { ComposerAttachments, type ComposerAttachment } from "../../shared/ui/composer/ComposerAttachments";
import { ComposerInput } from "../../shared/ui/composer/ComposerInput";
import { ComposerSurface } from "../../shared/ui/composer/ComposerSurface";
import { ExternalAgentConfigControls } from "./ExternalAgentConfigControls";
import { AnimatePresence } from "motion/react";
import { ComposerPlanBadge } from "../../shared/ui/composer/ComposerPlanBadge";

export function ExternalAgentComposer({
  draft,
  attachments,
  supportsImages,
  onAddImages,
  onRemoveImage,
  newTask = false,
  disabled,
  running,
  options,
  pending,
  onDraftChange,
  onSubmit,
  onCancel,
  onConfigChange,
  name = "External agent",
}: {
  draft: string;
  attachments: ComposerAttachment[];
  supportsImages: boolean;
  onAddImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  newTask?: boolean;
  disabled: boolean;
  running: boolean;
  options: ExternalAgentConfigOption[];
  pending: Record<string, string | boolean>;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onConfigChange: (configId: string, value: string | boolean) => void;
  name?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const planOption =
    options.find((option) => option.id === "collaboration_mode") ??
    options.find(
      (option) =>
        option.category === "mode" &&
        option.options.some((choice) => choice.value === "plan"),
    );
  const planActive = planOption?.currentValue === "plan";
  const accessOption = options.find(
    (option) => option.category === "mode" || option.id === "mode",
  );
  const readOnlyActive = accessOption?.currentValue === "read-only";
  const defaultAccess =
    accessOption?.options.find((choice) => choice.value === "default") ??
    accessOption?.options.find((choice) => choice.value === "agent");
  const normalMode =
    planOption?.options.find((choice) => choice.value === "default") ??
    planOption?.options.find((choice) => choice.value !== "plan");


  const submit = () => {
    if (disabled || running || (!draft.trim() && !attachments.length)) return;
    onSubmit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <footer className={`agent-composer-wrap external-agent-composer shrink-0 px-2.5 pb-2.5 pt-0${newTask ? " is-new-task" : ""}`}>
      <div className="agent-composer-stack relative mx-auto flex w-full flex-col">
        <div className="agent-composer-card-slot relative">
          <ComposerSurface compact newTask={newTask} disabled={disabled} inputRef={inputRef} dragOver={dragOver}
            onPaste={event => {
              const images = [...event.clipboardData.files].filter(file => file.type.startsWith("image/"));
              if (!images.length) return;
              event.preventDefault();
              onAddImages(images);
            }}
            onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); if (!disabled && !running) setDragOver(true); } }}
            onDragLeave={() => setDragOver(false)}
            onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); setDragOver(false); if (!disabled && !running) onAddImages([...event.dataTransfer.files]); }}>
            <input ref={fileRef} aria-label="Attach images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
              onChange={event => { onAddImages([...(event.target.files ?? [])]); event.target.value = ""; }} />
            <ComposerAttachments attachments={attachments} onRemove={onRemoveImage} />
            <div className="agent-composer-input-row">
              <ComposerInput
                aria-label={`Message ${name}`}
                compact
                newTask={newTask}
                disabled={disabled}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={`Message ${name}`}
                ref={inputRef}
                value={draft}
              />
            </div>
            <div className="agent-centered-composer-actions flex h-[30px] shrink-0 items-center gap-1.5">
              <ExternalAgentConfigControls
                newTask={newTask}
                onAttachImages={supportsImages && !running ? () => fileRef.current?.click() : undefined}
                disabled={disabled || Object.keys(pending).length > 0}
                onChange={onConfigChange}
                options={options}
                pending={pending}
              />
              <AnimatePresence>
                {readOnlyActive && accessOption && defaultAccess ? (
                  <ComposerPlanBadge
                    key="read-only"
                    readOnly
                    disabled={disabled || Object.keys(pending).length > 0}
                    onClear={() =>
                      onConfigChange(accessOption.id, defaultAccess.value)
                    }
                  />
                ) : null}
                {planActive && normalMode && planOption ? (
                  <ComposerPlanBadge
                    key="plan"
                    disabled={disabled || Object.keys(pending).length > 0}
                    onClear={() =>
                      onConfigChange(planOption.id, normalMode.value)
                    }
                  />
                ) : null}
              </AnimatePresence>
              <button
                aria-label={running ? "Stop" : "Send"}
                className={`agent-send-button agent-send-button-centered is-${planActive ? "plan" : readOnlyActive ? "ask" : "act"} ml-auto shrink-0${running ? " is-stop" : ""}`}
                disabled={!running && (disabled || (!draft.trim() && !attachments.length))}
                onClick={running ? onCancel : submit}
                type="button"
              >
                {running ? (
                  <span aria-hidden="true" className="agent-send-stop-mark" />
                ) : (
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="22"
                    viewBox="0 0 24 24"
                    width="22"
                  >
                    <path
                      d="M12 20V4m-7 7l7-7l7 7"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                )}
              </button>
            </div>
          </ComposerSurface>
        </div>
      </div>
    </footer>
  );
}
