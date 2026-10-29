import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Switch } from "../Switch";
import { motion } from "motion/react";

export const COMPOSER_MENU_TRANSITION = {
  duration: 0.12,
  ease: "easeOut",
} as const;

export function ComposerChevron({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`size-1.5 shrink-0 transition-transform ${className}`}
      fill="none"
      height="6"
      viewBox="0 0 24 24"
      width="6"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="m4 9 8 8 8-8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function ComposerMenuCheck() {
  return (
    <span className="ml-auto flex">
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path
          d="M3.2 8.3 6.3 11.4 12.8 4.6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export const ComposerModelTrigger = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function ComposerModelTrigger({ className = "", ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      aria-haspopup="menu"
      className={`agent-composer-model-trigger flex h-[30px] max-w-[200px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${className}`}
    />
  );
});

export const ComposerModelPanel = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { flyout?: boolean }
>(function ComposerModelPanel(
  { flyout = false, className = "", ...props },
  ref,
) {
  const name = flyout
    ? "agent-composer-model-flyout"
    : "agent-composer-model-menu";
  return (
    <div
      {...props}
      ref={ref}
      role="menu"
      className={`${name} ${name}-fixed rounded-[6px] p-1 shadow-none ${className}`}
    />
  );
});

export const AnimatedComposerModelPanel = motion.create(ComposerModelPanel);

export const ComposerModelRow = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    selected?: boolean;
    icon?: ReactNode;
  }
>(function ComposerModelRow(
  { selected, icon, children, className = "", ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className={`agent-model-menu-item flex h-6 w-full items-center gap-1.5 rounded-[4px] px-2 text-left text-xs ${className}`}
    >
      {icon}
      {children}
      {selected ? <ComposerMenuCheck /> : null}
    </button>
  );
});

export function ComposerModelToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <div
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      className="agent-model-auto flex h-6 w-full cursor-pointer items-center justify-between rounded-[4px] px-2 text-left text-xs"
      onClick={(event) => {
        if (
          !disabled &&
          !(event.target as HTMLElement).closest(".settings-toggle")
        )
          onChange(!checked);
      }}
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget ||
          disabled ||
          !["Enter", " "].includes(event.key)
        )
          return;
        event.preventDefault();
        onChange(!checked);
      }}
      role="menuitemcheckbox"
      tabIndex={disabled ? -1 : 0}
    >
      <span>{label}</span>
      <Switch
        checked={checked}
        disabled={disabled}
        label={label}
        onChange={onChange}
      />
    </div>
  );
}
