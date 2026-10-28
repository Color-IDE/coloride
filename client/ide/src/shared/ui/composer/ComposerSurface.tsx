import {
  forwardRef,
  type HTMLAttributes,
  type RefObject,
} from "react";

interface ComposerSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  centered?: boolean;
  compact?: boolean;
  disabled?: boolean;
  dragOver?: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  newTask?: boolean;
  providerError?: boolean;
}

/** Visual shell for the agent composer. Composer state stays in AgentComposerCard. */
export const ComposerSurface = forwardRef<HTMLDivElement, ComposerSurfaceProps>(
  function ComposerSurface(
    {
      centered = false,
      children,
      className = "",
      compact = false,
      disabled = false,
      dragOver = false,
      inputRef,
      newTask = false,
      onMouseDown,
      providerError = false,
      ...props
    },
    ref,
  ) {
    return (
      <div
        {...props}
        className={`agent-composer relative flex w-full flex-col ${
          compact ? "px-2.5 pb-2 pt-2" : "px-2.5 pb-2.5 pt-2.5"
        } ${centered ? "agent-composer-centered" : "agent-composer-docked"} rounded-control${
          compact ? " agent-composer-compact" : ""
        }${newTask ? " is-new-task" : ""}${dragOver ? " is-drag-over" : ""}${
          providerError ? " is-provider-error" : ""
        } ${className}`}
        onMouseDown={(event) => {
          onMouseDown?.(event);
          if (event.defaultPrevented || disabled) return;

          const target = event.target as HTMLElement | null;
          if (
            !target
            || target.closest(
              "button, a, input, textarea, select, [role='button'], [role='menu'], [role='menuitem'], .agent-composer-code-chip",
            )
          ) {
            return;
          }

          requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
        }}
        ref={ref}
      >
        {children}
      </div>
    );
  },
);
