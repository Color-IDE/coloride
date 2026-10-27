import { api, encodeBytesToBase64 } from "../../../shared/api/client";
import {
  codeRefDisplayName,
  formatCodeRefRange,
  isTerminalCodeRef,
  type ColorideCodeRefPayload,
  type ColorideCodeRefSource,
} from "../../editor/codeRefClipboard";
import {
  formatAttachmentSize,
  type ComposerAttachment,
} from "./ComposerAttachments";
import type { ComposerCodeRef } from "./ComposerCodeReferences";

export const MAX_COMPOSER_ATTACHMENTS = 12;
/** Any file type (fonts, zip, pdf, binaries…) — same ceiling as tree upload. */
export const MAX_COMPOSER_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const AGENT_UPLOAD_DIR = ".coloride/uploads";

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(
    file.name,
  );
}

export function looksLikeTextAttachment(item: ComposerAttachment): boolean {
  if (item.kind === "image") return false;
  if (item.mime.startsWith("text/")) return true;
  if (
    /^application\/(json|xml|javascript|typescript|x-yaml|yaml|toml|csv|sql|x-sh|x-httpd-php)$/i.test(
      item.mime,
    )
  ) {
    return true;
  }
  // Broad text-ish extensions — everything else is treated as binary and uploaded as-is.
  return /\.(txt|md|markdown|json|ya?ml|toml|csv|tsv|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|sql|env|ini|cfg|conf|log|gitignore|dockerignore|editorconfig|svg)$/i.test(
    item.name,
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

export function safeUploadFileName(name: string): string {
  const base =
    (name || "file").replace(/[\\/]/g, "_").replace(/^\.+/, "") || "file";
  return base.slice(0, 180);
}

async function ensureRemoteDirs(path: string): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  // Build absolute remote path segments one level at a time (mkdir is not recursive).
  let built = path.startsWith("/") ? "" : "";
  for (const part of parts) {
    built = path.startsWith("/")
      ? `${built}/${part}`
      : built
        ? `${built}/${part}`
        : part;
    try {
      await api.mkdir(built);
    } catch {
      // exists / race — ignore
    }
  }
}

/** Save any binary/non-inlined attachment into the workspace so the agent can use the path. */
async function uploadAttachmentToWorkspace(
  item: ComposerAttachment,
  workspacePath: string,
): Promise<string> {
  const root = workspacePath.replace(/\/+$/, "");
  const dir = `${root}/${AGENT_UPLOAD_DIR}`;
  await ensureRemoteDirs(dir);
  const stamp = Date.now().toString(36);
  const dest = `${dir}/${stamp}-${safeUploadFileName(item.name)}`;
  const bytes = new Uint8Array(await item.file.arrayBuffer());
  await api.writeFile(dest, encodeBytesToBase64(bytes));
  return dest;
}

/** Compact JPEG for chat thumbs + hover (not the full-res vision payload). */
async function buildAttachmentPreviewDataUrl(
  item: ComposerAttachment,
): Promise<string | null> {
  if (item.kind !== "image") return null;
  try {
    const bitmap = await createImageBitmap(item.file);
    const maxEdge = 480;
    const scale = Math.min(
      1,
      maxEdge / Math.max(bitmap.width, bitmap.height, 1),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    return dataUrl.length > 150_000
      ? canvas.toDataURL("image/jpeg", 0.55)
      : dataUrl;
  } catch {
    return null;
  }
}

export type BuiltAgentPrompt = {
  text: string;
  attachments: Array<{
    name: string;
    kind: "image" | "file" | "code";
    mime: string;
    size: number;
    path?: string | null;
    previewDataUrl?: string | null;
    startLine?: number;
    endLine?: number;
  }>;
  pluginIds?: string[];
};

export function createComposerCodeRef(
  payload: ColorideCodeRefPayload,
): ComposerCodeRef {
  const source: ColorideCodeRefSource =
    payload.source === "terminal" || isTerminalCodeRef(payload)
      ? "terminal"
      : "file";
  return {
    id: `code-${source}-${payload.path}-${payload.startLine}-${payload.endLine}-${Math.random().toString(36).slice(2, 8)}`,
    path: payload.path,
    name: codeRefDisplayName(payload),
    startLine: payload.startLine,
    endLine: payload.endLine,
    text: payload.text,
    source,
  };
}

/**
 * Clean user text + attachment metadata for the API.
 * Images are uploaded to the VPS; the backend loads them as vision for the model.
 * Chat UI shows thumbs from previewDataUrl — not a wall of path text.
 */
export async function buildPromptWithAttachments(
  text: string,
  attachments: ComposerAttachment[],
  workspacePath?: string | null,
  codeRefs: ComposerCodeRef[] = [],
): Promise<BuiltAgentPrompt> {
  const trimmed = text.trim();
  if (!attachments.length && !codeRefs.length)
    return { text: trimmed, attachments: [] };

  const textBlocks: string[] = [];
  if (trimmed) textBlocks.push(trimmed);
  const payload: BuiltAgentPrompt["attachments"] = [];

  for (const ref of codeRefs) {
    const range = formatCodeRefRange(ref.startLine, ref.endLine);
    const isTerm = ref.source === "terminal" || isTerminalCodeRef(ref);
    const cwd =
      isTerm && ref.path.startsWith("terminal:")
        ? ref.path.slice("terminal:".length)
        : "";
    const header = isTerm
      ? cwd
        ? `Terminal @ ${cwd} (${range})`
        : `Terminal (${range})`
      : `${ref.path} (${range})`;
    const clipped =
      ref.text.length > 80_000
        ? `${ref.text.slice(0, 80_000)}\n\n… [truncated]`
        : ref.text;
    textBlocks.push(`--- ${header} ---\n${clipped}`);
    payload.push({
      name: ref.name,
      // API attachment kind stays "code"; terminal vs file is in the prompt header + chip UI.
      kind: "code",
      mime: "text/plain",
      size: ref.text.length,
      path: isTerm ? cwd || "terminal" : ref.path,
      previewDataUrl: null,
      startLine: ref.startLine,
      endLine: ref.endLine,
    });
  }

  for (const item of attachments) {
    // Prefer inlining small text so the model can read it immediately.
    if (looksLikeTextAttachment(item) && item.size <= 200_000) {
      try {
        const content = await item.file.text();
        if (!content.includes("\0")) {
          const clipped =
            content.length > 80_000
              ? `${content.slice(0, 80_000)}\n\n… [truncated ${formatAttachmentSize(item.size - 80_000)}]`
              : content;
          textBlocks.push(`--- ${item.name} ---\n${clipped}`);
          payload.push({
            name: item.name,
            kind: "file",
            mime: item.mime,
            size: item.size,
            path: null,
            previewDataUrl: null,
          });
          continue;
        }
      } catch {
        // fall through
      }
    }

    let remotePath: string | null = null;
    if (workspacePath) {
      try {
        remotePath = await uploadAttachmentToWorkspace(item, workspacePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        textBlocks.push(
          `[File attachment: ${item.name} — upload failed: ${message}]`,
        );
        payload.push({
          name: item.name,
          kind: item.kind,
          mime: item.mime,
          size: item.size,
          path: null,
          previewDataUrl:
            item.kind === "image"
              ? await buildAttachmentPreviewDataUrl(item)
              : null,
        });
        continue;
      }
    } else if (item.kind !== "image") {
      textBlocks.push(
        `[File attachment: ${item.name} (${formatAttachmentSize(item.size)}) — connect a workspace to save binary files on the server.]`,
      );
    }

    const previewDataUrl =
      item.kind === "image" ? await buildAttachmentPreviewDataUrl(item) : null;
    payload.push({
      name: item.name,
      kind: item.kind,
      mime: item.mime,
      size: item.size,
      path: remotePath,
      previewDataUrl,
    });
  }

  return {
    text: textBlocks.join("\n\n").trim(),
    attachments: payload,
  };
}
