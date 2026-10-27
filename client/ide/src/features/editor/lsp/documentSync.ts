import { lspSessionManager } from "./LspSessionManager";
import { lspDocumentLanguageId } from "./pathUri";

function isTsOrJs(path: string): boolean {
  return lspDocumentLanguageId(path) != null;
}

export async function lspSyncOpen(path: string, text: string) {
  if (!isTsOrJs(path)) return;
  await lspSessionManager.didOpen(path, text);
}

export function lspSyncChange(path: string, text: string) {
  if (!isTsOrJs(path)) return;
  lspSessionManager.didChange(path, text);
}

export async function lspSyncSave(path: string, text?: string) {
  if (!isTsOrJs(path)) return;
  await lspSessionManager.didSave(path, text);
}

export async function lspSyncClose(path: string) {
  if (!isTsOrJs(path)) return;
  await lspSessionManager.didClose(path);
}
