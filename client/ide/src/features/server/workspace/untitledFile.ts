import type { Dispatch, SetStateAction } from "react";
import { api, encodeTextToBase64 } from "../../../shared/api/client";
import type { EditorBuffer } from "./types";

export const UNTITLED_PREFIX = "untitled:";

export function isUntitledPath(path: string | null | undefined): path is string {
  return Boolean(path?.startsWith(UNTITLED_PREFIX));
}

export function untitledTabLabel(path: string) {
  return path.startsWith(UNTITLED_PREFIX) ? "Untitled" : path;
}

type OpenBlankFileInput = {
  editorBuffersRef: { current: Map<string, EditorBuffer> };
  setOpenFiles: Dispatch<SetStateAction<string[]>>;
  setSelectedFile: Dispatch<SetStateAction<string | null>>;
  setEditorValue: Dispatch<SetStateAction<string>>;
  setEditorImageUrl: Dispatch<SetStateAction<string | null>>;
  setEditorEtag: Dispatch<SetStateAction<string | null>>;
  setEditorDirty: Dispatch<SetStateAction<boolean>>;
  setEditorTruncated: Dispatch<SetStateAction<boolean>>;
  setEditorError: Dispatch<SetStateAction<string>>;
  setEditorLoading: Dispatch<SetStateAction<boolean>>;
};

export function openBlankFile(input: OpenBlankFileInput) {
  const key = `${UNTITLED_PREFIX}${Date.now()}`;
  input.editorBuffersRef.current.set(key, {
    dirty: false,
    error: "",
    etag: "untitled",
    truncated: false,
    imageUrl: null,
    value: "",
  });
  input.setOpenFiles((current) => (current.includes(key) ? current : [...current, key]));
  input.setSelectedFile(key);
  input.setEditorValue("");
  input.setEditorImageUrl(null);
  input.setEditorEtag("untitled");
  input.setEditorDirty(false);
  input.setEditorTruncated(false);
  input.setEditorError("");
  input.setEditorLoading(false);
}

/** Ask before discarding a dirty untitled buffer. Returns false when the tab should stay open. */
export async function confirmUntitledClose(value: string): Promise<boolean> {
  const save = window.confirm("Save changes to Untitled before closing?");
  if (!save) return true;
  const destination = await window.colorideDesktop?.saveFile?.("Untitled.txt");
  if (!destination) return false;
  await api.writeFile(destination, encodeTextToBase64(value), null);
  return true;
}
