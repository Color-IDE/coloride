/** Agents we do not offer anywhere in the product. */
export const HIDDEN_AGENT_IDS = new Set([
  "agoragentic-acp",
  "amp-acp",
  "auggie",
  "autohand",
  "codebuddy-code",
  "cortex-code",
  "corust-agent",
  "crow-cli",
  "deepagents",
  "devin",
  "dimcode",
  "dirac",
  "fast-agent",
  "gemini",
  "glm-acp-agent",
  "goose",
  "harn",
  "junie",
  "kimchi",
  "minion-code",
  "nova",
  "opencode-v2",
  "pi-acp",
  "poolside",
  "qoder",
  "sigit",
  "stakpak",
  "vtcode",
]);

export function isOfferedAgent(agentId: string): boolean {
  return !HIDDEN_AGENT_IDS.has(agentId);
}
