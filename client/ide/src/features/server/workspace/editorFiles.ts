export const getImageMimeType = (path: string) => {
  const extension = path.split(".").at(-1)?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
  };
  return extension ? (mimeTypes[extension] ?? null) : null;
};

/** Extensions that must never be loaded as text into the editor (OOM / crash risk). */
export const KNOWN_BINARY_EXTENSIONS = new Set([
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "dmg",
  "pkg",
  "exe",
  "dll",
  "so",
  "dylib",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "mp3",
  "mp4",
  "mov",
  "wav",
  "webm",
  "avi",
  "mkv",
  "flac",
  "ogg",
  "m4a",
  "psd",
  "ai",
  "sketch",
  "fig",
  "wasm",
  "bin",
  "dat",
  "glb",
  "gltf",
  "fbx",
  "obj",
  "blend",
  "sqlite",
  "db",
  "lock",
  "pyc",
  "class",
  "o",
  "a",
]);

export const pathExtension = (path: string) => {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
};

/** True for fonts/archives/media/etc. — open as a lightweight placeholder, never full download. */
export const isKnownBinaryPath = (path: string) => {
  if (getImageMimeType(path)) return false; // images use their own path
  const ext = pathExtension(path);
  return Boolean(ext && KNOWN_BINARY_EXTENSIONS.has(ext));
};

export const formatBytesShort = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** True when decoded bytes look non-textual (fonts, zip, pdf, …). */
export const isProbablyBinaryBase64 = (contentB64: string) => {
  try {
    // Only sample a tiny prefix — never decode multi‑MB payloads here.
    const sample = atob(contentB64.slice(0, 4_000));
    if (sample.includes("\0")) return true;
    // High ratio of non-printable bytes → binary (skip common whitespace).
    let weird = 0;
    const n = Math.min(sample.length, 1024);
    for (let i = 0; i < n; i += 1) {
      const code = sample.charCodeAt(i);
      if (code === 9 || code === 10 || code === 13) continue;
      if (code < 32 || code === 127) weird += 1;
    }
    return n > 0 && weird / n > 0.15;
  } catch {
    return false;
  }
};

/** Soft cap: never pull more than this into the renderer as base64 JSON. */
export const MAX_EDITOR_FETCH_BYTES = 2 * 1024 * 1024;

export const editorSessionStorageKey = (
  profileId: string,
  workspacePath: string,
) => `coloride.editor-session.v1:${profileId}:${workspacePath}`;
