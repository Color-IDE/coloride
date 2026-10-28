import type { ExternalAgentPermissionRequest } from "@coloride/contracts";

export function ExternalAgentPermission({
  request,
  onResolve,
}: {
  request: ExternalAgentPermissionRequest;
  onResolve: (optionId: string | null, outcome: "selected" | "cancelled") => void;
}) {
  return (
    <section aria-label="Codex permission" className="mx-3 mb-3 rounded-control border border-[var(--agent-border,#333)] p-3">
      <p className="text-sm font-medium">{request.title || "Codex needs permission"}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {request.options.map((option) => (
          <button
            className="rounded-control border border-[var(--agent-border,#333)] px-2 py-1 text-xs"
            key={option.optionId}
            onClick={() => onResolve(option.optionId, "selected")}
            type="button"
          >
            {option.name}
          </button>
        ))}
        <button
          className="rounded-control px-2 py-1 text-xs text-[#a3a3a3]"
          onClick={() => onResolve(null, "cancelled")}
          type="button"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
