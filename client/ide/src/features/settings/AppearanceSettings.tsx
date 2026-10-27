import {
  Add01Icon,
  ArrowDown01Icon,
  MinusSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "../../shared/ui/Icon";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  updateAppPreference,
  useAppPreferences,
  type CodeFontFamily,
  type InterfaceFontFamily,
  type MotionPreference,
  type ThemePreference,
} from "./preferences";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const accentOptions = ["#4ebdff", "#62d49b", "#d59bff"];
const interfaceFontOptions: Array<{ label: string; value: InterfaceFontFamily }> = [
  { label: "System", value: "system" },
  { label: "Rounded", value: "rounded" },
  { label: "Classic", value: "classic" },
];
const codeFontOptions: Array<{ label: string; value: CodeFontFamily }> = [
  { label: "JetBrains Mono", value: "jetbrains" },
  { label: "System Mono", value: "system-mono" },
  { label: "Menlo", value: "menlo" },
];

export function AppearanceSettings() {
  const preferences = useAppPreferences();

  return (
    <div className="settings-appearance mt-6 pb-8">
      <section className="settings-section-group border-b border-[#303030] pb-6">
        <h2 className="settings-section-heading mb-3 text-xs font-medium text-[#808085]">Theme</h2>
        <div aria-label="Application theme" className="grid max-w-[640px] grid-cols-3 gap-3" role="radiogroup">
          <ThemePreview label="System" mode="system" selected={preferences.theme === "system"} />
          <ThemePreview label="Light" mode="light" selected={preferences.theme === "light"} />
          <ThemePreview label="Dark" mode="dark" selected={preferences.theme === "dark"} />
        </div>

      </section>

      <SettingsGroup title="Theme customization">
        <SettingsRow description="Use this color for primary actions and active interface accents." label="Accent">
          <div className="appearance-accent-options flex items-center gap-1.5 rounded-lg bg-[#2c2c2c] p-1">
            {accentOptions.map((color) => (
              <button
                aria-label={`Use ${color} as accent color`}
                className={`appearance-accent-swatch relative size-6 rounded-md transition-transform active:scale-90 ${preferences.accentColor === color ? "ring-1 ring-white/70 ring-offset-1 ring-offset-[#2c2c2c]" : "hover:scale-105"}`}
                data-selected={preferences.accentColor === color}
                key={color}
                onClick={() => updateAppPreference("accentColor", color)}
                style={{ backgroundColor: color }}
                type="button"
              >
                {preferences.accentColor === color && <Icon icon={Tick02Icon} className="absolute inset-0 m-auto text-[#171717]" size={13} strokeWidth={2.5} />}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow description="Choose the typeface used by menus, labels and controls." label="Interface font">
          <CompactSelect
            ariaLabel="Interface font"
            onChange={(value) => updateAppPreference("interfaceFontFamily", value)}
            options={interfaceFontOptions}
            value={preferences.interfaceFontFamily}
          />
        </SettingsRow>
        <SettingsRow description="Choose the monospace typeface used by Monaco and remote terminals." label="Code font">
          <CompactSelect
            ariaLabel="Code font"
            onChange={(value) => updateAppPreference("codeFontFamily", value)}
            options={codeFontOptions}
            value={preferences.codeFontFamily}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Preferences">
        <SettingsRow
          description="Show the pointer cursor when hovering over interactive controls."
          label="Pointer cursors"
        >
          <SettingsSwitch
            checked={preferences.pointerCursors}
            label="Pointer cursors"
            onChange={(checked) => updateAppPreference("pointerCursors", checked)}
          />
        </SettingsRow>
        <SettingsRow
          description="Follow macOS, reduce interface animations or keep the full motion design."
          label="Reduce motion"
        >
          <SegmentedControl<MotionPreference>
            ariaLabel="Reduce motion"
            onChange={(value) => updateAppPreference("motionPreference", value)}
            options={[
              { label: "System", value: "system" },
              { label: "On", value: "reduce" },
              { label: "Off", value: "full" },
            ]}
            value={preferences.motionPreference}
          />
        </SettingsRow>
        <SettingsRow description="Adjust the base size used throughout the interface." label="Interface font size">
          <NumberStepper
            label="Interface font size"
            max={16}
            min={11}
            onChange={(value) => updateAppPreference("interfaceFontSize", value)}
            value={preferences.interfaceFontSize}
          />
        </SettingsRow>
        <SettingsRow description="Adjust text in Monaco and every remote terminal." label="Code font size">
          <NumberStepper
            label="Code font size"
            max={18}
            min={10}
            onChange={(value) => updateAppPreference("codeFontSize", value)}
            value={preferences.codeFontSize}
          />
        </SettingsRow>
        <SettingsRow description="Use macOS font smoothing for interface and editor text." label="Font smoothing">
          <SettingsSwitch
            checked={preferences.fontSmoothing}
            label="Font smoothing"
            onChange={(checked) => updateAppPreference("fontSmoothing", checked)}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

function ThemePreview({
  label,
  mode,
  selected = false,
}: {
  label: string;
  mode: ThemePreference;
  selected?: boolean;
}) {
  const light = mode === "light";
  const split = mode === "system";

  return (
    <button
      aria-checked={selected}
      aria-label={`${label} theme`}
      className="appearance-theme-option group relative min-w-0 text-left active:scale-[0.99]"
      data-mode={mode}
      data-selected={selected}
      onClick={() => updateAppPreference("theme", mode)}
      role="radio"
      title={`Use ${label.toLowerCase()} theme`}
      type="button"
    >
      <span
        className={`appearance-theme-preview relative block aspect-[1.45/1] overflow-hidden rounded-xl border transition-colors ${selected ? "border-[#9a9a9f]" : "border-[#3b3b3b]"} ${light ? "bg-[#ededed]" : "bg-[#2b2b2b]"}`}
      >
        {split && <span className="theme-preview-split absolute inset-y-0 left-0 w-1/2 bg-[#dedede]" />}
        <span className={`theme-preview-header absolute left-[13%] right-[13%] top-[24%] h-2 rounded-full ${light ? "bg-[#c8c8c8]" : "bg-[#727272]"}`} />
        <span className={`theme-preview-panel absolute bottom-0 left-[9%] right-[9%] h-[52%] rounded-t-lg ${light ? "bg-white" : "bg-[#171717]"}`} />
        <span className={`theme-preview-line-primary absolute bottom-[31%] left-[15%] h-2 w-[28%] rounded-full ${light ? "bg-[#d8d8d8]" : "bg-[#555]"}`} />
        <span className={`theme-preview-line-secondary absolute bottom-[17%] left-[15%] h-1.5 w-[50%] rounded-full ${light ? "bg-[#e5e5e5]" : "bg-[#3f3f3f]"}`} />
        {selected && (
          <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-[var(--accent-color)] text-[#10202b]">
            <Icon icon={Tick02Icon} size={12} strokeWidth={2.4} />
          </span>
        )}
      </span>
      <span className={`appearance-theme-label mt-1.5 block text-center text-xs ${selected ? "text-white" : "text-[#a0a0a5]"}`}>{label}</span>
    </button>
  );
}

function SettingsGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="settings-section-group py-5">
      <h2 className="settings-section-heading mb-1 text-xs font-medium text-[#808085]">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function SettingsRow({ children, description, label }: { children: ReactNode; description: string; label: string }) {
  return (
    <div className="settings-preference-row grid min-h-[64px] grid-cols-[minmax(0,1fr)_minmax(210px,280px)] items-center gap-8 border-b border-[#303030] py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="settings-preference-label text-[13px] font-medium text-[#e6e6e8]">{label}</div>
        <p className="settings-preference-description mt-0.5 max-w-xl text-xs leading-5 text-[#85858a]">{description}</p>
      </div>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

function SettingsSwitch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`settings-toggle group relative h-5 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-[#4cae77]" : "bg-[#474747]"}`}
      data-checked={checked}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className={`absolute top-0.5 h-4 w-6 rounded-full bg-white transition-[left,transform] duration-200 ease-out group-active:scale-x-110 ${checked ? "left-[18px] origin-right" : "left-0.5 origin-left"}`} />
    </button>
  );
}

function CompactSelect<Value extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: Value) => void;
  options: Array<{ label: string; value: Value }>;
  value: Value;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="relative w-full max-w-[220px]" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label={ariaLabel}
        className="settings-select flex h-7 w-full items-center justify-between gap-3 rounded-lg bg-[#2c2c2c] px-2.5 text-left text-xs text-[#e8e8ea] transition-colors hover:bg-[#353535]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="truncate">{selected.label}</span>
        <Icon icon={ArrowDown01Icon} className={`shrink-0 text-[#85858a] transition-transform ${open ? "rotate-180" : ""}`} size={13} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="settings-select-menu absolute right-0 top-9 z-40 w-full min-w-48 rounded-xl bg-[#2c2c2c] p-1.5 shadow-[0_14px_32px_rgba(0,0,0,0.4)]"
            exit={{ opacity: 0, scale: 0.98, y: -3 }}
            initial={{ opacity: 0, scale: 0.98, y: -3 }}
            transition={{ duration: 0.13, ease: "easeOut" }}
          >
            {options.map((option) => (
              <button
                className={`settings-select-option flex h-7 w-full items-center justify-between rounded-lg px-2 text-left text-xs transition-colors ${option.value === value ? "bg-[#3a3a3a] text-white" : "text-[#c3c3c7] hover:bg-[#363636] hover:text-white"}`}
                data-active={option.value === value}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                type="button"
              >
                <span>{option.label}</span>
                {option.value === value && <Icon icon={Tick02Icon} aria-hidden="true" size={12} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SegmentedControl<Value extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: Value) => void;
  options: Array<{ label: string; value: Value }>;
  value: Value;
}) {
  return (
    <div aria-label={ariaLabel} className="settings-segmented flex items-center rounded-lg bg-[#2c2c2c] p-0.5" role="radiogroup">
      {options.map((option) => (
        <button
          aria-checked={option.value === value}
          className={`settings-segment-option h-7 rounded-md px-3 text-xs transition-colors ${option.value === value ? "bg-[#424242] text-white" : "text-[#a7a7ac] hover:text-white"}`}
          data-active={option.value === value}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function NumberStepper({ label, max, min, onChange, value }: { label: string; max: number; min: number; onChange: (value: number) => void; value: number }) {
  return (
    <div className="settings-number-stepper flex h-7 items-center rounded-lg bg-[#2c2c2c] text-xs text-[#e8e8ea]">
      <button aria-label={`Decrease ${label}`} className="settings-number-button flex h-7 w-7 items-center justify-center rounded-lg text-[#a0a0a5] hover:bg-[#383838] hover:text-white disabled:opacity-30" disabled={value <= min} onClick={() => onChange(clamp(value - 1, min, max))} type="button">
        <Icon icon={MinusSignIcon} size={12} />
      </button>
      <span className="w-12 text-center tabular-nums">{value} px</span>
      <button aria-label={`Increase ${label}`} className="settings-number-button flex h-7 w-7 items-center justify-center rounded-lg text-[#a0a0a5] hover:bg-[#383838] hover:text-white disabled:opacity-30" disabled={value >= max} onClick={() => onChange(clamp(value + 1, min, max))} type="button">
        <Icon icon={Add01Icon} size={12} />
      </button>
    </div>
  );
}
