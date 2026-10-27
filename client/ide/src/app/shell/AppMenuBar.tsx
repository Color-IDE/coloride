/**
 * In-window application menus shared by macOS and Windows.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { EditorCommandId } from "../../features/editor";
import { readLocalRecentWorkspaces } from "../../features/settings/lastSession";
import { useAppPreferences } from "../../features/settings/preferences";

export type AppMenuActionId =
  | `editor-command:${EditorCommandId}`
  | "about-coloride"
  | "open-settings"
  | "check-for-updates"
  | "sign-out"
  | "new-window"
  | "new-file"
  | "new-folder"
  | "open-file"
  | "open-local-folder"
  | "open-ssh-workspace"
  | "save-file"
  | "save-all-files"
  | "toggle-auto-save"
  | "revert-file"
  | "close-editor"
  | "close-workspace"
  | "edit-undo"
  | "edit-redo"
  | "edit-cut"
  | "edit-copy"
  | "edit-paste"
  | "edit-find"
  | "edit-replace"
  | "command-palette"
  | "open-explorer"
  | "open-agents"
  | "toggle-terminal"
  | "open-browser"
  | "toggle-side-panel"
  | "new-agent-task"
  | "agent-mode-ask"
  | "agent-mode-plan"
  | "agent-mode-debug"
  | "agent-select-model"
  | "agent-access-request"
  | "agent-access-agent"
  | "agent-access-full"
  | "stop-agent"
  | "new-terminal"
  | "split-terminal"
  | "clear-terminal"
  | "restart-terminal"
  | "kill-terminal"
  | "connect-server"
  | "reconnect-server"
  | "disconnect-server"
  | "open-ssh-workspace"
  | "open-server-settings"
  | "connection-info"
  | "window-minimize"
  | "window-maximize"
  | "window-close"
  | "help-docs"
  | "open-shortcuts"
  | "help-report-bug"
  | "open-diagnostics"
  | "help-discord"
  | `open-recent:${string}`;

type MenuItem =
  | { type: "item"; id: AppMenuActionId; label: string; shortcut?: string }
  | { type: "separator" }
  | { type: "submenu"; label: string; items: MenuItem[] };

type MenuDef = {
  id: string;
  label: string;
  items: MenuItem[];
};

const MENUS: MenuDef[] = [
  {
    id: "coloride",
    label: "Coloride",
    items: [
      { type: "item", id: "about-coloride", label: "About Coloride" },
      { type: "item", id: "open-settings", label: "Settings", shortcut: "Ctrl+," },
      { type: "item", id: "check-for-updates", label: "Check for Updates" },
      { type: "separator" },
      { type: "item", id: "sign-out", label: "Sign Out" },
      { type: "separator" },
      { type: "item", id: "window-close", label: "Quit Coloride" },
    ],
  },
  {
    id: "file",
    label: "File",
    items: [
      { type: "item", id: "new-file", label: "New File", shortcut: "Ctrl+N" },
      { type: "item", id: "new-folder", label: "New Folder" },
      { type: "item", id: "new-window", label: "New Window", shortcut: "Ctrl+Shift+N" },
      { type: "separator" },
      { type: "item", id: "open-file", label: "Open…", shortcut: "Ctrl+O" },
      { type: "item", id: "open-local-folder", label: "Open Folder…" },
      { type: "submenu", label: "Open Recent", items: [] },
      { type: "separator" },
      { type: "item", id: "save-file", label: "Save", shortcut: "Ctrl+S" },
      { type: "item", id: "save-all-files", label: "Save All" },
      { type: "separator" },
      { type: "item", id: "toggle-auto-save", label: "Auto Save" },
      { type: "item", id: "revert-file", label: "Revert File" },
      { type: "item", id: "close-editor", label: "Close Editor", shortcut: "Ctrl+W" },
      { type: "item", id: "close-workspace", label: "Close Workspace" },
      { type: "item", id: "window-close", label: "Close Window", shortcut: "Ctrl+Shift+W" },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    items: [
      { type: "item", id: "edit-undo", label: "Undo", shortcut: "Ctrl+Z" },
      { type: "item", id: "edit-redo", label: "Redo", shortcut: "Ctrl+Y" },
      { type: "separator" },
      { type: "item", id: "edit-cut", label: "Cut", shortcut: "Ctrl+X" },
      { type: "item", id: "edit-copy", label: "Copy", shortcut: "Ctrl+C" },
      { type: "item", id: "edit-paste", label: "Paste", shortcut: "Ctrl+V" },
      { type: "separator" },
      { type: "item", id: "edit-find", label: "Find", shortcut: "Ctrl+F" },
      { type: "item", id: "edit-replace", label: "Replace", shortcut: "Ctrl+H" },
    ],
  },
  {
    id: "view",
    label: "View",
    items: [
      { type: "item", id: "command-palette", label: "Command Palette", shortcut: "Ctrl+Shift+P" },
      { type: "separator" },
      { type: "item", id: "open-explorer", label: "Explorer", shortcut: "Ctrl+Shift+E" },
      { type: "item", id: "open-agents", label: "Agents" },
      { type: "item", id: "toggle-terminal", label: "Terminal", shortcut: "Ctrl+J" },
      { type: "item", id: "open-browser", label: "Browser" },
      { type: "separator" },
      { type: "item", id: "toggle-side-panel", label: "Toggle Sidebar", shortcut: "Ctrl+B" },
      { type: "item", id: "window-maximize", label: "Zoom" },
    ],
  },
  {
    id: "agent",
    label: "Agent",
    items: [
      { type: "item", id: "new-agent-task", label: "New Task", shortcut: "Ctrl+T" },
      { type: "separator" },
      { type: "item", id: "agent-mode-ask", label: "Ask" },
      { type: "item", id: "agent-mode-plan", label: "Plan" },
      { type: "item", id: "agent-mode-debug", label: "Debug" },
      { type: "separator" },
      { type: "item", id: "agent-select-model", label: "Select Model" },
      {
        type: "submenu",
        label: "Access Mode",
        items: [
          { type: "item", id: "agent-access-request", label: "Request Approval" },
          { type: "item", id: "agent-access-agent", label: "Agent Decides" },
          { type: "item", id: "agent-access-full", label: "Full Access" },
        ],
      },
      { type: "separator" },
      { type: "item", id: "stop-agent", label: "Stop Agent" },
      { type: "item", id: "new-agent-task", label: "New Agent" },
    ],
  },
  {
    id: "terminal",
    label: "Terminal",
    items: [
      { type: "item", id: "new-terminal", label: "New Terminal", shortcut: "Ctrl+Shift+`" },
      { type: "item", id: "split-terminal", label: "Split Terminal" },
      { type: "separator" },
      { type: "item", id: "clear-terminal", label: "Clear", shortcut: "Ctrl+K" },
      { type: "item", id: "restart-terminal", label: "Restart Terminal" },
      { type: "item", id: "kill-terminal", label: "Kill Terminal" },
    ],
  },
  {
    id: "window",
    label: "Window",
    items: [
      { type: "item", id: "window-minimize", label: "Minimize" },
      { type: "item", id: "window-maximize", label: "Zoom" },
    ],
  },
  {
    id: "help",
    label: "Help",
    items: [
      { type: "item", id: "help-docs", label: "Documentation" },
      { type: "item", id: "open-shortcuts", label: "Keyboard Shortcuts" },
      { type: "item", id: "help-report-bug", label: "Report a Bug" },
      { type: "item", id: "open-diagnostics", label: "Show Logs" },
      { type: "item", id: "help-discord", label: "Discord / Support" },
    ],
  },
];

// Keep secondary capabilities available inside the eight main application menus.
const menuById = (id: string) => MENUS.find(menu => menu.id === id)!;
const APPLICATION_MENUS: MenuDef[] = [
  menuById("file"),
  menuById("edit"),
  {id:"selection",label:"Selection",items:[
    {type:"item",id:"editor-command:selectAll",label:"Select All",shortcut:"Ctrl+A"},
    {type:"item",id:"editor-command:selectNext",label:"Select Next Occurrence",shortcut:"Ctrl+D"},
    {type:"separator"},
    {type:"item",id:"editor-command:toggleComment",label:"Toggle Comment",shortcut:"Ctrl+/"},
  ]},
  menuById("view"),
  {id:"go",label:"Go",items:[
    {type:"item",id:"editor-command:goToDefinition",label:"Go to Definition",shortcut:"F12"},
    {type:"item",id:"editor-command:findReferences",label:"Find References",shortcut:"Shift+F12"},
    {type:"item",id:"editor-command:goToSymbol",label:"Go to Symbol",shortcut:"Ctrl+Shift+O"},
  ]},
  {id:"run",label:"Run",items:[
    {type:"item",id:"new-terminal",label:"New Terminal",shortcut:"Ctrl+Shift+`"},
    {type:"item",id:"editor-command:toggleBreakpoint",label:"Toggle Breakpoint",shortcut:"F9"},
    {type:"separator"},
    {type:"submenu",label:"Agent",items:menuById("agent").items},
    {type:"submenu",label:"Terminal",items:menuById("terminal").items},
  ]},
  {...menuById("window"),items:[...menuById("window").items,{type:"item",id:"window-close",label:"Close Window"}]},
  {...menuById("help"),items:[...menuById("help").items,{type:"separator"},{type:"submenu",label:"Coloride",items:menuById("coloride").items}]},
];

function runEditCommand(command: string) {
  try {
    document.execCommand(command);
  } catch {
    // ignore
  }
}

export function dispatchAppMenuAction(id: AppMenuActionId) {
  if (id.startsWith("editor-command:")) {
    window.dispatchEvent(new CustomEvent("coloride:editor-command", {detail:id.slice("editor-command:".length)}));
    return;
  }
  const desktop = window.colorideDesktop;
  switch (id) {
    case "edit-undo":
      runEditCommand("undo");
      return;
    case "edit-redo":
      runEditCommand("redo");
      return;
    case "edit-cut":
      runEditCommand("cut");
      return;
    case "edit-copy":
      runEditCommand("copy");
      return;
    case "edit-paste":
      runEditCommand("paste");
      return;
    case "window-minimize":
      void desktop?.windowControls?.minimize();
      return;
    case "window-maximize":
      void desktop?.windowControls?.toggleMaximize();
      return;
    case "window-close":
      void desktop?.windowControls?.close();
      return;
    case "about-coloride":
    case "help-docs":
    case "help-discord":
      return;
    default:
      // Reuse the same action bus as the native app menu.
      window.dispatchEvent(new CustomEvent("coloride:app-menu-action", { detail: id }));
  }
}

export function AppMenuBar() {
  const prefs = useAppPreferences();
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenId(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  return (
    <div
      ref={rootRef}
      className="app-menu-bar flex h-full min-w-0 shrink-0 items-center [-webkit-app-region:no-drag]"
      role="menubar"
      aria-label="Application"
      onMouseDown={event => event.preventDefault()}
      onKeyDown={event => {
        const triggers = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(".app-menu-trigger") ?? []);
        const triggerIndex = triggers.findIndex(button => button === document.activeElement);
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault(); event.stopPropagation();
          const index = triggerIndex >= 0 ? triggerIndex : APPLICATION_MENUS.findIndex(menu => menu.id === openId);
          const next = (index + (event.key === "ArrowRight" ? 1 : -1) + triggers.length) % triggers.length;
          triggers[next]?.focus();
          if (openId) setOpenId(APPLICATION_MENUS[next].id);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); event.stopPropagation();
          if (triggerIndex >= 0 && !openId) setOpenId(APPLICATION_MENUS[triggerIndex].id);
          requestAnimationFrame(() => {
            const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('.app-menu-dropdown > button') ?? []);
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          });
        } else if (event.key === "Escape") {
          event.stopPropagation(); setOpenId(null);
          triggers[APPLICATION_MENUS.findIndex(menu => menu.id === openId)]?.focus();
        }
      }}
    >
      {APPLICATION_MENUS.map((menu) => {
        const open = openId === menu.id;
        return (
          <div className="app-menu-root relative flex h-full" key={menu.id}>
            <button
              aria-expanded={open}
              aria-haspopup="menu"
              className={`app-menu-trigger${open ? " is-open" : ""}`}
              onClick={() => setOpenId((current) => (current === menu.id ? null : menu.id))}
              onMouseEnter={() => {
                // Classic menu bar: once one is open, hover switches menus.
                if (openId) setOpenId(menu.id);
              }}
              role="menuitem"
              type="button"
            >
              {menu.label}
            </button>
            <AnimatePresence>
              {open ? (
                <motion.div
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className="app-menu-dropdown"
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  key={`menu-${menu.id}`}
                  role="menu"
                  transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                >
                  {menu.items.map((item, index) => {
                    if (item.type === "separator") {
                      return (
                        <div
                          aria-hidden="true"
                          className="app-menu-separator"
                          key={`sep-${menu.id}-${index}`}
                        />
                      );
                    }
                    if (item.type === "submenu") {
                      const recentItems =
                        item.label === "Open Recent"
                          ? readLocalRecentWorkspaces().map((workspace) => ({
                              type: "item" as const,
                              id: `open-recent:local:${workspace.path}` as AppMenuActionId,
                              label: workspace.name,
                            }))
                          : item.items;
                      const children = recentItems.length
                        ? recentItems
                        : [{ type: "item" as const, id: "open-local-folder" as AppMenuActionId, label: "No Recent Workspaces" }];
                      return (
                        <div className="app-menu-submenu" key={`sub-${menu.id}-${index}`}>
                          <div className="app-menu-item app-menu-submenu-label">
                            <span className="app-menu-item-label">{item.label}</span>
                            <span className="app-menu-item-shortcut">›</span>
                          </div>
                          <div className="app-menu-submenu-panel">
                            {children.map((child) =>
                              child.type === "item" ? (
                                <button
                                  className="app-menu-item"
                                  key={child.id}
                                  onClick={() => {
                                    setOpenId(null);
                                    dispatchAppMenuAction(child.id);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  <span className="app-menu-item-label">{child.label}</span>
                                </button>
                              ) : null,
                            )}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <button
                        className="app-menu-item"
                        key={`${item.id}-${index}`}
                        onClick={() => {
                          setOpenId(null);
                          dispatchAppMenuAction(item.id);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <span className="app-menu-item-label">
                          {item.id === "toggle-auto-save" && prefs.editorAutoSave ? "✓ " : ""}
                          {item.label}
                        </span>
                        {item.shortcut ? (
                          <span className="app-menu-item-shortcut">{/Mac/.test(navigator.platform) ? item.shortcut.replaceAll("Ctrl+", "⌘").replaceAll("Shift+", "⇧") : item.shortcut}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

