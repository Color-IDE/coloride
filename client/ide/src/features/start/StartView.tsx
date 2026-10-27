import { useEffect, type ReactNode } from "react";
import { MenuItem } from "../../shared/ui/Menu";
import { StartLogo } from "./StartLogo";
import type { LocalRecentWorkspace } from "../settings/lastSession";
import type { Profile } from "../../shared/api/types";
import { formatShortcut, useShortcutBindings } from "../settings/shortcuts";

type StartViewProps = {
  localFolderOpening?: boolean;
  onCloneRepository?: () => void;
  onCommandPalette?: () => void;
  onNewFile?: () => void;
  onOpenProject?: () => void;
  onOpenRecent?: (path: string) => void;
  onOpenServer?: (profile: Profile) => void;
  recents: LocalRecentWorkspace[];
  servers: Profile[];
};

function OpenProjectIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0h12v12H0z" fill="none" />
      <path
        d="M11 4.5A2.5 2.5 0 0 0 8.5 2H5.21l-.42-.41C4.42 1.21 3.91 1 3.38 1H2.5A2.5 2.5 0 0 0 0 3.5v5A2.5 2.5 0 0 0 2.5 11H8c.79 0 1.54-.38 2-1l.99-1.32l.51-.68c.33-.45.5-.96.5-1.5c0-.82-.39-1.54-1-2m-10-1C1 2.67 1.67 2 2.5 2h.88c.26 0 .52.11.71.29l.7.71H8.5c.67 0 1.23.44 1.42 1.04C9.78 4.01 9.64 4 9.5 4H4c-.79 0-1.54.38-2 1L1 6.33zm9.7 3.9l-.7.93l-.8 1.07c-.28.38-.72.6-1.2.6H2.5a1.498 1.498 0 0 1-1.2-2.4l1.5-2c.28-.38.72-.6 1.2-.6h5.5c.18 0 .34.03.5.09a1.495 1.495 0 0 1 .7 2.31"
        fill="currentColor"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" className="size-[18px]" fill="none" viewBox="0 0 24 24">
      <path d="M12 4.5v15M4.5 12h15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function CloneIcon() {
  return (
    <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 1792 1792" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0h1792v1792H0z" fill="none" />
      <path
        d="M1664 1632V544q0-13-9.5-22.5T1632 512H544q-13 0-22.5 9.5T512 544v1088q0 13 9.5 22.5t22.5 9.5h1088q13 0 22.5-9.5t9.5-22.5m128-1088v1088q0 66-47 113t-113 47H544q-66 0-113-47t-47-113V544q0-66 47-113t113-47h1088q66 0 113 47t47 113m-384-384v160h-128V160q0-13-9.5-22.5T1248 128H160q-13 0-22.5 9.5T128 160v1088q0 13 9.5 22.5t22.5 9.5h160v128H160q-66 0-113-47T0 1248V160Q0 94 47 47T160 0h1088q66 0 113 47t47 113"
        fill="currentColor"
      />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M5 8h14M5 12h10M5 16h7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function ServerIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <rect height="5" rx="1.4" stroke="currentColor" strokeWidth="1.6" width="16" x="4" y="4" />
      <rect height="5" rx="1.4" stroke="currentColor" strokeWidth="1.6" width="16" x="4" y="15" />
      <path d="M7 6.5h.01M7 17.5h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}

export function StartView({
  localFolderOpening = false,
  onCloneRepository,
  onCommandPalette,
  onNewFile,
  onOpenProject,
  onOpenRecent,
  onOpenServer,
  recents,
  servers,
}: StartViewProps) {
  const bindings = useShortcutBindings();
  const recentRows = recents.slice(0, 6);
  const serverRows = servers.slice(0, 4);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return;
      }
      const index = Number(event.key) - 1;
      const recent = recentRows[index];
      if (!recent || index < 0) return;
      event.preventDefault();
      onOpenRecent?.(recent.path);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenRecent, recentRows]);

  return (
    <div className="start-screen flex h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-y-auto bg-[#f7f7f8] px-8 py-12 text-[#3f3f46] dark:bg-[#171717] dark:text-[#d4d4d8]">
      <div className="flex w-full max-w-[520px] flex-col">
        <div className="mb-10 flex justify-center">
          <h1 className="sr-only">Coloride</h1>
          <StartLogo />
        </div>

        <section className="flex flex-col gap-1">
          <SectionLabel>GET STARTED</SectionLabel>
          <StartRow disabled={localFolderOpening} icon={<PlusIcon />} label="New File" onClick={onNewFile} shortcut={formatShortcut(bindings["files.new-file"])} />
          <StartRow disabled={localFolderOpening} icon={<OpenProjectIcon />} label="Open Project" onClick={onOpenProject} shortcut={formatShortcut(bindings["files.open-browser"])} />
          <StartRow icon={<CloneIcon />} label="Clone Repository" onClick={onCloneRepository} />
        </section>

        {recentRows.length || serverRows.length ? (
          <section className="mt-5 flex flex-col gap-1">
            <SectionLabel>RECENT PROJECTS</SectionLabel>
            {recentRows.map((item, index) => (
              <StartRow
                icon={<OpenProjectIcon />}
                key={item.path}
                label={item.name}
                onClick={() => onOpenRecent?.(item.path)}
                shortcut={index < 9 ? String(index + 1) : undefined}
                title={item.path}
              />
            ))}

          </section>
        ) : null}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 flex items-center gap-3">
      <span className="h-px flex-1 bg-[#e4e4e7] dark:bg-white/[0.08]" />
      <span className="text-[10px] font-medium tracking-[0.08em] text-[#8b8b90]">{children}</span>
      <span className="h-px flex-1 bg-[#e4e4e7] dark:bg-white/[0.08]" />
    </div>
  );
}

function StartRow({
  disabled,
  icon,
  label,
  onClick,
  shortcut,
  title,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  shortcut?: string;
  title?: string;
}) {
  return (
    <MenuItem className="!h-8" disabled={disabled} onClick={onClick} shortcut={shortcut} title={title}>
      <span className="flex w-5 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="truncate">{label}</span>
    </MenuItem>
  );
}
