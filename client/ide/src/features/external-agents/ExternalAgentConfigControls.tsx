import type { ExternalAgentConfigOption } from "@coloride/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Menu, MenuItem, MenuSeparator } from "../../shared/ui/Menu";
import {
  ComposerChevron,
  AnimatedComposerModelPanel,
  COMPOSER_MENU_TRANSITION,
  ComposerModelTrigger,
  ComposerModelRow,
  ComposerModelToggle,
} from "../../shared/ui/composer/ComposerModelControls";
import { ChatGPTMark } from "./marks";
import { ExternalAgentAccessSelector } from "./ExternalAgentAccessSelector";
import { EXTERNAL_MODEL_DETAILS } from "./modelDetails";
import { ComposerModelTooltip } from "../../shared/ui/composer/ComposerModelTooltip";
import {
  MODEL_MENU_WIDTH,
  MODEL_FLYOUT_WIDTH,
  placeMenuAboveTrigger,
  placeBesideRect,
} from "../../shared/ui/composer/modelMenuPosition";

function optionLabel(option: ExternalAgentConfigOption, value: string) {
  return (
    option.options.find((choice) => choice.value === value)?.name ?? option.name
  );
}

export function ExternalAgentConfigControls({
  options,
  newTask = false,
  onAttachImages,
  pending,
  disabled,
  onChange,
}: {
  options: ExternalAgentConfigOption[];
  newTask?: boolean;
  onAttachImages?: () => void;
  pending: Record<string, string | boolean>;
  disabled: boolean;
  onChange: (configId: string, value: string | boolean) => void;
}) {
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [hoverTip, setHoverTip] = useState<{
    name: string;
    modelId: string;
    anchor: DOMRect;
    description: string;
    top: number;
    left: number;
    side: "left" | "right";
    caretOffsetY?: number;
  } | null>(null);
  const showModelTip = (
    name: string,
    modelId: string,
    description: string | null | undefined,
    row: HTMLElement,
  ) => {
    if (!description) {
      setHoverTip(null);
      return;
    }
    const placement = placeBesideRect(
      row.getBoundingClientRect(),
      248,
      240,
      12,
      modelFlyoutPosition?.side ?? "left",
    );
    setHoverTip({
      name,
      modelId,
      description,
      anchor: row.getBoundingClientRect(),
      ...placement,
    });
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelFlyoutRef = useRef<HTMLDivElement>(null);
  const [modelMenuPosition, setModelMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [modelFlyoutPosition, setModelFlyoutPosition] = useState<{
    top: number;
    left: number;
    side: "left" | "right";
  } | null>(null);
  const mode =
    options.find((option) => option.category === "mode") ??
    options.find((option) => option.id === "mode");
  const model =
    options.find((option) => option.category === "model") ??
    options.find((option) => option.id === "model");
  const reasoning =
    options.find((option) => option.category === "thought_level") ??
    options.find((option) => option.id === "reasoning_effort");
  const fastMode =
    options.find((option) => option.id === "fast-mode") ??
    options.find(
      (option) =>
        option.type === "boolean" && option.name.toLowerCase() === "fast mode",
    );
  const extras = options.filter(
    (option) =>
      option !== mode &&
      option !== model &&
      option !== reasoning &&
      option !== fastMode,
  );
  const modeValue = mode ? String(pending[mode.id] ?? mode.currentValue) : "";
  const modelValue = model
    ? String(pending[model.id] ?? model.currentValue)
    : "";
  const reasoningValue = reasoning
    ? String(pending[reasoning.id] ?? reasoning.currentValue)
    : "";
  const fastModeValue = fastMode
    ? Boolean(pending[fastMode.id] ?? fastMode.currentValue)
    : false;

  const repositionModelMenus = useCallback(() => {
    if (!modelOpen) return;
    const trigger = modelTriggerRef.current;
    if (!trigger) return;
    const menuHeight = modelMenuRef.current?.offsetHeight || 260;
    const triggerRect = trigger.getBoundingClientRect();
    setModelMenuPosition(
      placeMenuAboveTrigger(triggerRect, MODEL_MENU_WIDTH, menuHeight, newTask),
    );

    if (!modelsOpen) {
      setModelFlyoutPosition(null);
      return;
    }
    const menuRect = modelMenuRef.current?.getBoundingClientRect();
    if (!menuRect) return;
    const flyoutWidth = MODEL_FLYOUT_WIDTH;
    const flyoutHeight = modelFlyoutRef.current?.offsetHeight || 260;
    const placement = placeBesideRect(
      menuRect,
      flyoutWidth,
      flyoutHeight,
      8,
      "left",
    );
    const flyoutTop = Math.max(
      8,
      Math.min(
        menuRect.bottom - flyoutHeight,
        window.innerHeight - flyoutHeight - 8,
      ),
    );
    setModelFlyoutPosition({
      top: flyoutTop,
      left: placement.left,
      side: placement.side,
    });
  }, [modelOpen, modelsOpen, newTask]);

  useLayoutEffect(() => {
    setHoverTip(null);
    if (!modelOpen) {
      setModelMenuPosition(null);
      setModelFlyoutPosition(null);
      return;
    }
    repositionModelMenus();
    const frame = window.requestAnimationFrame(repositionModelMenus);
    window.addEventListener("resize", repositionModelMenus);
    window.addEventListener("scroll", repositionModelMenus, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", repositionModelMenus);
      window.removeEventListener("scroll", repositionModelMenus, true);
    };
  }, [modelOpen, modelsOpen, repositionModelMenus]);

  useEffect(() => {
    if (!plusOpen && !modelOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !modelMenuRef.current?.contains(target) &&
        !modelFlyoutRef.current?.contains(target)
      ) {
        setPlusOpen(false);
        setModelOpen(false);
        setModelsOpen(false);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlusOpen(false);
        setModelOpen(false);
        setModelsOpen(false);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [plusOpen, modelOpen]);

  if (!options.length && !onAttachImages) return null;
  return (
    <div className="relative flex h-[30px] items-center gap-1.5" ref={rootRef}>
      <button
        aria-expanded={plusOpen}
        aria-haspopup="menu"
        aria-label={plusOpen ? "Close mode menu" : "Choose mode"}
        className="agent-composer-action flex items-center justify-center rounded-full"
        disabled={disabled}
        onClick={() => {
          setModelOpen(false);
          setModelsOpen(false);
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
      {model ? (
        <ComposerModelTrigger
          aria-expanded={modelOpen}
          aria-haspopup="menu"
          aria-label={model.name}
          disabled={disabled}
          onClick={() => {
            setPlusOpen(false);
            setModelsOpen(false);
            setModelOpen((current) => !current);
          }}
          ref={modelTriggerRef}
          type="button"
        >
          <span className="external-agent-model-icon">
            <ChatGPTMark />
          </span>
          <span className="truncate">{optionLabel(model, modelValue)}</span>
          <ComposerChevron className={modelOpen ? "rotate-180" : ""} />
        </ComposerModelTrigger>
      ) : null}
      {mode ? (
        <ExternalAgentAccessSelector
          newTask={newTask}
          onOpen={() => {
            setPlusOpen(false);
            setModelOpen(false);
            setModelsOpen(false);
          }}
          option={mode}
          pending={pending[mode.id]}
          disabled={disabled}
          onChange={onChange}
        />
      ) : null}
      {plusOpen ? (
        <motion.div
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className={`absolute ${newTask ? "top-[calc(100%+4px)]" : "bottom-[calc(100%+4px)]"} left-0 z-40`}
          initial={{ opacity: 0, y: 5, scale: 0.98 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
        >
          <Menu className="min-w-44">
            {onAttachImages ? <MenuItem compact onClick={() => { setPlusOpen(false); onAttachImages(); }}>Add images</MenuItem> : null}
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
              return option.options
                .filter((choice) => choice.value !== "default")
                .map((choice) => (
                  <MenuItem
                    compact
                    key={`${option.id}:${choice.value}`}
                    onClick={() => {
                      onChange(option.id, choice.value);
                      setPlusOpen(false);
                    }}
                  >
                    {choice.name}
                    {choice.value === String(value) &&
                    !(
                      choice.value === "default" && modeValue === "read-only"
                    ) ? (
                      <span className="ml-auto text-[11px] text-muted">On</span>
                    ) : null}
                  </MenuItem>
                ));
            })}
          </Menu>
        </motion.div>
      ) : null}
      {modelOpen && model
        ? createPortal(
            <>
              <AnimatedComposerModelPanel
                animate={{ opacity: 1, y: 0, scale: 1 }}
                initial={{ opacity: 0, y: 5, scale: 0.98 }}
                transition={COMPOSER_MENU_TRANSITION}
                ref={modelMenuRef}
                style={{
                  top: modelMenuPosition?.top ?? 0,
                  left: modelMenuPosition?.left ?? 0,
                  width: MODEL_MENU_WIDTH,
                  visibility: modelMenuPosition ? "visible" : "hidden",
                }}
              >
                {fastMode ? (
                  <ComposerModelToggle
                    checked={fastModeValue}
                    disabled={disabled}
                    label="Fast mode"
                    onChange={(value) => onChange(fastMode.id, value)}
                  />
                ) : null}
                {reasoning && reasoning.options.length ? (
                  <>
                    <MenuSeparator />
                    <div className="agent-model-label px-2 py-1 text-[11px] font-medium">
                      Reasoning Effort
                    </div>
                    {reasoning.options.map((choice) => (
                      <ComposerModelRow
                        selected={choice.value === reasoningValue}
                        disabled={disabled}
                        key={choice.value}
                        onClick={() => onChange(reasoning.id, choice.value)}
                        role="menuitemradio"
                        type="button"
                      >
                        {choice.name}
                      </ComposerModelRow>
                    ))}
                  </>
                ) : null}
                <MenuSeparator />
                <button
                  aria-expanded={modelsOpen}
                  aria-haspopup="menu"
                  className={`agent-model-menu-item agent-model-submenu-trigger flex h-6 w-full items-center gap-1.5 rounded-[4px] px-2 text-left text-xs${modelsOpen ? " is-open" : ""}`}
                  onClick={() => setModelsOpen((current) => !current)}
                  role="menuitem"
                  type="button"
                >
                  <span className="external-agent-model-icon">
                    <ChatGPTMark />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {optionLabel(model, modelValue)}
                  </span>
                  <ComposerChevron
                    className={`shrink-0 opacity-50 -rotate-90${modelFlyoutPosition?.side === "left" ? " rotate-90" : ""}`}
                  />
                </button>
              </AnimatedComposerModelPanel>
              {modelsOpen ? (
                <AnimatedComposerModelPanel
                  animate={{ opacity: 1, scale: 1 }}
                  initial={{ opacity: 0, scale: 0.98 }}
                  transition={COMPOSER_MENU_TRANSITION}
                  flyout
                  ref={modelFlyoutRef}
                  style={{
                    top: modelFlyoutPosition?.top ?? 0,
                    left: modelFlyoutPosition?.left ?? 0,
                    width: MODEL_FLYOUT_WIDTH,
                    visibility: modelFlyoutPosition ? "visible" : "hidden",
                  }}
                >
                  {model.options.map((choice) => (
                    <ComposerModelRow
                      selected={choice.value === modelValue}
                      disabled={disabled}
                      key={choice.value}
                      onMouseEnter={(event) =>
                        showModelTip(
                          choice.name,
                          choice.value,
                          choice.description,
                          event.currentTarget,
                        )
                      }
                      onMouseLeave={() => setHoverTip(null)}
                      onFocus={(event) =>
                        showModelTip(
                          choice.name,
                          choice.value,
                          choice.description,
                          event.currentTarget,
                        )
                      }
                      onBlur={() => setHoverTip(null)}
                      onClick={() => {
                        onChange(model.id, choice.value);
                        setModelsOpen(false);
                        setModelOpen(false);
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      <span className="external-agent-model-icon">
                        <ChatGPTMark />
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {choice.name}
                      </span>
                    </ComposerModelRow>
                  ))}
                </AnimatedComposerModelPanel>
              ) : null}
              {modelsOpen && hoverTip ? (
                <ComposerModelTooltip
                  anchor={hoverTip.anchor}
                  description={hoverTip.description}
                  stats={[
                    {
                      label: "Price",
                      value:
                        EXTERNAL_MODEL_DETAILS[hoverTip.modelId]?.price ?? null,
                    },
                    {
                      label: "Coding",
                      value:
                        EXTERNAL_MODEL_DETAILS[hoverTip.modelId]?.coding ??
                        null,
                    },
                    {
                      label: "Visual",
                      value:
                        EXTERNAL_MODEL_DETAILS[hoverTip.modelId]?.visual ??
                        null,
                    },
                  ]}
                  tokenPrice={{
                    input:
                      EXTERNAL_MODEL_DETAILS[hoverTip.modelId]?.input ?? null,
                    output:
                      EXTERNAL_MODEL_DETAILS[hoverTip.modelId]?.output ?? null,
                  }}
                  tokenPriceLabel="Standard API token price"
                  side={hoverTip.side}
                  caretOffsetY={hoverTip.caretOffsetY}
                  style={{
                    position: "fixed",
                    top: hoverTip.top,
                    left: hoverTip.left,
                    width: 248,
                    zIndex: 10060,
                  }}
                >
                  <p className="mt-2 text-[10px] leading-4 opacity-60">
                    Coding/Visual: Coloride estimates. API rates do not
                    represent ChatGPT plan usage.
                  </p>
                </ComposerModelTooltip>
              ) : null}
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
