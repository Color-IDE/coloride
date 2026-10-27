import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

function classes(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

export type MenuProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "dropdown" | "context";
};

export const Menu = forwardRef<HTMLDivElement, MenuProps>(
  function Menu({ className, role = "menu", variant = "dropdown", ...props }, ref) {
    return (
      <div
        ref={ref}
        role={role}
        className={classes(
          `flex flex-col gap-px rounded-menu border border-border-subtle bg-surface-raised p-menu text-primary ${variant === "context" ? "fixed z-[900] w-[var(--context-menu-width,224px)] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto shadow-[var(--ui-menu-shadow)]" : "shadow-none"}`,
          className,
        )}
        {...props}
      />
    );
  },
);

export type MenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  compact?: boolean;
  danger?: boolean;
  shortcut?: ReactNode;
};

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(
  function MenuItem({ children, className, compact = false, danger = false, shortcut, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        role="menuitem"
        type={type}
        className={classes(
          `group flex w-full cursor-default items-center justify-between gap-3 rounded-control border-0 bg-transparent px-control-x text-left text-xs leading-[18px] transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:text-muted ${compact ? "h-menu-item-height" : "min-h-7"} ${danger ? "text-danger hover:bg-danger-surface hover:text-danger-hover focus-visible:bg-danger-surface focus-visible:text-danger-hover" : "text-primary hover:bg-surface-selected focus-visible:bg-surface-selected"}`,
          className,
        )}
        {...props}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">{children}</span>
        {shortcut ? (
          <span
            aria-hidden="true"
            className="ml-auto inline-flex h-[18px] min-w-[22px] shrink-0 items-center justify-center rounded-control bg-keycap px-[7px] text-[11px] font-[550] leading-none tracking-[0.01em] text-keycap-text group-hover:bg-keycap-hover group-hover:text-keycap-text-hover group-focus-visible:bg-keycap-hover group-focus-visible:text-keycap-text-hover"
          >
            {shortcut}
          </span>
        ) : null}
      </button>
    );
  },
);

export function MenuSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={classes("mx-1 my-1 h-px bg-border-subtle", className)}
      {...props}
    />
  );
}

export function MenuLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={classes("px-control-x py-1 text-[10px] font-medium uppercase tracking-wide text-muted", className)}
      {...props}
    />
  );
}
