import { MenuItem, MenuSeparator } from "../../../../shared/ui/Menu";

export function ReturnKeyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="filetree-context-key-icon"
      viewBox="0 0 2048 2048"
    >
      <path d="M0 0h2048v2048H0z" fill="none" />
      <path
        d="M1792 1152H475l466 467l-90 90l-621-621l621-621l90 90l-466 467h1189V384h128z"
        fill="currentColor"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="56"
      />
    </svg>
  );
}

export function TreeMenuItem({
  danger = false,
  disabled = false,
  label,
  onClick,
  shortcut,
  shortcutIcon,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  shortcut?: string;
  shortcutIcon?: React.ReactNode;
}) {
  return (
    <MenuItem
      danger={danger}
      disabled={disabled}
      onClick={onClick}
      shortcut={shortcutIcon ?? shortcut}
    >
      {label}
    </MenuItem>
  );
}

export function TreeMenuDivider() {
  return <MenuSeparator />;
}
