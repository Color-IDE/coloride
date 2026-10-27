/** Shared OS-clipboard → File helpers (composer + file tree paste). */

export function mimeToImageExtension(mime: string): string | null {
  const normalized = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/avif": "avif",
    "image/svg+xml": "svg",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/tiff": "tiff",
    "image/x-tiff": "tiff",
  };
  return map[normalized] ?? (normalized.startsWith("image/") ? "png" : null);
}

export function makePastedImageName(ext: string): string {
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `pasted-image-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.${ext}`;
}

const IMAGE_NAME_RE = /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i;
/** Non-image extensions that must never be rewritten as pasted-image.png. */
const REAL_FILE_EXT_RE =
  /\.(ttf|otf|woff2?|eot|zip|rar|7z|tar|gz|bz2|xz|pdf|docx?|xlsx?|pptx?|csv|json|ya?ml|toml|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|sql|env|ini|cfg|conf|log|md|txt|mp3|mp4|mov|wav|webm|ico|icns|dmg|pkg|exe|dll|so|dylib|bin|dat|wasm|glb|gltf|fbx|obj|blend)$/i;

function isImageFile(file: File): boolean {
  if (REAL_FILE_EXT_RE.test(file.name || "")) return false;
  if (file.type.startsWith("image/")) return true;
  return IMAGE_NAME_RE.test(file.name);
}

function hasPlaceholderImageName(name: string): boolean {
  const bare = (name || "").trim().toLowerCase();
  return (
    !bare
    || bare === "blob"
    || bare === "image.png"
    || bare === "image.jpg"
    || bare === "image.jpeg"
    || bare === "untitled"
    || bare === "untitled.png"
    || /^pasted-image-\d/.test(bare)
  );
}

export function normalizeClipboardFile(file: File): File {
  const bareName = (file.name || "").trim();

  // Real files from Finder (font.ttf, archive.zip, …) — keep name + bytes as-is.
  // Never rebrand them as pasted-image.png even if the browser lies about MIME.
  if (bareName && REAL_FILE_EXT_RE.test(bareName)) {
    const type =
      file.type && !file.type.startsWith("image/")
        ? file.type
        : "application/octet-stream";
    if (file.type === type && file.name === bareName) return file;
    return new File([file], bareName, {
      type,
      lastModified: file.lastModified || Date.now(),
    });
  }

  const isImage = isImageFile(file);
  if (isImage && hasPlaceholderImageName(bareName)) {
    const ext = mimeToImageExtension(file.type) || "png";
    return new File([file], makePastedImageName(ext), {
      type: file.type || `image/${ext}`,
      lastModified: file.lastModified || Date.now(),
    });
  }
  return file;
}

/**
 * Discord / Figma / screenshots often put images in `clipboardData.items`
 * while `clipboardData.files` stays empty.
 */
export function filesFromClipboardData(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];

  const collected: File[] = [];
  const pushFile = (file: File | null) => {
    if (!file) return;
    collected.push(normalizeClipboardFile(file));
  };

  if (data.items && data.items.length > 0) {
    for (let index = 0; index < data.items.length; index += 1) {
      const item = data.items[index];
      if (!item || item.kind !== "file") continue;
      pushFile(item.getAsFile());
    }
  }

  if (collected.length === 0 && data.files && data.files.length > 0) {
    for (const file of Array.from(data.files)) pushFile(file);
  }

  // If the pasteboard has both a real named file and a nameless image thumbnail,
  // keep only the real files (Finder does this for .ttf / .pdf / …).
  const realNamed = collected.filter((file) => {
    const name = (file.name || "").trim();
    return name && REAL_FILE_EXT_RE.test(name) && !hasPlaceholderImageName(name);
  });
  if (realNamed.length > 0) return realNamed;

  return collected;
}

export function fileFromBase64(
  dataBase64: string,
  mime: string,
  extension: string,
  fileName?: string,
): File | null {
  try {
    const binary = atob(dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const type = mime || "application/octet-stream";
    const ext = extension || mimeToImageExtension(type) || "bin";
    const name =
      (fileName && fileName.trim())
      || (type.startsWith("image/")
        ? makePastedImageName(ext)
        : `pasted-file-${Date.now().toString(36)}.${ext}`);
    return new File([bytes], name, {
      type,
      lastModified: Date.now(),
    });
  } catch {
    return null;
  }
}

/** Electron: real Finder files on the pasteboard (any type). */
export async function filesFromElectronClipboardFiles(): Promise<File[]> {
  const read = window.colorideDesktop?.readClipboardFiles;
  if (!read) return [];
  try {
    const payload = await read();
    if (!Array.isArray(payload) || payload.length === 0) return [];
    const files: File[] = [];
    for (const item of payload) {
      if (!item?.dataBase64) continue;
      const ext =
        (item.name && item.name.includes(".")
          ? item.name.split(".").pop()
          : "") || "bin";
      const file = fileFromBase64(
        item.dataBase64,
        item.mime || "application/octet-stream",
        ext,
        item.name,
      );
      if (file) files.push(normalizeClipboardFile(file));
    }
    return files;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (!message.includes("No handler registered")) {
      console.warn("[coloride] filesFromElectronClipboardFiles failed", error);
    }
    return [];
  }
}

/** Electron native clipboard image (screenshots / Discord / Figma only). */
export async function filesFromElectronClipboard(): Promise<File[]> {
  const read = window.colorideDesktop?.readClipboardImage;
  if (!read) return [];
  try {
    const payload = await read();
    if (!payload?.dataBase64) return [];
    const file = fileFromBase64(payload.dataBase64, payload.mime, payload.extension);
    return file ? [file] : [];
  } catch (error) {
    // Main process may be on an older build without the IPC handler.
    const message = error instanceof Error ? error.message : String(error || "");
    if (!message.includes("No handler registered")) {
      console.warn("[coloride] filesFromElectronClipboard failed", error);
    }
    return [];
  }
}

/** Browser Clipboard API fallback (permissions permitting). */
export async function filesFromNavigatorClipboard(): Promise<File[]> {
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.read !== "function") return [];
  try {
    const items = await clipboard.read();
    const files: File[] = [];
    for (const item of items) {
      // Prefer non-image file types when present.
      const fileType = item.types.find((type) => (
        type === "text/uri-list"
        || type === "Files"
        || (!type.startsWith("image/") && type !== "text/plain" && type !== "text/html")
      ));
      if (fileType && fileType !== "text/uri-list") {
        try {
          const blob = await item.getType(fileType);
          files.push(normalizeClipboardFile(new File(
            [blob],
            `pasted-file-${Date.now().toString(36)}.bin`,
            { type: fileType, lastModified: Date.now() },
          )));
          continue;
        } catch {
          // fall through to image
        }
      }
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const ext = mimeToImageExtension(imageType) || "png";
      files.push(new File([blob], makePastedImageName(ext), {
        type: imageType,
        lastModified: Date.now(),
      }));
    }
    return files;
  } catch {
    return [];
  }
}

/**
 * Best-effort OS clipboard read.
 * ALWAYS prefer real files (Finder .ttf etc.) over image thumbnails.
 */
export async function readOsClipboardFiles(): Promise<File[]> {
  // 1) Real files from Finder / Explorer (Electron).
  let files = await filesFromElectronClipboardFiles();
  if (files.length > 0) return files;

  // 2) Pure clipboard images (screenshots, Discord, Figma).
  files = await filesFromElectronClipboard();
  if (files.length > 0) return files;

  // 3) Web Clipboard API fallback.
  files = await filesFromNavigatorClipboard();
  return files;
}
