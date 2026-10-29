import type { AgentMode } from "@coloride/contracts";
import { AnimatePresence, motion } from "motion/react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Menu, MenuItem, MenuSeparator } from "../../../shared/ui/Menu";
import { type AgentAccessLevel } from "../../settings/agentAccess";
import { ComposerModelSelector } from "./ComposerModelSelector";
import { formatContextTokens, type ComposerContextUsage } from "./contextUsage";
import { type ComposerModelOption } from "./modelCatalog";
import { type ComposerReasoning } from "./modelReasoning";
import { useComposerModelMenu } from "./useComposerModelMenu";
import { ComposerPlanBadge } from "../../../shared/ui/composer/ComposerPlanBadge";

/** Clip badges for non-default modes. Act is the normal mode and has no badge. */
const COMPOSER_MODE_BADGES: Partial<
  Record<AgentMode, { label: string; className: string }>
> = {
  ask: { label: "Ask", className: "is-ask" },
  plan: { label: "Plan", className: "is-plan" },
  debug: { label: "Debug", className: "is-debug" },
};

/** Tool-approval level (orthogonal to Ask/Plan/Debug submodes). */
export type { AgentAccessLevel } from "../../settings/agentAccess";

function workingModeForAccessLevel(level: AgentAccessLevel): AgentMode {
  void level;
  return "act";
}

function ComposerModeBadgeIcon({ mode }: { mode: AgentMode }) {
  if (mode === "ask") {
    return (
      <svg
        aria-hidden="true"
        className="shrink-0"
        fill="none"
        height="15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="15"
      >
        <path d="M21.5 12C21.5 17.2467 17.2467 21.5 12 21.5C10.3719 21.5 8.8394 21.0904 7.5 20.3687C5.63177 19.362 4.37462 20.2979 3.26592 20.4658C3.09774 20.4913 2.93024 20.4302 2.80997 20.31C2.62741 20.1274 2.59266 19.8451 2.6935 19.6074C3.12865 18.5818 3.5282 16.6382 2.98341 15C2.6698 14.057 2.5 13.0483 2.5 12C2.5 6.75329 6.75329 2.5 12 2.5C17.2467 2.5 21.5 6.75329 21.5 12Z" />
        <path d="M9.5 9.5C9.5 8.11929 10.6193 7 12 7C13.3807 7 14.5 8.11929 14.5 9.5C14.5 10.3569 14.0689 11.1131 13.4117 11.5636C12.7283 12.0319 12 12.6716 12 13.5" />
        <path d="M12.125 16.75H12M12.25 16.75C12.25 16.8881 12.1381 17 12 17C11.8619 17 11.75 16.8881 11.75 16.75C11.75 16.6119 11.8619 16.5 12 16.5C12.1381 16.5 12.25 16.6119 12.25 16.75Z" />
      </svg>
    );
  }
  if (mode === "plan") {
    return (
      <svg
        aria-hidden="true"
        className="shrink-0"
        fill="none"
        height="15"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="15"
      >
        <path d="M12.9961 6L20.9961 6" strokeLinecap="round" />
        <path d="M12.9961 12L20.9961 12" strokeLinecap="round" />
        <path d="M12.9961 18L20.9961 18" strokeLinecap="round" />
        <path
          d="M4.23073 19.3478C4.59827 19.5 5.06421 19.5 5.99609 19.5C6.92798 19.5 7.39392 19.5 7.76146 19.3478C8.25152 19.1448 8.64086 18.7554 8.84385 18.2654C8.99609 17.8978 8.99609 17.4319 8.99609 16.5C8.99609 15.5681 8.99609 15.1022 8.84385 14.7346C8.64086 14.2446 8.25152 13.8552 7.76146 13.6522C7.39392 13.5 6.92798 13.5 5.99609 13.5C5.06421 13.5 4.59827 13.5 4.23073 13.6522C3.74067 13.8552 3.35132 14.2446 3.14833 14.7346C2.99609 15.1022 2.99609 15.5681 2.99609 16.5C2.99609 17.4319 2.99609 17.8978 3.14833 18.2654C3.35132 18.7554 3.74067 19.1448 4.23073 19.3478Z"
          strokeLinejoin="round"
        />
        <path
          d="M2.99609 7.16667C2.99609 7.16667 3.74609 7.16667 4.49609 8.5C4.49609 8.5 6.87845 5.16667 8.99609 4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (mode === "debug") {
    return (
      <svg
        aria-hidden="true"
        className="shrink-0"
        fill="none"
        height="15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="15"
      >
        <path d="M3.01206 6.59744C2.89214 7.65674 3.6584 10.1951 5.87693 10.255" />
        <path d="M18.2891 10.195C19.3684 10.255 20.9873 8.99582 20.9873 6.59741" />
        <path d="M20.0876 20.9879C20.1476 19.6088 19.2482 17.4742 17.5093 17.4142" />
        <path d="M3.90138 20.9881C3.84009 19.5998 4.7594 17.4509 6.53675 17.3905" />
        <path d="M3.01227 13.7926H5.21757" />
        <path d="M21 13.7926L18.8282 13.7926" />
        <path d="M11.9932 13.7926V10.8546M16.4902 2.99982L14.6914 4.79862M7.49615 2.99982L9.29496 4.79862" />
        <path d="M6.95612 8.61209C8.57504 9.77532 12.5924 11.4542 16.9695 8.68404" />
        <path d="M16.826 7.6767C13.2523 2.7 8.69536 5.09841 7.07644 7.8206C6.02093 9.59542 4.37823 13.8886 7.49616 18.5655C10.8539 22.6667 14.8113 20.808 16.4302 18.6494C17.9892 16.7906 19.5242 11.9938 16.826 7.6767Z" />
      </svg>
    );
  }
  return null;
}

const MotionMenu = motion.create(Menu);
interface Props {
  composerActionsRef: RefObject<HTMLDivElement | null>;
  attachMenuRef: RefObject<HTMLDivElement | null>;
  attachMenuOpen: boolean;
  composerDisabled: boolean;
  setComposerModelOpen: Dispatch<SetStateAction<boolean>>;
  setComposerModelsFlyoutOpen: Dispatch<SetStateAction<boolean>>;
  setAttachMenuOpen: Dispatch<SetStateAction<boolean>>;
  modelMenu: ReturnType<typeof useComposerModelMenu>;
  providerModel: string;
  autoModel: boolean;
  hasPaidModelAccess: boolean;
  composerReasoning: ComposerReasoning;
  savingProvider: boolean;
  setAutoModel: (value: boolean) => void;
  setComposerReasoning: (value: ComposerReasoning) => void;
  onSelectModel: (option: ComposerModelOption) => void;
  contextUsage: ComposerContextUsage;
  setContextHoverTip: Dispatch<
    SetStateAction<{ top: number; left: number; label: string } | null>
  >;
  showContextHoverTip: (el: HTMLElement) => void;
  contextMeterRef: RefObject<HTMLSpanElement | null>;
  contextHoverTip: { top: number; left: number; label: string } | null;
  modeBadgeVisible: boolean;
  activeMode: AgentMode;
  modeLabelVisible: boolean;
  onChangeMode: (mode: AgentMode) => void;
  accessLevel: AgentAccessLevel;
  onChangeAccess: ((level: AgentAccessLevel) => void) | undefined;
  openFilePicker: (imagesOnly?: boolean) => void;
  primaryLabel: "Stop generating" | "Queue next message" | "Send";
  showStop: boolean;
  primaryDisabled: boolean;
  handlePrimaryAction: () => void;
}
export function ComposerToolbar({
  composerActionsRef,
  attachMenuRef,
  attachMenuOpen,
  composerDisabled,
  setComposerModelOpen,
  setComposerModelsFlyoutOpen,
  setAttachMenuOpen,
  modelMenu,
  providerModel,
  autoModel,
  hasPaidModelAccess,
  composerReasoning,
  savingProvider,
  setAutoModel,
  setComposerReasoning,
  onSelectModel,
  contextUsage,
  setContextHoverTip,
  showContextHoverTip,
  contextMeterRef,
  contextHoverTip,
  modeBadgeVisible,
  activeMode,
  modeLabelVisible,
  onChangeMode,
  accessLevel,
  onChangeAccess,
  openFilePicker,
  primaryLabel,
  showStop,
  primaryDisabled,
  handlePrimaryAction,
}: Props) {
  return (
    <div
      className="agent-centered-composer-actions flex h-[30px] shrink-0 items-center gap-1.5"
      ref={composerActionsRef}
    >
      <div
        className="relative flex h-[30px] items-center gap-1.5"
        ref={attachMenuRef}
      >
        <button
          aria-expanded={attachMenuOpen}
          aria-haspopup="menu"
          aria-label={
            attachMenuOpen ? "Close attachment menu" : "Add to message"
          }
          className="agent-composer-action flex items-center justify-center rounded-full"
          disabled={composerDisabled}
          onClick={() => {
            setComposerModelOpen(false);
            setComposerModelsFlyoutOpen(false);
            setAttachMenuOpen((open) => !open);
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
            style={{
              transform: attachMenuOpen ? "rotate(45deg)" : "rotate(0deg)",
            }}
            viewBox="0 0 24 24"
            width="16"
          >
            <path d="M11.9922 4.00012V20.0001M19.9922 12.0001H3.99222" />
          </svg>
        </button>

        <ComposerModelSelector
          {...modelMenu}
          providerModel={providerModel}
          autoModel={autoModel}
          hasPaidModelAccess={hasPaidModelAccess}
          composerReasoning={composerReasoning}
          savingProvider={savingProvider}
          setAutoModel={setAutoModel}
          setComposerReasoning={setComposerReasoning}
          onSelectModel={onSelectModel}
          setAttachMenuOpen={setAttachMenuOpen}
        />
        {/* Keep the context meter mounted once the chat has a real sample.
              Hiding it at an arbitrary 50% made it blink in/out as fresh
              estimates and provider usage arrived. */}
        {contextUsage.inputTokens > 0 ? (
          <span
            aria-label={`Context ${formatContextTokens(contextUsage.inputTokens)} of ${formatContextTokens(contextUsage.maxTokens)} tokens (${contextUsage.pct}%)`}
            className={`agent-composer-context${
              contextUsage.pct >= 85
                ? " is-high"
                : contextUsage.pct >= 70
                  ? " is-warn"
                  : ""
            }`}
            onBlur={() => setContextHoverTip(null)}
            onFocus={(event) => showContextHoverTip(event.currentTarget)}
            onMouseEnter={(event) => showContextHoverTip(event.currentTarget)}
            onMouseLeave={() => setContextHoverTip(null)}
            ref={contextMeterRef}
            tabIndex={0}
          >
            <span aria-hidden="true" className="agent-composer-context-ring">
              <svg height="14" viewBox="0 0 16 16" width="14">
                <circle
                  className="agent-composer-context-track"
                  cx="8"
                  cy="8"
                  r="5.5"
                />
                <circle
                  className="agent-composer-context-fill"
                  cx="8"
                  cy="8"
                  r="5.5"
                  style={{
                    strokeDasharray: `${(Math.min(100, contextUsage.pct) / 100) * 34.558} 34.558`,
                  }}
                />
              </svg>
            </span>
            <span className="agent-composer-context-label">
              {contextUsage.pct}%
            </span>
          </span>
        ) : null}
        {contextHoverTip
          ? createPortal(
              <div
                aria-hidden="true"
                className="agent-composer-context-tip is-portaled"
                role="tooltip"
                style={{ top: contextHoverTip.top, left: contextHoverTip.left }}
              >
                {contextHoverTip.label}
              </div>,
              document.body,
            )
          : null}
        <AnimatePresence mode="wait">
          {modeBadgeVisible && activeMode === "plan" ? (
            <ComposerPlanBadge
              key="plan"
              compact={!modeLabelVisible}
              onClear={() =>
                onChangeMode(workingModeForAccessLevel(accessLevel))
              }
            />
          ) : modeBadgeVisible && COMPOSER_MODE_BADGES[activeMode] ? (
            modeLabelVisible ? (
              <motion.span
                animate={{ opacity: 1, scale: 1, x: 0 }}
                className={`agent-composer-mode-badge ${COMPOSER_MODE_BADGES[activeMode]!.className}`}
                exit={{ opacity: 0, scale: 0.94, x: -4 }}
                initial={{ opacity: 0, scale: 0.94, x: -4 }}
                key={`${activeMode}-label`}
                transition={{ duration: 0.12, ease: "easeOut" }}
              >
                <ComposerModeBadgeIcon mode={activeMode} />
                {COMPOSER_MODE_BADGES[activeMode]!.label}
                <button
                  aria-label={`Clear ${COMPOSER_MODE_BADGES[activeMode]!.label} mode`}
                  className="agent-composer-mode-badge-clear"
                  onClick={() =>
                    onChangeMode(workingModeForAccessLevel(accessLevel))
                  }
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="14"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="14"
                  >
                    <path d="M18 6L12 12M12 12L6 18M12 12L18 18M12 12L6 6" />
                  </svg>
                </button>
              </motion.span>
            ) : (
              <motion.button
                animate={{ opacity: 1, scale: 1, x: 0 }}
                aria-label={`Clear ${COMPOSER_MODE_BADGES[activeMode]!.label} mode`}
                className={`agent-composer-mode-badge is-icon-only ${COMPOSER_MODE_BADGES[activeMode]!.className}`}
                exit={{ opacity: 0, scale: 0.94, x: -4 }}
                initial={{ opacity: 0, scale: 0.94, x: -4 }}
                key={`${activeMode}-icon`}
                onClick={() =>
                  onChangeMode(workingModeForAccessLevel(accessLevel))
                }
                title={`${COMPOSER_MODE_BADGES[activeMode]!.label} — click to exit`}
                transition={{ duration: 0.12, ease: "easeOut" }}
                type="button"
              >
                <ComposerModeBadgeIcon mode={activeMode} />
              </motion.button>
            )
          ) : null}
        </AnimatePresence>
        <AnimatePresence mode="wait">
          {modeBadgeVisible &&
          accessLevel === "full" &&
          activeMode === "act" ? (
            <motion.span
              animate={{ opacity: 1, scale: 1, x: 0 }}
              className="agent-composer-mode-badge is-full"
              exit={{ opacity: 0, scale: 0.94, x: -4 }}
              initial={{ opacity: 0, scale: 0.94, x: -4 }}
              key="full-access"
              transition={{ duration: 0.12, ease: "easeOut" }}
            >
              <svg
                aria-hidden="true"
                className="shrink-0"
                fill="none"
                height="15"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                width="15"
              >
                <path d="M15.5 11L8.5 11" />
                <path d="M18.7088 3.49534C16.8165 2.55382 14.5009 2 12 2C9.4991 2 7.1835 2.55382 5.29116 3.49534C4.36318 3.95706 3.89919 4.18792 3.4496 4.91378C3 5.63965 3 6.34248 3 7.74814V11.2371C3 16.9205 7.54236 20.0804 10.173 21.4338C10.9067 21.8113 11.2735 22 12 22C12.7265 22 13.0933 21.8113 13.8269 21.4338C16.4576 20.0804 21 16.9205 21 11.2371L21 7.74814C21 6.34249 21 5.63966 20.5504 4.91378C20.1008 4.18791 19.6368 3.95706 18.7088 3.49534Z" />
              </svg>
              {modeLabelVisible ? "Full access" : null}
              <button
                aria-label="Turn off full access"
                className="agent-composer-mode-badge-clear"
                onClick={() => onChangeAccess?.("agent")}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <path d="M18 6L12 12M12 12L6 18M12 12L18 18M12 12L6 6" />
                </svg>
              </button>
            </motion.span>
          ) : null}
        </AnimatePresence>
        <AnimatePresence>
          {attachMenuOpen && (
            <MotionMenu
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="absolute bottom-[calc(100%+4px)] left-0 z-40 w-44"
              exit={{ opacity: 0, y: 5, scale: 0.98 }}
              initial={{ opacity: 0, y: 5, scale: 0.98 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
            >
              <MenuItem
                compact
                onClick={() => {
                  setAttachMenuOpen(false);
                  onChangeMode(
                    activeMode === "ask"
                      ? workingModeForAccessLevel(accessLevel)
                      : "ask",
                  );
                }}
              >
                <svg
                  aria-hidden="true"
                  className="shrink-0"
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <path d="M21.5 12C21.5 17.2467 17.2467 21.5 12 21.5C10.3719 21.5 8.8394 21.0904 7.5 20.3687C5.63177 19.362 4.37462 20.2979 3.26592 20.4658C3.09774 20.4913 2.93024 20.4302 2.80997 20.31C2.62741 20.1274 2.59266 19.8451 2.6935 19.6074C3.12865 18.5818 3.5282 16.6382 2.98341 15C2.6698 14.057 2.5 13.0483 2.5 12C2.5 6.75329 6.75329 2.5 12 2.5C17.2467 2.5 21.5 6.75329 21.5 12Z" />
                  <path d="M9.5 9.5C9.5 8.11929 10.6193 7 12 7C13.3807 7 14.5 8.11929 14.5 9.5C14.5 10.3569 14.0689 11.1131 13.4117 11.5636C12.7283 12.0319 12 12.6716 12 13.5" />
                  <path d="M12.125 16.75H12M12.25 16.75C12.25 16.8881 12.1381 17 12 17C11.8619 17 11.75 16.8881 11.75 16.75C11.75 16.6119 11.8619 16.5 12 16.5C12.1381 16.5 12.25 16.6119 12.25 16.75Z" />
                </svg>
                Ask
              </MenuItem>
              <MenuItem
                compact
                onClick={() => {
                  setAttachMenuOpen(false);
                  onChangeMode(
                    activeMode === "plan"
                      ? workingModeForAccessLevel(accessLevel)
                      : "plan",
                  );
                }}
              >
                <svg
                  aria-hidden="true"
                  className="shrink-0"
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <path d="M12.9961 6L20.9961 6" strokeLinecap="round" />
                  <path d="M12.9961 12L20.9961 12" strokeLinecap="round" />
                  <path d="M12.9961 18L20.9961 18" strokeLinecap="round" />
                  <path
                    d="M4.23073 19.3478C4.59827 19.5 5.06421 19.5 5.99609 19.5C6.92798 19.5 7.39392 19.5 7.76146 19.3478C8.25152 19.1448 8.64086 18.7554 8.84385 18.2654C8.99609 17.8978 8.99609 17.4319 8.99609 16.5C8.99609 15.5681 8.99609 15.1022 8.84385 14.7346C8.64086 14.2446 8.25152 13.8552 7.76146 13.6522C7.39392 13.5 6.92798 13.5 5.99609 13.5C5.06421 13.5 4.59827 13.5 4.23073 13.6522C3.74067 13.8552 3.35132 14.2446 3.14833 14.7346C2.99609 15.1022 2.99609 15.5681 2.99609 16.5C2.99609 17.4319 2.99609 17.8978 3.14833 18.2654C3.35132 18.7554 3.74067 19.1448 4.23073 19.3478Z"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M2.99609 7.16667C2.99609 7.16667 3.74609 7.16667 4.49609 8.5C4.49609 8.5 6.87845 5.16667 8.99609 4.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Plan
              </MenuItem>
              <MenuItem
                compact
                onClick={() => {
                  setAttachMenuOpen(false);
                  onChangeMode(
                    activeMode === "debug"
                      ? workingModeForAccessLevel(accessLevel)
                      : "debug",
                  );
                }}
              >
                <svg
                  aria-hidden="true"
                  className="shrink-0"
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <path d="M3.01206 6.59744C2.89214 7.65674 3.6584 10.1951 5.87693 10.255" />
                  <path d="M18.2891 10.195C19.3684 10.255 20.9873 8.99582 20.9873 6.59741" />
                  <path d="M20.0876 20.9879C20.1476 19.6088 19.2482 17.4742 17.5093 17.4142" />
                  <path d="M3.90138 20.9881C3.84009 19.5998 4.7594 17.4509 6.53675 17.3905" />
                  <path d="M3.01227 13.7926H5.21757" />
                  <path d="M21 13.7926L18.8282 13.7926" />
                  <path d="M11.9932 13.7926V10.8546M16.4902 2.99982L14.6914 4.79862M7.49615 2.99982L9.29496 4.79862" />
                  <path d="M6.95612 8.61209C8.57504 9.77532 12.5924 11.4542 16.9695 8.68404" />
                  <path d="M16.826 7.6767C13.2523 2.7 8.69536 5.09841 7.07644 7.8206C6.02093 9.59542 4.37823 13.8886 7.49616 18.5655C10.8539 22.6667 14.8113 20.808 16.4302 18.6494C17.9892 16.7906 19.5242 11.9938 16.826 7.6767Z" />
                </svg>
                Debug
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                compact
                disabled={composerDisabled}
                onClick={() => openFilePicker(true)}
              >
                <svg
                  aria-hidden="true"
                  className="shrink-0"
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <circle
                    cx="7.5"
                    cy="7.5"
                    r="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z" />
                  <path d="M5 21C9.37246 15.775 14.2741 8.88406 21.4975 13.5424" />
                </svg>
                Image
              </MenuItem>
              <MenuItem
                compact
                disabled={composerDisabled}
                onClick={() => openFilePicker(false)}
              >
                <svg
                  aria-hidden="true"
                  className="shrink-0"
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <path d="M18.1688 12L19.713 10.4558C21.4186 8.75022 21.4186 5.98485 19.713 4.27922C18.0073 2.57359 15.242 2.57359 13.5363 4.27922L4.27141 13.5442C2.56578 15.2498 2.56578 18.0152 4.27141 19.7208C5.97704 21.4264 8.7424 21.4264 10.448 19.7208L13.9224 16.2464C14.9884 15.1804 14.9884 13.4521 13.9224 12.386C12.8564 11.32 11.128 11.32 10.062 12.386L8.1318 14.3162" />
                </svg>
                File
              </MenuItem>
            </MotionMenu>
          )}
        </AnimatePresence>
      </div>
      <button
        aria-label={primaryLabel}
        className={`agent-send-button agent-send-button-centered is-${activeMode}${showStop ? " is-stop" : ""} ml-auto shrink-0`}
        disabled={primaryDisabled}
        onClick={handlePrimaryAction}
        type="button"
      >
        {showStop ? (
          <span aria-hidden="true" className="agent-send-stop-mark" />
        ) : (
          <svg
            aria-hidden="true"
            fill="none"
            height="22"
            viewBox="0 0 24 24"
            width="22"
          >
            <path
              d="M12 20V4m-7 7l7-7l7 7"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
