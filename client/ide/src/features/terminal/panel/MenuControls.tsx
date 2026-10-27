import {
  MenuSeparator,
  MenuItem as SharedMenuItem,
} from "../../../shared/ui/Menu";

export function MenuItem({
  label,
  onClick,
  shortcut,
}: {
  label: string;
  onClick?: () => void;
  shortcut: string;
}) {
  return (
    <SharedMenuItem onClick={onClick} shortcut={shortcut || undefined}>
      {label}
    </SharedMenuItem>
  );
}

export function MenuDivider() {
  return <MenuSeparator />;
}

export function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TerminalTabIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5 flex-shrink-0"
      height="14"
      viewBox="0 0 24 24"
      width="14"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="M18.25 3H5.75A2.755 2.755 0 0 0 3 5.75v12.5A2.755 2.755 0 0 0 5.75 21h12.5A2.755 2.755 0 0 0 21 18.25V5.75A2.755 2.755 0 0 0 18.25 3m-7.575 9.885L7.53 16.03l-1.06-1.06L9.44 12L6.47 9.03l1.06-1.06l3.145 3.145c.485.485.485 1.28 0 1.77M16.5 16.5h-5V15h5z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ProblemsTabIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5 flex-shrink-0"
      height="14"
      viewBox="0 0 24 24"
      width="14"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="M11.953 2C6.465 2 2 6.486 2 12s4.486 10 10 10s10-4.486 10-10S17.493 2 11.953 2M13 17h-2v-2h2zm0-4h-2V7h2z"
        fill="currentColor"
      />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="12"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
