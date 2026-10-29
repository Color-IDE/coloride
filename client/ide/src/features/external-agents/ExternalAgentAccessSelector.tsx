import type { ExternalAgentConfigOption } from "@coloride/contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatedComposerModelPanel,
  ComposerChevron,
  ComposerModelRow,
  ComposerModelTrigger,
  COMPOSER_MENU_TRANSITION,
} from "../../shared/ui/composer/ComposerModelControls";
import { placeMenuAboveTrigger } from "../../shared/ui/composer/modelMenuPosition";

export function ExternalAgentAccessSelector({
  option,
  newTask = false,
  disabled,
  pending,
  onChange,
  onOpen,
}: {
  option: ExternalAgentConfigOption;
  newTask?: boolean;
  disabled: boolean;
  pending?: string | boolean;
  onChange(id: string, value: string | boolean): void;
  onOpen(): void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = String(pending ?? option.currentValue);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const reposition = () => {
      if (trigger.current)
        setPosition(
          placeMenuAboveTrigger(
            trigger.current.getBoundingClientRect(),
            224,
            panel.current?.offsetHeight ?? 160,
            newTask,
          ),
        );
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, newTask]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <>
      <ComposerModelTrigger
        ref={trigger}
        aria-label="Access level"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!open) onOpen();
          setOpen((value) => !value);
        }}
      >
        <span className="truncate">
          {option.options.find((choice) => choice.value === current)?.name ??
            option.name}
        </span>
        <ComposerChevron className={open ? "rotate-180" : ""} />
      </ComposerModelTrigger>
      {open
        ? createPortal(
            <AnimatedComposerModelPanel
              ref={panel}
              initial={{ opacity: 0, y: 5, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={COMPOSER_MENU_TRANSITION}
              style={{
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                width: 224,
                visibility: position ? "visible" : "hidden",
              }}
            >
              {option.options.map((choice) => (
                <ComposerModelRow
                  key={choice.value}
                  selected={choice.value === current}
                  disabled={disabled}
                  title={choice.description ?? undefined}
                  onClick={() => {
                    onChange(option.id, choice.value);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{choice.name}</span>
                </ComposerModelRow>
              ))}
            </AnimatedComposerModelPanel>,
            document.body,
          )
        : null}
    </>
  );
}
