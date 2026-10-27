import type { AgentCheckpoint } from "@coloride/contracts";
import type { Dispatch, SetStateAction } from "react";
import type { AgentTerminalReference } from "../../shared/api/types";
import type {
  AgentTimelineEntry,
  AgentUserTimelineEntry,
} from "./AgentTimeline";
import {
  AgentCheckpointDock,
  AgentTimelineTurn,
  collectTurnFileStats,
  type AgentOpenFileRequest,
} from "./AgentTimeline";

interface Props {
  liveRow: boolean;
  localIndex: number;
  turn: {
    id: string;
    user: AgentUserTimelineEntry | null;
    items: AgentTimelineEntry[];
  };
  showTurnCard: boolean;
  turnCheckpointsForCard: AgentCheckpoint[];
  keepCheckpoints: (checkpoints: AgentCheckpoint[]) => void;
  openWorkspaceFile: (request: AgentOpenFileRequest | string) => void;
  setOpenCheckpointTurnId: Dispatch<SetStateAction<string | null>>;
  setCheckpointReviewOpen: Dispatch<SetStateAction<boolean>>;
  openCheckpointTurnId: string | null;
  undoCheckpoints: (checkpoints: AgentCheckpoint[]) => Promise<void>;
  restoringCheckpoint: string | null;
  checkpointReviewOpen: boolean;
  turnActive: boolean;
  openWorkspaceBrowser: (rawUrl: string) => void;
  openWorkspaceTerminal: (terminal: AgentTerminalReference) => void;
}
export function AgentConversationTurn({
  liveRow,
  localIndex,
  turn,
  showTurnCard,
  turnCheckpointsForCard,
  keepCheckpoints,
  openWorkspaceFile,
  setOpenCheckpointTurnId,
  setCheckpointReviewOpen,
  openCheckpointTurnId,
  undoCheckpoints,
  restoringCheckpoint,
  checkpointReviewOpen,
  turnActive,
  openWorkspaceBrowser,
  openWorkspaceTerminal,
}: Props) {
  return (
    <div
      className={`agent-timeline-virtual-item agent-chat-measure${
        liveRow ? " agent-timeline-live-row" : ""
      }`}
      data-agent-turn-index={localIndex}
      id={`agent-turn-${turn.id}`}
    >
      <AgentTimelineTurn
        checkpointCard={
          showTurnCard ? (
            <div className="agent-turn-checkpoint-card">
              <AgentCheckpointDock
                checkpoints={turnCheckpointsForCard}
                fileStats={collectTurnFileStats(turn.items)}
                onKeepAll={() => keepCheckpoints(turnCheckpointsForCard)}
                onOpenFile={openWorkspaceFile}
                onReview={() => {
                  setOpenCheckpointTurnId((current) =>
                    current === turn.id ? null : turn.id,
                  );
                  setCheckpointReviewOpen((open) =>
                    openCheckpointTurnId === turn.id ? !open : true,
                  );
                }}
                onUndoAll={() => void undoCheckpoints(turnCheckpointsForCard)}
                restoring={restoringCheckpoint !== null}
                reviewOpen={
                  openCheckpointTurnId === turn.id && checkpointReviewOpen
                }
                turnActive={turnActive}
                variant="full"
              />
            </div>
          ) : null
        }
        items={turn.items}
        onOpenBrowserUrl={openWorkspaceBrowser}
        onOpenFile={openWorkspaceFile}
        onOpenTerminal={openWorkspaceTerminal}
        turnActive={liveRow}
        user={turn.user}
      />
    </div>
  );
}
