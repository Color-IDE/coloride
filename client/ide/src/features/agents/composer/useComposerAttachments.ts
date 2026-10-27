import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import type { ComposerAttachment } from "./ComposerAttachments";
import {
  MAX_COMPOSER_ATTACHMENTS,
  MAX_COMPOSER_ATTACHMENT_BYTES,
  createComposerAttachment,
} from "./attachmentPrompt";

export function useComposerAttachments(composerDisabled: boolean) {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const dragDepthRef = useRef(0);
  const revokeAttachmentUrls = useCallback((items: ComposerAttachment[]) => {
    for (const item of items) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments((current) => {
      revokeAttachmentUrls(current);
      return [];
    });
  }, [revokeAttachmentUrls]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      revokeAttachmentUrls(attachmentsRef.current);
    };
  }, [revokeAttachmentUrls]);

  const addFiles = useCallback(
    (fileList: FileList | File[] | null | undefined) => {
      if (!fileList || composerDisabled) return;
      // Accept every file type (ttf, otf, zip, pdf, binaries…). Empty files ok.
      const incoming = Array.from(fileList).filter((file) =>
        Boolean(file && (file.name || file.size >= 0)),
      );
      if (!incoming.length) return;

      setAttachments((current) => {
        const remaining = Math.max(
          0,
          MAX_COMPOSER_ATTACHMENTS - current.length,
        );
        if (remaining <= 0) return current;

        const next = [...current];
        const seen = new Set(
          current.map(
            (item) => `${item.name}:${item.size}:${item.file.lastModified}`,
          ),
        );
        for (const file of incoming) {
          if (next.length >= MAX_COMPOSER_ATTACHMENTS) break;
          if (file.size > MAX_COMPOSER_ATTACHMENT_BYTES) continue;
          const key = `${file.name}:${file.size}:${file.lastModified}`;
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(createComposerAttachment(file));
        }
        return next;
      });
    },
    [composerDisabled],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const onComposerDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (composerDisabled) return;
      if (![...event.dataTransfer.types].includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current += 1;
      setDragOver(true);
    },
    [composerDisabled],
  );

  const onComposerDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (composerDisabled) return;
      if (![...event.dataTransfer.types].includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      if (!dragOver) setDragOver(true);
    },
    [composerDisabled, dragOver],
  );

  const onComposerDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (composerDisabled) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragOver(false);
    },
    [composerDisabled],
  );

  const onComposerDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (composerDisabled) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setDragOver(false);
      addFiles(event.dataTransfer.files);
    },
    [addFiles, composerDisabled],
  );

  return {
    attachments,
    attachmentsRef,
    dragOver,
    setDragOver,
    dragDepthRef,
    clearAttachments,
    addFiles,
    removeAttachment,
    onComposerDragEnter,
    onComposerDragLeave,
    onComposerDragOver,
    onComposerDrop,
  };
}
