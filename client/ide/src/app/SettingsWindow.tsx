import { useEffect, useState } from "react";
import { SettingsView, type SettingsSection } from "../features/settings/SettingsView";
import { applyResolvedThemeToDocument, getInterfaceFontFamily, useAppPreferences, useResolvedTheme } from "../features/settings/preferences";

/** Preferences have their own renderer; opening this window never mounts an IDE session. */
export default function SettingsWindow() {
  const [section, setSection] = useState(() => new URLSearchParams(location.search).get("section") as SettingsSection || "general");
  const preferences = useAppPreferences();
  const theme = useResolvedTheme();
  useEffect(() => {
    document.title = "Settings — Coloride";
    const unsubscribeSection = window.colorideDesktop?.onSettingsSectionChange?.(value => setSection(value as SettingsSection));
    const unsubscribeMenu = window.colorideDesktop?.onMenuAction(action => {
      if (action === "edit-find") window.dispatchEvent(new CustomEvent("coloride:editor-find"));
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("coloride:editor-find"));
      } else if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        void window.colorideDesktop?.windowControls?.close();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      unsubscribeSection?.(); unsubscribeMenu?.();
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
  useEffect(() => {
    applyResolvedThemeToDocument();
    const html = document.documentElement;
    html.style.setProperty("--accent-color", preferences.accentColor);
    html.style.setProperty("--font-sans", getInterfaceFontFamily(preferences.interfaceFontFamily));
    html.style.setProperty("--interface-font-size", `${preferences.interfaceFontSize}px`);
    document.body.dataset.motion = preferences.motionPreference;
    document.body.dataset.fontSmoothing = String(preferences.fontSmoothing);
    for (const element of [html, document.body]) {
      element.dataset.pointerCursors = String(preferences.pointerCursors);
      element.classList.toggle("pointer-cursors-on", preferences.pointerCursors);
      element.classList.toggle("pointer-cursors-off", !preferences.pointerCursors);
    }
  }, [preferences, theme]);
  return <div className="settings-window"><SettingsView initialSection={section} onSectionChange={setSection} /></div>;
}
