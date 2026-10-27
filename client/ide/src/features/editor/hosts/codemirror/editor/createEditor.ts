import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { forEachDiagnostic, lintKeymap } from "@codemirror/lint";
import {
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  SearchQuery,
  selectNextOccurrence,
  setSearchQuery,
} from "@codemirror/search";
import {
  EditorSelection,
  EditorState,
  Prec,
  type Extension,
} from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import { isFindInFileEvent } from "../../../../settings/shortcuts";
import type {
  EditorCommandId,
  EditorHandle,
  EditorTheme,
  EditorViewOptions,
} from "../../../core/types";
import {
  acceptAgentEditHunk,
  acceptAllAgentEditHunks,
  agentEditDecorations,
  agentEditRemoteAnnotation,
  agentHunkActionsPlugin,
  agentReviewScrollGuard,
  applyAgentEditMarks,
  getAgentEditFieldState,
  rejectAgentEditHunk,
  rejectAllAgentEditHunks,
  setAgentEditSession,
  subscribeAgentEditHunkResults,
} from "../agentEditDecorations";
import { breakpointGutter } from "../breakpointGutter";
import {
  changeGutter,
  markChangeBaseline,
  resetChangeBaseline,
} from "../changeGutter";
import { editorCommands } from "../editorCommands";
import { editorContextMenuExtension } from "../editorContextMenu";
import { errorDiagnosticsUi } from "../errorGutter";
import { findScopeExtension, setFindScopeEffect } from "../findScope";
import { foldGutter } from "../foldGutter";
import { gotoDefinitionExtension, symbolRangeAt } from "../gotoDefinition";
import { languageExtension } from "../languages";
import {
  LSP_AUTOCOMPLETE_ENABLED,
  lspCompletionExtension,
} from "../lspCompletion";
import { lspFormatExtension } from "../lspFormat";
import { lspInlayHintsExtension } from "../lspInlayHints";
import { lspReferencesExtension } from "../lspReferences";
import { lspRenameExtension } from "../lspRename";
import { lspSignatureHelpExtension } from "../lspSignatureHelp";
import { lspSymbolsExtension } from "../lspSymbols";
import { MarkerStore } from "../markers";
import { minimapExtension } from "../minimap";
import { overlayScrollbar } from "../overlayScrollbar";
import { pathAndUrlLinksExtension } from "../pathAndUrlLinks";
import { scopeGuides } from "../scopeGuides";
import { searchMatchHighlighter } from "../searchHighlights";
import { highlightSelectedLineGutter } from "../selectedLineGutter";
import { editorShortcut } from "../shortcutBinding";
import { collectSyntaxMarkers, SYNTAX_OWNER } from "../syntaxLint";
import { textOnlySelection } from "../textSelection";
import { codeRefCopyExtension } from "./clipboard";
import { runEditorCommand } from "./commands";
import {
  editableCompartment,
  inlayHintsCompartment,
  langCompartment,
  lineNumberCompartment,
  minimapCompartment,
  tabCompartment,
  themeCompartment,
  wrapCompartment,
} from "./compartments";
import { buildThemeExt, lineNumberExt, tabExt } from "./extensions";
import { applyFindQuery, computeFindStatus, emptyFindStatus } from "./find";
import {
  type CodeMirrorHost,
  type CreateCodeMirrorEditorParams,
} from "./types";

export function createCodeMirrorEditor(
  params: CreateCodeMirrorEditorParams,
): CodeMirrorHost {
  const markers = new MarkerStore();
  let currentPath = params.path;
  let currentLanguage = params.language;
  let currentOptions = params.options;
  let currentTheme = params.theme;
  let suppressChange = false;
  let syntaxTimer: number | null = null;
  let syntaxFollowUp: number | null = null;
  // Late-bound: listener runs after `view` exists.
  let viewRef: EditorView | null = null;

  function countDiagnostics(view: EditorView): {
    errors: number;
    warnings: number;
  } {
    let errors = 0;
    let warnings = 0;
    forEachDiagnostic(view.state, (d) => {
      if (d.severity === "error") errors += 1;
      else if (d.severity === "warning") warnings += 1;
    });
    return { errors, warnings };
  }

  function emitDiagnostics(view: EditorView) {
    if (!params.onDiagnosticsChange) return;
    params.onDiagnosticsChange(countDiagnostics(view));
  }

  function refreshSyntaxMarkers() {
    const view = viewRef;
    if (!view) return;
    markers.set(SYNTAX_OWNER, collectSyntaxMarkers(view, currentLanguage));
    markers.apply(view);
    emitDiagnostics(view);
  }

  function scheduleSyntaxLint(immediate = false) {
    if (syntaxTimer != null) window.clearTimeout(syntaxTimer);
    if (syntaxFollowUp != null) window.clearTimeout(syntaxFollowUp);
    const run = () => {
      syntaxTimer = null;
      refreshSyntaxMarkers();
      // Parser may still be catching up on larger files — one follow-up pass.
      syntaxFollowUp = window.setTimeout(() => {
        syntaxFollowUp = null;
        refreshSyntaxMarkers();
      }, 500);
    };
    if (immediate) {
      window.requestAnimationFrame(run);
      return;
    }
    syntaxTimer = window.setTimeout(run, 350);
  }

  const emitCursor = (state: EditorState) => {
    if (!params.onCursorChange) return;
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    params.onCursorChange({ line: line.number, column: pos - line.from + 1 });
  };

  const updateListener = EditorView.updateListener.of((update) => {
    const agentRemote = update.transactions.some((tr) =>
      tr.annotation(agentEditRemoteAnnotation),
    );
    if (suppressChange || agentRemote) {
      // External setDoc / hunk Reject — lint + cursor only (hunk listener owns onChange).
      if (update.docChanged) {
        markers.pruneTouched(
          update.startState.doc,
          update.changes,
          update.state.doc,
          SYNTAX_OWNER,
        );
        const view = update.view;
        queueMicrotask(() => {
          if (viewRef !== view) return;
          markers.apply(view);
          emitDiagnostics(view);
        });
        scheduleSyntaxLint();
      }
      if (update.selectionSet || update.docChanged) emitCursor(update.state);
      return;
    }
    if (update.docChanged) {
      params.onChange?.(update.state.doc.toString());
      markers.pruneTouched(
        update.startState.doc,
        update.changes,
        update.state.doc,
        SYNTAX_OWNER,
      );
      const view = update.view;
      queueMicrotask(() => {
        if (viewRef !== view) return;
        markers.apply(view);
        emitDiagnostics(view);
      });
      scheduleSyntaxLint();
    }
    if (update.selectionSet || update.docChanged) {
      emitCursor(update.state);
    }
  });

  const featureKeymap = Prec.high(
    keymap.of([
      editorShortcut("editor.go-to-definition", (view) => {
        const pos = view.state.selection.main.head;
        const range = symbolRangeAt(view.state, pos);
        const target = range?.from ?? pos;
        const line = view.state.doc.lineAt(target);
        const column = target - line.from + 1;
        params.onGoToDefinition?.(line.number, column);
        return true;
      }),
      {
        // Some platforms surface this; real navigation is also on mousedown.
        key: "Mod-Click",
        run: (view) => {
          const pos = view.state.selection.main.head;
          const range = symbolRangeAt(view.state, pos);
          if (!range) return false;
          const line = view.state.doc.lineAt(range.from);
          const column = range.from - line.from + 1;
          params.onGoToDefinition?.(line.number, column);
          return true;
        },
      },
      editorShortcut("editor.select-next", selectNextOccurrence),
      {
        any: (_view, event) => {
          if (!isFindInFileEvent(event)) return false;
          event.preventDefault();
          params.onFindRequest?.();
          return true;
        },
      },
      {
        key: "Escape",
        run: (view) => {
          // Clear highlights if a query is active; UI close is handled outside.
          const q = getSearchQuery(view.state);
          if (!q.search) return false;
          view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: "" })),
          });
          return false; // let React find bar also handle Escape
        },
      },
    ]),
  );

  // Keep find next/prev shortcuts; drop default openSearchPanel (ugly CM panel).
  const filteredSearchKeymap = searchKeymap.filter(
    (binding) => binding.key !== "Mod-f" && binding.key !== "Mod-Shift-f",
  );

  // Definition links are for code files only, never markdown.
  const gotoDefinition = Prec.highest(
    gotoDefinitionExtension(
      params.onGoToDefinition,
      params.canJumpToDefinition,
      { path: params.path, language: params.language, showCandidate: true },
    ),
  );

  // Cmd+click URLs + file paths (works in code, markdown, configs).
  const pathUrlLinks =
    params.onOpenPath || params.onOpenUrl
      ? Prec.highest(
          pathAndUrlLinksExtension({
            currentPath: params.path,
            workspaceRoot: params.workspaceRoot ?? null,
            onOpenPath: (p) => params.onOpenPath?.(p),
            onOpenUrl: (u) => params.onOpenUrl?.(u),
          }),
        )
      : [];

  const extensions: Extension[] = [
    langCompartment.of(languageExtension(params.language)),
    themeCompartment.of(buildThemeExt(params.theme, params.options)),
    editableCompartment.of([
      EditorView.editable.of(!params.options.readOnly),
      EditorState.readOnly.of(Boolean(params.options.readOnly)),
    ]),
    wrapCompartment.of(
      params.options.wordWrap === "off" ? [] : EditorView.lineWrapping,
    ),
    changeGutter(),
    agentEditDecorations,
    breakpointGutter(() => currentPath),
    // Error icon gutter must come before line numbers so it sits on the left.
    errorDiagnosticsUi(),
    lineNumberCompartment.of(lineNumberExt(params.options.lineNumbers)),
    // Give the fold gutter lower precedence than line numbers so its chevron
    // sits in the narrow column immediately before the code, never at the
    // far-left edge of the editor.
    Prec.lowest(foldGutter()),
    tabCompartment.of(tabExt(params.options)),
    minimapCompartment.of(minimapExtension(Boolean(params.options.minimap))),
    highlightActiveLineGutter(),
    highlightSelectedLineGutter(),
    highlightSpecialChars(),
    scopeGuides(),
    editorCommands(),
    overlayScrollbar(),
    params.onContextMenu
      ? editorContextMenuExtension(params.onContextMenu)
      : [],
    history(),
    drawSelection(),
    textOnlySelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    // Alt+click adds a caret. Cmd/Ctrl+click goes to the definition.
    EditorView.clickAddsSelectionRange.of((event) => event.altKey),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    params.onCompletion && LSP_AUTOCOMPLETE_ENABLED
      ? lspCompletionExtension(
          () => currentPath,
          params.onCompletion,
          params.onResolveCompletion,
        )
      : [],
    params.onSignatureHelp
      ? lspSignatureHelpExtension(() => currentPath, params.onSignatureHelp)
      : [],
    params.onFindReferences && params.onOpenLocation
      ? lspReferencesExtension({
          getPath: () => currentPath,
          workspaceRoot: params.workspaceRoot,
          find: params.onFindReferences,
          open: params.onOpenLocation,
        })
      : [],
    params.onPrepareRename && params.onRenameSymbol
      ? lspRenameExtension({
          getPath: () => currentPath,
          prepare: params.onPrepareRename,
          rename: params.onRenameSymbol,
          applyFiles: params.onApplyRenameFiles,
        })
      : [],
    params.onFormatDocument
      ? lspFormatExtension(
          () => currentPath,
          () => ({
            tabSize: currentOptions.tabSize,
            insertSpaces: currentOptions.insertSpaces,
          }),
          params.onFormatDocument,
          params.onOrganizeImports,
        )
      : [],
    params.onDocumentSymbols
      ? lspSymbolsExtension(() => currentPath, params.onDocumentSymbols)
      : [],
    inlayHintsCompartment.of(
      params.onInlayHints && params.options.inlayHints !== false
        ? lspInlayHintsExtension(() => currentPath, params.onInlayHints)
        : [],
    ),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    EditorView.editorAttributes.compute(["selection"], (state) => ({
      class: state.selection.ranges.some((range) => !range.empty)
        ? "cm-has-selection"
        : "",
    })),
    highlightSelectionMatches({
      highlightWordAroundCursor: true,
      wholeWords: true,
      minSelectionLength: 2,
    }),
    search({ top: true }),
    // Custom highlighter: CM only paints matches when its own panel is open.
    searchMatchHighlighter,
    findScopeExtension,
    // Top-level so the floating Accept/Reject layer always mounts (not buried in field.provide).
    agentHunkActionsPlugin,
    // Short files + review widgets make ArrowDown scroll the text upward.
    agentReviewScrollGuard,
    codeRefCopyExtension(() => currentPath),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...filteredSearchKeymap,
      ...historyKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    featureKeymap,
    gotoDefinition,
    pathUrlLinks,
    updateListener,
    EditorView.editorAttributes.of({
      class: "coloride-code-editor",
      "data-path": params.path,
    }),
  ];

  const state = EditorState.create({
    doc: params.doc,
    extensions,
  });

  const view = new EditorView({
    state,
    parent: params.parent,
  });
  viewRef = view;
  // Initial parse diagnostics (no LSP required).
  scheduleSyntaxLint(true);
  emitCursor(view.state);

  const handle: EditorHandle = {
    focus() {
      view.focus();
    },
    reveal(req) {
      const lineNo = Math.max(1, Math.min(req.line, view.state.doc.lines));
      const line = view.state.doc.line(lineNo);
      const col = Math.max(1, req.column ?? 1);
      const pos = Math.min(line.from + col - 1, line.to);
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "center" }),
      });
      view.focus();
    },
    getValue() {
      return view.state.doc.toString();
    },
    runCommand(command: EditorCommandId) {
      return runEditorCommand(view, command, params);
    },
    markChangeBaseline() {
      markChangeBaseline(view);
    },
    setMarkers(owner, list) {
      // Never let external owners wipe local syntax diagnostics.
      if (owner === SYNTAX_OWNER) return;
      markers.set(owner, list);
      // Re-merge with latest syntax markers so LSP + syntax coexist.
      markers.set(SYNTAX_OWNER, collectSyntaxMarkers(view, currentLanguage));
      markers.apply(view);
      emitDiagnostics(view);
    },
    clearMarkers(owner) {
      if (owner === SYNTAX_OWNER) return;
      markers.clear(owner);
      markers.set(SYNTAX_OWNER, collectSyntaxMarkers(view, currentLanguage));
      markers.apply(view);
      emitDiagnostics(view);
    },
    getCursor() {
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      return { line: line.number, column: pos - line.from + 1 };
    },
    getDiagnosticCounts() {
      return countDiagnostics(view);
    },
    getMarkers() {
      return markers.visible(view.state.doc);
    },
    getPath() {
      return currentPath;
    },
    getSelectedText() {
      const sel = view.state.selection.main;
      if (sel.empty) return "";
      return view.state.sliceDoc(sel.from, sel.to);
    },
    getSelectionRange() {
      const sel = view.state.selection.main;
      if (sel.empty) return null;
      return { from: sel.from, to: sel.to };
    },
    setFindQuery(options, jump = "none") {
      return applyFindQuery(view, options, jump);
    },
    findNext() {
      const q = getSearchQuery(view.state);
      if (!q.valid || !q.search) return emptyFindStatus();
      findNext(view);
      return computeFindStatus(view);
    },
    findPrevious() {
      const q = getSearchQuery(view.state);
      if (!q.valid || !q.search) return emptyFindStatus();
      findPrevious(view);
      return computeFindStatus(view);
    },
    replaceNext() {
      const q = getSearchQuery(view.state);
      if (!q.valid || !q.search) return emptyFindStatus();
      replaceNext(view);
      return computeFindStatus(view);
    },
    replaceAll() {
      const q = getSearchQuery(view.state);
      if (!q.valid || !q.search) return emptyFindStatus();
      replaceAll(view);
      return computeFindStatus(view);
    },
    clearFind() {
      view.dispatch({
        effects: [
          setSearchQuery.of(new SearchQuery({ search: "" })),
          setFindScopeEffect.of(null),
        ],
      });
    },
    highlightAgentEdit(before: string, after: string) {
      applyAgentEditMarks(view, before, after);
    },
    restoreAgentEditReview(before: string, after: string, expected: string) {
      if (view.state.doc.toString() !== expected) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: after },
        annotations: agentEditRemoteAnnotation.of(true),
      });
      applyAgentEditMarks(view, before, after);
    },
    clearAgentEditHighlight() {
      view.dispatch({ effects: setAgentEditSession.of(null) });
    },
    acceptAgentEditHunk(hunkId: number) {
      return acceptAgentEditHunk(view, hunkId);
    },
    rejectAgentEditHunk(hunkId: number) {
      return rejectAgentEditHunk(view, hunkId);
    },
    acceptAllAgentEditHunks() {
      return acceptAllAgentEditHunks(view);
    },
    rejectAllAgentEditHunks() {
      return rejectAllAgentEditHunks(view);
    },
    hasAgentEditHunks() {
      return getAgentEditFieldState(view).hunks.length > 0;
    },
    getFindStatus() {
      return computeFindStatus(view);
    },
  };

  if (params.onAgentEditHunkResult) {
    subscribeAgentEditHunkResults(view, params.onAgentEditHunkResult);
  }

  function reconfigureOptions(next: EditorViewOptions, theme: EditorTheme) {
    const previous = currentOptions;
    const effects = [];
    // Loading changes readOnly twice per open. Rebuild only the compartment
    // whose setting changed, so it does not remount the theme and minimap.
    const themeKeys: (keyof EditorViewOptions)[] = [
      "fontFamily", "fontSize", "lineHeight", "fontLigatures", "cursorStyle", "paddingTop",
    ];
    if (currentTheme !== theme || themeKeys.some((key) => previous[key] !== next[key])) {
      effects.push(themeCompartment.reconfigure(buildThemeExt(theme, next)));
    }
    if (Boolean(previous.readOnly) !== Boolean(next.readOnly)) {
      effects.push(editableCompartment.reconfigure([
        EditorView.editable.of(!next.readOnly),
        EditorState.readOnly.of(Boolean(next.readOnly)),
      ]));
    }
    if (previous.wordWrap !== next.wordWrap) {
      effects.push(wrapCompartment.reconfigure(next.wordWrap === "off" ? [] : EditorView.lineWrapping));
    }
    if (previous.lineNumbers !== next.lineNumbers) {
      effects.push(lineNumberCompartment.reconfigure(lineNumberExt(next.lineNumbers)));
    }
    if (previous.tabSize !== next.tabSize || previous.insertSpaces !== next.insertSpaces) {
      effects.push(tabCompartment.reconfigure(tabExt(next)));
    }
    if (previous.minimap !== next.minimap) {
      effects.push(minimapCompartment.reconfigure(minimapExtension(Boolean(next.minimap))));
    }
    if (previous.inlayHints !== next.inlayHints) {
      effects.push(inlayHintsCompartment.reconfigure(
        params.onInlayHints && next.inlayHints !== false
          ? lspInlayHintsExtension(() => currentPath, params.onInlayHints)
          : [],
      ));
    }
    currentOptions = next;
    currentTheme = theme;
    if (effects.length) view.dispatch({ effects });
  }

  return {
    view,
    handle,
    setPath(path: string) {
      currentPath = path;
      view.dom.setAttribute("data-path", path);
      scheduleSyntaxLint(true);
    },
    setLanguage(language: string) {
      if (currentLanguage === language) return;
      currentLanguage = language;
      view.dispatch({
        effects: langCompartment.reconfigure(languageExtension(language)),
      });
      scheduleSyntaxLint(true);
    },
    setTheme(theme: EditorTheme, options: EditorViewOptions) {
      reconfigureOptions(options, theme);
    },
    setOptions(options: EditorViewOptions) {
      reconfigureOptions(options, currentTheme);
    },
    setDoc(doc: string) {
      if (doc === view.state.doc.toString()) {
        view.dispatch({ effects: resetChangeBaseline.of(doc) });
        return;
      }
      const pos = Math.min(view.state.selection.main.head, doc.length);
      suppressChange = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: doc },
          selection: EditorSelection.cursor(pos),
          effects: resetChangeBaseline.of(doc),
        });
        scheduleSyntaxLint(true);
      } finally {
        suppressChange = false;
      }
    },
    destroy() {
      if (syntaxTimer != null) window.clearTimeout(syntaxTimer);
      if (syntaxFollowUp != null) window.clearTimeout(syntaxFollowUp);
      syntaxTimer = null;
      syntaxFollowUp = null;
      viewRef = null;
      markers.clearAll();
      view.destroy();
    },
  };
}
