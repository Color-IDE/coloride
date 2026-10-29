import type { ExternalAgentConfigOption } from "@coloride/contracts";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Menu, MenuItem, MenuSeparator } from "../../shared/ui/Menu";

const MODE_ORDER = ["plan", "read-only", "ask", "debug"];

function modeLabel(option: ExternalAgentConfigOption, value: string) {
  return (
    option.options.find((choice) => choice.value === value)?.name ??
    option.name
  );
}

function ModeChevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`size-1.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      height="6"
      viewBox="0 0 24 24"
      width="6"
    >
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

export function ExternalAgentConfigControls({
  options,
  pending,
  disabled,
  onChange,
}: {
  options: ExternalAgentConfigOption[];
  pending: Record<string, string | boolean>;
  disabled: boolean;
  onChange: (configId: string, value: string | boolean) => void;
}) {
  const [plusOpen, setPlusOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const mode =
    options.find((option) => option.category === "mode") ??
    options.find((option) => option.type === "select" && option.options.length > 1);
  const extras = options.filter((option) => option !== mode);
  const modeValue = mode
    ? String(pending[mode.id] ?? mode.currentValue)
    : "";
  const modeChoices = [...(mode?.options ?? [])].sort((left, right) => {
    const leftIndex = MODE_ORDER.indexOf(left.value);
    const rightIndex = MODE_ORDER.indexOf(right.value);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
  });

  useEffect(() => {
    if (!plusOpen && !modeOpen) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPlusOpen(false);
        setModeOpen(false);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlusOpen(false);
        setModeOpen(false);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [plusOpen, modeOpen]);

  if (!options.length) return null;
  return (
    <div className="relative flex h-[30px] items-center gap-1.5" ref={rootRef}>
      <button
        aria-expanded={plusOpen}
        aria-haspopup="menu"
        aria-label={plusOpen ? "Close mode menu" : "Choose mode"}
        className="agent-composer-action flex items-center justify-center rounded-full"
        disabled={disabled}
        onClick={() => {
          setModeOpen(false);
          setPlusOpen((current) => !current);
        }}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="transition-transform duration-150 ease-out"
          fill="none"
          height="16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          style={{ transform: plusOpen ? "rotate(45deg)" : "rotate(0deg)" }}
          viewBox="0 0 24 24"
          width="16"
        >
          <path d="M11.9922 4.00012V20.0001M19.9922 12.0001H3.99222" />
        </svg>
      </button>
      {mode ? (
        <button
          aria-expanded={modeOpen}
          aria-haspopup="menu"
          className="agent-composer-model-trigger flex h-[30px] max-w-[200px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium"
          disabled={disabled}
          onClick={() => {
            setPlusOpen(false);
            setModeOpen((current) => !current);
          }}
          type="button"
        >
          <span className="truncate">{modeLabel(mode, modeValue)}</span>
          <ModeChevron open={modeOpen} />
        </button>
      ) : null}
      {plusOpen ? (
        <motion.div
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="absolute bottom-[calc(100%+4px)] left-0 z-40"
          initial={{ opacity: 0, y: 5, scale: 0.98 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
        >
        <Menu className="min-w-44">
          {modeChoices.map((choice, index) => (
            <span key={choice.value}>
              {index === 1 ? <MenuSeparator /> : null}
              <MenuItem
                compact
                onClick={() => {
                  if (mode) onChange(mode.id, choice.value);
                  setPlusOpen(false);
                }}
              >
                {choice.name}
                {choice.value === modeValue ? (
                  <span className="ml-auto text-[11px] text-muted">On</span>
                ) : null}
              </MenuItem>
            </span>
          ))}
          {extras.map((option) => {
            const value = pending[option.id] ?? option.currentValue;
            if (option.type === "boolean") {
              return (
                <MenuItem
                  compact
                  key={option.id}
                  onClick={() => onChange(option.id, !value)}
                >
                  {option.name}
                  <span className="ml-auto text-[11px] text-muted">
                    {value ? "On" : "Off"}
                  </span>
                </MenuItem>
              );
            }
            return option.options.map((choice) => (
              <MenuItem
                compact
                key={`${option.id}:${choice.value}`}
                onClick={() => {
                  onChange(option.id, choice.value);
                  setPlusOpen(false);
                }}
              >
                {choice.name}
              </MenuItem>
            ));
          })}
        </Menu>
        </motion.div>
      ) : null}
      {modeOpen && mode ? (
        <Menu className="agent-composer-model-menu absolute bottom-[calc(100%+4px)] left-9 z-40 w-44 p-1 shadow-none">
          {modeChoices.map((choice) => (
            <button
              aria-checked={choice.value === modeValue}
              className="agent-model-menu-item flex h-6 w-full items-center rounded-[4px] px-2 text-left text-xs"
              key={choice.value}
              onClick={() => {
                onChange(mode.id, choice.value);
                setModeOpen(false);
              }}
              role="menuitemradio"
              type="button"
            >
              {choice.name}
            </button>
          ))}
        </Menu>
      ) : null}
    </div>
  );
}
