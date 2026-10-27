import { useEffect } from "react";
import { useContextMenuPosition } from "../../shared/ui/useContextMenuPosition";
import { Menu, MenuItem as SharedMenuItem, MenuSeparator } from "../../shared/ui/Menu";
import {
  formatShortcut,
  useShortcutBindings,
  type ShortcutActionId,
} from "../settings/shortcuts";
import type { EditorCommandId, EditorHandle } from "./core/types";

export type EditorContextMenuState = {
  x: number;
  y: number;
  hasSelection: boolean;
  readOnly: boolean;
};

type EditorContextMenuProps = {
  handle: EditorHandle;
  menu: EditorContextMenuState;
  onClose: () => void;
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? "⌘" : "Ctrl+";
const shift = isMac ? "⇧" : "Shift+";

export function EditorContextMenu({ handle, menu, onClose }: EditorContextMenuProps) {
  const bindings = useShortcutBindings();
  const shortcut = (id: ShortcutActionId) => formatShortcut(bindings[id]);
  const placement = useContextMenuPosition(menu);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const run = (command: EditorCommandId) => {
    handle.runCommand(command);
    handle.focus();
    onClose();
  };

  return (
    <Menu
      ref={placement.ref}
      className="editor-context-menu"
      onPointerDown={(event) => event.stopPropagation()}
      style={placement.style}
      variant="context"
    >
      <MenuItem label="Go to Definition" onClick={() => run("goToDefinition")} shortcut={shortcut("editor.go-to-definition")} />
      <MenuItem label="Find References" onClick={() => run("findReferences")} shortcut={shortcut("editor.find-references")} />
      <MenuItem label="Go to Symbol" onClick={() => run("goToSymbol")} shortcut={shortcut("editor.go-to-symbol")} />
      <MenuItem disabled={menu.readOnly} label="Rename Symbol" onClick={() => run("rename")} shortcut={shortcut("editor.rename")} />
      <MenuItem label="Toggle Breakpoint" onClick={() => run("toggleBreakpoint")} shortcut={shortcut("editor.toggle-breakpoint")} />
      <MenuDivider />
      <MenuItem disabled={menu.readOnly || !menu.hasSelection} label="Cut" onClick={() => run("cut")} shortcut={`${mod}X`} />
      <MenuItem disabled={!menu.hasSelection} label="Copy" onClick={() => run("copy")} shortcut={`${mod}C`} />
      <MenuItem disabled={menu.readOnly} label="Paste" onClick={() => run("paste")} shortcut={`${mod}V`} />
      <MenuDivider />
      <MenuItem label="Select All" onClick={() => run("selectAll")} shortcut={`${mod}A`} />
      <MenuItem label="Select Next" onClick={() => run("selectNext")} shortcut={shortcut("editor.select-next")} />
      <MenuDivider />
      <MenuItem disabled={menu.readOnly} label="Toggle Comment" onClick={() => run("toggleComment")} shortcut={shortcut("editor.toggle-comment")} />
      <MenuItem disabled={menu.readOnly} label="Format Document" onClick={() => run("format")} shortcut={shortcut("editor.format")} />
      <MenuItem disabled={menu.readOnly} label="Organize Imports" onClick={() => run("organizeImports")} shortcut={shortcut("editor.organize-imports")} />
      <MenuDivider />
      <MenuItem label="Fold" onClick={() => run("fold")} shortcut={shortcut("editor.fold")} />
      <MenuItem label="Unfold" onClick={() => run("unfold")} shortcut={shortcut("editor.unfold")} />
      <MenuDivider />
      <MenuItem label="Find" onClick={() => run("find")} shortcut={shortcut("editor.find")} />
      <MenuDivider />
      <MenuItem disabled={menu.readOnly} label="Undo" onClick={() => run("undo")} shortcut={`${mod}Z`} />
      <MenuItem disabled={menu.readOnly} label="Redo" onClick={() => run("redo")} shortcut={`${shift}${mod}Z`} />
    </Menu>
  );
}

function MenuItem({
  danger = false,
  disabled = false,
  label,
  onClick,
  shortcut,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <SharedMenuItem
      danger={danger}
      disabled={disabled}
      onClick={onClick}
      shortcut={shortcut}
    >
      {label}
    </SharedMenuItem>
  );
}

function MenuDivider() {
  return <MenuSeparator />;
}
