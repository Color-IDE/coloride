import {
  useCallback,
  useState
} from "react";
import { useAgentHistoryPreferences } from "./useAgentHistoryPreferences";

interface Dependencies {
  sessionPane: "agent" | "sidebar";
  selectedSessionId: string | null;
}

export function useAgentHistoryState({ sessionPane, selectedSessionId }: Dependencies) {
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [chatHistoryDetails, setChatHistoryDetails] = useState<
    Record<string, import("@coloride/contracts").AgentChatHistoryEntry>
  >({});
  const handleHistoryDetails = useCallback(
    (entries: import("@coloride/contracts").AgentChatHistoryEntry[]) => {
      setChatHistoryDetails(
        Object.fromEntries(entries.map((entry) => [entry.sessionId, entry])),
      );
    },
    [],
  );
  const {
    chatTitles,
    setChatTitles,
    archivedTaskIds,
    setArchivedTaskIds,
    hiddenTaskIds,
    setHiddenTaskIds,
    pinnedTaskIds,
    setPinnedTaskIds,
    projects,
    setProjects,
  } = useAgentHistoryPreferences(sessionPane, selectedSessionId);
  return {
    chatHistoryOpen,
    setChatHistoryOpen,
    chatHistoryDetails,
    handleHistoryDetails,
    chatTitles,
    setChatTitles,
    archivedTaskIds,
    setArchivedTaskIds,
    hiddenTaskIds,
    setHiddenTaskIds,
    pinnedTaskIds,
    setPinnedTaskIds,
    projects,
    setProjects,
  };
}
