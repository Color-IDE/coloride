import { useWorkspaceClipboard } from "./useWorkspaceClipboard";
import { useWorkspaceDeletionUndo } from "./useWorkspaceDeletionUndo";
import { useWorkspaceFileMutations } from "./useWorkspaceFileMutations";

type Dependencies = Parameters<typeof useWorkspaceFileMutations>[0]
  & Omit<Parameters<typeof useWorkspaceClipboard>[0], "handleMoveTreeItem" | "pushTreeUndo">
  & Omit<Parameters<typeof useWorkspaceDeletionUndo>[0], "moveTreeItem">;

/** Compatibility facade: each operation has one implementation and state owner. */
export function useWorkspaceFileOperations(dependencies: Dependencies) {
  const mutations = useWorkspaceFileMutations(dependencies);
  const deletion = useWorkspaceDeletionUndo({...dependencies, moveTreeItem:mutations.handleMoveTreeItem});
  const clipboard = useWorkspaceClipboard({
    ...dependencies,
    handleMoveTreeItem: mutations.handleMoveTreeItem,
    pushTreeUndo: deletion.pushTreeUndo,
  });
  return { ...mutations, ...clipboard, ...deletion };
}
