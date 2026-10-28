import type { ExternalAgentConfigOption } from "@coloride/contracts";
import type { ReactNode } from "react";
import { SharedComposer } from "../../shared/ui/composer/SharedComposer";
import { ExternalAgentConfigControls } from "./ExternalAgentConfigControls";

export function ExternalAgentComposer({
  draft,
  disabled,
  running,
  options,
  pending,
  onDraftChange,
  onSubmit,
  onCancel,
  onConfigChange,
}: {
  draft: string;
  disabled: boolean;
  running: boolean;
  options: ExternalAgentConfigOption[];
  pending: Record<string, string | boolean>;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onConfigChange: (configId: string, value: string | boolean) => void;
}) {
  const controls: ReactNode = (
    <ExternalAgentConfigControls
      disabled={disabled}
      onChange={onConfigChange}
      options={options}
      pending={pending}
    />
  );
  return (
    <div className="px-3 pb-3">
      <SharedComposer
        controls={controls}
        disabled={disabled}
        draft={draft}
        onCancel={onCancel}
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
        placeholder="Message Codex"
        running={running}
      />
    </div>
  );
}
