import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CodeEditorProps, EditorHandle } from "../core/types";
import { EditorContextMenu, type EditorContextMenuState } from "../EditorContextMenu";
import {
  applyReveal,
  createCodeMirrorEditor,
  type CodeMirrorHost,
} from "../hosts/codemirror";
import {
  peekAgentEditHighlight,
  resolveReviewBufferText,
  subscribeAgentEditReviews,
  takeAgentEditHighlight,
  updateAgentEditReviewAfter,
} from "../agentEditBridge";
import { lspSessionManager } from "../lsp/LspSessionManager";

/**
 * Coloride code editor — stable public React surface.
 * Engine: CodeMirror 6 (swap host later without changing call sites).
 */
export function CodeEditor({
  path,
  value,
  language,
  theme,
  options,
  reveal = null,
  className = "",
  workspaceRoot = null,
  onOpenPath,
  onOpenLocation,
  onApplyRenameFiles,
  onChange,
  onCursorChange,
  onDiagnosticsChange,
  onFindRequest,
  onContextMenu,
  onAgentEditHunkResult,
  onReady,
  onDispose,
}: CodeEditorProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<CodeMirrorHost | null>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const lastRevealTokenRef = useRef(0);
  const lastRevealLenRef = useRef(-1);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onDiagnosticsChangeRef = useRef(onDiagnosticsChange);
  const onFindRequestRef = useRef(onFindRequest);
  const onContextMenuRef = useRef(onContextMenu);
  const [contextMenu, setContextMenu] = useState<EditorContextMenuState | null>(null);
  const onOpenPathRef = useRef(onOpenPath);
  const onOpenLocationRef = useRef(onOpenLocation);
  const onApplyRenameFilesRef = useRef(onApplyRenameFiles);
  const pathRef = useRef(path);
  const onAgentEditHunkResultRef = useRef(onAgentEditHunkResult);
  const onReadyRef = useRef(onReady);
  const onDisposeRef = useRef(onDispose);
  const valueRef = useRef(value);
  const languageRef = useRef(language);
  const lastLocalValueRef = useRef(value);
  const lastLocalEditAtRef = useRef(0);

  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;
  onDiagnosticsChangeRef.current = onDiagnosticsChange;
  onFindRequestRef.current = onFindRequest;
  onContextMenuRef.current = onContextMenu;
  onOpenPathRef.current = onOpenPath;
  onOpenLocationRef.current = onOpenLocation;
  onApplyRenameFilesRef.current = onApplyRenameFiles;
  pathRef.current = path;
  onAgentEditHunkResultRef.current = onAgentEditHunkResult;
  onReadyRef.current = onReady;
  onDisposeRef.current = onDispose;
  valueRef.current = value;
  languageRef.current = language;

  // Stable options key for shallow-ish compare
  const optionsKey = useMemo(() => JSON.stringify(options), [options]);

  const paintAgentEdit = (
    host: CodeMirrorHost,
    filePath: string,
    doc: string,
    options?: { force?: boolean },
  ) => {
    // Consume one-shot queue; review map keeps Accept/Reject state.
    takeAgentEditHighlight(filePath);
    const review = peekAgentEditHighlight(filePath);
    if (!review) {
      // Keep all / clear from chat sidebar — always drop IDE decorations.
      host.handle.clearAgentEditHighlight();
      return;
    }
    // Keep partial Accept/Reject hunks unless content just changed (force) or nothing painted yet.
    if (!options?.force && host.handle.hasAgentEditHunks()) {
      return;
    }
    // If the tab buffer was reset to the pre-agent baseline, put agent content back
    // so green/red + Keep/Undo can show again after switching files.
    const afterDoc = resolveReviewBufferText(filePath, doc);
    if (afterDoc !== doc) {
      host.setDoc(afterDoc);
      // Keep review.after in sync and notify parent via onChange path when possible.
      updateAgentEditReviewAfter(filePath, afterDoc);
      onChangeRef.current?.(afterDoc);
    }
    host.handle.highlightAgentEdit(review.before, afterDoc);
  };

  const editorPathRef = useRef(path);

  // Create once; swapping files reuses the CodeMirror view (tab switches stay snappy).
  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;

    lastRevealTokenRef.current = 0;
    lastRevealLenRef.current = -1;

    const initialPath = pathRef.current;
    editorPathRef.current = initialPath;

    const host = createCodeMirrorEditor({
      parent,
      path: initialPath,
      doc: valueRef.current,
      language,
      theme,
      options,
      workspaceRoot,
      onChange: (next) => {
        lastLocalValueRef.current = next;
        lastLocalEditAtRef.current = Date.now();
        updateAgentEditReviewAfter(pathRef.current, next);
        onChangeRef.current?.(next);
      },
      onCursorChange: (cursor) => onCursorChangeRef.current?.(cursor),
      onDiagnosticsChange: (counts) => onDiagnosticsChangeRef.current?.(counts),
      onGoToDefinition: (line, column) => {
        void lspSessionManager.goToDefinition(pathRef.current, line, column).then((hit) => {
          if (!hit) return;
          onOpenLocationRef.current?.(hit.path, { line: hit.line, column: hit.column });
        });
      },
      onCompletion: (query) =>
        lspSessionManager.complete(query.path, query.line, query.column, {
          text: query.text,
          explicit: query.explicit,
          triggerCharacter: query.triggerCharacter,
        }),
      onResolveCompletion: (item) => lspSessionManager.resolveCompletion(item),
      onSignatureHelp: (query) =>
        lspSessionManager.signatureHelp(query.path, query.line, query.column, {
          text: query.text,
          triggerCharacter: query.triggerCharacter,
          retrigger: query.retrigger,
        }),
      onFindReferences: (line, column) =>
        lspSessionManager.findReferences(pathRef.current, line, column),
      onOpenLocation: (absolutePath, location) => {
        onOpenLocationRef.current?.(absolutePath, location);
      },
      onPrepareRename: (line, column) =>
        lspSessionManager.prepareRename(pathRef.current, line, column),
      onRenameSymbol: (line, column, newName) =>
        lspSessionManager.rename(pathRef.current, line, column, newName),
      onApplyRenameFiles: (files) => onApplyRenameFilesRef.current?.(files),
      onFormatDocument: (options) =>
        lspSessionManager.formatDocument(pathRef.current, options),
      onOrganizeImports: () => lspSessionManager.organizeImports(pathRef.current),
      onDocumentSymbols: () => lspSessionManager.documentSymbols(pathRef.current),
      onInlayHints: (range) => lspSessionManager.inlayHints(pathRef.current, range),
      onAgentEditHunkResult: (result) => onAgentEditHunkResultRef.current?.(result),
      onOpenPath: (absolutePath) => {
        onOpenPathRef.current?.(absolutePath);
      },
      onOpenUrl: (url) => {
        const cleaned = url.trim();
        if (!cleaned) return;
        if (window.colorideDesktop?.openExternal) {
          void window.colorideDesktop.openExternal(cleaned);
          return;
        }
        window.open(cleaned, "_blank", "noopener,noreferrer");
      },
      onFindRequest: () => onFindRequestRef.current?.(),
      onContextMenu: (next) => {
        onContextMenuRef.current?.(next);
        setContextMenu(next);
      },
    });

    hostRef.current = host;
    handleRef.current = host.handle;
    lspSessionManager.registerEditor(initialPath, host.handle);
    onReadyRef.current?.(host.handle);

    requestAnimationFrame(() => {
      if (hostRef.current === host) {
        paintAgentEdit(host, editorPathRef.current, host.handle.getValue(), { force: true });
      }
    });

    return () => {
      const handle = host.handle;
      lspSessionManager.unregisterEditor(editorPathRef.current, handle);
      onDisposeRef.current?.(handle);
      host.destroy();
      if (hostRef.current === host) hostRef.current = null;
      if (handleRef.current === handle) handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reuse the view across file switches
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const prevPath = editorPathRef.current;
    if (prevPath === path) return;
    lspSessionManager.unregisterEditor(prevPath, host.handle);
    host.setPath(path);
    host.setLanguage(languageRef.current);
    host.setDoc(valueRef.current);
    lastLocalValueRef.current = valueRef.current;
    editorPathRef.current = path;
    lspSessionManager.registerEditor(path, host.handle);
    lastRevealTokenRef.current = 0;
    lastRevealLenRef.current = -1;
    requestAnimationFrame(() => {
      if (hostRef.current === host) {
        paintAgentEdit(host, path, host.handle.getValue(), { force: true });
      }
    });
  }, [path]);

  // External value sync (reload / agent stream / undo from outside).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const prev = host.handle.getValue();
    const docChanged = prev !== value;
    // CodeMirror is source of truth after the user types. A stale React
    // `value` (autosave, diagnostics re-render) used to replace the whole
    // document and the current line vanished.
    const userOwnsDoc =
      docChanged
      && prev === lastLocalValueRef.current
      && lastLocalEditAtRef.current > 0;
    if (docChanged && !userOwnsDoc) {
      host.setDoc(value);
      lastLocalValueRef.current = value;
    }
    if (userOwnsDoc) return;
    // Force re-paint when buffer text changed so early/wrong paints get corrected.
    // Same-value final (stream already had full text) relies on the review subscription.
    // Always force when a saved review exists so switching back restores green/red.
    const id = window.requestAnimationFrame(() => {
      const current = hostRef.current;
      if (!current) return;
      const hasReview = Boolean(peekAgentEditHighlight(path));
      paintAgentEdit(current, path, current.handle.getValue(), {
        force: docChanged || hasReview,
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [value, path]);

  // Re-paint when a review is queued/restored for this path.
  useEffect(() => {
    let disposed = false;
    let queued = false;
    const sync = () => {
      if (queued) return;
      queued = true;
      // Review changes can be emitted by onChange during a CM transaction.
      // Dispatching decorations there is forbidden and leaves stale controls.
      queueMicrotask(() => {
        queued = false;
        if (disposed || editorPathRef.current !== path) return;
        const host = hostRef.current;
        if (!host) return;
        const hasReview = Boolean(peekAgentEditHighlight(path));
        paintAgentEdit(host, path, host.handle.getValue(), { force: hasReview });
      });
    };
    sync();
    const unsubscribe = subscribeAgentEditReviews(sync);
    return () => { disposed = true; unsubscribe(); };
  }, [path]);

  // Language
  useEffect(() => {
    hostRef.current?.setLanguage(language);
  }, [language, path]);

  // Theme + options
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.setTheme(theme, options);
    // optionsKey forces update when nested prefs change
  }, [theme, options, optionsKey, path]);

  // Reveal (search / go-to-def). Re-run when value loads so we don't land on "".
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    applyReveal(handle, reveal, lastRevealTokenRef, lastRevealLenRef);
  }, [reveal, path, value]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    setContextMenu(null);
  }, [path]);

  return (
    <>
      <div
        className={`coloride-code-editor-root h-full min-h-0 w-full overflow-hidden ${className}`}
        data-editor-path={path}
        onContextMenu={(event) => event.preventDefault()}
        ref={parentRef}
      />
      {contextMenu && handleRef.current ? (
        <EditorContextMenu
          handle={handleRef.current}
          menu={contextMenu}
          onClose={closeContextMenu}
        />
      ) : null}
    </>
  );
}
