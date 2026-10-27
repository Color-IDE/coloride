export type ComposerContextUsage = {
  inputTokens: number;
  maxTokens: number;
  pct: number;
};

export function formatContextTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(thousands >= 10 ? 0 : 1).replace(/\.0$/, "")}k`;
  }
  return String(Math.max(0, Math.round(value)));
}
