import { api } from "../../shared/api/client";

export type BrowserNetworkMode = "local" | "ssh";

/**
 * Local folders talk to this machine (direct).
 * SSH workspaces keep the VPS SOCKS hop so localhost is the server.
 */
export async function applyBrowserProxy(mode: BrowserNetworkMode | string | null | undefined) {
  const embed = window.colorideDesktop?.browserEmbed;
  if (!embed?.setSocks) return { ok: false as const, reason: "no-embed" };
  if (mode === "local") {
    return embed.setSocks({ socksPort: null });
  }
  const connection = await api.connectionState().catch(() => null);
  return embed.setSocks({ socksPort: connection?.socksPort ?? null });
}
