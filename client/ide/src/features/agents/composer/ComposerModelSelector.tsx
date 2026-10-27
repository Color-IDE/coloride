import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { motion } from "motion/react";
import { createPortal } from "react-dom";
import { Icon } from "../../../shared/ui/Icon";
import { Switch as SettingsSwitch } from "../../../shared/ui/Switch";
import { PaidModelIcon } from "./ComposerModelDetails";
import { ComposerModelHoverTip } from "./ComposerModelHoverTip";
import { ComposerModelIcon } from "./ComposerModelIcon";
import {
  COMPOSER_MODEL_GROUPS,
  COMPOSER_MODELS,
  type ComposerModelOption,
} from "./modelCatalog";
import { MODEL_FLYOUT_WIDTH, MODEL_MENU_WIDTH } from "./modelMenuPosition";
import {
  reasoningLevelsForModel,
  type ComposerReasoning,
} from "./modelReasoning";
import type { useComposerModelMenu } from "./useComposerModelMenu";

type SelectorProps = ReturnType<typeof useComposerModelMenu> & {
  providerModel: string;
  autoModel: boolean;
  hasPaidModelAccess: boolean;
  composerReasoning: ComposerReasoning;
  savingProvider: boolean;
  setAutoModel: (value: boolean) => void;
  setComposerReasoning: (value: ComposerReasoning) => void;
  onSelectModel: (option: ComposerModelOption) => void;
  setAttachMenuOpen: (value: boolean) => void;
};
export function ComposerModelSelector({
  composerModelOpen,
  setComposerModelOpen,
  composerModelsFlyoutOpen,
  setComposerModelsFlyoutOpen,
  modelMenuPos,
  setModelMenuPos,
  modelFlyoutPos,
  setModelFlyoutPos,
  modelHoverTip,
  setModelHoverTip,
  composerModelRef,
  modelTriggerRef,
  modelMenuPanelRef,
  modelFlyoutPanelRef,
  modelSubmenuBtnRef,
  closeComposerModelMenus,
  showModelHoverTip,
  providerModel,
  autoModel,
  hasPaidModelAccess,
  composerReasoning,
  savingProvider,
  setAutoModel,
  setComposerReasoning,
  onSelectModel,
  setAttachMenuOpen,
}: SelectorProps) {
  return (
    <div className="relative" ref={composerModelRef}>
      <button
        aria-expanded={composerModelOpen}
        aria-haspopup="menu"
        className="agent-composer-model-trigger flex h-[30px] max-w-[200px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium"
        onClick={() => {
          setAttachMenuOpen(false);
          setComposerModelOpen((open) => {
            if (open) {
              setComposerModelsFlyoutOpen(false);
              setModelHoverTip(null);
              setModelMenuPos(null);
              setModelFlyoutPos(null);
              return false;
            }
            return true;
          });
        }}
        ref={modelTriggerRef}
        type="button"
      >
        <ComposerModelIcon
          className={
            providerModel.startsWith("gemini-") ? "size-[18px]" : "size-4"
          }
          model={providerModel}
        />
        <span className="truncate">
          {COMPOSER_MODELS.find((item) => item.model === providerModel)
            ?.label ?? providerModel}
        </span>
        <Icon
          icon={ArrowDown01Icon}
          className={composerModelOpen ? "rotate-180" : ""}
          size={13}
        />
      </button>
      {composerModelOpen
        ? createPortal(
            <>
              <motion.div
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="agent-composer-model-menu agent-composer-model-menu-fixed rounded-[6px] p-1 shadow-none"
                initial={{ opacity: 0, y: 5, scale: 0.98 }}
                ref={modelMenuPanelRef}
                role="menu"
                style={{
                  top: modelMenuPos?.top ?? 0,
                  left: modelMenuPos?.left ?? 0,
                  width: MODEL_MENU_WIDTH,
                  visibility: modelMenuPos ? "visible" : "hidden",
                }}
                transition={{ duration: 0.12, ease: "easeOut" }}
              >
                <div
                  aria-checked={autoModel}
                  className="agent-model-auto flex h-6 w-full cursor-pointer items-center justify-between rounded-[4px] px-2 text-left text-xs"
                  onClick={(event) => {
                    // The switch is already a button. Its own handler toggles it;
                    // anywhere else in this row should toggle exactly once as well.
                    if (
                      (event.target as HTMLElement).closest(".settings-toggle")
                    )
                      return;
                    setAutoModel(!autoModel);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setAutoModel(!autoModel);
                  }}
                  role="menuitemcheckbox"
                  tabIndex={0}
                >
                  <span>Auto</span>
                  <SettingsSwitch
                    checked={autoModel}
                    label="Automatically select a model"
                    onChange={setAutoModel}
                  />
                </div>
                {!autoModel && (
                  <>
                    {reasoningLevelsForModel(providerModel).length > 0 && (
                      <>
                        <div className="agent-model-divider" />
                        <div className="agent-model-label px-2 py-1 text-[11px] font-medium">
                          Reasoning Effort
                        </div>
                        {reasoningLevelsForModel(providerModel).map((level) => (
                          <button
                            aria-checked={composerReasoning === level.value}
                            className="agent-model-menu-item flex h-6 w-full items-center rounded-[4px] px-2 text-left text-xs"
                            key={level.value}
                            onClick={() => setComposerReasoning(level.value)}
                            role="menuitemradio"
                            type="button"
                          >
                            {level.label}
                            {composerReasoning === level.value && (
                              <Icon
                                icon={Tick02Icon}
                                className="ml-auto"
                                size={14}
                              />
                            )}
                          </button>
                        ))}
                      </>
                    )}
                  </>
                )}
                <div className="agent-model-divider" />
                <button
                  aria-expanded={composerModelsFlyoutOpen}
                  aria-haspopup="menu"
                  className={`agent-model-menu-item agent-model-submenu-trigger flex h-6 w-full items-center gap-1.5 rounded-[4px] px-2 text-left text-xs${
                    composerModelsFlyoutOpen ? " is-open" : ""
                  }`}
                  onClick={() => {
                    setModelHoverTip(null);
                    setComposerModelsFlyoutOpen((open) => !open);
                  }}
                  ref={modelSubmenuBtnRef}
                  role="menuitem"
                  type="button"
                >
                  <ComposerModelIcon
                    className={
                      providerModel.startsWith("gemini-")
                        ? "size-[18px] shrink-0"
                        : "size-4 shrink-0"
                    }
                    model={providerModel}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {COMPOSER_MODELS.find(
                      (item) => item.model === providerModel,
                    )?.label ?? providerModel}
                  </span>
                  <Icon
                    icon={ArrowRight01Icon}
                    className={`shrink-0 opacity-50 transition-transform${
                      modelFlyoutPos?.side === "left" ? " -scale-x-100" : ""
                    }`}
                    size={14}
                  />
                </button>
              </motion.div>

              {composerModelsFlyoutOpen ? (
                <motion.div
                  animate={{ opacity: 1, scale: 1 }}
                  className={`agent-composer-model-flyout agent-composer-model-flyout-fixed rounded-[6px] p-1 shadow-none is-side-${modelFlyoutPos?.side ?? "left"}`}
                  initial={{ opacity: 0, scale: 0.98 }}
                  ref={modelFlyoutPanelRef}
                  role="menu"
                  style={{
                    top: modelFlyoutPos?.top ?? 0,
                    left: modelFlyoutPos?.left ?? 0,
                    width: MODEL_FLYOUT_WIDTH,
                    visibility: modelFlyoutPos ? "visible" : "hidden",
                  }}
                  transition={{ duration: 0.12, ease: "easeOut" }}
                >
                  {COMPOSER_MODEL_GROUPS.map((group, groupIndex) => (
                    <div className="flex flex-col gap-px" key={group.label}>
                      {groupIndex > 0 ? (
                        <div className="agent-model-divider my-1" />
                      ) : null}
                      {group.models.map((option) => {
                        const selected = providerModel === option.model;
                        const locked = Boolean(
                          option.requiresPaidPlan && !hasPaidModelAccess,
                        );
                        return (
                          <div
                            className="agent-model-option-wrap"
                            key={option.model}
                            onMouseEnter={(event) =>
                              showModelHoverTip(option, event.currentTarget)
                            }
                            onMouseLeave={() => setModelHoverTip(null)}
                            onFocus={(event) =>
                              showModelHoverTip(option, event.currentTarget)
                            }
                            onBlur={() => setModelHoverTip(null)}
                          >
                            <button
                              aria-checked={selected}
                              aria-disabled={locked || undefined}
                              className={`agent-model-menu-item flex h-6 w-full items-center gap-1.5 rounded-[4px] px-2 text-left text-xs${
                                selected ? " is-selected" : ""
                              }${locked ? " is-locked" : ""}`}
                              disabled={
                                !option.provider || savingProvider || locked
                              }
                              onClick={(event) => {
                                if (
                                  locked ||
                                  !option.provider ||
                                  savingProvider
                                ) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  return;
                                }
                                closeComposerModelMenus();
                                onSelectModel(option);
                              }}
                              onPointerDown={(event) => {
                                if (!locked) return;
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              role="menuitemradio"
                              title={
                                locked
                                  ? "Add AI credits to use this model"
                                  : option.label
                              }
                              type="button"
                            >
                              <ComposerModelIcon
                                className={
                                  option.model.startsWith("gemini-")
                                    ? "size-[18px] shrink-0"
                                    : "size-4 shrink-0"
                                }
                                model={option.model}
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {option.label}
                              </span>
                              {option.requiresPaidPlan ? (
                                <PaidModelIcon />
                              ) : selected ? (
                                <Icon
                                  icon={Tick02Icon}
                                  className="shrink-0"
                                  size={14}
                                />
                              ) : null}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </motion.div>
              ) : null}

              {modelHoverTip ? (
                <ComposerModelHoverTip
                  caretOffsetY={modelHoverTip.caretOffsetY}
                  option={modelHoverTip.option}
                  side={modelHoverTip.side}
                  style={{
                    position: "fixed",
                    top: modelHoverTip.top,
                    left: modelHoverTip.left,
                    zIndex: 10060,
                  }}
                />
              ) : null}
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
