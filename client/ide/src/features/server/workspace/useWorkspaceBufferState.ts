import { useEffect, useRef, useState } from "react";
import {
  type BrowserTabState
} from "../../explorer/BrowserPane";
import {
  type EditorBuffer
} from "./types";

export function useWorkspaceBufferState() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [browserTabs, setBrowserTabs] = useState<
    Record<string, BrowserTabState>
  >({});
  const [editorValue, setEditorValue] = useState("");
  const [editorImageUrl, setEditorImageUrl] = useState<string | null>(null);
  const [editorEtag, setEditorEtag] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorTruncated, setEditorTruncated] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [missingFiles, setMissingFiles] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(() => new Set());

  const editorBuffersRef = useRef(new Map<string, EditorBuffer>());

  const editorLoadRequestRef = useRef(0);

  const editorRevealTokenRef = useRef(0);

  /** Skip editor auto-reload briefly after our own save (etag already updated). */
  const suppressEditorWatchUntilRef = useRef(0);

  const openFilesRef = useRef<string[]>([]);

  const selectedFileRef = useRef<string | null>(null);

  const editorDirtyRef = useRef(false);

  const editorEtagRef = useRef<string | null>(null);

  const editorValueRef = useRef("");

  const editorImageUrlRef = useRef<string | null>(null);

  const editorTruncatedRef = useRef(false);

  const autoSaveTimerRef = useRef<number | null>(null);

  const autoSaveInFlightRef = useRef(false);

  const autoSavePendingRef = useRef(false);

  const saveEditorBufferRef = useRef<
    (
      path: string,
      buffer: EditorBuffer,
      options?: { format?: boolean },
    ) => Promise<string | null>
  >(async () => null);

  const reloadEditorFromRemoteRef = useRef<
    (path: string, options?: { force?: boolean }) => Promise<boolean>
  >(async () => false);

  /** Bumps when workspace/session restore is superseded (switch root / disconnect). */
  const sessionRestoreGenRef = useRef(0);

  /** Last cursor in the active editor (1-based) for session restore. */
  const editorCursorRef = useRef<{ line: number; column: number }>({
    line: 1,
    column: 1,
  });

  useEffect(() => {
    openFilesRef.current = openFiles;
  }, [openFiles]);

  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  useEffect(() => {
    editorDirtyRef.current = editorDirty;
  }, [editorDirty]);

  useEffect(() => {
    editorEtagRef.current = editorEtag;
  }, [editorEtag]);

  useEffect(() => {
    editorValueRef.current = editorValue;
  }, [editorValue]);

  useEffect(() => {
    editorImageUrlRef.current = editorImageUrl;
  }, [editorImageUrl]);

  useEffect(() => {
    editorTruncatedRef.current = editorTruncated;
  }, [editorTruncated]);

  const [editorSessionReadyKey, setEditorSessionReadyKey] = useState("");
  return {
    editorSessionReadyKey,
    setEditorSessionReadyKey,
    editorBuffersRef,
    editorLoadRequestRef,
    suppressEditorWatchUntilRef,
    openFilesRef,
    selectedFileRef,
    editorDirtyRef,
    editorEtagRef,
    editorValueRef,
    editorImageUrlRef,
    editorTruncatedRef,
    autoSaveTimerRef,
    autoSaveInFlightRef,
    autoSavePendingRef,
    saveEditorBufferRef,
    reloadEditorFromRemoteRef,
    editorRevealTokenRef,
    sessionRestoreGenRef,
    editorCursorRef,
    selectedFile,
    setSelectedFile,
    openFiles,
    setOpenFiles,
    browserTabs,
    setBrowserTabs,
    editorValue,
    setEditorValue,
    editorImageUrl,
    setEditorImageUrl,
    editorEtag,
    setEditorEtag,
    editorDirty,
    setEditorDirty,
    editorTruncated,
    setEditorTruncated,
    editorLoading,
    setEditorLoading,
    editorError,
    setEditorError,
    missingFiles,
    setMissingFiles,
    dirtyFiles,
    setDirtyFiles,
  };
}
