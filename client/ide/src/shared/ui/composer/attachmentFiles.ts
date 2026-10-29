import type { ComposerAttachment } from "./ComposerAttachments";

export const MAX_COMPOSER_ATTACHMENTS = 12;
/** Any file type (fonts, zip, pdf, binaries…) — same ceiling as tree upload. */
export const MAX_COMPOSER_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(
    file.name,
  );
}

export function createComposerAttachment(file: File): ComposerAttachment {
  const kind = isImageFile(file) ? "image" : "file";
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    name: file.name || "untitled",
    mime:
      file.type || (kind === "image" ? "image/*" : "application/octet-stream"),
    size: file.size,
    kind,
    previewUrl: kind === "image" ? URL.createObjectURL(file) : null,
  };
}

