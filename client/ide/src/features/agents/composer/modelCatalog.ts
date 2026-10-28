import type { AgentProvider } from "@coloride/contracts";

export interface ComposerModelOption {
  detailsUnavailable?: boolean;
  capabilities?: { tools: boolean; streaming: boolean; images: boolean; reasoning: boolean };
  label: string;
  model: string;
  provider: AgentProvider | null;
  description: string;
  /** Zero to four filled bars in the model details card. */
  price: number;
  coding: number;
  visual: number;
  /** USD per one million tokens. */
  inputPerM: number;
  cachedInputPerM?: number;
  outputPerM: number;
  contextTokens?: number;
  parameters?: string;
  requiresPaidPlan?: boolean;
}

export interface ProviderOption {
  label: string;
  model: string;
  keyLabel: string;
}

export const PROVIDER_OPTIONS: Record<AgentProvider, ProviderOption> = {
  fireworks: {
    label: "Fireworks",
    model: "accounts/fireworks/models/kimi-k3",
    keyLabel: "Fireworks API key",
  },
  deepseek: {
    label: "DeepSeek",
    model: "deepseek-flash",
    keyLabel: "DeepSeek API key",
  },
  mistral: {
    label: "Mistral",
    model: "mistral-large-latest",
    keyLabel: "Mistral API key",
  },
  groq: {
    label: "Groq",
    model: "openai/gpt-oss-120b",
    keyLabel: "Groq API key",
  },
  ollama: {
    label: "Ollama",
    model: "qwen2.5-coder",
    keyLabel: "No API key",
  },
  gemini: {
    label: "Gemini",
    model: "gemini-3.8-flash",
    keyLabel: "Coloride-managed Gemini",
  },
  openai: {
    label: "OpenAI",
    model: "gpt-5.3-codex",
    keyLabel: "OpenAI API key",
  },
  xai: {
    label: "xAI",
    model: "grok-4.5",
    keyLabel: "xAI API key",
  },
};

// Google introductory pricing ends on November 30, 2026 (UTC).
const GEMINI_ARGON_INTRO_PRICING = Date.now() < Date.UTC(2026, 11, 1);

/** Models Coloride exposes in the composer (managed cloud / xAI). */
export const COMPOSER_MODELS: ComposerModelOption[] = [
  {
    label: "DeepSeek V4.1 Flash",
    model: "accounts/fireworks/models/deepseek-v4p1-flash",
    provider: "fireworks",
    description: "Fast, efficient model for coding, long-context analysis, and agentic workflows.",
    price: 1,
    coding: 4,
    visual: 2,
    inputPerM: 0.22,
    cachedInputPerM: 0.007,
    outputPerM: 0.66,
    contextTokens: 1_000_000,
    parameters: "552B",
    requiresPaidPlan: true,
  },
  {
    label: "Grok Build 0.1",
    model: "grok-build-0.1",
    provider: "xai",
    description: "Fast coding model for agentic workflows with tool calling, reasoning, structured outputs, and vision.",
    price: 2,
    coding: 4,
    visual: 3,
    inputPerM: 1,
    cachedInputPerM: 0.2,
    outputPerM: 2,
    contextTokens: 256_000,
  },
  {
    label: "MiniMax M3",
    model: "accounts/fireworks/models/minimax-m3",
    provider: "fireworks",
    description: "Native multimodal model built for long-context coding, agentic work, and visual understanding.",
    price: 1,
    coding: 4,
    visual: 4,
    inputPerM: 0.3,
    cachedInputPerM: 0.059,
    outputPerM: 1.2,
    contextTokens: 512_000,
    parameters: "428B",
    requiresPaidPlan: true,
  },
  {
    label: "Kimi K3",
    model: "accounts/fireworks/models/kimi-k3",
    provider: "fireworks",
    description: "Moonshot AI's flagship open model for long-horizon coding, reasoning, and visual tasks.",
    price: 3,
    coding: 4,
    visual: 4,
    inputPerM: 3,
    cachedInputPerM: 0.3,
    outputPerM: 15,
    contextTokens: 1_000_000,
    parameters: "2.81T",
    requiresPaidPlan: true,
  },
  {
    label: "Grok 4.7",
    model: "grok-4.7",
    provider: "xai",
    description: "Frontier model for coding, long-running agents, and hard reasoning.",
    price: 3,
    coding: 4,
    visual: 4,
    inputPerM: 2,
    cachedInputPerM: 0.5,
    outputPerM: 6,
    contextTokens: 500_000,
  },
  {
    label: "Grok 4.6",
    model: "grok-4.6",
    provider: "xai",
    description: "Latest flagship for coding, long-running agents, and visual work.",
    price: 3,
    coding: 4,
    visual: 4,
    inputPerM: 2,
    cachedInputPerM: 0.5,
    outputPerM: 6,
    contextTokens: 500_000,
  },
  {
    label: "Grok 4.5",
    model: "grok-4.5",
    provider: "xai",
    description: "Flagship coding model with deep reasoning and strong agent tool use.",
    price: 3,
    coding: 4,
    visual: 3,
    inputPerM: 2,
    outputPerM: 6,
    contextTokens: 500_000,
  },
  {
    label: "Gemini 4 Argon",
    model: "gemini-4-argon",
    provider: "gemini",
    description: "Google's flagship reasoning model for complex coding and multi-step agent work.",
    price: 4,
    coding: 4,
    visual: 4,
    inputPerM: GEMINI_ARGON_INTRO_PRICING ? 2 : 4,
    cachedInputPerM: GEMINI_ARGON_INTRO_PRICING ? 0.1 : 0.2,
    outputPerM: GEMINI_ARGON_INTRO_PRICING ? 10 : 20,
    contextTokens: 1_048_576,
  },
  {
    label: "Gemini 3.8 Flash",
    model: "gemini-3.8-flash",
    provider: "gemini",
    description: "Google's latest stable Flash model for complex coding and reliable multi-step agent work.",
    price: 2,
    coding: 4,
    visual: 4,
    inputPerM: 0.75,
    outputPerM: 3.75,
    contextTokens: 1_000_000,
  },
  {
    label: "Gemini 3.1 Pro (Preview)",
    model: "gemini-3.1-pro-preview",
    provider: "gemini",
    description: "Google's preview flagship for difficult reasoning, coding, and long-running agent work.",
    price: 4,
    coding: 4,
    visual: 4,
    inputPerM: 2,
    outputPerM: 12,
    contextTokens: 1_000_000,
  },
];

/** Published model window for the context meter — not the 40k working-set cap. */
export function modelContextWindow(model: string | null | undefined): number {
  const normalized = (model ?? "").trim().toLowerCase();
  const listed = COMPOSER_MODELS.find((item) => item.model.toLowerCase() === normalized);
  if (listed?.contextTokens && listed.contextTokens > 0) return listed.contextTokens;
  if (normalized.startsWith("grok-build-0.1")) return 256_000;
  if (normalized.startsWith("grok-4.3") || normalized.startsWith("grok4.3")) return 1_000_000;
  if (normalized.includes("deepseek-v4") || normalized.includes("kimi-k3")) return 1_000_000;
  if (normalized.startsWith("mistral-large") || normalized.startsWith("codestral")) return 1_000_000;
  if (normalized.startsWith("mistral-")) return 128_000;
  if (normalized.includes("llama-3.3") || normalized.includes("gpt-oss") || normalized.includes("qwen3")) return 131_072;
  if (normalized.includes("minimax-m3")) return 512_000;
  if (normalized.startsWith("gemini-4-argon")) return 1_048_576;
  if (normalized.startsWith("gemini-3") || normalized.startsWith("gemini-2.5")) return 1_000_000;
  if (
    normalized.startsWith("grok-4")
    || normalized.includes("grok-4.5")
    || normalized.includes("grok-4.6")
    || normalized.includes("grok-4.7")
  ) {
    return 500_000;
  }
  return 500_000;
}

export const COMPOSER_MODEL_GROUPS = [
  { label: "xAI", models: COMPOSER_MODELS.filter((model) => model.provider === "xai") },
  { label: "Fireworks", models: COMPOSER_MODELS.filter((model) => model.provider === "fireworks") },
  { label: "Google Gemini", models: COMPOSER_MODELS.filter((model) => model.provider === "gemini") },
];
