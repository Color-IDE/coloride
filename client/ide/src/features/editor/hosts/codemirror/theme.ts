import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import type { EditorTheme, EditorViewOptions } from "../../core/types";

function baseColors(theme: EditorTheme) {
  if (theme === "light") {
    return {
      bg: "#ffffff",
      fg: "#171717",
      caret: "#171717",
      selection: "#d0d0d6",
      // Translucent so selection (painted under the line) stays visible.
      lineHighlight: "rgba(0, 0, 0, 0.04)",
      gutterFg: "#a1a1aa",
      gutterActiveFg: "#52525b",
      border: "#e4e4e6",
      comment: "#71717a",
      keyword: "#7c3aed",
      string: "#047857",
      number: "#b45309",
      function: "#1d4ed8",
      type: "#0e7490",
      operator: "#52525b",
      punctuation: "#52525b",
      property: "#0f766e",
      invalid: "#dc2626",
      matchingBracket: "#e4e4e7",
    };
  }
  return {
    bg: "#171717",
    fg: "#d4d4d4",
    caret: "#f0f4f8",
    selection: "#3a3d45",
    lineHighlight: "rgba(255, 255, 255, 0.04)",
    gutterFg: "#6b6b6b",
    gutterActiveFg: "#a0a0a5",
    border: "#333333",
    comment: "#6a9955",
    keyword: "#c586c0",
    string: "#ce9178",
    number: "#b5cea8",
    function: "#dcdcaa",
    type: "#4ec9b0",
    operator: "#d4d4d4",
    punctuation: "#d4d4d4",
    property: "#9cdcfe",
    invalid: "#f44747",
    matchingBracket: "#3b3b3b",
  };
}

/** Simple Coloride theme — defaults + colors. No selection geometry hacks. */
export function colorideTheme(theme: EditorTheme, options: EditorViewOptions): Extension[] {
  const c = baseColors(theme);
  const caretWidth =
    options.cursorStyle === "block" ? "0.6em" : options.cursorStyle === "underline" ? "0.12em" : "1.5px";

  const highlight = HighlightStyle.define([
    { tag: t.comment, color: c.comment, fontStyle: "italic" },
    { tag: t.lineComment, color: c.comment, fontStyle: "italic" },
    { tag: t.blockComment, color: c.comment, fontStyle: "italic" },
    { tag: t.keyword, color: c.keyword },
    { tag: [t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: c.keyword },
    { tag: t.string, color: c.string },
    { tag: t.number, color: c.number },
    { tag: t.bool, color: c.number },
    { tag: t.null, color: c.keyword },
    { tag: t.function(t.variableName), color: c.function },
    { tag: t.function(t.propertyName), color: c.function },
    { tag: t.definition(t.variableName), color: c.property },
    { tag: t.variableName, color: c.fg },
    { tag: t.typeName, color: c.type },
    { tag: t.className, color: c.type },
    { tag: t.propertyName, color: c.property },
    { tag: t.operator, color: c.operator },
    { tag: t.punctuation, color: c.punctuation },
    { tag: t.bracket, color: c.punctuation },
    { tag: t.angleBracket, color: c.punctuation },
    { tag: t.tagName, color: c.keyword },
    { tag: t.attributeName, color: c.property },
    { tag: t.attributeValue, color: c.string },
    { tag: t.meta, color: c.comment },
    { tag: t.invalid, color: c.invalid },
    { tag: t.regexp, color: c.string },
    { tag: t.escape, color: c.number },
    { tag: t.heading, color: c.keyword, fontWeight: "bold" },
    { tag: t.link, color: c.function, textDecoration: "underline" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strong, fontWeight: "bold" },
  ]);

  const viewTheme = EditorView.theme(
    {
      "&": {
        "--coloride-review-add-bg": theme === "light" ? "rgba(34, 197, 94, 0.10)" : "rgba(74, 222, 128, 0.10)",
        "--coloride-review-mod-bg": theme === "light" ? "rgba(212, 160, 23, 0.10)" : "rgba(210, 153, 34, 0.10)",
        "--coloride-review-del-bg": theme === "light" ? "rgba(239, 68, 68, 0.09)" : "rgba(248, 113, 113, 0.10)",
        "--coloride-review-add-number": theme === "light" ? "#54745e" : "#8ea995",
        "--coloride-review-mod-number": theme === "light" ? "#806b45" : "#b4a282",
        height: "100%",
        fontSize: `${options.fontSize}px`,
        fontFamily: options.fontFamily,
        fontVariantLigatures: options.fontLigatures ? "common-ligatures" : "none",
        backgroundColor: c.bg,
        color: c.fg,
      },
      ".cm-scopeGuideLayer": {
        pointerEvents: "none",
        zIndex: "0",
      },
      ".cm-scopeGuide": {
        pointerEvents: "none",
        backgroundColor: theme === "light" ? "rgba(0, 0, 0, 0.12)" : "rgba(255, 255, 255, 0.12)",
      },
      ".cm-scopeGuide-active": {
        backgroundColor: theme === "light" ? "rgba(0, 0, 0, 0.26)" : "rgba(255, 255, 255, 0.26)",
      },
      ".cm-scroller": {
        fontFamily: options.fontFamily,
        lineHeight: String(options.lineHeight),
        overflow: "auto",
        scrollbarWidth: "none",
        scrollbarGutter: "auto",
      },
      ".cm-content": {
        caretColor: c.caret,
        fontFamily: options.fontFamily,
        paddingTop: `${options.paddingTop ?? 0}px`,
        // Keep bottom pad tiny — large padding makes short files scroll for no reason.
        paddingBottom: "4px",
        boxSizing: "border-box",
        minHeight: "100%",
      },
      // Tailwind sets img { display:block } — CM needs these inline for caret.
      ".cm-widgetBuffer": {
        display: "inline",
        verticalAlign: "text-top",
        height: "1em",
        width: "0",
        maxWidth: "none",
        maxHeight: "none",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: c.caret,
        borderLeftWidth: caretWidth,
      },
      // Native selection stays transparent so CM's selectionLayer paints the
      // real highlight (avoids double-paint). Layer must be clearly visible.
      ".cm-line ::selection, .cm-line::selection, .cm-content ::selection": {
        backgroundColor: "transparent !important",
        color: "inherit",
      },
      ".cm-textSelectionLayer .cm-selectionPath": {
        overflow: "visible",
        pointerEvents: "none",
      },
      ".cm-textSelectionLayer .cm-selectionPath-fill": {
        fill: c.selection + " !important",
      },
      // Custom text layer sits above line backgrounds. Default CM layer is hidden.
      ".cm-textSelectionLayer": {
        zIndex: "1",
      },
      ".cm-selectionLayer": {
        zIndex: "0",
      },
      ".cm-selectionMatch": {
        backgroundColor: theme === "light" ? "rgba(0, 0, 0, 0.10)" : "rgba(255, 255, 255, 0.12)",
        borderRadius: "2px",
      },
      ".cm-selectionMatch-main": {
        backgroundColor: theme === "light" ? "rgba(0, 0, 0, 0.14)" : "rgba(255, 255, 255, 0.16)",
        borderRadius: "2px",
      },
      ".cm-activeLine": {
        backgroundColor: c.lineHighlight,
      },
      "&.cm-has-selection .cm-activeLine": {
        backgroundColor: "transparent",
      },
      "&.cm-has-selection .cm-activeLineGutter": {
        backgroundColor: "transparent",
      },
      ".cm-gutters": {
        backgroundColor: c.bg,
        color: c.gutterFg,
        border: "none",
      },
      ".cm-gutters.cm-gutters-before": {
        position: "relative",
        border: "none",
        boxShadow: "none",
        backgroundColor: c.bg,
      },
      ".cm-gutters.cm-gutters-after": {
        border: "none",
        boxShadow: "none",
        backgroundColor: c.bg,
      },
      ".cm-gutter-coloride-hunk-wash": {
        width: "0",
        minWidth: "0",
        overflow: "visible",
        pointerEvents: "none",
      },
      ".cm-gutter-coloride-hunk-wash .cm-gutterElement.coloride-hunk-gutter-add, .cm-gutter-coloride-hunk-wash .cm-gutterElement.coloride-hunk-gutter-del": {
        left: "0",
        width: "100%",
        pointerEvents: "none",
        zIndex: "0",
      },
      ".cm-gutter": {
        backgroundColor: "transparent",
      },
      ".cm-activeLineGutter": {
        backgroundColor: c.lineHighlight,
        color: c.gutterActiveFg,
      },
      ".cm-lineNumbers .cm-gutterElement.coloride-error-gutter-num, .cm-lineNumbers .cm-gutterElement.coloride-error-gutter-warn": {
        backgroundColor: "transparent",
        color: "inherit",
      },
      // Line numbers on selected rows — a bit brighter than default, not pure white.
      ".cm-lineNumbers .cm-gutterElement.coloride-selected-line-gutter": {
        color: theme === "light" ? "#52525b" : "#c8c8cc",
      },
      ".cm-line": {
        padding: "0",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 8px 0 6px",
        minWidth: "calc(3ch + 16px)",
        boxSizing: "border-box",
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        userSelect: "none",
        position: "relative",
      },
      ".cm-scroller::-webkit-scrollbar": {
        display: "none",
        width: "0",
        height: "0",
      },
      ".cm-gutter-lint": {
        display: "none",
      },
      ".cm-gutter-coloride-change": {
        width: "3px",
        minWidth: "3px",
      },
      ".cm-gutter-coloride-change .cm-gutterElement": {
        padding: "0",
        cursor: "pointer",
      },
      ".cm-gutter-coloride-change .coloride-change-add": {
        backgroundColor: theme === "light" ? "#2da44e" : "#3fb950",
      },
      ".cm-gutter-coloride-change .coloride-change-mod": {
        backgroundColor: theme === "light" ? "#d4a017" : "#d29922",
      },
      ".cm-gutter-coloride-change .coloride-change-del": {
        backgroundColor: theme === "light" ? "#cf222e" : "#f85149",
      },

      ".cm-foldGutter": {
        width: "18px",
        minWidth: "18px",
        position: "relative",
        zIndex: "2",
        userSelect: "none",
      },
      ".cm-foldGutter .cm-gutterElement": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
      ".cm-foldGutter .cm-gutterElement.coloride-fold-wash-add, .cm-foldGutter .cm-gutterElement.coloride-fold-wash-add.cm-activeLineGutter": {
        backgroundColor: "var(--coloride-review-add-bg)",
      },
      ".cm-foldGutter .cm-gutterElement.coloride-fold-wash-mod, .cm-foldGutter .cm-gutterElement.coloride-fold-wash-mod.cm-activeLineGutter": {
        backgroundColor: "var(--coloride-review-mod-bg)",
      },
      ".cm-foldGutter .cm-gutterElement.coloride-fold-wash-del, .cm-foldGutter .cm-gutterElement.coloride-fold-wash-del.cm-activeLineGutter": {
        backgroundColor: "var(--coloride-review-del-bg)",
      },
      ".cm-foldGutter .cm-gutterElement-placeholder": {
        padding: "0",
      },
      ".coloride-fold-btn": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "14px",
        height: "14px",
        borderRadius: "4px",
        color: c.gutterFg,
        cursor: "pointer",
        lineHeight: "0",
        opacity: "0",
      },
      ".cm-foldGutter:hover .coloride-fold-btn": {
        opacity: "1",
      },
      ".coloride-fold-btn svg": {
        display: "block",
        width: "10px",
        height: "10px",
        transition: "transform 0.12s ease",
      },
      ".coloride-fold-btn.is-closed svg": {
        transform: "rotate(-90deg)",
      },
      ".coloride-fold-btn:hover": {
        backgroundColor: theme === "light" ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.10)",
        color: c.gutterActiveFg,
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        border: "none",
        color: c.gutterFg + " !important",
        margin: "0 2px",
        padding: "0 4px",
        borderRadius: "3px",
        cursor: "pointer",
      },
      ".cm-foldPlaceholder:hover": {
        backgroundColor: theme === "light" ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.08)",
      },
      // Custom error gutter (circle+X) left of line numbers — compact, not flush to edge
      ".cm-gutter-coloride-error": {
        width: "20px",
        minWidth: "20px",
      },
      ".cm-gutter-coloride-error .cm-gutterElement": {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "0 2px 0 6px",
        boxSizing: "border-box",
      },
      ".coloride-error-marker": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "12px",
        height: "12px",
        lineHeight: "0",
        color: "#ef4444",
        cursor: "default",
        flexShrink: "0",
      },
      ".coloride-error-marker svg": {
        display: "block",
        width: "12px",
        height: "12px",
      },
      ".coloride-error-marker-warning": {
        color: "#f59e0b",
      },
      ".coloride-error-marker-info": {
        color: "#3b82f6",
      },
      ".coloride-error-marker-hint": {
        color: "#a1a1aa",
      },
      ".cm-line.coloride-error-line-error, .cm-line.coloride-error-line-warning, .cm-line.coloride-error-line-info, .cm-line.coloride-error-line-hint": {
        backgroundColor: "transparent",
      },
      // Right-side minimap (@replit/codemirror-minimap)
      ".cm-minimap-gutter, .cm-gutters-after": {
        border: "none",
        backgroundColor: c.bg,
      },
      ".cm-minimap-gutter": {
        borderLeft: `1px solid ${theme === "light" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)"}`,
      },
      ".coloride-minimap, .cm-minimap": {
        backgroundColor: c.bg,
      },
      ".cm-minimap-overlay": {
        backgroundColor: theme === "light" ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.07)",
      },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: c.matchingBracket,
        outline: "none",
      },
      ".cm-tooltip": {
        backgroundColor: theme === "light" ? "#f0f0f2" : "#212121",
        border: `1px solid ${c.border}`,
        color: c.fg,
        borderRadius: "6px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        fontSize: "12.5px",
        overflow: "hidden",
        zIndex: "50000",
      },
      /* Autocomplete — max width, truncate overflow, rounded rows, no scrollbar */
      ".cm-tooltip.cm-tooltip-autocomplete": {
        padding: "2px",
        minWidth: "240px",
        maxWidth: "480px",
        borderRadius: "6px",
        overflow: "visible",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul": {
        fontFamily: "inherit",
        maxHeight: "240px",
        overflowX: "hidden",
        overflowY: "auto",
        padding: "0",
        margin: "0",
        scrollPadding: "2px",
        scrollbarWidth: "none",
        scrollbarColor: "transparent transparent",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
        padding: "2px 6px",
        lineHeight: "1.45",
        margin: "0 2px",
        border: "2px solid transparent",
        borderLeft: "0",
        borderRight: "0",
        backgroundClip: "padding-box",
        borderRadius: "4px",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: c.selection,
        borderRadius: "4px",
      },
      ".cm-completionIcon": {
        display: "none !important",
        width: "0 !important",
        minWidth: "0 !important",
        margin: "0 !important",
        padding: "0 !important",
      },
      ".cm-completionLabel": {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "12.5px",
        whiteSpace: "nowrap",
      },
      ".cm-completion-kind-function .cm-completionLabel, .cm-completion-kind-method .cm-completionLabel": {
        color: theme === "light" ? "#7c3aed" : "#dcdcaa",
      },
      ".cm-completion-kind-class .cm-completionLabel": {
        color: theme === "light" ? "#b45309" : "#ee9d28",
      },
      ".cm-completion-kind-interface .cm-completionLabel, .cm-completion-kind-type .cm-completionLabel": {
        color: theme === "light" ? "#0e7490" : "#4ec9b0",
      },
      ".cm-completion-kind-variable .cm-completionLabel, .cm-completion-kind-property .cm-completionLabel": {
        color: theme === "light" ? "#1d4ed8" : "#9cdcfe",
      },
      ".cm-completion-kind-constant .cm-completionLabel, .cm-completion-kind-enum .cm-completionLabel": {
        color: theme === "light" ? "#0e7490" : "#4fc1f7",
      },
      ".cm-completion-kind-keyword .cm-completionLabel": {
        color: theme === "light" ? "#7c3aed" : "#c586c0",
      },
      ".cm-completion-kind-namespace .cm-completionLabel, .cm-completion-kind-module .cm-completionLabel": {
        color: theme === "light" ? "#b45309" : "#d7ba7d",
      },
      ".cm-completionMatchedText": {
        textDecoration: "none",
        fontWeight: "600",
        color: "inherit",
      },
      ".cm-completionDetail": {
        marginLeft: "0",
        fontStyle: "normal",
        fontSize: "12.5px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        color: theme === "light" ? "#a1a1aa" : "#85858a",
        opacity: "1",
        whiteSpace: "nowrap",
      },
      ".cm-completionInfo": {
        maxWidth: "480px",
        padding: "8px 10px",
        lineHeight: "1.45",
        whiteSpace: "pre-wrap",
        overflow: "auto",
        maxHeight: "240px",
        scrollbarWidth: "none",
      },
      ".cm-panels": {
        backgroundColor: theme === "light" ? "#fafafa" : "#212121",
        color: c.fg,
        borderTop: `1px solid ${c.border}`,
      },
      /* All matches while typing in find bar */
      ".cm-searchMatch": {
        backgroundColor: theme === "light" ? "rgba(250, 204, 21, 0.55)" : "rgba(234, 179, 8, 0.32)",
        outline: theme === "light" ? "1px solid rgba(180, 83, 9, 0.45)" : "1px solid rgba(250, 204, 21, 0.28)",
        borderRadius: "2px",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: theme === "light" ? "rgba(245, 158, 11, 0.78)" : "rgba(250, 204, 21, 0.55)",
        outline: theme === "light" ? "1px solid rgba(146, 64, 14, 0.65)" : "1px solid rgba(253, 224, 71, 0.55)",
      },
      /* Persistent “find in selection” range (until toggle off) */
      /* Agent edit — green/red always visible; Keep/Undo bar is hover-only */
      ".cm-agent-line-add": {
        backgroundColor: "var(--coloride-review-add-bg)",
      },
      ".cm-activeLine.cm-agent-line-add, .cm-agent-line-add.cm-activeLine": {
        backgroundColor: "var(--coloride-review-add-bg)",
      },
      ".cm-agent-line-mod, .cm-activeLine.cm-agent-line-mod": {
        backgroundColor: "var(--coloride-review-mod-bg)",
      },
      /* Deleted ghost line — same content column as normal lines */
      ".cm-agent-line-del-wrap": {
        display: "flex",
        alignItems: "stretch",
        boxSizing: "border-box",
        width: "100%",
        height: "1.5em",
        minHeight: "1.5em",
        lineHeight: "1.5",
        backgroundColor: "var(--coloride-review-del-bg)",
      },
      ".cm-gutterElement.coloride-hunk-gutter-add": {
        backgroundColor: "var(--coloride-review-add-bg)",
      },
      ".cm-gutterElement.coloride-hunk-gutter-del": {
        backgroundColor: "var(--coloride-review-del-bg)",
      },
      ".cm-lineNumbers .cm-gutterElement.coloride-hunk-gutter-add, .cm-lineNumbers .cm-gutterElement.coloride-hunk-gutter-add.cm-activeLineGutter": {
        backgroundColor: "var(--coloride-review-add-bg)",
        color: "var(--coloride-review-add-number)",
      },
      ".cm-lineNumbers .cm-gutterElement.coloride-hunk-gutter-mod, .cm-lineNumbers .cm-gutterElement.coloride-hunk-gutter-mod.cm-activeLineGutter": {
        backgroundColor: "var(--coloride-review-mod-bg)",
        color: "var(--coloride-review-mod-number)",
      },
      ".cm-lineNumbers .cm-gutterElement.coloride-hunk-gutter-del, .cm-lineNumbers .cm-gutterElement.coloride-hunk-gutter-del.cm-activeLineGutter": {
        backgroundColor: "var(--coloride-review-del-bg)",
        color: "transparent",
      },
      ".cm-agent-line-del": {
        display: "flex",
        alignItems: "center",
        boxSizing: "border-box",
        width: "100%",
        height: "100%",
        minHeight: "1.5em",
        padding: "0 2px 0 0",
        marginLeft: "0",
        color: theme === "light" ? "rgba(127, 29, 29, 0.62)" : "rgba(254, 202, 202, 0.62)",
        fontFamily: "inherit",
        fontSize: "inherit",
        lineHeight: "1.5",
        whiteSpace: "pre",
        overflow: "hidden",
        textOverflow: "ellipsis",
        opacity: "0.9",
      },
      ".cm-hunk-gutter-wash-layer": {
        pointerEvents: "none",
      },
      ".coloride-hunk-gutter-del-wash": {
        backgroundColor: theme === "light" ? "rgba(239, 68, 68, 0.09)" : "rgba(248, 113, 113, 0.10)",
      },
      /* Layer hosts both: static card + per-hunk float with ⌘N/⌘Y */
      ".cm-agent-hunk-actions-layer": {
        position: "absolute",
        inset: "0",
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: "40",
      },
      ".cm-agent-hunk-actions": {
        position: "absolute",
        display: "none",
        alignItems: "center",
        boxSizing: "border-box",
        margin: "0",
        userSelect: "none",
        pointerEvents: "none",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: theme === "light" ? "#3f3f46" : "#e4e4e7",
      },
      ".cm-agent-hunk-actions.is-visible": {
        display: "inline-flex",
        pointerEvents: "auto",
      },
      /* —— Static bottom-center card: [ ^ 1/1 v ] Undo [Keep] —— */
      ".cm-agent-hunk-card": {
        gap: "2px",
        padding: "4px 5px 4px 4px",
        borderRadius: "6px",
        backgroundColor: theme === "light" ? "#f0f0f2" : "#212121",
        border: "none",
        boxShadow: "none",
        filter: "none",
        backdropFilter: "none",
        /* Centered on the editor X axis */
        left: "50%",
        right: "auto",
        transform: "translateX(-50%)",
      },
      ".cm-agent-hunk-card .cm-agent-hunk-nav": {
        pointerEvents: "auto",
        display: "inline-flex",
        alignItems: "center",
        gap: "0",
        padding: "0 2px 0 0",
        backgroundColor: "transparent",
        fontSize: "12px",
        fontWeight: "400",
        lineHeight: "1",
      },
      ".cm-agent-hunk-card .cm-agent-hunk-undo": {
        backgroundColor: "transparent",
        color: theme === "light" ? "#52525b" : "#a1a1aa",
        padding: "4px 8px",
        fontWeight: "500",
      },
      ".cm-agent-hunk-card .cm-agent-hunk-undo:hover": {
        backgroundColor: "transparent",
        color: theme === "light" ? "#27272a" : "#f4f4f5",
      },
      /* Same green as hover float Keep */
      ".cm-agent-hunk-card .cm-agent-hunk-keep": {
        backgroundColor: theme === "light" ? "#2f9e62" : "#5a8f76",
        color: theme === "light" ? "#ffffff" : "#ecfdf5",
        fontWeight: "500",
      },
      ".cm-agent-hunk-card .cm-agent-hunk-keep:hover": {
        backgroundColor: theme === "light" ? "#278656" : "#64997f",
      },
      /* —— Float near active hunk: [ ^ n/m v ] Undo⌘N Keep⌘Y —— */
      ".cm-agent-hunk-float": {
        gap: "6px",
        padding: "0",
        margin: "0",
        background: "transparent",
        border: "none",
        boxShadow: "none",
      },
      ".cm-agent-hunk-float .cm-agent-hunk-nav": {
        pointerEvents: "auto",
        display: "inline-flex",
        alignItems: "center",
        gap: "2px",
        padding: "2px 4px",
        borderRadius: "4px",
        backgroundColor: theme === "light" ? "#f0f0f2" : "#212121",
        color: theme === "light" ? "#3f3f46" : "#e4e4e7",
        fontSize: "12px",
        fontWeight: "400",
        lineHeight: "1",
      },
      ".cm-agent-hunk-float .cm-agent-hunk-nav-count": {
        minWidth: "3.2em",
        fontWeight: "400",
      },
      ".cm-agent-hunk-float .cm-agent-hunk-undo": {
        backgroundColor: theme === "light" ? "#f0f0f2" : "#212121",
        color: theme === "light" ? "#3f3f46" : "#e4e4e7",
        fontWeight: "400",
        padding: "4px 7px",
      },
      ".cm-agent-hunk-float .cm-agent-hunk-undo:hover": {
        backgroundColor: theme === "light" ? "#e2e2e6" : "#45454a",
      },
      ".cm-agent-hunk-float .cm-agent-hunk-keep": {
        backgroundColor: theme === "light" ? "#2f9e62" : "#5a8f76",
        color: theme === "light" ? "#ffffff" : "#ecfdf5",
        fontWeight: "400",
        padding: "4px 7px",
      },
      ".cm-agent-hunk-float .cm-agent-hunk-keep:hover": {
        backgroundColor: theme === "light" ? "#278656" : "#64997f",
      },
      ".cm-agent-hunk-nav-btn": {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0",
        padding: "3px",
        border: "none",
        borderRadius: "4px",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        opacity: "0.9",
      },
      ".cm-agent-hunk-nav-btn:hover:not(:disabled)": {
        opacity: "1",
        backgroundColor: "transparent",
      },
      ".cm-agent-hunk-nav-btn:disabled": {
        opacity: "0.35",
        cursor: "default",
      },
      ".cm-agent-hunk-nav-count": {
        padding: "0 2px",
        minWidth: "2.1em",
        textAlign: "center",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        fontSize: "12px",
        fontWeight: "500",
      },
      ".cm-agent-hunk-btn": {
        pointerEvents: "auto",
        display: "inline-flex",
        alignItems: "center",
        margin: "0",
        padding: "4px 9px",
        border: "none",
        borderRadius: "4px",
        boxShadow: "none !important",
        filter: "none",
        textShadow: "none",
        fontFamily: "inherit",
        fontSize: "12px",
        lineHeight: "1.2",
        letterSpacing: "0.01em",
        cursor: "pointer",
        transition: "background-color 100ms ease, color 100ms ease, opacity 100ms ease",
      },
      ".cm-agent-hunk-btn:hover": {
        filter: "none",
        boxShadow: "none !important",
      },
      ".cm-agent-hunk-kbd": {
        display: "inline-flex",
        alignItems: "center",
        gap: "2px",
        marginLeft: "5px",
        fontSize: "11px",
        fontWeight: "400",
        opacity: "0.88",
        fontFamily: "inherit",
        lineHeight: "1",
      },
      ".cm-agent-hunk-key-icon": {
        display: "block",
        width: "10px",
        height: "10px",
        flexShrink: "0",
      },
      ".cm-findScope": {
        backgroundColor: theme === "light" ? "rgba(37, 99, 235, 0.16)" : "rgba(96, 165, 250, 0.2)",
        boxShadow: theme === "light" ? "inset 0 0 0 1px rgba(37, 99, 235, 0.28)" : "none",
        borderRadius: "2px",
      },
      ".cm-lintRange": {
        position: "relative",
        backgroundColor: "transparent",
      },
      ".cm-inlay-hint": {
        color: c.gutterFg,
        fontStyle: "italic",
        opacity: "0.78",
        pointerEvents: "none",
      },
      ".cm-lintRange-error, .cm-lintRange-warning, .cm-lintRange-info, .cm-lintRange-hint": {
        backgroundColor: "transparent",
      },
      ".cm-tooltip-lint": {
        display: "none",
      },
    },
    { dark: theme === "dark" },
  );

  return [viewTheme, syntaxHighlighting(theme === "light" ? highlight : oneDarkHighlightStyle)];
}
