import type { ExternalAgentConfigOption } from "@coloride/contracts";

const CONTROL_CATEGORIES = ["model", "thought_level", "mode", "model_config"] as const;

export function ExternalAgentConfigControls({
  options,
  pending,
  disabled,
  onChange,
}: {
  options: ExternalAgentConfigOption[];
  pending: Record<string, string | boolean>;
  disabled: boolean;
  onChange: (configId: string, value: string | boolean) => void;
}) {
  const visible = options.filter((option) => option.category == null || CONTROL_CATEGORIES.includes(option.category as (typeof CONTROL_CATEGORIES)[number]) || option.category === "model_config");
  if (!visible.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {visible.map((option) => {
        const pendingValue = pending[option.id];
        const value = pendingValue ?? option.currentValue;
        if (option.type === "boolean") {
          return (
            <button
              aria-pressed={Boolean(value)}
              className="rounded-control px-2 py-1 text-xs"
              disabled={disabled}
              key={option.id}
              onClick={() => onChange(option.id, !option.currentValue)}
              type="button"
            >
              {option.name}
            </button>
          );
        }
        return (
          <label className="flex items-center gap-1 text-xs" key={option.id}>
            <span className="sr-only">{option.name}</span>
            <select
              aria-label={option.name}
              disabled={disabled}
              onChange={(event) => onChange(option.id, event.target.value)}
              value={String(value)}
            >
              {option.options.map((choice) => (
                <option key={`${choice.group ?? ""}:${choice.value}`} value={choice.value}>
                  {choice.groupName ? `${choice.groupName} · ${choice.name}` : choice.name}
                </option>
              ))}
            </select>
            {pendingValue !== undefined ? <span aria-hidden="true">…</span> : null}
          </label>
        );
      })}
    </div>
  );
}
