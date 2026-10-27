import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { AboutSettings } from "./AboutSettings";
import { AgentSettings } from "./AgentSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import { EditorSettings } from "./EditorSettings";
import { GeneralSettings } from "./GeneralSettings";
import { KeyboardShortcutsSettings } from "./KeyboardShortcutsSettings";
import { SecuritySettings } from "./SecuritySettings";
import { TerminalSettings } from "./TerminalSettings";
import { UpdatesSettings } from "./UpdatesSettings";

export type SettingsSection = "general" | "appearance" | "shortcuts" | "editor" | "terminal" | "agent" | "security" | "updates" | "diagnostics" | "about";
interface SettingsViewProps {
  initialSection?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
  sidePanelOpen?: boolean;
  onShowNavigation?: () => void;
}
interface SettingsMenuItem { icon?: ComponentType; id: SettingsSection; label: string; }
interface SettingsMenuGroup { id: string; items: SettingsMenuItem[]; label: string; }
const menuGroups: SettingsMenuGroup[] = [
  {
    id: "application",
    label: "Application",
    items: [
      { id: "general", label: "General", icon: SettingsGeneralIcon },
      { id: "appearance", label: "Appearance", icon: SettingsAppearanceIcon },
      {
        id: "shortcuts",
        label: "Keyboard Shortcuts",
        icon: SettingsShortcutsIcon,
      },
    ],
  },
  {
    id: "development",
    label: "Development",
    items: [
      { id: "editor", label: "Editor", icon: SettingsEditorIcon },
      { id: "terminal", label: "Terminal", icon: SettingsTerminalIcon },
      { id: "agent", label: "Agent", icon: SettingsAgentIcon },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { id: "security", label: "Security", icon: SettingsSecurityIcon },
      { id: "updates", label: "Updates", icon: SettingsUpdatesIcon },
      {
        id: "diagnostics",
        label: "Diagnostics",
        icon: SettingsDiagnosticsIcon,
      },
      { id: "about", label: "About", icon: SettingsAboutIcon },
    ],
  },
];

const menuItems = menuGroups.flatMap(group => group.items);
const sections: Record<SettingsSection, ComponentType> = {
  general: GeneralSettings, appearance: AppearanceSettings, shortcuts: KeyboardShortcutsSettings,
  editor: EditorSettings, terminal: TerminalSettings, agent: AgentSettings,
  security: SecuritySettings, updates: UpdatesSettings, diagnostics: DiagnosticsSettings, about: AboutSettings,
};
const descriptions: Record<SettingsSection, string> = {
  general: "Startup, sessions and notifications.", appearance: "Colors, typography and the way Coloride feels.",
  shortcuts: "Make your everyday actions a keystroke away.", editor: "Indentation, navigation and the details of your editor.",
  terminal: "Your shell, text and terminal behavior.", agent: "Models and preferences for your coding assistant.",
  security: "Control access to your workspace and tools.", updates: "Keep your desktop up to date.",
  diagnostics: "Inspect activity and troubleshoot your desktop.", about: "Coloride, your local desktop IDE.",
};
const resolveSection = (section?: SettingsSection): SettingsSection => section && section in sections ? section : "general";

export function SettingsView({ initialSection = "general", onSectionChange, sidePanelOpen = true, onShowNavigation }: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState(() => resolveSection(initialSection));
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;
  useEffect(() => {
    setActiveSection(resolveSection(initialSection));
    setQuery("");
    contentRef.current?.scrollTo({ top: 0 });
  }, [initialSection]);
  const focusSearch = useCallback(() => {
    if (!contentRef.current?.getClientRects().length) return;
    onShowNavigation?.();
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [onShowNavigation]);
  useEffect(() => {
    window.addEventListener("coloride:editor-find", focusSearch);
    return () => window.removeEventListener("coloride:editor-find", focusSearch);
  }, [focusSearch]);
  const selectSection = useCallback((section: SettingsSection) => {
    setQuery("");
    setActiveSection(section);
    onSectionChange?.(section);
    contentRef.current?.scrollTo({ top: 0 });
  }, [onSectionChange]);

  // Search the rendered labels and descriptions, so new settings are included
  // without maintaining a second, stale list of searchable preference names.
  useLayoutEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const needle = query.trim().toLocaleLowerCase();
    let count = 0;
    for (const category of root.querySelectorAll<HTMLElement>('[data-settings-category]')) {
      const categoryMatch = (category.dataset.settingsCategory || "").toLocaleLowerCase().includes(needle);
      const rows = [...category.querySelectorAll<HTMLElement>('.settings-preference-row')];
      for (const row of rows) {
        const groupMatch = row.closest('.settings-section-group')?.querySelector('h2')?.textContent?.toLocaleLowerCase().includes(needle);
        row.hidden = Boolean(needle) && !categoryMatch && !groupMatch && !row.textContent?.toLocaleLowerCase().includes(needle);
      }
      for (const group of category.querySelectorAll<HTMLElement>('.settings-section-group')) {
        const groupRows = [...group.querySelectorAll<HTMLElement>('.settings-preference-row')];
        group.hidden = Boolean(needle) && (groupRows.length > 0
          ? groupRows.every(row => row.hidden)
          : !categoryMatch && !group.textContent?.toLocaleLowerCase().includes(needle));
      }
      category.hidden = Boolean(needle) && !categoryMatch && (rows.length ? rows.every(row => row.hidden) : !category.textContent?.toLocaleLowerCase().includes(needle));
      if (!category.hidden) count += rows.length ? rows.filter(row => !row.hidden).length : 1;
    }
    setMatches(count);
  }, [query, activeSection]);

  const activeItem = menuItems.find(item => item.id === activeSection)!;
  return (
    <div className="settings-workbench" onKeyDown={event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); focusSearch(); }
      if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); }
    }}>
      <div className="settings-layout">
        <aside className="settings-navigation" hidden={!sidePanelOpen}>
          <div className="settings-navigation-title"><SettingsGeneralIcon /><span>Settings</span></div>
          <label className="settings-search">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
            <input ref={searchRef} aria-label="Search settings" placeholder="Search settings…" value={query} onChange={event => setQuery(event.target.value)} />
            {query && <button type="button" aria-label="Clear settings search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>×</button>}
          </label>
          <nav aria-label="Settings sections" className="settings-categories">
            {menuGroups.map(group => <section key={group.id}>
              <h2>{group.label}</h2>
              {group.items.map(({id, label, icon: Icon}) => <button type="button" key={id} aria-current={!searching && activeSection === id ? "page" : undefined} onClick={() => selectSection(id)}>
                {Icon && <Icon />}<span>{label}</span><span className="settings-category-arrow" aria-hidden="true">›</span>
              </button>)}
            </section>)}
          </nav>
          <div className="settings-navigation-footer"><span>On this device</span><kbd>⌘ ,</kbd></div>
        </aside>
        <section className="settings-main" aria-labelledby="settings-section-title">
          <header className="settings-page-header">
            <div><span className="settings-scope">User</span><span className="settings-save-hint">Changes save automatically</span></div>
            <h1 id="settings-section-title">{searching ? "Search settings" : activeItem.label}</h1>
            <p>{searching ? `Results for “${query.trim()}”` : descriptions[activeSection]}</p>
          </header>
          <div className="settings-page-scroll" ref={contentRef}>
            {(searching ? menuItems : [activeItem]).map(item => {
              const Content = sections[item.id];
              return <div className="settings-category-content" data-settings-category={item.label} key={item.id}>
                {searching && <h2 className="settings-result-category">{item.label}</h2>}
                <Content />
              </div>;
            })}
            {searching && matches === 0 && <div className="settings-no-results" role="status"><h2>No settings found</h2><p>Try a preference such as font, minimap or scrollback.</p><button type="button" onClick={() => setQuery("")}>Clear search</button></div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingsGeneralIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M15.5 12C15.5 13.933 13.933 15.5 12 15.5C10.067 15.5 8.5 13.933 8.5 12C8.5 10.067 10.067 8.5 12 8.5C13.933 8.5 15.5 10.067 15.5 12Z" />
      <path d="M20.7906 9.15201C21.5969 10.5418 22 11.2366 22 12C22 12.7634 21.5969 13.4582 20.7906 14.848L18.8669 18.1638C18.0638 19.548 17.6623 20.2402 17.0019 20.6201C16.3416 21 15.5402 21 13.9373 21L10.0627 21C8.45982 21 7.6584 21 6.99807 20.6201C6.33774 20.2402 5.93619 19.548 5.13311 18.1638L3.20942 14.848C2.40314 13.4582 2 12.7634 2 12C2 11.2366 2.40314 10.5418 3.20942 9.152L5.13311 5.83621C5.93619 4.45196 6.33774 3.75984 6.99807 3.37992C7.6584 3 8.45982 3 10.0627 3L13.9373 3C15.5402 3 16.3416 3 17.0019 3.37992C17.6623 3.75984 18.0638 4.45197 18.8669 5.83622L20.7906 9.15201Z" />
    </svg>
  );
}

function SettingsAppearanceIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z" />
      <path d="M5 20L19 5" strokeLinejoin="round" />
      <path
        d="M16 9L22 13.8528M12.4128 12.4059L19.3601 18.3634M8 15.6672L15 21.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsShortcutsIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M14.5 7H9.5C6.21252 7 4.56878 7 3.46243 7.90796C3.25989 8.07418 3.07418 8.25989 2.90796 8.46243C2 9.56878 2 11.2125 2 14.5C2 17.7875 2 19.4312 2.90796 20.5376C3.07418 20.7401 3.25989 20.9258 3.46243 21.092C4.56878 22 6.21252 22 9.5 22H14.5C17.7875 22 19.4312 22 20.5376 21.092C20.7401 20.9258 20.9258 20.7401 21.092 20.5376C22 19.4312 22 17.7875 22 14.5C22 11.2125 22 9.56878 21.092 8.46243C20.9258 8.25989 20.7401 8.07418 20.5376 7.90796C19.4312 7 17.7875 7 14.5 7Z" />
      <path
        d="M12 7V5C12 4.44772 12.4477 4 13 4C13.5523 4 14 3.55228 14 3V2"
        strokeLinejoin="round"
      />
      <path d="M7 12L8 12" strokeLinejoin="round" />
      <path d="M11.5 12L12.5 12" strokeLinejoin="round" />
      <path d="M16 12L17 12" strokeLinejoin="round" />
      <path d="M7 17L17 17" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsEditorIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.5 20.5C7.25736 20.5 5.13604 20.5 3.81802 19.182C2.5 17.864 2.5 15.7426 2.5 11.5C2.5 7.25736 2.5 5.13604 3.81802 3.81802C5.13604 2.5 7.25736 2.5 11.5 2.5C15.7426 2.5 17.864 2.5 19.182 3.81802C20.5 5.13604 20.5 7.25736 20.5 11.5" />
      <path d="M3 7.5H20" />
      <path d="M11.5 16H12.5M6.5 16H7.5" />
      <path d="M11.5 12H16.5M6.5 12H7.5" />
      <path d="M15.2844 18.5846L19.0505 14.8295C19.4916 14.3902 20.2068 14.3902 20.6478 14.8295L21.1692 15.3488C21.6103 15.7881 21.6103 16.5004 21.1692 16.9397L17.4378 20.7114C17.223 20.9254 16.9481 21.0696 16.6494 21.1252L14.9566 21.4912C14.6893 21.549 14.4513 21.3126 14.5086 21.0463L14.8689 19.3698C14.9247 19.0723 15.0695 18.7986 15.2844 18.5846Z" />
    </svg>
  );
}

function SettingsTerminalIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.5 7.5L8.72654 8.55719C9.24218 9.00163 9.5 9.22386 9.5 9.5C9.5 9.77614 9.24218 9.99836 8.72654 10.4428L7.5 11.5" />
      <path d="M11.5 12.5H15.5" />
      <path d="M12 21C15.7497 21 17.6246 21 18.9389 20.0451C19.3634 19.7367 19.7367 19.3634 20.0451 18.9389C21 17.6246 21 15.7497 21 12C21 8.25027 21 6.3754 20.0451 5.06107C19.7367 4.6366 19.3634 4.26331 18.9389 3.95491C17.6246 3 15.7497 3 12 3C8.25027 3 6.3754 3 5.06107 3.95491C4.6366 4.26331 4.26331 4.6366 3.95491 5.06107C3 6.3754 3 8.25027 3 12C3 15.7497 3 17.6246 3.95491 18.9389C4.26331 19.3634 4.6366 19.7367 5.06107 20.0451C6.3754 21 8.25027 21 12 21Z" />
    </svg>
  );
}

function SettingsAgentIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5001 22L13.7318 20.8445C13.8936 20.0376 14.5333 19.4121 15.3436 19.2685L16.156 19.1244C17.214 18.9261 17.9047 17.9391 17.6987 16.9201L17.3258 15.0749L18.7846 13.9936C18.9503 13.8708 19.0298 13.6683 18.9898 13.4705C18.9714 13.3797 18.9288 13.295 18.866 13.2249L16.752 10.9684C16.5071 10.707 16.3452 10.3827 16.2275 10.0444C15.5249 8.02369 13.1412 5.11904 8.23162 6.25555C3.07736 7.44871 2.78666 11.9991 3.07736 13.4378C3.46185 15.3407 4.31306 16.452 5.18511 17.4085C6.24497 18.5711 6.26308 20.2323 5.32602 21.4957L4.95195 22" />
      <path d="M19.5 2.9375V4.5M19.5 4.5V6.0625M19.5 4.5H18.25M19.5 4.5H20.75M22 4.5L20.9156 4.13852C20.4179 3.97263 20.0274 3.58211 19.8615 3.08443L19.5 2L19.1385 3.08443C18.9726 3.58211 18.5821 3.97263 18.0844 4.13852L17 4.5L18.0844 4.86148C18.5821 5.02737 18.9726 5.41789 19.1385 5.91557L19.5 7L19.8615 5.91557C20.0274 5.41789 20.4179 5.02737 20.9156 4.86148L22 4.5Z" />
    </svg>
  );
}

function SettingsSecurityIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18.7088 3.49546C16.8165 2.55394 14.5009 2.00012 12 2.00012C9.4991 2.00012 7.1835 2.55394 5.29116 3.49547C4.36318 3.95718 3.89919 4.18804 3.4496 4.91391C3 5.63978 3 6.3426 3 7.74826V11.2372C3 16.9206 7.54236 20.0805 10.173 21.4339C10.9067 21.8114 11.2735 22.0001 12 22.0001C12.7265 22.0001 13.0933 21.8114 13.8269 21.4339C16.4576 20.0805 21 16.9206 21 11.2372L21 7.74827C21 6.34261 21 5.63978 20.5504 4.91391C20.1008 4.18804 19.6368 3.95718 18.7088 3.49546Z" />
      <path d="M12 9.00012V10.0001M11 9.50012C11 9.76534 11.1054 10.0197 11.2929 10.2072C11.4804 10.3948 11.7348 10.5001 12 10.5001C12.2652 10.5001 12.5196 10.3948 12.7071 10.2072C12.8946 10.0197 13 9.76534 13 9.50012C13 9.23491 12.8946 8.98055 12.7071 8.79302C12.5196 8.60548 12.2652 8.50012 12 8.50012C11.7348 8.50012 11.4804 8.60548 11.2929 8.79302C11.1054 8.98055 11 9.23491 11 9.50012Z" />
      <path d="M12.75 14.0001H11.25L12 10.5001L12.75 14.0001Z" />
    </svg>
  );
}

function SettingsUpdatesIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.50003 13.5V6.5H21.5V13.5C21.5 17.2712 21.5 19.1569 20.3285 20.3284C19.1569 21.5 17.2713 21.5 13.5 21.5H10.5C6.72879 21.5 4.84318 21.5 3.6716 20.3284C2.50003 19.1569 2.50003 17.2712 2.50003 13.5Z" />
      <path d="M2.50003 6.5L3.10003 5.7C4.27774 4.12972 4.86659 3.34458 5.71118 2.92229C6.55576 2.5 7.53718 2.5 9.50003 2.5H14.5C16.4629 2.5 17.4443 2.5 18.2889 2.92229C19.1335 3.34458 19.7223 4.12972 20.9 5.7L21.5 6.5" />
      <path d="M15 14.5C15 14.5 12.7906 17.5 12 17.5C11.2095 17.5 9.00003 14.5 9.00003 14.5M12 17L12 10.5" />
    </svg>
  );
}

function SettingsDiagnosticsIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        d="M13.5 13L17 9M14 15C14 16.1046 13.1046 17 12 17C10.8954 17 10 16.1046 10 15C10 13.8954 10.8954 13 12 13C13.1046 13 14 13.8954 14 15Z"
        strokeLinecap="round"
      />
      <path
        d="M6 12C6 8.68629 8.68629 6 12 6C13.0929 6 14.1175 6.29218 15 6.80269"
        strokeLinecap="round"
      />
      <path d="M2.50006 12.0001C2.50006 7.52172 2.50006 5.28255 3.8913 3.8913C5.28255 2.50006 7.52172 2.50006 12.0001 2.50006C16.4784 2.50006 18.7176 2.50006 20.1088 3.8913C21.5001 5.28255 21.5001 7.52172 21.5001 12.0001C21.5001 16.4784 21.5001 18.7176 20.1088 20.1088C18.7176 21.5001 16.4784 21.5001 12.0001 21.5001C7.52172 21.5001 5.28255 21.5001 3.8913 20.1088C2.50006 18.7176 2.50006 16.4784 2.50006 12.0001Z" />
    </svg>
  );
}

function SettingsAboutIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 9C9.5 7.61929 10.6193 6.5 12 6.5C13.3807 6.5 14.5 7.61929 14.5 9C14.5 9.85691 14.0689 10.6131 13.4117 11.0636C12.7283 11.5319 12 12.1716 12 13" />
      <path d="M12.125 16.25H12M12.25 16.25C12.25 16.3881 12.1381 16.5 12 16.5C11.8619 16.5 11.75 16.3881 11.75 16.25C11.75 16.1119 11.8619 16 12 16C12.1381 16 12.25 16.1119 12.25 16.25Z" />
      <path d="M18.7088 3.49534C16.8165 2.55382 14.5009 2 12 2C9.4991 2 7.1835 2.55382 5.29116 3.49534C4.36318 3.95706 3.89919 4.18792 3.4496 4.91378C3 5.63965 3 6.34248 3 7.74814V11.2371C3 16.9205 7.54236 20.0804 10.173 21.4338C10.9067 21.8113 11.2735 22 12 22C12.7265 22 13.0933 21.8113 13.8269 21.4338C16.4576 20.0804 21 16.9205 21 11.2371L21 7.74814C21 6.34249 21 5.63966 20.5504 4.91378C20.1008 4.18791 19.6368 3.95706 18.7088 3.49534Z" />
    </svg>
  );
}
