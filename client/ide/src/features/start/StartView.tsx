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

function PlusIcon() {
  return (
    <svg aria-hidden="true" className="size-[18px]" fill="none" viewBox="0 0 24 24">
      <path d="M12 4.5v15M4.5 12h15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function CloneIcon() {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1.15em" height="1.15em" viewBox="0 0 512 512">
      <path d="M0 0h512v512H0z" fill="none" />
      <path fill="currentColor" d="M464 0H144c-26.51 0-48 21.49-48 48v48H48c-26.51 0-48 21.49-48 48v320c0 26.51 21.49 48 48 48h320c26.51 0 48-21.49 48-48v-48h48c26.51 0 48-21.49 48-48V48c0-26.51-21.49-48-48-48M362 464H54a6 6 0 0 1-6-6V150a6 6 0 0 1 6-6h42v224c0 26.51 21.49 48 48 48h224v42a6 6 0 0 1-6 6m96-96H150a6 6 0 0 1-6-6V54a6 6 0 0 1 6-6h308a6 6 0 0 1 6 6v308a6 6 0 0 1-6 6" />
    </svg>
  );
}

export function StartView({
  localFolderOpening = false,
  onCloneRepository,
  onNewFile,
  onOpenProject,
  onOpenRecent,
  recents,
  servers,
}: StartViewProps) {
  const bindings = useShortcutBindings();
  const recentRows = recents.slice(0, 6);
  void servers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (localFolderOpening || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
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
  }, [localFolderOpening, onOpenRecent, recentRows]);

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

        {recentRows.length ? (
          <section className="mt-5 flex flex-col gap-1">
            <SectionLabel>RECENT PROJECTS</SectionLabel>
            {recentRows.map((item, index) => (
              <StartRow
                disabled={localFolderOpening}
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
