import {
  SearchIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "../../shared/ui/Icon";
import { Button } from "../../shared/ui/Button";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultShortcutBindings,
  formatShortcut,
  isAllowedShortcut,
  resetAllShortcutBindings,
  resetShortcutBinding,
  shortcutConflict,
  shortcutDefinitions,
  shortcutFromKeyboardEvent,
  updateShortcutBinding,
  useShortcutBindings,
  type ShortcutActionId,
  type ShortcutCategory,
} from "./shortcuts";

const categories: ShortcutCategory[] = ["Navigation", "Files", "Editor", "Terminal", "Agents"];

export function KeyboardShortcutsSettings() {
  const bindings = useShortcutBindings();
  const [query, setQuery] = useState("");
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null);
  const [message, setMessage] = useState<{ id: ShortcutActionId; text: string } | null>(null);
  const recordingButtonRef = useRef<HTMLButtonElement>(null);

  const filteredDefinitions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return shortcutDefinitions;
    return shortcutDefinitions.filter((definition) =>
      `${definition.label} ${definition.description} ${definition.category} ${formatShortcut(bindings[definition.id])}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [bindings, query]);

  useEffect(() => {
    if (!recordingId) return;
    recordingButtonRef.current?.focus();

    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecordingId(null);
        setMessage(null);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        updateShortcutBinding(recordingId, "");
        setRecordingId(null);
        setMessage(null);
        return;
      }

      const nextBinding = shortcutFromKeyboardEvent(event);
      if (!nextBinding) return;
      if (!isAllowedShortcut(nextBinding)) {
        setMessage({ id: recordingId, text: "Include Command, Control, Option or a function key." });
        return;
      }

      const conflict = shortcutConflict(bindings, recordingId, nextBinding);
      if (conflict) {
        setMessage({ id: recordingId, text: `Already assigned to ${conflict.label}.` });
        return;
      }

      updateShortcutBinding(recordingId, nextBinding);
      setRecordingId(null);
      setMessage(null);
    };

    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [bindings, recordingId]);

  const resetAll = () => {
    resetAllShortcutBindings();
    setRecordingId(null);
    setMessage(null);
  };

  return (
    <div className="settings-shortcuts mt-6 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <label className="settings-shortcut-search flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-lg bg-[#2c2c2c] px-2.5 text-[#85858a] focus-within:text-[#d4d4d7]">
          <Icon icon={SearchIcon} aria-hidden="true" size={14} strokeWidth={1.7} />
          <input
            aria-label="Search keyboard shortcuts"
            className="min-w-0 flex-1 border-0 bg-transparent text-xs text-[#f0f4f8] outline-none placeholder:text-[#77777c]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shortcuts"
            value={query}
          />
        </label>
        <Button onClick={resetAll}>
          Restore defaults
        </Button>
      </div>

      <p className="mt-2 text-xs leading-5 text-[#77777c]">
        Select a shortcut, then press a new combination. Press Escape to cancel or Delete to remove it.
      </p>

      <div className="mt-5">
        {categories.map((category) => {
          const definitions = filteredDefinitions.filter((definition) => definition.category === category);
          if (definitions.length === 0) return null;
          return (
            <section className="settings-shortcut-group border-b border-[#303030] py-4 first:pt-0 last:border-b-0" key={category}>
              <h2 className="settings-section-heading mb-1 text-xs font-medium text-[#808085]">{category}</h2>
              <div>
                {definitions.map((definition) => {
                  const binding = bindings[definition.id];
                  const recording = recordingId === definition.id;
                  const changed = binding !== defaultShortcutBindings[definition.id];
                  return (
                    <div className="settings-shortcut-row grid min-h-[62px] grid-cols-[minmax(0,1fr)_minmax(170px,240px)] items-center gap-8 py-2" key={definition.id}>
                      <div className="min-w-0">
                        <div className="settings-preference-label text-[13px] font-medium text-[#e6e6e8]">{definition.label}</div>
                        <p className="settings-preference-description mt-0.5 text-xs leading-5 text-[#85858a]">{definition.description}</p>
                      </div>
                      <div className="flex min-w-0 flex-col items-end">
                        <div className="flex items-center gap-1.5">
                          {changed && !recording && (
                            <Button className="text-[11px]" size="sm" variant="ghost" onClick={() => resetShortcutBinding(definition.id)}>
                              Reset
                            </Button>
                          )}
                          <button
                            aria-label={`Change shortcut for ${definition.label}`}
                            className={`settings-shortcut-binding flex h-8 min-w-[112px] items-center justify-center rounded-lg px-3 text-xs transition-colors active:scale-[0.98] ${recording ? "bg-[var(--accent-color)] text-[#10202b]" : "bg-[#2c2c2c] text-[#e8e8ea] hover:bg-[#353535]"}`}
                            data-recording={recording}
                            data-shortcut-recorder="true"
                            onClick={() => {
                              setMessage(null);
                              setRecordingId(definition.id);
                            }}
                            ref={recording ? recordingButtonRef : undefined}
                            type="button"
                          >
                            {recording ? "Press keys…" : formatShortcut(binding)}
                          </button>
                        </div>
                        {message?.id === definition.id && <div className="mt-1 text-right text-[11px] text-[#e0a96d]">{message.text}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {filteredDefinitions.length === 0 && (
          <div className="py-14 text-center text-sm text-[#77777c]">No shortcuts match “{query}”.</div>
        )}
      </div>
    </div>
  );
}
