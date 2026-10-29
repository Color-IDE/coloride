import type { ExternalAgentConfigOption } from "@coloride/contracts";
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { ComposerInput } from "../../shared/ui/composer/ComposerInput";
import { ComposerSurface } from "../../shared/ui/composer/ComposerSurface";
import { ExternalAgentConfigControls } from "./ExternalAgentConfigControls";
import { AnimatePresence } from "motion/react";
import { ComposerPlanBadge } from "../../shared/ui/composer/ComposerPlanBadge";

export function ExternalAgentComposer({
  draft,
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
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(180, input.scrollHeight)}px`;
  }, [draft]);

  const submit = () => {
    if (disabled || running || !draft.trim()) return;
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
    <footer className="agent-composer-wrap external-agent-composer shrink-0 px-2.5 pb-2.5 pt-0">
      <div className="agent-composer-stack relative mx-auto flex w-full flex-col">
        <div className="agent-composer-card-slot relative">
          <ComposerSurface compact disabled={disabled} inputRef={inputRef}>
            <div className="agent-composer-input-row">
              <ComposerInput
                aria-label={`Message ${name}`}
                compact
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
                disabled={!running && (disabled || !draft.trim())}
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
