import { Switch as SettingsSwitch } from "../../shared/ui/Switch";
import {
  updateAppPreference,
  useAppPreferences,
  type EditorCursorStyle,
  type EditorLineNumbers,
  type EditorRenderWhitespace,
  type EditorWordWrap,
} from "./preferences";
import { CompactSelect, SettingsGroup, SettingsRow } from "./SettingsControls";

const wordWrapOptions: Array<{ label: string; value: EditorWordWrap }> = [
  { label: "Off", value: "off" },
  { label: "On", value: "on" },
  { label: "At 100 columns", value: "bounded" },
];

const lineNumberOptions: Array<{ label: string; value: EditorLineNumbers }> = [
  { label: "Absolute", value: "on" },
  { label: "Relative", value: "relative" },
  { label: "Hidden", value: "off" },
];

const whitespaceOptions: Array<{
  label: string;
  value: EditorRenderWhitespace;
}> = [
  { label: "Selection", value: "selection" },
  { label: "All", value: "all" },
  { label: "Hidden", value: "none" },
];

const cursorOptions: Array<{ label: string; value: EditorCursorStyle }> = [
  { label: "Line", value: "line" },
  { label: "Block", value: "block" },
  { label: "Underline", value: "underline" },
];

const tabSizeOptions = [
  { label: "2 spaces", value: "2" },
  { label: "4 spaces", value: "4" },
  { label: "8 spaces", value: "8" },
];

export function EditorSettings() {
  const preferences = useAppPreferences();

  return (
    <div className="settings-editor mt-6 pb-8">
      <SettingsGroup title="Layout">
        <SettingsRow
          description="Wrap long lines inside the available editor width."
          label="Word wrap"
        >
          <CompactSelect
            ariaLabel="Editor word wrap"
            onChange={(value) => updateAppPreference("editorWordWrap", value)}
            options={wordWrapOptions}
            value={preferences.editorWordWrap}
          />
        </SettingsRow>
        <SettingsRow
          description="Show a compact overview of the file on the right side."
          label="Minimap"
        >
          <SettingsSwitch
            checked={preferences.editorMinimap}
            label="Editor minimap"
            onChange={(checked) =>
              updateAppPreference("editorMinimap", checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description="Keep the current scopes visible while scrolling through long files."
          label="Sticky scroll"
        >
          <SettingsSwitch
            checked={preferences.editorStickyScroll}
            label="Editor sticky scroll"
            onChange={(checked) =>
              updateAppPreference("editorStickyScroll", checked)
            }
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Indentation">
        <SettingsRow
          description="Choose the width used for each indentation level."
          label="Tab size"
        >
          <CompactSelect
            ariaLabel="Editor tab size"
            onChange={(value) =>
              updateAppPreference("editorTabSize", Number(value))
            }
            options={tabSizeOptions}
            value={String(preferences.editorTabSize)}
          />
        </SettingsRow>
        <SettingsRow
          description="Insert spaces when pressing Tab instead of a tab character."
          label="Insert spaces"
        >
          <SettingsSwitch
            checked={preferences.editorInsertSpaces}
            label="Insert spaces for tabs"
            onChange={(checked) =>
              updateAppPreference("editorInsertSpaces", checked)
            }
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Display">
        <SettingsRow
          description="Control how line numbers are shown beside the code."
          label="Line numbers"
        >
          <CompactSelect
            ariaLabel="Editor line numbers"
            onChange={(value) =>
              updateAppPreference("editorLineNumbers", value)
            }
            options={lineNumberOptions}
            value={preferences.editorLineNumbers}
          />
        </SettingsRow>
        <SettingsRow
          description="Reveal spaces and tab characters when they are useful."
          label="Whitespace"
        >
          <CompactSelect
            ariaLabel="Editor whitespace"
            onChange={(value) =>
              updateAppPreference("editorRenderWhitespace", value)
            }
            options={whitespaceOptions}
            value={preferences.editorRenderWhitespace}
          />
        </SettingsRow>
        <SettingsRow
          description="Show gray type names next to variables and parameters."
          label="Inlay hints"
        >
          <SettingsSwitch
            checked={preferences.editorInlayHints}
            label="Editor inlay hints"
            onChange={(checked) =>
              updateAppPreference("editorInlayHints", checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description="Use distinct colors for matching nested brackets."
          label="Bracket pair colors"
        >
          <SettingsSwitch
            checked={preferences.editorBracketPairColorization}
            label="Bracket pair colorization"
            onChange={(checked) =>
              updateAppPreference("editorBracketPairColorization", checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description="Enable connected glyphs such as arrows and comparison operators."
          label="Font ligatures"
        >
          <SettingsSwitch
            checked={preferences.editorFontLigatures}
            label="Editor font ligatures"
            onChange={(checked) =>
              updateAppPreference("editorFontLigatures", checked)
            }
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Files">
        <SettingsRow
          description="Write remote file changes shortly after you stop typing. Manual Save still works."
          label="Auto save"
        >
          <SettingsSwitch
            checked={preferences.editorAutoSave}
            label="Auto save editor files"
            onChange={(checked) =>
              updateAppPreference("editorAutoSave", checked)
            }
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Interaction">
        <SettingsRow
          description="Choose the shape used for the active text cursor."
          label="Cursor style"
        >
          <CompactSelect
            ariaLabel="Editor cursor style"
            onChange={(value) =>
              updateAppPreference("editorCursorStyle", value)
            }
            options={cursorOptions}
            value={preferences.editorCursorStyle}
          />
        </SettingsRow>
        <SettingsRow
          description="Animate the editor viewport when navigating or scrolling."
          label="Smooth scrolling"
        >
          <SettingsSwitch
            checked={preferences.editorSmoothScrolling}
            label="Editor smooth scrolling"
            onChange={(checked) =>
              updateAppPreference("editorSmoothScrolling", checked)
            }
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
