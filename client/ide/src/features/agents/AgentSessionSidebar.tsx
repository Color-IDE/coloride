import type { AgentSessionSummary } from "@coloride/contracts";
import type { Dispatch, SetStateAction } from "react";
import {
  FolderClosedIcon,
  FolderOpenIcon,
} from "../explorer/filetree/FileTree";
import { AgentTaskTitle } from "./AgentTaskTitle";
import { Orb } from "./Orb";

interface Props {
  createNewTask: () => void;
  newTaskShortcut: string;
  complementsOpen: boolean;
  setComplementsOpen: Dispatch<SetStateAction<boolean>>;
  workspaceSectionOpen: boolean;
  setWorkspaceSectionOpen: Dispatch<SetStateAction<boolean>>;
  workspaceGroups: {
    key: string;
    label: string;
    path: string;
    sessions: AgentSessionSummary[];
  }[];
  isWorkspaceGroupOpen: (key: string) => boolean;
  toggleWorkspaceGroup: (key: string) => void;
  pinnedTaskIds: string[];
  selectedSessionId: string | null;
  setTaskMenu: Dispatch<
    SetStateAction<{ sessionId: string; x: number; y: number } | null>
  >;
  selectSession: (
    sessionId: string | null,
    options?: { preferNewTask?: boolean },
  ) => void;
  togglePinTask: (sessionId: string) => void;
  archiveTask: (sessionId: string) => void;
  loading: boolean;
  filteredSessions: AgentSessionSummary[];
}
export function AgentSessionSidebar({
  createNewTask,
  newTaskShortcut,
  complementsOpen,
  setComplementsOpen,
  workspaceSectionOpen,
  setWorkspaceSectionOpen,
  workspaceGroups,
  isWorkspaceGroupOpen,
  toggleWorkspaceGroup,
  pinnedTaskIds,
  selectedSessionId,
  setTaskMenu,
  selectSession,
  togglePinTask,
  archiveTask,
  loading,
  filteredSessions,
}: Props) {
  return (
    <aside className="agent-side flex h-full min-h-0 flex-col overflow-hidden border-0 p-2">
      <div className="flex shrink-0 flex-col gap-0.5">
        <button
          className="agent-new-task flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-left text-[13px] font-medium leading-none"
          onClick={createNewTask}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="size-[15px] shrink-0"
            viewBox="0 0 24 24"
          >
            <path d="M0 0h24v24H0z" fill="none" />
            <path
              clipRule="evenodd"
              d="M11.9426 1.25L13.5 1.25C13.9142 1.25 14.25 1.58579 14.25 2C14.25 2.41421 13.9142 2.75 13.5 2.75H12C9.62177 2.75 7.91356 2.75159 6.61358 2.92637C5.33517 3.09825 4.56445 3.42514 3.9948 3.9948C3.42514 4.56445 3.09825 5.33517 2.92637 6.61358C2.75159 7.91356 2.75 9.62177 2.75 12C2.75 14.3782 2.75159 16.0864 2.92637 17.3864C3.09825 18.6648 3.42514 19.4355 3.9948 20.0052C4.56445 20.5749 5.33517 20.9018 6.61358 21.0736C7.91356 21.2484 9.62177 21.25 12 21.25C14.3782 21.25 16.0864 21.2484 17.3864 21.0736C18.6648 20.9018 19.4355 20.5749 20.0052 20.0052C20.5749 19.4355 20.9018 18.6648 21.0736 17.3864C21.2484 16.0864 21.25 14.3782 21.25 12V10.5C21.25 10.0858 21.5858 9.75 22 9.75C22.4142 9.75 22.75 10.0858 22.75 10.5V12.0574C22.75 14.3658 22.75 16.1748 22.5603 17.5863C22.366 19.031 21.9607 20.1711 21.0659 21.0659C20.1711 21.9607 19.031 22.366 17.5863 22.5603C16.1748 22.75 14.3658 22.75 12.0574 22.75H11.9426C9.63423 22.75 7.82519 22.75 6.41371 22.5603C4.96897 22.366 3.82895 21.9607 2.93414 21.0659C2.03933 20.1711 1.63399 19.031 1.43975 17.5863C1.24998 16.1748 1.24999 14.3658 1.25 12.0574V11.9426C1.24999 9.63423 1.24998 7.82519 1.43975 6.41371C1.63399 4.96897 2.03933 3.82895 2.93414 2.93414C3.82895 2.03933 4.96897 1.63399 6.41371 1.43975C7.82519 1.24998 9.63423 1.24999 11.9426 1.25ZM16.7705 2.27592C18.1384 0.908029 20.3562 0.908029 21.7241 2.27592C23.092 3.6438 23.092 5.86158 21.7241 7.22947L15.076 13.8776C14.7047 14.2489 14.4721 14.4815 14.2126 14.684C13.9069 14.9224 13.5761 15.1268 13.2261 15.2936C12.929 15.4352 12.6169 15.5392 12.1188 15.7052L9.21426 16.6734C8.67801 16.8521 8.0868 16.7126 7.68711 16.3129C7.28742 15.9132 7.14785 15.322 7.3266 14.7857L8.29477 11.8812C8.46079 11.3831 8.56479 11.071 8.7064 10.7739C8.87319 10.4239 9.07761 10.0931 9.31605 9.78742C9.51849 9.52787 9.7511 9.29529 10.1224 8.924L16.7705 2.27592ZM20.6634 3.33658C19.8813 2.55448 18.6133 2.55448 17.8312 3.33658L17.4546 3.7132C17.4773 3.80906 17.509 3.92327 17.5532 4.05066C17.6965 4.46372 17.9677 5.00771 18.48 5.51999C18.9923 6.03227 19.5363 6.30346 19.9493 6.44677C20.0767 6.49097 20.1909 6.52273 20.2868 6.54543L20.6634 6.16881C21.4455 5.38671 21.4455 4.11867 20.6634 3.33658ZM19.1051 7.72709C18.5892 7.50519 17.9882 7.14946 17.4193 6.58065C16.8505 6.01185 16.4948 5.41082 16.2729 4.89486L11.2175 9.95026C10.801 10.3668 10.6376 10.532 10.4988 10.7099C10.3274 10.9297 10.1804 11.1676 10.0605 11.4192C9.96337 11.623 9.88868 11.8429 9.7024 12.4017L9.27051 13.6974L10.3026 14.7295L11.5983 14.2976C12.1571 14.1113 12.377 14.0366 12.5808 13.9395C12.8324 13.8196 13.0703 13.6726 13.2901 13.5012C13.468 13.3624 13.6332 13.199 14.0497 12.7825L19.1051 7.72709Z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
          <span className="min-w-0 flex-1 truncate">New Task</span>
          {newTaskShortcut && newTaskShortcut !== "Unassigned" ? (
            <span className="agent-new-task-shortcut ml-auto shrink-0">
              {newTaskShortcut}
            </span>
          ) : null}
        </button>
        <button
          aria-pressed={complementsOpen}
          className={`agent-new-task flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-left text-[13px] font-medium leading-none${complementsOpen ? " is-active" : ""}`}
          onClick={() => setComplementsOpen(true)}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="size-[15px] shrink-0"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              clipRule="evenodd"
              d="M6.448 1.75C5.54954 1.74997 4.8003 1.74995 4.20552 1.82991C3.57773 1.91432 3.01093 2.09999 2.55546 2.55546C2.09999 3.01093 1.91432 3.57773 1.82991 4.20552C1.74995 4.8003 1.74997 5.54951 1.75 6.44798V6.552C1.74997 7.45047 1.74995 8.19971 1.82991 8.79448C1.91432 9.42228 2.09999 9.98908 2.55546 10.4445C3.01093 10.9 3.57773 11.0857 4.20552 11.1701C4.8003 11.2501 5.54951 11.25 6.44798 11.25H6.552C7.45047 11.25 8.19971 11.2501 8.79448 11.1701C9.42228 11.0857 9.98908 10.9 10.4445 10.4445C10.9 9.98908 11.0857 9.42228 11.1701 8.79448C11.2501 8.19971 11.25 7.4505 11.25 6.55203V6.44801C11.25 5.54954 11.2501 4.8003 11.1701 4.20552C11.0857 3.57773 10.9 3.01093 10.4445 2.55546C9.98908 2.09999 9.42228 1.91432 8.79448 1.82991C8.19971 1.74995 7.4505 1.74997 6.55203 1.75H6.448ZM3.61612 3.61612C3.74644 3.4858 3.94393 3.37858 4.4054 3.31654C4.88843 3.2516 5.53599 3.25 6.5 3.25C7.46401 3.25 8.11157 3.2516 8.59461 3.31654C9.05607 3.37858 9.25357 3.4858 9.38389 3.61612C9.5142 3.74644 9.62143 3.94393 9.68347 4.4054C9.74841 4.88843 9.75 5.53599 9.75 6.5C9.75 7.46401 9.74841 8.11157 9.68347 8.59461C9.62143 9.05607 9.5142 9.25357 9.38389 9.38389C9.25357 9.5142 9.05607 9.62143 8.59461 9.68347C8.11157 9.74841 7.46401 9.75 6.5 9.75C5.53599 9.75 4.88843 9.74841 4.4054 9.68347C3.94393 9.62143 3.74644 9.5142 3.61612 9.38389C3.4858 9.25357 3.37858 9.05607 3.31654 8.59461C3.2516 8.11157 3.25 7.46401 3.25 6.5C3.25 5.53599 3.2516 4.88843 3.31654 4.4054C3.37858 3.94393 3.4858 3.74644 3.61612 3.61612Z"
              fill="currentColor"
              fillRule="evenodd"
            />
            <path
              clipRule="evenodd"
              d="M17.448 12.75C16.5495 12.75 15.8003 12.7499 15.2055 12.8299C14.5777 12.9143 14.0109 13.1 13.5555 13.5555C13.1 14.0109 12.9143 14.5777 12.8299 15.2055C12.7499 15.8003 12.75 16.5495 12.75 17.448V17.552C12.75 18.4505 12.7499 19.1997 12.8299 19.7945C12.9143 20.4223 13.1 20.9891 13.5555 21.4445C14.0109 21.9 14.5777 22.0857 15.2055 22.1701C15.8003 22.2501 16.5495 22.25 17.4479 22.25H17.552C18.4504 22.25 19.1997 22.2501 19.7945 22.1701C20.4223 22.0857 20.9891 21.9 21.4445 21.4445C21.9 20.9891 22.0857 20.4223 22.1701 19.7945C22.2501 19.1997 22.25 18.4505 22.25 17.5521V17.448C22.25 16.5496 22.2501 15.8003 22.1701 15.2055C22.0857 14.5777 21.9 14.0109 21.4445 13.5555C20.9891 13.1 20.4223 12.9143 19.7945 12.8299C19.1997 12.7499 18.4505 12.75 17.552 12.75H17.448ZM14.6161 14.6161C14.7464 14.4858 14.9439 14.3786 15.4054 14.3165C15.8884 14.2516 16.536 14.25 17.5 14.25C18.464 14.25 19.1116 14.2516 19.5946 14.3165C20.0561 14.3786 20.2536 14.4858 20.3839 14.6161C20.5142 14.7464 20.6214 14.9439 20.6835 15.4054C20.7484 15.8884 20.75 16.536 20.75 17.5C20.75 18.464 20.7484 19.1116 20.6835 19.5946C20.6214 20.0561 20.5142 20.2536 20.3839 20.3839C20.2536 20.5142 20.0561 20.6214 19.5946 20.6835C19.1116 20.7484 18.464 20.75 17.5 20.75C16.536 20.75 15.8884 20.7484 15.4054 20.6835C14.9439 20.6214 14.7464 20.5142 14.6161 20.3839C14.4858 20.2536 14.3786 20.0561 14.3165 19.5946C14.2516 19.1116 14.25 18.464 14.25 17.5C14.25 16.536 14.2516 15.8884 14.3165 15.4054C14.3786 14.9439 14.4858 14.7464 14.6161 14.6161Z"
              fill="currentColor"
              fillRule="evenodd"
            />
            <path
              clipRule="evenodd"
              d="M6.448 12.75H6.552C7.45048 12.75 8.1997 12.7499 8.79448 12.8299C9.42228 12.9143 9.98908 13.1 10.4445 13.5555C10.9 14.0109 11.0857 14.5777 11.1701 15.2055C11.2501 15.8003 11.25 16.5495 11.25 17.448V17.552C11.25 18.4505 11.2501 19.1997 11.1701 19.7945C11.0857 20.4223 10.9 20.9891 10.4445 21.4445C9.98908 21.9 9.42228 22.0857 8.79448 22.1701C8.19971 22.2501 7.45051 22.25 6.55206 22.25H6.44801C5.54955 22.25 4.80029 22.2501 4.20552 22.1701C3.57773 22.0857 3.01093 21.9 2.55546 21.4445C2.09999 20.9891 1.91432 20.4223 1.82991 19.7945C1.74995 19.1997 1.74997 18.4505 1.75 17.552V17.448C1.74997 16.5495 1.74995 15.8003 1.82991 15.2055C1.91432 14.5777 2.09999 14.0109 2.55546 13.5555C3.01093 13.1 3.57773 12.9143 4.20552 12.8299C4.8003 12.7499 5.54952 12.75 6.448 12.75ZM4.4054 14.3165C3.94393 14.3786 3.74644 14.4858 3.61612 14.6161C3.4858 14.7464 3.37858 14.9439 3.31654 15.4054C3.2516 15.8884 3.25 16.536 3.25 17.5C3.25 18.464 3.2516 19.1116 3.31654 19.5946C3.37858 20.0561 3.4858 20.2536 3.61612 20.3839C3.74644 20.5142 3.94393 20.6214 4.4054 20.6835C4.88843 20.7484 5.53599 20.75 6.5 20.75C7.46401 20.75 8.11157 20.7484 8.59461 20.6835C9.05607 20.6214 9.25357 20.5142 9.38389 20.3839C9.5142 20.2536 9.62143 20.0561 9.68347 19.5946C9.74841 19.1116 9.75 18.464 9.75 17.5C9.75 16.536 9.74841 15.8884 9.68347 15.4054C9.62143 14.9439 9.5142 14.7464 9.38389 14.6161C9.25357 14.4858 9.05607 14.3786 8.59461 14.3165C8.11157 14.2516 7.46401 14.25 6.5 14.25C5.53599 14.25 4.88843 14.2516 4.4054 14.3165Z"
              fill="currentColor"
              fillRule="evenodd"
            />
            <path
              clipRule="evenodd"
              d="M17.448 1.75C16.5495 1.74997 15.8003 1.74995 15.2055 1.82991C14.5777 1.91432 14.0109 2.09999 13.5555 2.55546C13.1 3.01093 12.9143 3.57773 12.8299 4.20552C12.7499 4.8003 12.75 5.54952 12.75 6.448V6.552C12.75 7.45048 12.7499 8.1997 12.8299 8.79448C12.9143 9.42228 13.1 9.98908 13.5555 10.4445C14.0109 10.9 14.5777 11.0857 15.2055 11.1701C15.8003 11.2501 16.5495 11.25 17.448 11.25H17.552C18.4505 11.25 19.1997 11.2501 19.7945 11.1701C20.4223 11.0857 20.9891 10.9 21.4445 10.4445C21.9 9.98908 22.0857 9.42228 22.1701 8.79448C22.2501 8.19971 22.25 7.4505 22.25 6.55203V6.44801C22.25 5.54954 22.2501 4.8003 22.1701 4.20552C22.0857 3.57773 21.9 3.01093 21.4445 2.55546C20.9891 2.09999 20.4223 1.91432 19.7945 1.82991C19.1997 1.74995 18.4505 1.74997 17.552 1.75H17.448ZM14.6161 3.61612C14.7464 3.4858 14.9439 3.37858 15.4054 3.31654C15.8884 3.2516 16.536 3.25 17.5 3.25C18.464 3.25 19.1116 3.2516 19.5946 3.31654C20.0561 3.37858 20.2536 3.4858 20.3839 3.61612C20.5142 3.74644 20.6214 3.94393 20.6835 4.4054C20.7484 4.88843 20.75 5.53599 20.75 6.5C20.75 7.46401 20.7484 8.11157 20.6835 8.59461C20.6214 9.05607 20.5142 9.25357 20.3839 9.38389C20.2536 9.5142 20.0561 9.62143 19.5946 9.68347C19.1116 9.74841 18.464 9.75 17.5 9.75C16.536 9.75 15.8884 9.74841 15.4054 9.68347C14.9439 9.62143 14.7464 9.5142 14.6161 9.38389C14.4858 9.25357 14.3786 9.05607 14.3165 8.59461C14.2516 8.11157 14.25 7.46401 14.25 6.5C14.25 5.53599 14.2516 4.88843 14.3165 4.4054C14.3786 3.94393 14.4858 3.74644 14.6161 3.61612Z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
          <span className="min-w-0 flex-1 truncate">Complements</span>
        </button>
      </div>
      <button
        aria-expanded={workspaceSectionOpen}
        className="agent-workspace-section-label mt-3 flex w-full shrink-0 items-center gap-0.5 rounded-lg px-2 py-0.5 text-left hover:bg-white/[0.04]"
        onClick={() => setWorkspaceSectionOpen((open) => !open)}
        type="button"
      >
        <span className="min-w-0">Workspace</span>
        <svg
          aria-hidden="true"
          className={`agent-workspace-section-chevron h-4 w-4 shrink-0 ${workspaceSectionOpen ? "" : "-rotate-90"}`}
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            d="m6 10l6 6l6-6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      </button>
      {workspaceSectionOpen ? (
        <div className="agent-session-list mt-1 min-h-0 flex-1 overflow-y-auto">
          {workspaceGroups.map((group) => {
            const open = isWorkspaceGroupOpen(group.key);
            return (
              <div
                className="agent-workspace-group mb-1"
                key={group.key || "__other__"}
              >
                <button
                  aria-expanded={open}
                  className="agent-workspace-group-toggle flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium hover:bg-white/[0.04]"
                  onClick={() => toggleWorkspaceGroup(group.key)}
                  title={group.path || group.label}
                  type="button"
                >
                  {open ? (
                    <FolderOpenIcon className="agent-workspace-group-folder size-4 shrink-0" />
                  ) : (
                    <FolderClosedIcon className="agent-workspace-group-folder size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                </button>
                {open
                  ? group.sessions.map((session) => {
                      const isPinned = pinnedTaskIds.includes(
                        session.sessionId,
                      );
                      const isBusy = [
                        "starting",
                        "running",
                        "waiting-approval",
                      ].includes(session.state);
                      const waitingApproval =
                        session.state === "waiting-approval";
                      return (
                        <div
                          className={`agent-session-row agent-session-row-nested relative mb-0.5 flex w-full items-center rounded-lg py-1.5 pl-7 pr-2 text-left ${selectedSessionId === session.sessionId ? "is-active" : ""}${isPinned ? " is-pinned" : ""}${isBusy ? " is-busy" : ""}`}
                          key={session.sessionId}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setTaskMenu({
                              sessionId: session.sessionId,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                        >
                          {isBusy ? (
                            <span
                              className={`agent-session-busy-orb${waitingApproval ? " is-waiting-approval" : ""}`}
                              aria-hidden="true"
                            >
                              <Orb
                                label={
                                  waitingApproval
                                    ? "Waiting for permission"
                                    : "Generating"
                                }
                                size={22}
                                variant="S2"
                              />
                            </span>
                          ) : null}
                          <button
                            aria-busy={isBusy || undefined}
                            className="agent-session-select min-w-0 flex-1 text-left"
                            onClick={() => selectSession(session.sessionId)}
                            type="button"
                          >
                            <AgentTaskTitle
                              title={session.task || "Untitled task"}
                            />
                          </button>
                          <button
                            aria-label={isPinned ? "Unpin task" : "Pin task"}
                            aria-pressed={isPinned}
                            className={`agent-session-pin-action -mr-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]${isPinned ? " is-active" : ""}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              togglePinTask(session.sessionId);
                            }}
                            title={isPinned ? "Unpin" : "Pin"}
                            type="button"
                          >
                            <svg
                              aria-hidden="true"
                              className="agent-session-pin h-4 w-4"
                              fill={isPinned ? "currentColor" : "none"}
                              viewBox="0 0 24 24"
                            >
                              <path
                                d="M3 21L8 16"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="1.5"
                              />
                              <path
                                d="M13.2585 18.8714C9.51516 18.0215 5.97844 14.4848 5.12853 10.7415C4.99399 10.1489 4.92672 9.85266 5.12161 9.37197C5.3165 8.89129 5.55457 8.74255 6.03071 8.44509C7.10705 7.77265 8.27254 7.55888 9.48209 7.66586C11.1793 7.81598 12.0279 7.89104 12.4512 7.67048C12.8746 7.44991 13.1622 6.93417 13.7376 5.90269L14.4664 4.59604C14.9465 3.73528 15.1866 3.3049 15.7513 3.10202C16.316 2.89913 16.6558 3.02199 17.3355 3.26771C18.9249 3.84236 20.1576 5.07505 20.7323 6.66449C20.978 7.34417 21.1009 7.68401 20.898 8.2487C20.6951 8.8134 20.2647 9.05346 19.4039 9.53358L18.0672 10.2792C17.0376 10.8534 16.5229 11.1406 16.3024 11.568C16.0819 11.9955 16.162 12.8256 16.3221 14.4859C16.4399 15.7068 16.2369 16.88 15.5555 17.9697C15.2577 18.4458 15.1088 18.6839 14.6283 18.8786C14.1477 19.0733 13.8513 19.006 13.2585 18.8714Z"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="1.5"
                              />
                            </svg>
                          </button>
                          <button
                            aria-label="Archive task"
                            className="agent-session-pin-action -mr-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]"
                            onClick={(event) => {
                              event.stopPropagation();
                              archiveTask(session.sessionId);
                            }}
                            title="Archive"
                            type="button"
                          >
                            <svg
                              aria-hidden="true"
                              className="agent-session-pin h-4 w-4"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <path
                                d="M13 2H11C7.22876 2 5.34315 2 4.17157 3.17157C3 4.34315 3 6.22876 3 10V14C3 17.7712 3 19.6569 4.17157 20.8284C5.34315 22 7.22876 22 11 22H13C16.7712 22 18.6569 22 19.8284 20.8284C21 19.6569 21 17.7712 21 14V10C21 6.22876 21 4.34315 19.8284 3.17157C18.6569 2 16.7712 2 13 2Z"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeWidth="1.5"
                              />
                              <path
                                d="M21 12H3"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeWidth="1.5"
                              />
                              <path
                                d="M15 7H9"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeWidth="1.5"
                              />
                              <path
                                d="M15 17H9"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeWidth="1.5"
                              />
                            </svg>
                          </button>
                        </div>
                      );
                    })
                  : null}
              </div>
            );
          })}
          {!loading && filteredSessions.length === 0 ? (
            <div className="agent-muted px-2 py-6 text-center text-xs">
              No tasks
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
