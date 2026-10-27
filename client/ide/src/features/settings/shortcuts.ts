import { useSyncExternalStore } from "react";

export type ShortcutActionId =
  | "navigation.back"
  | "navigation.forward"
  | "navigation.explorer"
  | "navigation.server"
  | "navigation.settings"
  | "layout.toggle-sidebar"
  | "files.open-browser"
  | "files.new-file"
  | "files.new-folder"
  | "files.save"
  | "files.save-all"
  | "files.close-editor"
  | "terminal.new"
  | "terminal.toggle"
  | "terminal.clear"
  | "terminal.close"
  | "agents.new-task"
  | "editor.find"
  | "editor.select-next"
  | "editor.toggle-comment"
  | "editor.move-line-up"
  | "editor.move-line-down"
  | "editor.duplicate-line-up"
  | "editor.duplicate-line-down"
  | "editor.expand-selection"
  | "editor.shrink-selection"
  | "editor.go-to-symbol"
  | "editor.go-to-definition"
  | "editor.find-references"
  | "editor.rename"
  | "editor.format"
  | "editor.organize-imports"
  | "editor.fold"
  | "editor.unfold"
  | "editor.toggle-problems"
  | "editor.toggle-breakpoint";

export type ShortcutCategory = "Navigation" | "Files" | "Terminal" | "Agents" | "Editor";

export interface ShortcutDefinition {
  category: ShortcutCategory;
  defaultBinding: string;
  description: string;
  id: ShortcutActionId;
  label: string;
}

export const shortcutDefinitions: ShortcutDefinition[] = [
  { id: "navigation.back", category: "Navigation", label: "Go back", description: "Return to the previous Coloride view.", defaultBinding: "mod+[" },
  { id: "navigation.forward", category: "Navigation", label: "Go forward", description: "Move to the next Coloride view.", defaultBinding: "mod+]" },
  { id: "navigation.explorer", category: "Navigation", label: "Open Explorer", description: "Switch to the remote file workspace.", defaultBinding: "mod+shift+e" },
  { id: "navigation.server", category: "Navigation", label: "Open Server", description: "Switch to server monitoring and management.", defaultBinding: "mod+shift+h" },
  { id: "navigation.settings", category: "Navigation", label: "Open Settings", description: "Open application settings.", defaultBinding: "mod+," },
  { id: "layout.toggle-sidebar", category: "Navigation", label: "Toggle side panel", description: "Show or hide the panel on the left.", defaultBinding: "mod+b" },
  { id: "files.open-browser", category: "Files", label: "Open remote browser", description: "Choose a file or workspace on the connected VPS.", defaultBinding: "mod+o" },
  { id: "files.new-file", category: "Files", label: "New file", description: "Create a file in the selected remote folder.", defaultBinding: "mod+n" },
  { id: "files.new-folder", category: "Files", label: "New folder", description: "Create a folder in the selected remote folder.", defaultBinding: "mod+shift+n" },
  { id: "files.save", category: "Files", label: "Save file", description: "Save the active Monaco editor file.", defaultBinding: "mod+s" },
  { id: "files.save-all", category: "Files", label: "Save all files", description: "Save every unsaved editor buffer.", defaultBinding: "alt+mod+s" },
  { id: "files.close-editor", category: "Files", label: "Close editor", description: "Close the active editor tab.", defaultBinding: "mod+w" },
  { id: "terminal.new", category: "Terminal", label: "New terminal", description: "Create another terminal in the current workspace.", defaultBinding: "ctrl+shift+`" },
  { id: "terminal.toggle", category: "Terminal", label: "Toggle terminal panel", description: "Show or hide the embedded terminal without closing it.", defaultBinding: "mod+j" },
  { id: "terminal.clear", category: "Terminal", label: "Clear terminal", description: "Clear the active terminal scrollback and screen.", defaultBinding: "mod+k" },
  { id: "terminal.close", category: "Terminal", label: "Close terminal", description: "Close the active terminal tab.", defaultBinding: "mod+shift+w" },
  { id: "agents.new-task", category: "Agents", label: "New Task", description: "Start a blank agent chat.", defaultBinding: "mod+t" },
  { id: "editor.find", category: "Editor", label: "Find in file", description: "Search in the active editor.", defaultBinding: "mod+f" },
  { id: "editor.select-next", category: "Editor", label: "Select next occurrence", description: "Add the next matching word to the selection.", defaultBinding: "mod+d" },
  { id: "editor.toggle-comment", category: "Editor", label: "Toggle comment", description: "Comment or uncomment the selected lines.", defaultBinding: "mod+/" },
  { id: "editor.move-line-up", category: "Editor", label: "Move line up", description: "Move the current line or selection up.", defaultBinding: "alt+up" },
  { id: "editor.move-line-down", category: "Editor", label: "Move line down", description: "Move the current line or selection down.", defaultBinding: "alt+down" },
  { id: "editor.duplicate-line-up", category: "Editor", label: "Duplicate line up", description: "Copy the current line above.", defaultBinding: "alt+shift+up" },
  { id: "editor.duplicate-line-down", category: "Editor", label: "Duplicate line down", description: "Copy the current line below.", defaultBinding: "alt+shift+down" },
  { id: "editor.expand-selection", category: "Editor", label: "Expand selection", description: "Grow the selection from word to expression to block.", defaultBinding: "mod+shift+right" },
  { id: "editor.shrink-selection", category: "Editor", label: "Shrink selection", description: "Reduce the selection to the previous range.", defaultBinding: "mod+shift+left" },
  { id: "editor.go-to-symbol", category: "Editor", label: "Go to symbol", description: "Jump to a function or class in the current file.", defaultBinding: "mod+shift+o" },
  { id: "editor.go-to-definition", category: "Editor", label: "Go to definition", description: "Jump to the definition of the symbol under the cursor.", defaultBinding: "f12" },
  { id: "editor.find-references", category: "Editor", label: "Find references", description: "Show references to the current symbol.", defaultBinding: "shift+f12" },
  { id: "editor.rename", category: "Editor", label: "Rename symbol", description: "Rename the symbol under the cursor.", defaultBinding: "f2" },
  { id: "editor.format", category: "Editor", label: "Format document", description: "Format the file or the selected range.", defaultBinding: "alt+shift+f" },
  { id: "editor.organize-imports", category: "Editor", label: "Organize imports", description: "Sort and clean TypeScript/JavaScript imports.", defaultBinding: "alt+shift+o" },
  { id: "editor.fold", category: "Editor", label: "Fold", description: "Fold the block at the cursor.", defaultBinding: "mod+alt+[" },
  { id: "editor.unfold", category: "Editor", label: "Unfold", description: "Unfold the block at the cursor.", defaultBinding: "mod+alt+]" },
  { id: "editor.toggle-problems", category: "Editor", label: "Toggle problems", description: "Show or hide the problems panel for the active file.", defaultBinding: "mod+shift+m" },
  { id: "editor.toggle-breakpoint", category: "Editor", label: "Toggle breakpoint", description: "Add or remove a breakpoint on the current line.", defaultBinding: "f9" },
];

export type ShortcutBindings = Record<ShortcutActionId, string>;

const STORAGE_KEY = "coloride.keyboard-shortcuts.v1";
const listeners = new Set<() => void>();
const definitionIds = new Set(shortcutDefinitions.map((definition) => definition.id));

export const defaultShortcutBindings = Object.fromEntries(
  shortcutDefinitions.map((definition) => [definition.id, definition.defaultBinding]),
) as ShortcutBindings;

const readBindings = (): ShortcutBindings => {
  if (typeof window === "undefined") return defaultShortcutBindings;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ShortcutBindings> | null;
    if (!stored) return defaultShortcutBindings;
    const valid = Object.fromEntries(
      Object.entries(stored).filter(([id, value]) => definitionIds.has(id as ShortcutActionId) && typeof value === "string"),
    );
    return { ...defaultShortcutBindings, ...valid };
  } catch {
    return defaultShortcutBindings;
  }
};

let bindings = readBindings();

if (typeof window !== "undefined") window.addEventListener?.("storage", event => {
  if (event.storageArea !== window.localStorage || (event.key !== STORAGE_KEY && event.key !== null)) return;
  bindings = readBindings();
  listeners.forEach(listener => listener());
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => bindings;

export function useShortcutBindings() {
  return useSyncExternalStore(subscribe, getSnapshot, () => defaultShortcutBindings);
}

export function getShortcutBindings() {
  return bindings;
}

const persist = () => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Keep shortcuts active for this session when persistent storage is unavailable.
  }
  listeners.forEach((listener) => listener());
};

export function updateShortcutBinding(id: ShortcutActionId, binding: string) {
  bindings = { ...bindings, [id]: binding };
  persist();
}

export function resetShortcutBinding(id: ShortcutActionId) {
  updateShortcutBinding(id, defaultShortcutBindings[id]);
}

export function resetAllShortcutBindings() {
  bindings = { ...defaultShortcutBindings };
  persist();
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const normalizedKey = (event: KeyboardEvent) => {
  if (event.code.startsWith("Key")) return event.code.slice(3).toLowerCase();
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  if (event.code === "Backquote") return "`";
  if (event.code === "BracketLeft") return "[";
  if (event.code === "BracketRight") return "]";
  if (event.code === "Comma") return ",";
  if (event.code === "Period") return ".";
  if (event.code === "Slash") return "/";
  if (event.code === "Backslash") return "\\";
  if (event.code === "Semicolon") return ";";
  if (event.code === "Quote") return "'";
  if (event.code === "Minus") return "-";
  if (event.code === "Equal") return "=";
  const key = event.key;
  const lower = key.toLowerCase();
  if (lower === " ") return "space";
  if (lower === "esc") return "escape";
  if (lower === "arrowup") return "up";
  if (lower === "arrowdown") return "down";
  if (lower === "arrowleft") return "left";
  if (lower === "arrowright") return "right";
  return lower;
};

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = normalizedKey(event);
  if (["meta", "control", "alt", "shift"].includes(key)) return null;

  const parts: string[] = [];
  const primaryModifier = isMac() ? event.metaKey : event.ctrlKey;
  if (primaryModifier) parts.push("mod");
  if (event.ctrlKey && (isMac() || !primaryModifier)) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

export function matchesShortcut(event: KeyboardEvent, binding: string) {
  if (!binding) return false;
  const tokens = binding.split("+").filter(Boolean);
  if (tokens.includes("mod") && !event.metaKey && !event.ctrlKey) return false;
  if (tokens.includes("ctrl") && !event.ctrlKey) return false;
  if (tokens.includes("alt") && !event.altKey) return false;
  if (tokens.includes("shift") && !event.shiftKey) return false;
  if (tokens.includes("meta") && !event.metaKey) return false;
  return shortcutFromKeyboardEvent(event) === binding;
}

/** Cmd+F or Ctrl+F — never the letter F alone. */
export function isFindInFileEvent(event: KeyboardEvent) {
  if (event.isComposing || event.repeat) return false;
  if ((event.key || "").toLowerCase() !== "f") return false;
  if (event.altKey || event.shiftKey) return false;
  return Boolean(event.metaKey || event.ctrlKey);
}

const keyLabels: Record<string, string> = {
  alt: isMac() ? "⌥" : "Alt",
  backspace: "⌫",
  ctrl: isMac() ? "⌃" : "Ctrl",
  delete: "⌦",
  down: "↓",
  enter: "↩",
  escape: "Esc",
  left: "←",
  mod: isMac() ? "⌘" : "Ctrl",
  right: "→",
  shift: isMac() ? "⇧" : "Shift",
  space: "Space",
  tab: "⇥",
  up: "↑",
  f2: "F2",
  f9: "F9",
  f12: "F12",
};

export function formatShortcut(binding: string) {
  if (!binding) return "Unassigned";
  const parts = binding.split("+").map((part) => keyLabels[part] ?? (part.length === 1 ? part.toUpperCase() : part));
  return isMac() ? parts.join("") : parts.join(" + ");
}

export function shortcutConflict(bindingsToCheck: ShortcutBindings, id: ShortcutActionId, binding: string) {
  if (!binding) return null;
  const conflictingId = shortcutDefinitions.find((definition) => definition.id !== id && bindingsToCheck[definition.id] === binding)?.id;
  return conflictingId ? shortcutDefinitions.find((definition) => definition.id === conflictingId) ?? null : null;
}

export function isAllowedShortcut(binding: string) {
  if (!binding) return false;
  const parts = binding.split("+");
  const key = parts.at(-1) ?? "";
  return parts.length > 1 || /^f(?:[1-9]|1[0-2])$/.test(key);
}
