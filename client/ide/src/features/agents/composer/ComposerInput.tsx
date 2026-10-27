import { forwardRef, type TextareaHTMLAttributes } from "react";

interface ComposerInputProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  compact?: boolean;
  hasChips?: boolean;
  newTask?: boolean;
  provisional?: boolean;
}

export const ComposerInput = forwardRef<HTMLTextAreaElement, ComposerInputProps>(
  function ComposerInput(
    {
      className = "",
      compact = false,
      hasChips = false,
      newTask = false,
      provisional = false,
      style,
      value,
      ...props
    },
    ref,
  ) {
    const empty = typeof value !== "string" || value.length === 0;

    return (
      <textarea
        {...props}
        className={`agent-composer-input cursor-text resize-none bg-transparent outline-none${
          provisional ? " is-voice-provisional" : ""
        }${
          compact
            ? " agent-composer-input-compact w-full min-w-0 px-0.5 py-0 text-[13px] leading-[22px]"
            : " w-full px-1 py-1 text-sm leading-6"
        }${hasChips ? " agent-composer-input-with-chips" : ""} ${className}`}
        ref={ref}
        rows={1}
        style={
          compact && empty
            ? {
                height: newTask ? 110 : 22,
                minHeight: newTask ? 110 : 22,
                maxHeight: newTask ? 132 : 22,
                width: "100%",
                ...style,
              }
            : { width: "100%", ...style }
        }
        value={value}
      />
    );
  },
);
