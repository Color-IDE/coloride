import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  size?: "sm" | "md";
  variant?: "default" | "primary" | "danger" | "ghost";
};

const variants = {
  default: "bg-surface-hover text-primary hover:bg-surface-selected",
  primary: "bg-[var(--accent-color,#4ebdff)] text-[#10202b] hover:brightness-110",
  danger: "bg-danger-surface text-danger hover:text-danger-hover",
  ghost: "bg-transparent text-muted hover:bg-surface-hover hover:text-primary",
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ children, className, disabled, loading = false, size = "md", type = "button", variant = "default", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control border-0 px-3 text-xs font-medium transition-[background-color,color,filter,opacity,transform] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-subtle active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 ${size === "sm" ? "h-7 px-2.5" : "h-8"} ${variants[variant]}${className ? ` ${className}` : ""}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);
