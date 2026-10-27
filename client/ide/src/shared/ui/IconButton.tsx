import { forwardRef, type ButtonHTMLAttributes } from "react";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  active?: boolean;
  label: string;
  size?: "sm" | "md";
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ active = false, children, className, label, size = "md", title, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        data-active={active || undefined}
        title={title ?? label}
        type={type}
        className={`inline-flex shrink-0 items-center justify-center rounded-control border-0 text-muted transition-[background-color,color,transform] hover:bg-surface-hover hover:text-primary focus-visible:bg-surface-hover focus-visible:text-primary focus-visible:outline-none active:scale-95 disabled:pointer-events-none disabled:opacity-45 ${size === "sm" ? "size-4" : "size-7"} ${active ? "bg-surface-selected text-primary" : "bg-transparent"}${className ? ` ${className}` : ""}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);
