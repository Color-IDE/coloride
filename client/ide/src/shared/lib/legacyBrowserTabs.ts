/** Ignore obsolete browser tabs in persisted editor sessions. */
export function isBrowserTabKey(key: string): boolean {
  return key.startsWith("browser:");
}
