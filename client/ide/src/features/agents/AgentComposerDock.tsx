import type {
  AgentApproval,
  AgentCheckpoint,
  AgentMode,
  AgentPlan,
  AgentPlanStep,
  GuardPause,
  TaskBudget,
} from "@coloride/contracts";
import { AnimatePresence, motion } from "motion/react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { VerticalScrollHairline } from "../../shared/ui/VerticalScrollHairline";
import { type LlmCreditsSnapshot } from "../auth/llmCredits";
import {
  FolderClosedIcon,
  FolderOpenIcon,
} from "../explorer/filetree/FileTree";
import { type AgentAccessLevel } from "../settings/agentAccess";
import { AgentGuardPauseCard } from "./AgentGuardPauseCard";
import type { AgentOpenFileRequest, CheckpointFileStat } from "./AgentTimeline";
import {
  AgentApprovalCard,
  AgentCheckpointDock,
  AgentPlanDock,
} from "./AgentTimeline";
import { type AgentWorkspaceToolKind } from "./AgentWorkspacePanel";
import {
  WorkspaceMenuComputerIcon,
  WorkspaceMenuHomeIcon,
  WorkspaceMenuServerIcon,
} from "./WorkspaceMenuIcons";
import { hasModelCredits } from "./agentProviderState";
import { type AgentViewProps } from "./agentViewTypes";
import {
  isHomeWorkspacePath,
  normalizeWorkspaceCwd,
  pathTailLabel,
  workspaceMenuPathLabel,
} from "./agentWorkspacePaths";
import { AgentComposerCard } from "./composer/AgentComposerCard";
import type { BuiltAgentPrompt } from "./composer/attachmentPrompt";
import type { ComposerModelOption } from "./composer/modelCatalog";
import { type ComposerReasoning } from "./composer/modelReasoning";
import {
  type SlashCommandInvocation,
  type SlashCommandResult,
} from "./slashCommands";

interface Props {
  showNewTask: boolean;
  pendingApproval: AgentApproval | null;
  dockPlan: AgentPlan | null;
  showComposerCheckpointDock: false;
  checkpointReviewOpen: boolean;
  planBusy: boolean;
  turnActive: boolean;
  planDraftSteps: AgentPlanStep[];
  planDraftTitle: string;
  dismissPlan: () => Promise<void>;
  implementPlan: () => Promise<void>;
  pendingCheckpoints: AgentCheckpoint[];
  pendingCheckpointFileStats: Map<string, CheckpointFileStat>;
  keepCheckpoints: (checkpoints: AgentCheckpoint[]) => void;
  openWorkspaceFile: (request: AgentOpenFileRequest | string) => void;
  setCheckpointReviewOpen: Dispatch<SetStateAction<boolean>>;
  undoAllCheckpoints: () => void;
  restoringCheckpoint: string | null;
  isSidebar: boolean;
  timelineFadeEdges: { top: boolean; bottom: boolean };
  showEmptySetup: boolean;
  scrollTimelineToBottom: () => void;
  newTaskWorkspaceMenuRef: RefObject<HTMLDivElement | null>;
  newTaskWorkspaceMenuOpen: boolean;
  setNewTaskWorkspaceMenuOpen: Dispatch<SetStateAction<boolean>>;
  newTaskNoRepo: boolean;
  agentWorkspacePath: string | null;
  setNewTaskWorkspaceQuery: Dispatch<SetStateAction<string>>;
  newTaskWorkspaceSearchRef: RefObject<HTMLInputElement | null>;
  newTaskWorkspaceQuery: string;
  workspaceMenuScrollRef: RefObject<HTMLDivElement | null>;
  selectableWorkspaces: { path: string; label: string }[];
  selectNewTaskWorkspace: (requestedPath: string) => Promise<boolean>;
  hostWorkspaceLabel: "On this Computer" | "On this VPS";
  setNewTaskNoRepo: (value: boolean) => void;
  noRepoWorkspacePath: string;
  setNewTaskWorkspacePath: Dispatch<SetStateAction<string | null>>;
  props: AgentViewProps;
  isLocalWorkspace: boolean;
  visibleGuardPause: GuardPause | null;
  resolvingGuard: string | null;
  resolveGuard: (
    action: "retry-strategy" | "continue-once" | "update-budget" | "stop",
    budget?: TaskBudget,
  ) => Promise<void>;
  resolveApproval: (
    approval: AgentApproval,
    decision: "approve" | "approve-session" | "decline",
  ) => Promise<void>;
  resolvingApproval: string | null;
  effectiveAccessLevel: AgentAccessLevel;
  activeMode: AgentMode;
  autoModel: boolean;
  llmCredits: LlmCreditsSnapshot | null;
  composerDisabled: boolean;
  viewActive: boolean;
  activeHeaderTerminal: string | null;
  composerReasoning: ComposerReasoning;
  contextUsage: { inputTokens: number; maxTokens: number; pct: number };
  composerDraftKey: number;
  activeSessionId: string | null;
  composerRetryDraft: { sessionId: string; text: string; key: number } | null;
  error: string;
  changeAccess: (level: AgentAccessLevel) => Promise<void>;
  changeMode: (nextMode: AgentMode) => Promise<void>;
  setComplementsOpen: Dispatch<SetStateAction<boolean>>;
  openWorkspaceKind: (kind: AgentWorkspaceToolKind) => void;
  setQueuedFollowUps: Dispatch<SetStateAction<string[]>>;
  selectComposerModel: (option: ComposerModelOption) => Promise<void>;
  handleSlashCommand: (
    invocation: SlashCommandInvocation,
  ) => Promise<SlashCommandResult>;
  stopGeneration: () => Promise<void>;
  submit: (payload: string | BuiltAgentPrompt) => Promise<boolean>;
  composerPlaceholder: string;
  providerModel: string;
  queuedFollowUps: string[];
  savingProvider: boolean;
  sendBlocked: boolean;
  setAutoModel: Dispatch<SetStateAction<boolean>>;
  changeReasoning: (level: ComposerReasoning) => Promise<void>;
  stopping: boolean;
}
export function AgentComposerDock({
  showNewTask,
  pendingApproval,
  dockPlan,
  showComposerCheckpointDock,
  checkpointReviewOpen,
  planBusy,
  turnActive,
  planDraftSteps,
  planDraftTitle,
  dismissPlan,
  implementPlan,
  pendingCheckpoints,
  pendingCheckpointFileStats,
  keepCheckpoints,
  openWorkspaceFile,
  setCheckpointReviewOpen,
  undoAllCheckpoints,
  restoringCheckpoint,
  isSidebar,
  timelineFadeEdges,
  showEmptySetup,
  scrollTimelineToBottom,
  newTaskWorkspaceMenuRef,
  newTaskWorkspaceMenuOpen,
  setNewTaskWorkspaceMenuOpen,
  newTaskNoRepo,
  agentWorkspacePath,
  setNewTaskWorkspaceQuery,
  newTaskWorkspaceSearchRef,
  newTaskWorkspaceQuery,
  workspaceMenuScrollRef,
  selectableWorkspaces,
  selectNewTaskWorkspace,
  hostWorkspaceLabel,
  setNewTaskNoRepo,
  noRepoWorkspacePath,
  setNewTaskWorkspacePath,
  props,
  isLocalWorkspace,
  visibleGuardPause,
  resolvingGuard,
  resolveGuard,
  resolveApproval,
  resolvingApproval,
  effectiveAccessLevel,
  activeMode,
  autoModel,
  llmCredits,
  composerDisabled,
  viewActive,
  activeHeaderTerminal,
  composerReasoning,
  contextUsage,
  composerDraftKey,
  activeSessionId,
  composerRetryDraft,
  error,
  changeAccess,
  changeMode,
  setComplementsOpen,
  openWorkspaceKind,
  setQueuedFollowUps,
  selectComposerModel,
  handleSlashCommand,
  stopGeneration,
  submit,
  composerPlaceholder,
  providerModel,
  queuedFollowUps,
  savingProvider,
  sendBlocked,
  setAutoModel,
  changeReasoning,
  stopping,
}: Props) {
  return (
    <footer
      className={`agent-composer-wrap shrink-0 px-2.5 pb-2.5 pt-0${showNewTask ? " is-new-task" : ""}`}
    >
      <div
        className={`agent-composer-stack relative mx-auto flex w-full flex-col${
          pendingApproval || dockPlan || showComposerCheckpointDock
            ? " has-approval-dock"
            : ""
        }${dockPlan ? " has-plan-dock" : ""}${
          showComposerCheckpointDock && checkpointReviewOpen
            ? " has-checkpoint-review"
            : ""
        }`}
      >
        {/* Plan stays above the composer. Allow replaces the input. */}
        {dockPlan || showComposerCheckpointDock ? (
          <div className="agent-docks-stack">
            <AnimatePresence initial={false} mode="wait">
              {dockPlan ? (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="agent-dock-slot"
                  exit={{ opacity: 0, y: 6 }}
                  initial={{ opacity: 0, y: 6 }}
                  key={`plan-${dockPlan.id}`}
                  transition={{ duration: 0.14, ease: "easeOut" }}
                >
                  <AgentPlanDock
                    busy={planBusy || turnActive}
                    draftSteps={
                      planDraftSteps.length ? planDraftSteps : dockPlan.steps
                    }
                    draftTitle={planDraftTitle || dockPlan.title}
                    onDismiss={() => void dismissPlan()}
                    onImplement={() => void implementPlan()}
                    plan={dockPlan}
                  />
                </motion.div>
              ) : showComposerCheckpointDock ? (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="agent-dock-slot agent-checkpoint-dock-slot"
                  exit={{ opacity: 0, y: 6 }}
                  initial={{ opacity: 0, y: 6 }}
                  key="checkpoint-dock"
                  transition={{ duration: 0.14, ease: "easeOut" }}
                >
                  <AgentCheckpointDock
                    checkpoints={pendingCheckpoints}
                    fileStats={pendingCheckpointFileStats}
                    onKeepAll={() => keepCheckpoints(pendingCheckpoints)}
                    onOpenFile={openWorkspaceFile}
                    onReview={() => setCheckpointReviewOpen((open) => !open)}
                    onUndoAll={() => void undoAllCheckpoints()}
                    restoring={restoringCheckpoint !== null}
                    reviewOpen={checkpointReviewOpen}
                    turnActive={turnActive}
                    variant={isSidebar ? "sidebar" : "full"}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
        {/* Agents tab: jump-to-bottom arrow.
                      Hide while Allow/guard cards replace the composer so they don't overlap. */}
        <AnimatePresence>
          {!isSidebar &&
            timelineFadeEdges.bottom &&
            !showNewTask &&
            !showEmptySetup && (
              <motion.div
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="agent-scroll-to-bottom-wrap"
                exit={{ opacity: 0, y: 6, scale: 0.92 }}
                initial={{ opacity: 0, y: 6, scale: 0.92 }}
                key="scroll-to-bottom"
                transition={{ duration: 0.14, ease: "easeOut" }}
              >
                <button
                  aria-label="Scroll to latest messages"
                  className="agent-scroll-to-bottom"
                  onClick={scrollTimelineToBottom}
                  title="Jump to bottom"
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="18"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    viewBox="0 0 24 24"
                    width="18"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M12 18.502V5.00195" />
                    <path d="M18 13.002C18 13.002 13.5811 19.0019 12 19.002C10.4188 19.002 6 13.002 6 13.002" />
                  </svg>
                </button>
              </motion.div>
            )}
        </AnimatePresence>
        {showNewTask && !isSidebar ? (
          <div
            className="agent-newtask-workspace"
            ref={newTaskWorkspaceMenuRef}
          >
            <div className="agent-newtask-workspace-bar">
              <button
                aria-expanded={newTaskWorkspaceMenuOpen}
                aria-haspopup="listbox"
                className="agent-newtask-workspace-trigger inline-flex max-w-full items-center gap-1.5 text-left text-[13px] font-medium"
                onClick={() => setNewTaskWorkspaceMenuOpen((open) => !open)}
                title={
                  newTaskNoRepo || isHomeWorkspacePath(agentWorkspacePath)
                    ? "No repo"
                    : agentWorkspacePath || "Select workspace"
                }
                type="button"
              >
                {newTaskNoRepo || isHomeWorkspacePath(agentWorkspacePath) ? (
                  <WorkspaceMenuHomeIcon />
                ) : newTaskWorkspaceMenuOpen ? (
                  <FolderOpenIcon className="agent-newchat-workspace-folder size-3.5 shrink-0" />
                ) : (
                  <FolderClosedIcon className="agent-newchat-workspace-folder size-3.5 shrink-0" />
                )}
                <span className="min-w-0 truncate">
                  {newTaskNoRepo || isHomeWorkspacePath(agentWorkspacePath)
                    ? "No repo"
                    : agentWorkspacePath
                      ? pathTailLabel(agentWorkspacePath)
                      : "Workspace"}
                </span>
                <svg
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 16 16"
                >
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </button>
            </div>
            {newTaskWorkspaceMenuOpen ? (
              <div
                className="agent-newchat-workspace-menu agent-newtask-workspace-menu"
                role="listbox"
                aria-label="Select workspace"
              >
                <div className="agent-newtask-workspace-search">
                  <input
                    aria-label="Search folders"
                    className="agent-newtask-workspace-search-input"
                    onChange={(event) =>
                      setNewTaskWorkspaceQuery(event.target.value)
                    }
                    placeholder="Search folders, repos..."
                    ref={newTaskWorkspaceSearchRef}
                    type="text"
                    value={newTaskWorkspaceQuery}
                  />
                </div>
                <div className="agent-workspace-scroll-surface vertical-scroll-surface">
                  <div
                    className="agent-newchat-workspace-menu-list"
                    ref={workspaceMenuScrollRef}
                  >
                    {selectableWorkspaces.length ? (
                      <div className="agent-newtask-workspace-heading">
                        Recents
                      </div>
                    ) : null}
                    {selectableWorkspaces
                      .filter((item) => {
                        const query = newTaskWorkspaceQuery
                          .trim()
                          .toLowerCase();
                        if (!query) return true;
                        return (
                          item.label.toLowerCase().includes(query) ||
                          item.path.toLowerCase().includes(query) ||
                          workspaceMenuPathLabel(item.path)
                            .toLowerCase()
                            .includes(query)
                        );
                      })
                      .map((item) => {
                        const selected =
                          !newTaskNoRepo &&
                          normalizeWorkspaceCwd(agentWorkspacePath) ===
                            item.path;
                        return (
                          <button
                            className={`agent-newchat-workspace-item agent-newtask-workspace-item flex w-full items-center gap-2 text-left${selected ? " is-selected" : ""}`}
                            key={item.path}
                            onClick={() => {
                              setNewTaskWorkspaceMenuOpen(false);
                              if (!selected)
                                void selectNewTaskWorkspace(item.path);
                            }}
                            role="option"
                            aria-selected={selected}
                            title={item.path}
                            type="button"
                          >
                            <FolderClosedIcon className="agent-newchat-workspace-item-folder size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                              {workspaceMenuPathLabel(item.path)}
                            </span>
                            {selected ? (
                              <svg
                                aria-hidden="true"
                                className="agent-newtask-workspace-check ml-auto shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  d="m5 12 5 5L20 7"
                                  stroke="currentColor"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2.25"
                                />
                              </svg>
                            ) : null}
                          </button>
                        );
                      })}
                    {(() => {
                      const query = newTaskWorkspaceQuery.trim().toLowerCase();
                      const showNoRepo =
                        !query ||
                        "no repo".includes(query) ||
                        "norepo".includes(query.replace(/\s+/g, ""));
                      const showHost =
                        !query ||
                        hostWorkspaceLabel.toLowerCase().includes(query) ||
                        "vps".includes(query) ||
                        "computer".includes(query);
                      if (!showNoRepo && !showHost) return null;
                      const noRepoSelected = newTaskNoRepo;
                      return (
                        <>
                          <div className="agent-newtask-workspace-heading">
                            Repos
                          </div>
                          {showNoRepo ? (
                            <button
                              className={`agent-newchat-workspace-item agent-newtask-workspace-item flex w-full items-center gap-2 text-left${noRepoSelected ? " is-selected" : ""}`}
                              onClick={() => {
                                setNewTaskWorkspaceMenuOpen(false);
                                setNewTaskNoRepo(true);
                                if (noRepoWorkspacePath)
                                  setNewTaskWorkspacePath(noRepoWorkspacePath);
                              }}
                              role="option"
                              aria-selected={noRepoSelected}
                              title="Start without a repo — you can give one later in chat"
                              type="button"
                            >
                              <WorkspaceMenuHomeIcon />
                              <span className="min-w-0 flex-1 truncate">
                                No repo
                              </span>
                              {noRepoSelected ? (
                                <svg
                                  aria-hidden="true"
                                  className="agent-newtask-workspace-check ml-auto shrink-0"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    d="m5 12 5 5L20 7"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="2.25"
                                  />
                                </svg>
                              ) : null}
                            </button>
                          ) : null}
                          {showHost && props.onBrowseWorkspace ? (
                            <button
                              className="agent-newchat-workspace-item agent-newtask-workspace-item flex w-full items-center gap-2 text-left"
                              onClick={async () => {
                                setNewTaskWorkspaceMenuOpen(false);
                                const path = await props.onBrowseWorkspace?.();
                                if (path) await selectNewTaskWorkspace(path);
                              }}
                              type="button"
                            >
                              {isLocalWorkspace ? (
                                <WorkspaceMenuComputerIcon />
                              ) : (
                                <WorkspaceMenuServerIcon />
                              )}
                              <span className="min-w-0 flex-1 truncate">
                                {hostWorkspaceLabel}
                              </span>
                              <svg
                                aria-hidden="true"
                                className="agent-newtask-workspace-chevron-right ml-auto shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  d="m9 6 6 6-6 6"
                                  stroke="currentColor"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="1.75"
                                />
                              </svg>
                            </button>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                  <VerticalScrollHairline
                    targetRef={workspaceMenuScrollRef}
                    label="Recent workspaces scroll"
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="agent-composer-card-slot relative">
          {visibleGuardPause ? (
            <AgentGuardPauseCard
              pause={visibleGuardPause}
              resolving={resolvingGuard}
              onResolve={(action, budget) => void resolveGuard(action, budget)}
            />
          ) : pendingApproval ? (
            <AgentApprovalCard
              approval={pendingApproval}
              onResolve={resolveApproval}
              resolvingApproval={resolvingApproval}
              variant="full"
            />
          ) : (
            <AgentComposerCard
              accessLevel={effectiveAccessLevel}
              activeMode={activeMode}
              autoModel={autoModel}
              hasPaidModelAccess={hasModelCredits(llmCredits)}
              compact
              newTask={showNewTask}
              composerDisabled={composerDisabled}
              voiceEnabled={viewActive && !activeHeaderTerminal}
              composerReasoning={composerReasoning}
              contextUsage={contextUsage}
              draftKey={composerDraftKey}
              draftSessionId={activeSessionId}
              retryDraft={
                composerRetryDraft?.sessionId === activeSessionId
                  ? composerRetryDraft
                  : null
              }
              retryError={
                composerRetryDraft?.sessionId === activeSessionId ? error : ""
              }
              onChangeAccess={(level) => void changeAccess(level)}
              onChangeMode={(next) => void changeMode(next)}
              onBrowseComplements={() => setComplementsOpen(true)}
              onOpenBrowser={() => openWorkspaceKind("browser")}
              onRestoreQueuedFollowUp={(index) => {
                setQueuedFollowUps((current) => {
                  if (index < 0 || index >= current.length) return current;
                  return current.filter((_, i) => i !== index);
                });
              }}
              onSelectModel={(option) => void selectComposerModel(option)}
              onSlashCommand={handleSlashCommand}
              onSlashMenuOpenChange={(open) => {
                if (open) setNewTaskWorkspaceMenuOpen(false);
              }}
              onStop={() => void stopGeneration()}
              onSubmit={submit}
              placeholder={composerPlaceholder}
              providerModel={providerModel}
              queuedFollowUps={queuedFollowUps}
              savingProvider={savingProvider}
              sendBlocked={sendBlocked}
              setAutoModel={setAutoModel}
              setComposerReasoning={(level) => void changeReasoning(level)}
              stopping={stopping}
              turnActive={turnActive}
              workspacePath={agentWorkspacePath}
            />
          )}
        </div>
        {!isSidebar && showNewTask ? (
          <div className="agent-newtask-environment">
            {props.workspaceKind === "local" ? (
              <WorkspaceMenuComputerIcon />
            ) : (
              <WorkspaceMenuServerIcon />
            )}
            <span>
              {props.workspaceKind === "local"
                ? "Local"
                : "Connected workspace"}
            </span>
          </div>
        ) : null}
      </div>
    </footer>
  );
}
