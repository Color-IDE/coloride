import darkMarkUrl from "../../shared/assets/branding/coloride-editor-dark.svg";
import lightMarkUrl from "../../../../desktop/resources/branding/coloride-mark.svg";
import {
  formatShortcut,
  useShortcutBindings,
  type ShortcutActionId,
} from "../settings/shortcuts";

const COMMANDS: Array<{ label: string; shortcutId: ShortcutActionId }> = [
  { label: "New File", shortcutId: "files.new-file" },
  { label: "New Folder", shortcutId: "files.new-folder" },
  { label: "Open File", shortcutId: "files.open-browser" },
  { label: "Toggle Terminal", shortcutId: "terminal.toggle" },
  { label: "New Task", shortcutId: "agents.new-task" },
  { label: "Open Settings", shortcutId: "navigation.settings" },
];

export function EditorEmptyState() {
  const bindings = useShortcutBindings();

  return (
    <div className="editor-empty-state pointer-events-none select-none flex h-full flex-col items-center justify-center px-6" aria-hidden="true">
      <img className="editor-empty-mark-dark size-28 object-contain" src={darkMarkUrl} alt="" draggable={false} />
      <img className="editor-empty-mark-light size-28 object-contain" src={lightMarkUrl} alt="" draggable={false} />
      <div className="mt-8 flex w-full max-w-[280px] flex-col">
        {COMMANDS.map((command) => (
          <div
            className="editor-empty-command flex h-8 w-full items-center justify-between gap-6 px-1"
            key={command.shortcutId}
          >
            <span className="editor-empty-command-label truncate text-[13px] font-medium text-[#878888]">
              {command.label}
            </span>
            <span className="editor-empty-command-shortcut agent-new-task-shortcut ml-auto shrink-0">
              {formatShortcut(bindings[command.shortcutId])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
