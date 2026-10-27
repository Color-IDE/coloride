import {
  BubbleChatQuestionIcon,
  Bug01Icon,
  CheckListIcon,
  File01Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import githubMark from "../../shared/assets/complements/github.svg";
import linearMark from "../../shared/assets/complements/linear.svg";
import { Icon } from "../../shared/ui/Icon";
import type { IconSvgElement } from "../../shared/ui/Icon";
import {
  splitSlashCommands,
  type AgentPluginChoice,
  type SlashCommandDef,
  type SlashCommandId,
} from "./slashCommands";

const SLASH_ICONS: Partial<Record<SlashCommandId, IconSvgElement>> = {
  plan: CheckListIcon,
  ask: BubbleChatQuestionIcon,
  debug: Bug01Icon,
  log: File01Icon,
};

export function SlashCommandMenu({
  activeIndex,
  commands,
  onHover,
  onSelect,
  query = "",
}: {
  activeIndex: number;
  commands: readonly SlashCommandDef[];
  onHover: (index: number) => void;
  onSelect: (command: SlashCommandDef) => void;
  query?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [fadeEdges, setFadeEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
      if (maxScroll <= 1) {
        setFadeEdges({ top: false, bottom: false });
        return;
      }
      setFadeEdges({
        top: list.scrollTop > 2,
        bottom: list.scrollTop < maxScroll - 2,
      });
    };
    update();
    const raf = requestAnimationFrame(update);
    list.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(list);
    return () => {
      cancelAnimationFrame(raf);
      list.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [commands.length]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>("[aria-selected='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, commands.length]);

  const { recent, rest, rows } = splitSlashCommands(commands, query);

  if (!rows.length) {
    return (
      <div className="agent-slash-menu" role="listbox" aria-label="Slash commands">
        <div className="agent-slash-empty">No matching command</div>
      </div>
    );
  }

  const renderRow = (command: SlashCommandDef, index: number) => {
    const active = index === activeIndex;
    return (
      <button
        aria-selected={active}
        className={`agent-slash-item${active ? " is-active" : ""}`}
        key={`${command.id}-${index}`}
        onMouseDown={(event) => {
          event.preventDefault();
          onSelect(command);
        }}
        onMouseEnter={() => onHover(index)}
        role="option"
        type="button"
      >
        <span className="agent-slash-item-left">
          {command.id === "run-everything" ? (
            <RunEverythingIcon />
          ) : command.id === "fork" ? (
            <ForkIcon />
          ) : command.id === "summarize" ? (
            <SummarizeIcon />
          ) : command.id === "shell" || command.id === "canvas" ? (
            <ShellIcon />
          ) : command.id === "add-plugin" || command.id === "remove-plugin" ? (
            <PluginBoxIcon />
          ) : (
            <Icon
              className={`agent-slash-item-icon${
                command.id === "ask" || command.id === "plan" || command.id === "debug"
                  ? ` is-${command.id}`
                  : ""
              }`}
              icon={SLASH_ICONS[command.id] ?? File01Icon}
              size={14}
              strokeWidth={1.8}
            />
          )}
          <span className="agent-slash-item-name">{command.name}</span>
        </span>
        <span className="agent-slash-item-desc">{command.description}</span>
      </button>
    );
  };

  return (
    <div className="agent-slash-menu" role="listbox" aria-label="Slash commands">
      <div
        aria-hidden="true"
        className={`scroll-edge-fade agent-slash-fade agent-slash-fade-top${fadeEdges.top ? " is-visible" : ""}`}
        data-edge="top"
      />
      <div className="agent-slash-menu-list" ref={listRef}>
        {recent.length ? (
          <>
            <div className="agent-slash-heading">Recent</div>
            {recent.map((command, index) => renderRow(command, index))}
            {rest.length ? <div aria-hidden="true" className="agent-slash-separator" /> : null}
          </>
        ) : null}
        {rest.map((command, index) => renderRow(command, recent.length + index))}
      </div>
      <div
        aria-hidden="true"
        className={`scroll-edge-fade agent-slash-fade agent-slash-fade-bottom${fadeEdges.bottom ? " is-visible" : ""}`}
        data-edge="bottom"
      />
    </div>
  );
}

export function pluginArtworkSrc(id: string): string | undefined {
  if (id === "linear") return linearMark;
  if (id === "github") return githubMark;
  return undefined;
}

export function PluginConfirmCard({
  mode,
  onBrowse,
  onCancel,
  onConfirm,
  plugin,
}: {
  mode: "add" | "remove";
  onBrowse?: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  plugin: AgentPluginChoice;
}) {
  const artwork = pluginArtworkSrc(plugin.id);
  return (
    <div className="agent-plugin-confirm" role="dialog" aria-label={`${mode === "add" ? "Add" : "Remove"} ${plugin.name}`}>
      <div className="agent-plugin-confirm-top">
        {artwork ? (
          <img alt="" className="agent-plugin-confirm-mark" src={artwork} />
        ) : (
          <span className="agent-plugin-confirm-mark is-fallback">
            <PluginBoxIcon />
          </span>
        )}
        <div className="agent-plugin-confirm-copy">
          <div className="agent-plugin-confirm-name">{plugin.name}</div>
          <div className="agent-plugin-confirm-meta">Coloride · Complement</div>
        </div>
      </div>
      <p className="agent-plugin-confirm-desc">
        {plugin.description}
        {onBrowse ? (
          <>
            {" "}
            <button className="agent-plugin-confirm-details" onClick={onBrowse} type="button">
              View details
            </button>
          </>
        ) : null}
      </p>
      <div className="agent-plugin-confirm-actions">
        <button className="agent-plugin-confirm-cancel" onClick={onCancel} type="button">
          Cancel
          <kbd>Esc</kbd>
        </button>
        <button className="agent-plugin-confirm-add" onClick={onConfirm} type="button">
          {mode === "add" ? "Add Plugin" : "Remove Plugin"}
        </button>
      </div>
    </div>
  );
}

export function PluginAddedBar({
  onBrowse,
  onTry,
  plugin,
}: {
  onBrowse?: () => void;
  onTry: () => void;
  plugin: AgentPluginChoice;
}) {
  const artwork = pluginArtworkSrc(plugin.id);
  return (
    <div className="agent-plugin-added" role="status">
      <div className="agent-plugin-added-left">
        {artwork ? (
          <img alt="" className="agent-plugin-added-mark" src={artwork} />
        ) : (
          <span className="agent-plugin-added-mark is-fallback">
            <PluginBoxIcon />
          </span>
        )}
        <span className="agent-plugin-added-label">Added {plugin.name}</span>
      </div>
      <div className="agent-plugin-added-actions">
        {onBrowse ? (
          <button className="agent-plugin-added-details" onClick={onBrowse} type="button">
            Details
          </button>
        ) : null}
        <button className="agent-plugin-added-try" onClick={onTry} type="button">
          Try in Chat
        </button>
      </div>
    </div>
  );
}

export function PluginPickMenu({
  activeIndex,
  mode,
  onBrowse,
  onHover,
  onSelect,
  plugins,
}: {
  activeIndex: number;
  mode: "add" | "remove";
  onBrowse?: () => void;
  onHover: (index: number) => void;
  onSelect: (plugin: AgentPluginChoice) => void;
  plugins: readonly AgentPluginChoice[];
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>("[aria-selected='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, plugins.length]);

  return (
    <div
      className="agent-slash-menu agent-plugin-pick-menu"
      role="listbox"
      aria-label={mode === "add" ? "Add plugin" : "Remove plugin"}
    >
      <div className="agent-slash-menu-list agent-plugin-pick-list" ref={listRef}>
        {plugins.length ? (
          plugins.map((plugin, index) => {
            const active = index === activeIndex;
            const artwork = pluginArtworkSrc(plugin.id);
            return (
              <button
                aria-selected={active}
                className={`agent-plugin-pick-item${active ? " is-active" : ""}`}
                key={plugin.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(plugin);
                }}
                onMouseEnter={() => onHover(index)}
                role="option"
                type="button"
              >
                {artwork ? (
                  <img alt="" className="agent-plugin-pick-mark" src={artwork} />
                ) : (
                  <span className="agent-plugin-pick-mark is-fallback">
                    <PluginBoxIcon />
                  </span>
                )}
                <span className="agent-plugin-pick-copy">
                  <span className="agent-plugin-pick-title">
                    <span className="agent-plugin-pick-name">{plugin.name}</span>
                    <span className="agent-plugin-pick-id">{plugin.id}</span>
                  </span>
                  <span className="agent-plugin-pick-desc">{plugin.description}</span>
                </span>
              </button>
            );
          })
        ) : (
          <div className="agent-slash-empty">
            {mode === "add" ? "All plugins are already in this chat" : "No plugins in this chat"}
          </div>
        )}
      </div>
      {mode === "add" && onBrowse ? (
        <button
          className="agent-plugin-pick-browse"
          onMouseDown={(event) => {
            event.preventDefault();
            onBrowse();
          }}
          type="button"
        >
          Browse Complements
        </button>
      ) : null}
    </div>
  );
}

function PluginBoxIcon() {
  return (
    <svg
      aria-hidden="true"
      className="agent-slash-item-icon"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M2.5 7.5V13.5C2.5 17.2712 2.5 19.1569 3.67157 20.3284C4.84315 21.5 6.72876 21.5 10.5 21.5H13.5C17.2712 21.5 19.1569 21.5 20.3284 20.3284C21.5 19.1569 21.5 17.2712 21.5 13.5V7.5" />
      <path d="M3.86909 5.31461L2.5 7.5H21.5L20.2478 5.41303C19.3941 3.99021 18.9673 3.2788 18.2795 2.8894C17.5918 2.5 16.7621 2.5 15.1029 2.5H8.95371C7.32998 2.5 6.51812 2.5 5.84013 2.8753C5.16215 3.2506 4.73113 3.93861 3.86909 5.31461Z" />
      <path d="M12 7.5V2.5" />
      <path d="M6 18H11M6 15H9" />
    </svg>
  );
}

function ShellIcon() {
  return (
    <svg
      aria-hidden="true"
      className="agent-slash-item-icon"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M21 13.6376V10.3624C21 8.71559 21 7.89217 20.6166 7.20744C20.2332 6.52271 19.5317 6.09334 18.1287 5.2346L15.1287 3.39836C13.6056 2.46612 12.8441 2 12 2C11.1559 2 10.3944 2.46612 8.8713 3.39836L5.8713 5.2346C4.46832 6.09334 3.76683 6.52271 3.38341 7.20744C3 7.89217 3 8.71559 3 10.3624V13.6376C3 15.2844 3 16.1078 3.38341 16.7926C3.76683 17.4773 4.46832 17.9067 5.8713 18.7654L8.8713 20.6016C10.3944 21.5339 11.1559 22 12 22C12.8441 22 13.6056 21.5339 15.1287 20.6016L18.1287 18.7654C19.5317 17.9067 20.2332 17.4773 20.6166 16.7926C21 16.1078 21 15.2844 21 13.6376Z" />
      <path d="M3.5 7L12 12L20.5 7" />
      <path d="M12 12V22" />
    </svg>
  );
}

function SummarizeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="agent-slash-item-icon is-filled"
      fill="currentColor"
      height="12"
      viewBox="0 0 576 576"
      width="12"
    >
      <path
        clipRule="evenodd"
        d="M403.492 171.903C399.756 172.164 396.903 176.335 393.952 178.775C386.916 184.59 379.63 189.981 371.811 194.718C351.804 206.85 328.922 213.929 305.768 216.662C234.967 225.015 164.546 179.385 141.697 112.289C136.688 97.5658 134.052 82.9728 132.887 67.4868C132.255 59.025 132.092 50.4108 138.005 43.6697C144.431 36.3514 161.747 29.4579 170.841 25.3414C203.601 10.5088 240.554 1.36093 276.559 0.565936C291.675 0.239227 318.979 -3.75751 324.707 15.3005C328.367 27.5085 320.166 37.9414 314.241 47.8952C306.912 60.223 300.138 72.8993 292.786 85.2053C287.559 93.9611 280.883 103.174 278.28 113.139C273.281 132.273 283.769 154.707 302.98 161.198C307.424 162.712 312.172 163.757 316.855 163.779C344.834 163.899 353.721 140.386 365.625 119.924C374.969 103.849 384.313 87.7645 393.636 71.6687C402.131 56.9885 411.638 30.438 433.878 40.1848C442.046 43.7568 449.778 50.0188 456.934 55.2788C482.004 73.7269 503.764 95.6491 522.061 120.838C530.741 132.785 544.649 149.48 532.647 163.92C526.33 171.522 509.449 178.775 500.519 184.002C484.455 193.4 468.238 202.537 452.229 212.023C445.171 216.205 437.722 219.853 430.839 224.329C412.836 236.036 405.964 260.822 417.759 279.51C427.801 295.41 447.066 302.173 464.96 296.629C472.802 294.201 479.99 289.05 487.014 284.89C499.593 277.452 512.39 270.308 525.045 262.978C539.127 254.822 558.262 240.12 571.342 258.818C577.615 267.781 575.938 291.663 575.35 302.586C573.379 339.809 564.612 377.773 548.036 411.282C543.168 421.127 538.474 436.101 527.8 441.046C520.667 444.356 512.826 443.224 505.267 442.701C489.802 441.623 474.86 438.497 460.353 433.019C387.885 405.652 346.359 330.792 361.116 254.691C365.298 233.128 374.675 211.859 387.537 194.076C391.327 188.848 395.291 183.784 399.648 179.014C401.804 176.662 404.45 175.105 403.492 171.903ZM172.355 403.866C176.08 403.735 178.574 400.022 181.525 397.572C187.722 392.431 194.061 387.476 200.933 383.251C220.449 371.282 241.893 363.234 264.59 359.946C335.762 349.654 408.578 392.42 433.137 460.256C438.92 476.221 442.1 492.241 443.178 509.175C443.701 517.495 443.799 525.511 438.125 532.176C431.972 539.428 414.22 546.562 405.289 550.558C372.137 565.445 335.773 574.201 299.43 575.366C284.117 575.867 257.01 579.657 251.216 560.534C247.524 548.348 255.888 537.817 261.791 527.896C270.21 513.749 278.258 499.374 286.459 485.108C291.175 476.885 296.979 468.718 298.46 459.145C301.325 440.49 290.586 420.223 272.05 414.441C267.607 413.058 262.717 411.947 258.044 412.067C230.567 412.774 222.366 435.949 210.44 455.922C200.922 471.876 191.708 488.059 182.473 504.198C174.185 518.704 163.915 546.05 141.926 535.726C134.041 532.023 126.537 526.24 119.545 521.078C94.4636 502.587 72.7363 480.839 54.3416 455.671C45.4329 443.474 31.2312 426.681 43.3854 411.892C48.8853 405.217 67.3562 396.493 75.557 391.821C97.5021 379.33 119.121 366.295 141.12 353.901C161.638 342.347 171.201 318.464 158.545 296.989C148.842 280.534 129.064 273.956 111.072 279.27C103.209 281.601 96.0972 286.937 89.0508 290.988C75.7095 298.677 62.4662 306.605 48.9833 314.054C35.0321 321.775 17.4869 335.747 4.51589 317.038C-1.583 308.26 0.094194 284.955 0.584283 274.272C2.28326 237.081 11.1484 198.758 27.6372 165.282C32.3747 155.644 38.0706 139.515 48.319 134.843C54.8099 131.892 61.6821 132.752 68.5433 133.101C84.8905 133.939 101.129 137.174 116.376 143.196C188.071 171.522 229.87 244.715 214.917 321.089C210.669 342.782 201.314 363.779 188.582 381.813C184.88 387.062 180.752 392.105 176.407 396.831C174.326 399.107 171.713 400.73 172.355 403.866Z"
        fillRule="evenodd"
      />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg
      aria-hidden="true"
      className="agent-slash-item-icon"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M21 8.5V6.6C21 4.90294 21 4.05442 20.4728 3.52721C19.9456 3 19.0971 3 17.4 3H15.5M20 4L14.5 9.5" />
      <path d="M3 8.5V6.6C3 4.90294 3 4.05442 3.52721 3.52721C4.05442 3 4.90294 3 6.6 3H8.5M4 4L9.65686 9.65686C10.813 10.813 11.391 11.391 11.6955 12.1261C12 12.8612 12 13.6787 12 15.3137V21" />
    </svg>
  );
}

function RunEverythingIcon() {
  return (
    <svg
      aria-hidden="true"
      className="agent-slash-item-icon"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M15.5 11L8.5 11" />
      <path d="M18.7088 3.49534C16.8165 2.55382 14.5009 2 12 2C9.4991 2 7.1835 2.55382 5.29116 3.49534C4.36318 3.95706 3.89919 4.18792 3.4496 4.91378C3 5.63965 3 6.34248 3 7.74814V11.2371C3 16.9205 7.54236 20.0804 10.173 21.4338C10.9067 21.8113 11.2735 22 12 22C12.7265 22 13.0933 21.8113 13.8269 21.4338C16.4576 20.0804 21 16.9205 21 11.2371L21 7.74814C21 6.34249 21 5.63966 20.5504 4.91378C20.1008 4.18791 19.6368 3.95706 18.7088 3.49534Z" />
    </svg>
  );
}
