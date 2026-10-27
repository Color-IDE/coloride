import type { EditorView } from "@codemirror/view";
import {
  getShortcutBindings,
  matchesShortcut,
  type ShortcutActionId,
} from "../../../settings/shortcuts";

export function editorShortcut(
  id: ShortcutActionId,
  run: (view: EditorView) => boolean,
) {
  return {
    any: (view: EditorView, event: KeyboardEvent) => {
      const binding = getShortcutBindings()[id];
      if (!binding) return false;
      if (bindingNeedsModifier(binding) && !eventHasModifier(event)) return false;
      if (!matchesShortcut(event, binding)) return false;
      event.preventDefault();
      return run(view);
    },
  };
}

function bindingNeedsModifier(binding: string) {
  return binding.split("+").some((part) => part === "mod" || part === "ctrl" || part === "alt" || part === "meta" || part === "shift");
}

function eventHasModifier(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
}
