import { pluginArtworkSrc } from "../SlashCommandMenu";
import type { AgentPluginChoice } from "../slashCommands";

export type ComposerPluginPickMode = "add" | "remove";

export function ComposerPlugins({
  activePick,
  plugins,
  onDetach,
}: {
  activePick: ComposerPluginPickMode | null;
  plugins: AgentPluginChoice[];
  onDetach: (pluginId: string) => void;
}) {
  return (
    <>
      {activePick ? (
        <span className="agent-composer-plugin-token">
          {activePick === "add" ? "/add-plugin" : "/remove-plugin"}
        </span>
      ) : null}
      {plugins.map((plugin) => {
        const artwork = pluginArtworkSrc(plugin.id);
        return (
          <button
            aria-label={`Remove ${plugin.name} from this chat`}
            className="agent-composer-code-chip agent-composer-plugin-chip"
            key={plugin.id}
            onClick={() => onDetach(plugin.id)}
            title={`${plugin.name} is added to this chat`}
            type="button"
          >
            <span aria-hidden="true" className="agent-composer-code-chip-icon">
              {artwork ? (
                <img alt="" className="agent-composer-plugin-mark" src={artwork} />
              ) : (
                <svg
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <path d="M2.5 7.5V13.5C2.5 17.2712 2.5 19.1569 3.67157 20.3284C4.84315 21.5 6.72876 21.5 10.5 21.5H13.5C17.2712 21.5 19.1569 21.5 20.3284 20.3284C21.5 19.1569 21.5 17.2712 21.5 13.5V7.5" />
                  <path d="M12 7.5V2.5" />
                </svg>
              )}
            </span>
            <span className="agent-composer-code-chip-label">{plugin.name}</span>
          </button>
        );
      })}
    </>
  );
}
