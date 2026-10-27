/**
 * Keeps the managed-agent access token fresh on the local host.
 * Machine registration and workspace-path upload are intentionally not started:
 * open-source builds only call Coloride for sign-in and agent model requests.
 */

import { useEffect } from "react";
import { startCloudAgentTokenKeepAlive } from "./cloudAuth";

export function useCloudProductSync(workspacePath: string | null | undefined) {
  void workspacePath;
  // Access JWTs die in ~15 minutes. The agent needs a fresh copy during long turns.
  useEffect(() => startCloudAgentTokenKeepAlive(), []);
}
