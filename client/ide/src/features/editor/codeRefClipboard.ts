/** Clipboard payload when copying a selection from the Coloride editor or terminal. */

export const COLORIDE_CODE_REF_MIME = "application/x-coloride-code-ref";

export type ColorideCodeRefSource = "file" | "terminal";

export type ColorideCodeRefPayload = {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  /** Where the selection was copied from. Defaults to file. */
  source?: ColorideCodeRefSource;
};

export function serializeCodeRef(payload: ColorideCodeRefPayload): string {
  return JSON.stringify({
    v: 1,
    path: payload.path,
    startLine: payload.startLine,
    endLine: payload.endLine,
    text: payload.text,
    source: payload.source === "terminal" ? "terminal" : "file",
  });
}

export function parseCodeRef(raw: string | null | undefined): ColorideCodeRefPayload | null {
  if (!raw || !raw.trim()) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const path = typeof data.path === "string" ? data.path.trim() : "";
    const text = typeof data.text === "string" ? data.text : "";
    const startLine = Number(data.startLine);
    const endLine = Number(data.endLine);
    if (!path || !text) return null;
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return null;
    const start = Math.max(1, Math.floor(startLine));
    const end = Math.max(start, Math.floor(endLine));
    const source: ColorideCodeRefSource = data.source === "terminal" ? "terminal" : "file";
    return { path, startLine: start, endLine: end, text, source };
  } catch {
    return null;
  }
}

export function codeRefFileName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) || path;
}

export function formatCodeRefRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `${startLine}:${startLine}` : `${startLine}:${endLine}`;
}

/** Chip label: styles.css (3204:3213) */
export function formatCodeRefChipLabel(name: string, startLine: number, endLine: number): string {
  return `${name} (${formatCodeRefRange(startLine, endLine)})`;
}

export function isTerminalCodeRef(payload: Pick<ColorideCodeRefPayload, "source" | "path">): boolean {
  if (payload.source === "terminal") return true;
  return payload.path === "terminal" || payload.path.startsWith("terminal:");
}

/** Display name for composer chips. */
export function codeRefDisplayName(payload: Pick<ColorideCodeRefPayload, "source" | "path">): string {
  if (isTerminalCodeRef(payload)) return "Terminal";
  return codeRefFileName(payload.path);
}

/**
 * Write plain text + Coloride code-ref payload to the clipboard.
 * Prefer calling from a `copy` event (setData). Falls back to ClipboardItem / text-only.
 */
export async function writeCodeRefToClipboard(
  payload: ColorideCodeRefPayload,
  event?: ClipboardEvent | null,
): Promise<boolean> {
  const plain = payload.text;
  const json = serializeCodeRef(payload);
  if (!plain) return false;

  if (event?.clipboardData) {
    try {
      event.clipboardData.setData("text/plain", plain);
      event.clipboardData.setData(COLORIDE_CODE_REF_MIME, json);
      event.preventDefault();
      return true;
    } catch {
      // fall through
    }
  }

  // Electron bridge (custom format survives across paste in the same app).
  try {
    const written = await window.colorideDesktop?.writeClipboardCodeRef?.({
      text: plain,
      codeRef: json,
    });
    if (written) return true;
  } catch {
    // fall through
  }

  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plain], { type: "text/plain" }),
          [COLORIDE_CODE_REF_MIME]: new Blob([json], { type: COLORIDE_CODE_REF_MIME }),
        }),
      ]);
      return true;
    }
  } catch {
    // fall through
  }

  try {
    await navigator.clipboard.writeText(plain);
    return true;
  } catch {
    return false;
  }
}

/** Build a terminal selection payload from xterm buffer coordinates (0-based y). */
export function terminalCodeRefFromSelection(args: {
  text: string;
  cwd?: string | null;
  startRow?: number | null;
  endRow?: number | null;
}): ColorideCodeRefPayload | null {
  const text = args.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text.trim()) return null;
  const lines = text.replace(/\n$/, "").split("\n");
  const lineCount = Math.max(1, lines.length);
  let startLine = 1;
  let endLine = lineCount;
  if (
    typeof args.startRow === "number"
    && typeof args.endRow === "number"
    && Number.isFinite(args.startRow)
    && Number.isFinite(args.endRow)
  ) {
    startLine = Math.max(1, Math.floor(Math.min(args.startRow, args.endRow)) + 1);
    endLine = Math.max(startLine, Math.floor(Math.max(args.startRow, args.endRow)) + 1);
  }
  const cwd = (args.cwd || "").trim();
  return {
    path: cwd ? `terminal:${cwd}` : "terminal",
    startLine,
    endLine,
    text,
    source: "terminal",
  };
}
