import { useWorkspaceClipboard } from "./useWorkspaceClipboard";
import { useWorkspaceDeletionUndo } from "./useWorkspaceDeletionUndo";
import { useWorkspaceFileMutations } from "./useWorkspaceFileMutations";

type Dependencies = Parameters<typeof useWorkspaceFileMutations>[0]
  & Omit<Parameters<typeof useWorkspaceClipboard>[0], "handleMoveTreeItem">
  & Parameters<typeof useWorkspaceDeletionUndo>[0];

/** Compatibility facade: each operation has one implementation and state owner. */
export function useWorkspaceFileOperations(dependencies: Dependencies) {
  const mutations = useWorkspaceFileMutations(dependencies);
  const clipboard = useWorkspaceClipboard({
    ...dependencies,
    handleMoveTreeItem: mutations.handleMoveTreeItem,
  });
  const deletion = useWorkspaceDeletionUndo(dependencies);
  return { ...mutations, ...clipboard, ...deletion };
}
