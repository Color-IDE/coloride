import { forwardRef, type HTMLAttributes } from "react";

export type TabProps = HTMLAttributes<HTMLDivElement> & {
  active: boolean;
};

export const Tab = forwardRef<HTMLDivElement, TabProps>(
  function Tab({ active, className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-active={active ? "true" : "false"}
        className={`group relative flex h-7 w-fit max-w-56 shrink-0 cursor-pointer items-center justify-start rounded-control py-0 pl-2.5 pr-6 text-[12px] transition-[background-color,color,transform] active:scale-[0.98] ${active ? "bg-tab-active text-primary" : "bg-tab text-muted hover:bg-tab-hover hover:text-primary"}${className ? ` ${className}` : ""}`}
        {...props}
      />
    );
  },
);
