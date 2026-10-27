import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useContextMenuPosition } from "../../shared/ui/useContextMenuPosition";
import { Menu, MenuItem, MenuSeparator } from "../../shared/ui/Menu";

type MenuState = {
  x: number;
  y: number;
  selection: string;
  message: string;
  input: HTMLTextAreaElement | null;
  start: number;
  end: number;
};

export function AgentContextMenu({ rootRef, newChatShortcut, onNewChat, onHistory }: {
  rootRef: RefObject<HTMLDivElement | null>;
  newChatShortcut: string;
  onNewChat: () => void;
  onHistory?: () => void;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [error, setError] = useState("");
  const placement = useContextMenuPosition(menu);
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const open = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || event.defaultPrevented || target.closest(".coloride-terminal, .agent-session-row")) return;
      event.preventDefault();
      const input = target.closest("textarea");
      const start = input?.selectionStart ?? 0;
      const end = input?.selectionEnd ?? 0;
      const message = target.closest(".agent-assistant-message")?.querySelector<HTMLElement>(".agent-markdown")
        ?? target.closest(".agent-user-message")?.querySelector<HTMLElement>(".agent-user-message-text")
        ?? target.closest("pre");
      setError("");
      setMenu({ x: event.clientX, y: event.clientY, input, start, end,
        selection: input ? input.value.slice(start, end) : window.getSelection()?.toString() ?? "",
        message: message?.innerText ?? "" });
    };
    root.addEventListener("contextmenu", open);
    return () => root.removeEventListener("contextmenu", open);
  }, [rootRef]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    rootRef.current?.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
      rootRef.current?.removeEventListener("scroll", close, true);
    };
  }, [menu, rootRef]);

  if (!menu) return null;
  const writable = menu.input && !menu.input.disabled && !menu.input.readOnly;
  const run = async (action: () => void | Promise<void>) => {
    try { await action(); setMenu(null); }
    catch { setError("Could not access the clipboard. Try the keyboard shortcut."); }
  };
  const copyText = async (text: string) => {
    if (window.colorideDesktop?.writeClipboardCodeRef) {
      // The native bridge supports plain text when no code-reference metadata is supplied.
      if (!await window.colorideDesktop.writeClipboardCodeRef({ text, codeRef: "" })) throw new Error("Clipboard copy failed");
    } else await navigator.clipboard.writeText(text);
  };
  const replaceSelection = (text: string) => {
    if (!menu.input?.isConnected || menu.input.readOnly || menu.input.disabled) return;
    menu.input.focus({ preventScroll: true });
    menu.input.setSelectionRange(menu.start, menu.end);
    // Browser editing preserves undo and dispatches the input event React uses for drafts.
    if (!document.execCommand("insertText", false, text)) throw new Error("Clipboard edit was not applied");
  };
  const item = (label: string, action: () => void | Promise<void>, shortcut?: string, disabled = false) => (
    <MenuItem disabled={disabled} onClick={() => void run(action)} shortcut={shortcut && shortcut !== "Unassigned" ? shortcut : undefined}>
      {label}
    </MenuItem>
  );
  return createPortal(
    <Menu ref={placement.ref} style={placement.style} variant="context" aria-label="Agent context menu" onPointerDown={event => event.stopPropagation()}>
      {menu.input ? item("Cut", async () => { await copyText(menu.selection); replaceSelection(""); }, `${mod}X`, !writable || !menu.selection) : null}
      {item("Copy", () => copyText(menu.selection), `${mod}C`, !menu.selection)}
      {menu.message ? item("Copy message", () => copyText(menu.message)) : null}
      {menu.input ? item("Paste", async () => {
        const text = window.colorideDesktop?.readClipboardText ? await window.colorideDesktop.readClipboardText() : await navigator.clipboard.readText();
        replaceSelection(text);
      }, `${mod}V`, !writable) : null}
      {item("Select All", () => {
        if (menu.input) { menu.input.focus({ preventScroll: true }); menu.input.select(); }
        else {
          const timeline = rootRef.current?.querySelector(".agent-timeline");
          if (!timeline) return;
          const range = document.createRange(); range.selectNodeContents(timeline);
          const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
        }
      }, `${mod}A`)}
      <MenuSeparator />
      {item("New Coloride Agent", onNewChat, newChatShortcut)}
      {onHistory ? item("Chat history", onHistory) : null}
      {item("Scroll to bottom", () => {
        const timeline = rootRef.current?.querySelector(".agent-timeline");
        timeline?.scrollTo({ top: timeline.scrollHeight });
      })}
      {error ? <div role="alert" className="px-2 py-1 text-xs">{error}</div> : null}
    </Menu>, document.body,
  );
}
