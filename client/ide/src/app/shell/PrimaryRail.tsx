import { useRef, useState } from "react";

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

const ExplorerIcon = (props: { size?: number; className?: string }) => (
  <svg
    aria-hidden="true"
    className={props.className}
    fill="none"
    height={props.size ?? 24}
    viewBox="0 0 24 24"
    width={props.size ?? 24}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M10 9.5L8.20711 11.2929C7.81658 11.6834 7.81658 12.3166 8.20711 12.7071L10 14.5M14 9.5L15.7929 11.2929C16.1834 11.6834 16.1834 12.3166 15.7929 12.7071L14 14.5M7 20H17C18.6569 20 20 18.6569 20 17V7C20 5.34315 18.6569 4 17 4H7C5.34315 4 4 5.34315 4 7V17C4 18.6569 5.34315 20 7 20Z"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
);

const ExplorerIconActive = (props: { size?: number; className?: string }) => (
  <svg
    aria-hidden="true"
    className={props.className}
    fill="currentColor"
    height={props.size ?? 24}
    viewBox="0 0 24 24"
    width={props.size ?? 24}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      clipRule="evenodd"
      d="M3 7C3 4.79086 4.79086 3 7 3H17C19.2091 3 21 4.79086 21 7V17C21 19.2091 19.2091 21 17 21H7C4.79086 21 3 19.2091 3 17V7ZM10.7071 8.79289C11.0976 9.18342 11.0976 9.81658 10.7071 10.2071L8.91421 12L10.7071 13.7929C11.0976 14.1834 11.0976 14.8166 10.7071 15.2071C10.3166 15.5976 9.68342 15.5976 9.29289 15.2071L7.5 13.4142C6.71895 12.6332 6.71895 11.3668 7.5 10.5858L9.29289 8.79289C9.68342 8.40237 10.3166 8.40237 10.7071 8.79289ZM14.7071 8.79289C14.3166 8.40237 13.6834 8.40237 13.2929 8.79289C12.9024 9.18342 12.9024 9.81658 13.2929 10.2071L15.0858 12L13.2929 13.7929C12.9024 14.1834 12.9024 14.8166 13.2929 15.2071C13.6834 15.5976 14.3166 15.5976 14.7071 15.2071L16.5 13.4142C17.281 12.6332 17.281 11.3668 16.5 10.5858L14.7071 8.79289Z"
      fillRule="evenodd"
    />
  </svg>
);

const AgentsIcon = (props: { size?: number; className?: string }) => (
  <svg
    aria-hidden="true"
    className={props.className}
    fill="none"
    height={props.size ?? 24}
    viewBox="0 0 24 24"
    width={props.size ?? 24}
    xmlns="http://www.w3.org/2000/svg"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    role="img"
    aria-label="chat-chatting icon"
  >
    <path
      d="m17.05 18.718 1.74.124c.762.055 1.143.082 1.428-.053a1.2 1.2 0 0 0 .57-.57c.136-.286.109-.667.054-1.429l-.124-1.74c-.02-.28-.03-.42-.032-.562-.004-.258-.007-.122.009-.38.009-.142.088-.811.248-2.15Q21 11.486 21 11A8 8 0 0 0 6.385 6.5m7.415 9.1a5.4 5.4 0 1 0-10.733.856c.096.6.144.9.152.992.012.139.011.107.01.247 0 .093-.008.204-.023.427l-.1 1.386c-.036.515-.055.772.037.964a.8.8 0 0 0 .385.385c.192.091.45.073.964.036l1.385-.099c.224-.015.335-.024.428-.024.14 0 .108-.001.247.011.093.008.393.056.992.152Q7.963 21 8.4 21a5.39 5.39 0 0 0 4.203-2.01A5.38 5.38 0 0 0 13.8 15.6Z"
      fill="none"
    />
  </svg>
);

const AgentsIconActive = (props: { size?: number; className?: string }) => (
  <svg
    aria-hidden="true"
    className={props.className}
    height={props.size ?? 24}
    viewBox="0 0 24 24"
    width={props.size ?? 24}
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="chat-chatting icon"
    fill="currentColor"
  >
    <path d="M22 11A9 9 0 0 0 4.448 8.187a8.4 8.4 0 0 1 11.26 11.556l.418-.046.034-.003.01-.001.129-.008.01-.001.013-.001h.023l.129.003c.108.001.215.009.505.03l1.777.126c.35.025.672.048.942.044a2.2 2.2 0 0 0 .949-.194 2.2 2.2 0 0 0 1.045-1.045c.156-.33.19-.66.194-.95a12 12 0 0 0-.044-.941l-.127-1.777a9 9 0 0 1-.03-.505l-.002-.128h0v-.038l.002-.01.008-.128v-.01l.004-.034.012-.118q.015-.149.047-.41c.04-.35.1-.847.18-1.512v-.01A9 9 0 0 0 22 11Z" />
    <path d="M8.4 9.2a6.38 6.38 0 0 0-4.252 1.616 6.39 6.39 0 0 0-2.069 5.797c.048.301.084.523.108.682l.035.241.004.043.003.032v.082c0 .05-.004.118-.021.358l-.102 1.419c-.016.229-.033.46-.03.656.003.215.029.492.163.775.178.377.482.681.86.86.282.134.56.16.775.163a8 8 0 0 0 .656-.03l1.418-.102c.24-.017.31-.021.36-.022h.081l.074.007h0l.059.008.183.028.681.107Q7.883 22 8.4 22a6.4 6.4 0 0 0 4.784-2.148A6.4 6.4 0 0 0 8.4 9.2Z" />
  </svg>
);

const SettingsIcon = (props: { size?: number; className?: string }) => (
  <svg
    aria-hidden="true"
    className={props.className}
    fill="none"
    height={props.size ?? 24}
    viewBox="0 0 24 24"
    width={props.size ?? 24}
    xmlns="http://www.w3.org/2000/svg"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    role="img"
    aria-label="filter-horizontal icon"
  >
    <path
      d="M3 7h7m0 0a3 3 0 0 0 3 3h1a3 3 0 1 0 0-6h-1a3 3 0 0 0-3 3Zm6 10h5M20 7h1M3 17h3m0 0a3 3 0 0 0 3 3h1a3 3 0 1 0 0-6H9a3 3 0 0 0-3 3Z"
      fill="none"
    />
  </svg>
);

const SettingsIconActive = (props: { size?: number; className?: string }) => (
  <svg
    aria-hidden="true"
    className={props.className}
    height={props.size ?? 24}
    viewBox="0 0 24 24"
    width={props.size ?? 24}
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="filter-horizontal icon"
    fill="currentColor"
  >
    <path d="M13 3a4 4 0 0 0-3.874 3H3a1 1 0 0 0 0 2h6.126c.444 1.725 2.01 3 3.874 3h1a4 4 0 0 0 0-8z" />
    <path d="M20 6a1 1 0 1 0 0 2h1a1 1 0 1 0 0-2z" />
    <path d="M9 13a4 4 0 0 0-3.874 3H3a1 1 0 1 0 0 2h2.126c.444 1.725 2.01 3 3.874 3h1a4 4 0 0 0 0-8z" />
    <path d="M16 16a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2z" />
  </svg>
);

const tabs = [
  {
    id: "explorer",
    label: "Explorer",
    icon: ExplorerIcon,
    activeIcon: ExplorerIconActive,
    requiresVps: true,
  },
  {
    id: "agents",
    label: "Agents",
    icon: AgentsIcon,
    activeIcon: AgentsIconActive,
    requiresVps: true,
  },
  {
    id: "settings",
    label: "Settings",
    icon: SettingsIcon,
    activeIcon: SettingsIconActive,
    requiresVps: false,
  },
] as const;

interface PrimaryRailProps {
  activeTab: string | null;
  /** When false, Explorer / Server / Agents look disabled (gray). */
  serverConnected?: boolean;
  onSelectTab: (tab: string) => void;
}

export function PrimaryRail({
  activeTab,
  serverConnected = false,
  onSelectTab,
}: PrimaryRailProps) {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [isHiding, setIsHiding] = useState(false);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipExitTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = (text: string, event: React.MouseEvent<HTMLElement>) => {
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    if (tooltipExitTimeout.current) {
      clearTimeout(tooltipExitTimeout.current);
      tooltipExitTimeout.current = null;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (tooltip) {
      setIsHiding(true);
      tooltipExitTimeout.current = setTimeout(() => {
        setTooltip(null);
        setIsHiding(false);
        tooltipExitTimeout.current = null;
      }, 150);
    } else {
      setIsHiding(false);
    }

    tooltipTimeout.current = setTimeout(() => {
      setIsHiding(false);
      setTooltip({
        text,
        x: rect.right + 10,
        y: rect.top + rect.height / 2,
      });
    }, 700);
  };

  const hideTooltip = () => {
    if (tooltipTimeout.current) {
      clearTimeout(tooltipTimeout.current);
      tooltipTimeout.current = null;
    }
    if (tooltipExitTimeout.current) {
      clearTimeout(tooltipExitTimeout.current);
      tooltipExitTimeout.current = null;
    }

    if (tooltip && !isHiding) {
      setIsHiding(true);
      tooltipExitTimeout.current = setTimeout(() => {
        setTooltip(null);
        setIsHiding(false);
        tooltipExitTimeout.current = null;
      }, 150);
    } else {
      setTooltip(null);
      setIsHiding(false);
    }
  };

  return (
    <>
      <nav
        className="flex w-13 flex-col items-center gap-2.5 overflow-visible bg-[#171717] pb-2.5 pt-1"
        aria-label="Primary"
      >
        {tabs.map((tab) => {
          const disabled = tab.requiresVps && !serverConnected;
          return (
            <RailItem
              active={activeTab === tab.id && !disabled}
              activeIcon={tab.activeIcon}
              disabled={disabled}
              icon={tab.icon}
              key={tab.id}
              label={tab.label}
              onClick={() => {
                if (disabled) return;
                hideTooltip();
                onSelectTab(tab.id);
              }}
              onMouseEnter={(event) => {
                if (disabled) {
                  hideTooltip();
                  return;
                }
                showTooltip(tab.label, event);
              }}
              onMouseLeave={hideTooltip}
              separated={tab.id === "settings"}
            />
          );
        })}
      </nav>

      {tooltip && (
        <div
          key={tooltip.text}
          className="primary-rail-tooltip fixed z-99999 flex w-fit items-center whitespace-nowrap rounded-xl bg-white px-2 py-1 text-sm text-[#171717] shadow-md"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translateY(-50%)",
            animation: isHiding
              ? "tooltip-disappear 150ms ease-out forwards"
              : "tooltip-appear 150ms ease-out forwards",
          }}
        >
          <div className="px-1">{tooltip.text}</div>
          <span
            className="absolute left-px top-1/2 -translate-y-1/2"
            style={{
              transformOrigin: "0px 0px",
              transform: "translateY(50%) rotate(90deg) translateX(-50%)",
            }}
          >
            <div
              className="primary-rail-tooltip-pin -translate-y-3/5 size-3 -rotate-45 rounded-xs bg-white [clip-path:polygon(0_100%,0_0,100%_100%)]"
              style={{ display: "block" }}
            />
          </span>
        </div>
      )}
    </>
  );
}

function RailItem({
  active,
  activeIcon: ActiveIcon,
  disabled = false,
  icon: Icon,
  label,
  onClick,
  onMouseEnter,
  onMouseLeave,
  separated = false,
}: {
  active: boolean;
  activeIcon?: React.ComponentType<{ size?: number; className?: string }>;
  disabled?: boolean;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
  onMouseEnter: React.MouseEventHandler<HTMLButtonElement>;
  onMouseLeave: React.MouseEventHandler<HTMLButtonElement>;
  separated?: boolean;
}) {
  return (
    <>
      {separated && <div className="rail-divider mx-1.5 h-px w-6 shrink-0" />}
      <div className="relative flex h-9 w-9 items-center justify-center overflow-visible">
        <button
          aria-disabled={disabled || undefined}
          aria-label={label}
          data-active={active && !disabled ? "true" : "false"}
          data-disabled={disabled ? "true" : "false"}
          disabled={disabled}
          onClick={onClick}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className={cx(
            "h-9 w-9 flex items-center justify-center rounded-lg border transition-colors",
            disabled
              ? "rail-item-disabled cursor-default border-[#171717] text-[#4a4a4e] opacity-40"
              : active
                ? "rail-item-active bg-[#212121] border-[#323232] active:scale-95"
                : "rail-item-inactive border-[#171717] hover:bg-[#333333] hover:text-white active:scale-95",
          )}
          type="button"
        >
          <span className="inline-flex">
            {active && !disabled && ActiveIcon ? <ActiveIcon size={20} /> : <Icon size={20} />}
          </span>
        </button>
      </div>
    </>
  );
}
