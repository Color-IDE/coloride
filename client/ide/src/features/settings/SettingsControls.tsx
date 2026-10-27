import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../shared/ui/Icon";

export function SettingsGroup({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="settings-section-group border-b border-[#303030] py-4 first:pt-0 last:border-b-0">
      <h2 className="settings-section-heading mb-1 text-xs font-medium text-[#808085]">
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

export function SettingsRow({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description: string;
  label: string;
}) {
  return (
    <div className="settings-preference-row grid min-h-[62px] grid-cols-[minmax(0,1fr)_minmax(160px,220px)] items-center gap-8 py-2">
      <div className="min-w-0">
        <div className="settings-preference-label text-[13px] font-medium text-[#e6e6e8]">
          {label}
        </div>
        <p className="settings-preference-description mt-0.5 max-w-xl text-xs leading-5 text-[#85858a]">
          {description}
        </p>
      </div>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

export function CompactSelect<Value extends string>({
  menuStyle = "settings",
  ariaLabel,
  disabled,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: Value) => void;
  menuStyle?: "settings" | "agent";
  options: Array<{ label: string; value: Value }>;
  value: Value;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div
      className="relative w-full max-w-[220px]"
      ref={rootRef}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          rootRef.current?.querySelector("button")?.focus();
        }
      }}
    >
      <button
        aria-expanded={open}
        aria-label={ariaLabel}
        className="settings-select flex h-7 w-full items-center justify-between gap-3 rounded-lg bg-[#2c2c2c] px-2.5 text-left text-xs text-[#e8e8ea] transition-colors hover:bg-[#353535] disabled:opacity-50"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        type="button"
      >
        <span className="truncate">{selected.label}</span>
        <Icon
          icon={ArrowDown01Icon}
          className={`shrink-0 text-[#85858a] transition-transform ${open ? "rotate-180" : ""}`}
          size={13}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className={
              menuStyle === "agent"
                ? "agent-composer-attach-menu agent-history-filter-menu absolute right-0 top-9 z-40 p-1"
                : "settings-select-menu absolute right-0 top-9 z-40 w-full min-w-48 rounded-xl bg-[#2c2c2c] p-1.5 shadow-[0_14px_32px_rgba(0,0,0,0.4)]"
            }
            exit={{ opacity: 0, scale: 0.98, y: -3 }}
            initial={{ opacity: 0, scale: 0.98, y: -3 }}
            transition={{ duration: 0.13, ease: "easeOut" }}
          >
            {options.map((option) => (
              <button
                className={
                  menuStyle === "agent"
                    ? `agent-model-menu-item flex h-8 w-full items-center justify-between gap-2 rounded-[4px] px-2 text-left text-xs ${option.value === value ? "is-selected" : ""}`
                    : `settings-select-option flex h-7 w-full items-center justify-between rounded-lg px-2 text-left text-xs transition-colors ${option.value === value ? "bg-[#3a3a3a] text-white" : "text-[#c3c3c7] hover:bg-[#363636] hover:text-white"}`
                }
                data-active={option.value === value}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                type="button"
              >
                <span
                  className={
                    menuStyle === "agent" ? "min-w-0 truncate" : undefined
                  }
                  title={option.label}
                >
                  {option.label}
                </span>
                {option.value === value && (
                  <Icon icon={Tick02Icon} aria-hidden="true" size={12} />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
