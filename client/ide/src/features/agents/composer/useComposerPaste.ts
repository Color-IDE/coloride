import { useCallback, type ClipboardEvent } from "react";
import {
  filesFromClipboardData,
  readOsClipboardFiles,
} from "../../../shared/lib/clipboardFiles";
import {
  parseCodeRef,
  COLORIDE_CODE_REF_MIME,
  type ColorideCodeRefPayload,
} from "../../editor/codeRefClipboard";

export function useComposerPaste(
  composerDisabled: boolean,
  addCodeRef: (payload: ColorideCodeRefPayload) => void,
  addFiles: (files: File[]) => void,
  insertPlainTextAtCaret: (text: string) => void,
) {
  const onComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      if (composerDisabled) return;

      // Editor or terminal selection → chip with path/Terminal + line range.
      const codeRef = parseCodeRef(
        event.clipboardData?.getData(COLORIDE_CODE_REF_MIME),
      );
      if (codeRef) {
        event.preventDefault();
        event.stopPropagation();
        addCodeRef(codeRef);
        return;
      }

      const syncFiles = filesFromClipboardData(event.clipboardData);
      const plainText = event.clipboardData?.getData("text/plain") ?? "";
      const types = event.clipboardData
        ? Array.from(event.clipboardData.types || [])
        : [];
      const typesSuggestFileOrImage = types.some(
        (type) =>
          type === "Files" ||
          type.startsWith("image/") ||
          type === "public.tiff" ||
          type === "public.png" ||
          type === "public.file-url" ||
          type === "text/uri-list",
      );
      const hasElectronClipboard = Boolean(
        window.colorideDesktop?.readClipboardFiles ||
        window.colorideDesktop?.readClipboardImage ||
        window.colorideDesktop?.readClipboardCodeRef,
      );

      // Fast path: paste event already carries real file payloads (not just a thumbnail).
      if (syncFiles.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        addFiles(syncFiles);
        if (plainText.trim()) insertPlainTextAtCaret(plainText);
        return;
      }

      // Electron: Finder files + screenshots often miss the DOM paste event.
      // readOsClipboardFiles prefers real files over PNG thumbnails.
      if (!hasElectronClipboard && !typesSuggestFileOrImage) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void (async () => {
        try {
          const raw = await window.colorideDesktop?.readClipboardCodeRef?.();
          const fromOs = parseCodeRef(raw);
          if (fromOs) {
            addCodeRef(fromOs);
            return;
          }
        } catch {
          // ignore
        }
        const files = await readOsClipboardFiles();
        if (files.length > 0) {
          addFiles(files);
          if (plainText.trim()) insertPlainTextAtCaret(plainText);
          return;
        }
        if (plainText) insertPlainTextAtCaret(plainText);
      })();
    },
    [addCodeRef, addFiles, composerDisabled, insertPlainTextAtCaret],
  );

  return onComposerPaste;
}
