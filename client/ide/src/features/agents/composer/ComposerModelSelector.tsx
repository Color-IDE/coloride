import { useAvailableComposerModels } from "./useAvailableComposerModels";

import { MenuCheck } from "../../settings/SettingsControls";
import { createPortal } from "react-dom";
import {
  ComposerChevron,
  ComposerModelTrigger,
  ComposerModelToggle,
  ComposerModelRow,
  AnimatedComposerModelPanel as AnimatedModelPanel,
} from "../../../shared/ui/composer/ComposerModelControls";
import { PaidModelIcon } from "./ComposerModelDetails";
import { ComposerModelHoverTip } from "./ComposerModelHoverTip";
import { ComposerModelIcon } from "./ComposerModelIcon";
import { COMPOSER_MODELS, type ComposerModelOption } from "./modelCatalog";
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
  const groups = useAvailableComposerModels(composerModelOpen);
  const models = [
    ...groups.flatMap((group) => group.models),
    ...COMPOSER_MODELS,
  ];
  const reasoningAllowed =
    models.find((item) => item.model === providerModel)?.capabilities
      ?.reasoning !== false;
  return (
    <div className="relative" ref={composerModelRef}>
      <ComposerModelTrigger
        aria-expanded={composerModelOpen}
        aria-haspopup="menu"
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
          {models.find((item) => item.model === providerModel)?.label ??
            providerModel}
        </span>
        <ComposerChevron className={composerModelOpen ? "rotate-180" : ""} />
      </ComposerModelTrigger>
      {composerModelOpen
        ? createPortal(
            <>
              <AnimatedModelPanel
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
                <ComposerModelToggle
                  checked={autoModel}
                  label="Auto"
                  onChange={setAutoModel}
                />
                {!autoModel && (
                  <>
                    {reasoningAllowed &&
                      reasoningLevelsForModel(providerModel).length > 0 && (
                        <>
                          <div className="agent-model-divider" />
                          <div className="agent-model-label px-2 py-1 text-[11px] font-medium">
                            Reasoning Effort
                          </div>
                          {reasoningLevelsForModel(providerModel).map(
                            (level) => (
                              <ComposerModelRow
                                selected={composerReasoning === level.value}
                                key={level.value}
                                onClick={() =>
                                  setComposerReasoning(level.value)
                                }
                                role="menuitemradio"
                                type="button"
                              >
                                {level.label}
                              </ComposerModelRow>
                            ),
                          )}
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
                    {models.find((item) => item.model === providerModel)
                      ?.label ?? providerModel}
                  </span>
                  <ComposerChevron
                    className={`shrink-0 opacity-50 -rotate-90${
                      modelFlyoutPos?.side === "left" ? " rotate-90" : ""
                    }`}
                  />
                </button>
              </AnimatedModelPanel>

              {composerModelsFlyoutOpen ? (
                <AnimatedModelPanel
                  flyout
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
                  {!groups.length && (
                    <p className="px-2 py-2 text-xs opacity-60">
                      Add an API key in Settings to load models.
                    </p>
                  )}
                  {groups.map((group, groupIndex) => (
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
                                <MenuCheck />
                              ) : null}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </AnimatedModelPanel>
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
