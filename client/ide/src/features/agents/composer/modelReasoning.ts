export type ComposerReasoning = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ComposerReasoningLevel {
  value: ComposerReasoning;
  label: string;
  desc: string;
}

const REASONING_LEVELS: ComposerReasoningLevel[] = [
  { value: "max", label: "Maximum", desc: "Maximum reasoning" },
  { value: "xhigh", label: "Extra High", desc: "Maximum reasoning" },
  { value: "high", label: "High", desc: "Deep reasoning" },
  { value: "medium", label: "Medium", desc: "Balanced reasoning" },
  { value: "low", label: "Low", desc: "Minimal reasoning" },
  { value: "none", label: "Off", desc: "No extended thinking" },
];

const ACTIVE_LEVELS: ComposerReasoning[] = ["low", "medium", "high", "xhigh", "max"];

// Provider effort values. First match wins.
const MODEL_EFFORTS: {
  needle: string;
  efforts: ComposerReasoning[];
  supportsOff: boolean;
}[] = [
  { needle: "gpt-6", efforts: ACTIVE_LEVELS, supportsOff: false },
  { needle: "grok-build-0.1", efforts: [], supportsOff: false },
  { needle: "grok-4.7", efforts: ["low", "medium", "high", "xhigh"], supportsOff: false },
  { needle: "grok-4.6", efforts: ["low", "medium", "high", "xhigh"], supportsOff: false },
  { needle: "grok-4.5", efforts: ["low", "medium", "high"], supportsOff: false },
  { needle: "grok-4", efforts: ["low", "medium", "high"], supportsOff: false },
  { needle: "gemini-4-argon", efforts: ["low", "medium", "high"], supportsOff: false },
  { needle: "gemini-3.8-flash", efforts: ["low", "medium", "high"], supportsOff: false },
  { needle: "gemini-3.1-pro", efforts: ["low", "medium", "high"], supportsOff: false },
  { needle: "gemini-3", efforts: ["low", "medium", "high"], supportsOff: false },
  { needle: "gemini-2.5", efforts: ["low", "medium", "high"], supportsOff: false },
  { needle: "deepseek-v4p1-flash", efforts: ["low", "high", "max"], supportsOff: true },
  { needle: "deepseek-v4", efforts: ["low", "high", "max"], supportsOff: true },
  { needle: "minimax-m3", efforts: ["low", "medium", "high"], supportsOff: false },
  { needle: "kimi-k3", efforts: ["low", "medium", "high", "max"], supportsOff: true },
  { needle: "mistral-large", efforts: ["low", "medium", "high"], supportsOff: false },
  { needle: "mistral-medium", efforts: ["low", "medium", "high"], supportsOff: false },
];

function modelReasoningEntry(model: string) {
  const normalized = model.trim().toLowerCase();
  return MODEL_EFFORTS.find((entry) => normalized.includes(entry.needle));
}

function advertisedReasoningEfforts(model: string): ComposerReasoning[] {
  return modelReasoningEntry(model)?.efforts ?? ["low", "medium", "high"];
}

function supportsReasoningOff(model: string): boolean {
  return modelReasoningEntry(model)?.supportsOff ?? false;
}

export function reasoningLevelsForModel(model: string): ComposerReasoningLevel[] {
  const advertised = new Set(advertisedReasoningEfforts(model));
  if (advertised.size === 0) return [];
  const supportsOff = supportsReasoningOff(model);
  return REASONING_LEVELS.filter(
    (level) => (level.value === "none" && supportsOff) || advertised.has(level.value),
  );
}

/** Snap a stored choice to the closest effort advertised by the selected model. */
export function snapReasoningEffort(
  effort: ComposerReasoning,
  model: string,
): ComposerReasoning {
  const advertised = advertisedReasoningEfforts(model);
  if (advertised.length === 0) return "medium";
  if (effort === "none") return supportsReasoningOff(model) ? "none" : "medium";
  if (advertised.includes(effort)) return effort;

  const requested = Math.max(0, ACTIVE_LEVELS.indexOf(effort));
  let nearest = advertised[0]!;
  let nearestDistance = Math.abs(ACTIVE_LEVELS.indexOf(nearest) - requested);
  for (const candidate of advertised.slice(1)) {
    const distance = Math.abs(ACTIVE_LEVELS.indexOf(candidate) - requested);
    if (distance <= nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}
