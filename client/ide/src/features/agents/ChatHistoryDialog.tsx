import { externalAgentsApi } from "../external-agents";
import type {
  AgentChatHistoryEntry,
  ExternalAgentHistoryEntry,
  AgentSessionSummary,
} from "@coloride/contracts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../shared/api/client";
import { Button } from "../../shared/ui/Button";
import { IconButton } from "../../shared/ui/IconButton";
import { Menu, MenuItem, MenuSeparator } from "../../shared/ui/Menu";
import { useContextMenuPosition } from "../../shared/ui/useContextMenuPosition";
import { VerticalScrollHairline } from "../../shared/ui/VerticalScrollHairline";
import { CompactSelect } from "../settings/SettingsControls";

function HistoryIcon({
  kind,
  filled = false,
}: {
  kind: "plus" | "close" | "star" | "more";
  filled?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "plus" ? (
        <path d="M12 5v14M5 12h14" />
      ) : kind === "close" ? (
        <path d="m6 6 12 12M18 6 6 18" />
      ) : kind === "star" ? (
        <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />
      ) : (
        <>
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </>
      )}
    </svg>
  );
}
const GENERIC_TITLE =
  /^(?:initial greeting(?: only)?|new (?:chat|conversation)(?: greeting)?|untitled(?: task)?|analyze project codebase)$/i;
export function chatTitle(
  session: AgentSessionSummary,
  titles: Record<string, string>,
  detail?: AgentChatHistoryEntry,
) {
  return (
    titles[session.sessionId] ||
    (GENERIC_TITLE.test(session.task.trim()) && detail?.firstMessage
      ? detail.firstMessage
      : session.task) ||
    detail?.firstMessage ||
    "Untitled chat"
  );
}
const projectKey = (
  session: Pick<AgentSessionSummary, "cwd" | "workspaceKind" | "connectionId">,
) =>
  `${session.workspaceKind ?? "ssh"}:${session.connectionId ?? "local"}:${session.cwd.replace(/\/$/, "")}`;
const projectName = (cwd: string) =>
  cwd.replace(/\/$/, "").split(/[\\/]/).pop() || "No project";

export function ChatHistoryDialog(props: {
  sessions: AgentSessionSummary[];
  selectedId: string | null;
  workspacePath: string | null;
  workspaceKind: "local" | "ssh";
  connectionId?: string | null;
  filesystemScope: "workspace" | "server";
  pinnedIds: string[];
  archivedIds: string[];
  hiddenIds: string[];
  titles: Record<string, string>;
  newChatShortcut: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onSelectExternal?: (session: {sessionId:string; agentId:string; workspacePath:string}) => void;
  onNew: () => void;
  onDetails: (details: AgentChatHistoryEntry[]) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
  onArchive: (id: string) => void | Promise<void>;
  onTrash: (id: string) => void;
  onRestore: (id: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [externalHistory, setExternalHistory] = useState<ExternalAgentHistoryEntry[]>([]);
  const [externalError, setExternalError] = useState("");
  useEffect(() => {
    if (props.workspaceKind !== "local") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void externalAgentsApi.history(query.trim()).then(history => {
        if (cancelled) return;
        setExternalHistory(history);
        setExternalError("");
      }).catch(() => {
        if (!cancelled) setExternalError("Codex history is unavailable. Restart the local host to load it.");
      });
    }, query ? 180 : 0);
    return () => {cancelled = true; clearTimeout(timer);};
  }, [query, props.workspaceKind]);
  const historySessions = useMemo<AgentSessionSummary[]>(() => [
    ...props.sessions,
    ...externalHistory.map(({session, firstMessage}) => ({
      sessionId:`external:${session.id}`, agent:session.agentId,
      task:/^(codex|external agent|new chat)$/i.test(session.title) ? firstMessage || session.title : session.title,
      cwd:session.workspacePath, workspaceKind:"local" as const, connectionId:"local",
      filesystemScope:"workspace" as const, mode:"act" as const,
      state:session.turn === "running" ? "running" as const : "idle" as const,
      spentUsd:0, startedAt:session.updatedAt, updatedAt:session.updatedAt,
    })),
  ], [props.sessions, externalHistory]);

  const [view, setView] = useState("chats");
  const [project, setProject] = useState(() =>
    props.workspacePath
      ? projectKey({
          cwd: props.workspacePath,
          workspaceKind: props.workspaceKind,
          connectionId: props.connectionId,
        })
      : "all",
  );
  const [details, setDetails] = useState<Record<string, AgentChatHistoryEntry>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(
    null,
  );
  const placement = useContextMenuPosition(menu);
  const rowsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const updateEdges = () => {
    const node = listRef.current;
    if (node)
      setEdges({
        top: node.scrollTop > 1,
        bottom: node.scrollHeight - node.clientHeight - node.scrollTop > 1,
      });
  };
  const combinedDetails = useMemo(() => ({...details, ...Object.fromEntries(externalHistory.map(entry => [
    `external:${entry.session.id}`, {sessionId:`external:${entry.session.id}`, firstMessage:entry.firstMessage,
      preview:entry.preview, snippet:entry.snippet, matches:entry.matches},
  ]))}), [details, externalHistory]);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useEffect(
    () => () => {
      if (previousFocus.current?.isConnected)
        previousFocus.current.focus({ preventScroll: true });
    },
    [],
  );
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(
      () => {
        void api
          .agentChatHistory({
            workspaceKind: props.workspaceKind,
            connectionId: props.connectionId,
            filesystemScope: props.filesystemScope,
            query: query.trim(),
          })
          .then((result) => {
            if (cancelled) return;
            setDetails(
              Object.fromEntries(
                result.map((entry) => [entry.sessionId, entry]),
              ),
            );
            props.onDetails(result);
            setError("");
          })
          .catch(() => {
            if (!cancelled)
              setError(
                "Message search is unavailable. Restart Coloride to load the updated local host. You can still search titles and projects.",
              );
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      query ? 180 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    query,
    props.workspaceKind,
    props.connectionId,
    props.filesystemScope,
    props.onDetails,
  ]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);
  const projects = useMemo(
    () =>
      [
        ...new Map(
          historySessions.map((session) => [
            projectKey(session),
            { name: projectName(session.cwd), path: session.cwd },
          ]),
        ).entries(),
      ].sort((a, b) => a[1].name.localeCompare(b[1].name)),
    [historySessions],
  );
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const yesterday = new Date(midnight);
    yesterday.setDate(yesterday.getDate() - 1);
    return historySessions
      .filter((session) => {
        const trash = props.hiddenIds.includes(session.sessionId);
        const archived = Boolean(
          session.archived || props.archivedIds.includes(session.sessionId),
        );
        if (
          view === "trash"
            ? !trash
            : view === "archived"
              ? trash || !archived
              : trash || archived
        )
          return false;
        if (project !== "all" && projectKey(session) !== project) return false;
        const detail = combinedDetails[session.sessionId];
        return (
          !needle ||
          `${chatTitle(session, props.titles, detail)} ${session.cwd}`
            .toLowerCase()
            .includes(needle) ||
          detail?.matches
        );
      })
      .sort(
        (a, b) =>
          Number(props.pinnedIds.includes(b.sessionId)) -
            Number(props.pinnedIds.includes(a.sessionId)) ||
          Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      )
      .map((session) => {
        const date = new Date(session.updatedAt);
        const group =
          view === "chats" && props.pinnedIds.includes(session.sessionId)
            ? "Pinned"
            : date >= midnight
              ? "Today"
              : date >= yesterday
                ? "Yesterday"
                : "Earlier";
        return { session, detail: combinedDetails[session.sessionId], group };
      });
  }, [
    historySessions,
    props.titles,
    props.hiddenIds,
    props.archivedIds,
    props.pinnedIds,
    query,
    project,
    view,
    combinedDetails,
  ]);
  useEffect(() => {
    setActive(0);
  }, [query, project, view]);
  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, rows.length - 1)));
  }, [rows.length]);
  useEffect(() => {
    rowsRef.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useLayoutEffect(() => {
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    if (listRef.current) {
      observer.observe(listRef.current);
      for (const child of listRef.current.children) observer.observe(child);
    }
    return () => observer.disconnect();
  }, [rows, loading]);
  const choose = (id: string) => {
    const external = externalHistory.find(entry => `external:${entry.session.id}` === id);
    if (external) {
      if (!props.onSelectExternal) {setError("This view cannot open external agent conversations."); return;}
      props.onSelectExternal({sessionId:external.session.id, agentId:external.session.agentId,
        workspacePath:external.session.workspacePath});
    } else props.onSelect(id);
    props.onClose();
  };
  const rename = (id: string) => {
    if (renameText.trim()) props.onRename(id, renameText.trim().slice(0, 160));
    setRenaming(null);
  };
  const action = async (callback: () => void | Promise<void>) => {
    setMenu(null);
    try {
      await callback();
    } catch {
      setError("Could not update this conversation. Try again.");
    }
  };
  return createPortal(
    <div className="agent-history-backdrop" onMouseDown={props.onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Chat history"
        className="agent-history-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            const controls = Array.from(
              dialogRef.current?.querySelectorAll<HTMLElement>(
                "input:not(:disabled),select:not(:disabled),button:not(:disabled)",
              ) ?? [],
            );
            const first = controls[0],
              last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
          if (renaming || event.target instanceof HTMLSelectElement) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (menu) setMenu(null);
            else props.onClose();
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setActive((index) =>
              Math.max(
                0,
                Math.min(
                  rows.length - 1,
                  index + (event.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if (
            event.key === "Enter" &&
            (event.target instanceof HTMLInputElement ||
              (event.target instanceof HTMLElement &&
                event.target.getAttribute("role") === "option")) &&
            rows[active]
          ) {
            event.preventDefault();
            choose(rows[active].session.sessionId);
          }
        }}
      >
        <header className="agent-history-header">
          <input
            autoFocus
            maxLength={200}
            aria-label="Search chat history"
            placeholder="Search titles, messages or projects…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            size="sm"
            onClick={() => {
              props.onNew();
              props.onClose();
            }}
            title="New chat"
          >
            <HistoryIcon kind="plus" />
            New chat
          </Button>
          <IconButton label="Close chat history" onClick={props.onClose}>
            <HistoryIcon kind="close" />
          </IconButton>
        </header>
        <div
          className="agent-history-filters"
          onKeyDown={(event) => {
            if (
              event.key !== "Escape" &&
              event.currentTarget.querySelector('[aria-expanded="true"]')
            )
              event.stopPropagation();
          }}
        >
          <CompactSelect
            menuStyle="agent"
            ariaLabel="Filter by project"
            value={project}
            onChange={setProject}
            options={[
              { value: "all", label: "All projects" },
              ...(props.workspacePath &&
              !projects.some(
                ([key]) =>
                  key ===
                  projectKey({
                    cwd: props.workspacePath!,
                    workspaceKind: props.workspaceKind,
                    connectionId: props.connectionId,
                  }),
              )
                ? [
                    {
                      value: projectKey({
                        cwd: props.workspacePath,
                        workspaceKind: props.workspaceKind,
                        connectionId: props.connectionId,
                      }),
                      label: projectName(props.workspacePath),
                    },
                  ]
                : []),
              ...projects.map(([value, item]) => ({
                value,
                label: `${item.name} · ${item.path}`,
              })),
            ]}
          />
          <CompactSelect
            menuStyle="agent"
            ariaLabel="History view"
            value={view}
            onChange={setView}
            options={[
              { value: "chats", label: "Chats" },
              { value: "archived", label: "Archived" },
              { value: "trash", label: "Trash" },
            ]}
          />
          <span role="status" className="agent-history-muted">
            {loading
              ? query
                ? "Searching…"
                : "Loading…"
              : `${rows.length} ${rows.length === 1 ? "chat" : "chats"}`}
          </span>
        </div>
        {error || externalError ? (
          <p role="alert" className="agent-history-notice">
            {error || externalError}
          </p>
        ) : null}
        <div className="agent-history-scroll">
          <div
            ref={listRef}
            onScroll={updateEdges}
            className="agent-history-list"
            role="listbox"
            aria-label="Conversations"
          >
            {rows.map(({ session, detail, group }, index) => {
              const title = chatTitle(session, props.titles, detail);
              const pinned = props.pinnedIds.includes(session.sessionId);
              return (
                <div key={session.sessionId}>
                  {index === 0 || rows[index - 1].group !== group ? (
                    <div className="agent-history-group">{group}</div>
                  ) : null}
                  <div
                    className={`agent-history-row${active === index ? " is-focused" : ""}`}
                    onPointerMove={() => setActive(index)}
                    onFocusCapture={() => setActive(index)}
                  >
                    <button
                      ref={(node) => {
                        rowsRef.current[index] = node;
                      }}
                      role="option"
                      aria-selected={active === index}
                      className="agent-history-open"
                      onFocus={() => setActive(index)}
                      onClick={() => {
                        if (renaming !== session.sessionId)
                          choose(session.sessionId);
                      }}
                      type="button"
                    >
                      <span
                        className="agent-history-title"
                        style={
                          renaming === session.sessionId
                            ? { visibility: "hidden" }
                            : undefined
                        }
                      >
                        {title}
                      </span>
                      <span className="agent-history-preview">
                        {query && detail?.snippet
                          ? detail.snippet
                          : detail?.preview || "No message preview yet"}
                      </span>
                      <span className="agent-history-meta" title={session.cwd}>
                        {session.sessionId.startsWith("external:") ? `${session.agent === "codex-acp" ? "Codex" : session.agent} · ` : ""}
                        {projectName(session.cwd)} ·{" "}
                        {new Intl.DateTimeFormat(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(session.updatedAt))}
                        {session.state === "running" ? " · Running" : ""}
                      </span>
                    </button>
                    {renaming === session.sessionId ? (
                      <input
                        className="agent-history-rename"
                        autoFocus
                        aria-label="Conversation title"
                        maxLength={160}
                        value={renameText}
                        onFocus={(event) => {
                          const input = event.currentTarget;
                          input.setSelectionRange(
                            input.value.length,
                            input.value.length,
                          );
                        }}
                        onChange={(event) => setRenameText(event.target.value)}
                        onBlur={() => rename(session.sessionId)}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") rename(session.sessionId);
                          if (event.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : null}
                    <div className="agent-history-actions">
                      {view === "chats" ? (
                        <button
                          className="agent-history-icon"
                          aria-label={`${pinned ? "Unpin" : "Pin"} ${title}`}
                          aria-pressed={pinned}
                          onClick={() => props.onPin(session.sessionId)}
                          type="button"
                        >
                          <HistoryIcon kind="star" filled={pinned} />
                        </button>
                      ) : null}
                      <button
                        className="agent-history-icon"
                        aria-label={`Conversation actions: ${title}`}
                        onClick={(event) => {
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          setMenu({
                            id: session.sessionId,
                            x:
                              rect.right -
                              (parseFloat(
                                getComputedStyle(
                                  document.documentElement,
                                ).getPropertyValue("--context-menu-width"),
                              ) || 224),
                            y: rect.bottom + 4,
                          });
                        }}
                        type="button"
                      >
                        <HistoryIcon kind="more" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {!rows.length ? (
              <div className="agent-history-empty">
                {loading
                  ? "Loading conversations…"
                  : query
                    ? "No conversations match your search."
                    : view === "chats"
                      ? "No chats in this project yet."
                      : `No ${view === "trash" ? "deleted" : "archived"} conversations.`}
              </div>
            ) : null}
          </div>
          <VerticalScrollHairline
            targetRef={listRef}
            label="Chat history scroll"
          />
          <span
            className={`scroll-edge-fade agent-history-fade top${edges.top ? " is-visible" : ""}`}
            data-edge="top"
          />
          <span
            className={`scroll-edge-fade agent-history-fade bottom${edges.bottom ? " is-visible" : ""}`}
            data-edge="bottom"
          />
        </div>
        <footer className="agent-history-footer">
          <span>
            <button
              type="button"
              className="filetree-context-shortcut"
              aria-label="Previous conversation"
              onClick={() => setActive((index) => Math.max(0, index - 1))}
            >
              ↑
            </button>
            <button
              type="button"
              className="filetree-context-shortcut"
              aria-label="Next conversation"
              onClick={() =>
                setActive((index) =>
                  Math.min(Math.max(0, rows.length - 1), index + 1),
                )
              }
            >
              ↓
            </button>
            Navigate
          </span>
          <span>
            <kbd className="filetree-context-shortcut" title="Enter">
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
                <path d="M0 0h24v24H0z" fill="none" />
                <path fill="currentColor" d="M21 4a1 1 0 0 1 .993.883L22 5v6.5a3.5 3.5 0 0 1-3.308 3.495L18.5 15H5.415l3.292 3.293a1 1 0 0 1 .083 1.32l-.083.094a1 1 0 0 1-1.32.083l-.094-.083l-5-5a1 1 0 0 1-.097-.112l-.071-.11l-.054-.114l-.035-.105l-.025-.117l-.007-.06L2 14l.003-.075l.017-.126l.03-.111l.044-.111l.052-.098l.064-.092l.083-.094l5-5a1 1 0 0 1 1.497 1.32l-.083.094L5.415 13H18.5a1.5 1.5 0 0 0 1.493-1.355L20 11.5V5a1 1 0 0 1 1-1" />
              </svg>
              <span className="sr-only">Enter</span>
            </kbd>Open
          </span>
          <span>
            <kbd className="filetree-context-shortcut">Esc</kbd>Close
          </span>
          <span>
            <kbd className="filetree-context-shortcut">
              {props.newChatShortcut}
            </kbd>
            New chat
          </span>
        </footer>
      </section>
      {menu
        ? createPortal(
            <Menu
              ref={placement.ref}
              style={{ ...placement.style, zIndex: 11000 }}
              variant="context"
              aria-label="Conversation actions"
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setMenu(null);
                }
              }}
            >
              <MenuItem
                onClick={() => {
                  const session = historySessions.find(
                    (item) => item.sessionId === menu.id,
                  )!;
                  setRenameText(
                    chatTitle(session, props.titles, combinedDetails[menu.id]),
                  );
                  setRenaming(menu.id);
                  setMenu(null);
                }}
              >
                Rename
              </MenuItem>
              {view === "chats" ? (
                <>
                  <MenuItem
                    onClick={() => void action(() => props.onPin(menu.id))}
                  >
                    {props.pinnedIds.includes(menu.id) ? "Unpin" : "Pin"}
                  </MenuItem>
                  <MenuItem
                    onClick={() => void action(() => props.onArchive(menu.id))}
                  >
                    Archive
                  </MenuItem>
                </>
              ) : (
                <MenuItem
                  onClick={() => void action(() => props.onRestore(menu.id))}
                >
                  Restore
                </MenuItem>
              )}
              {view !== "trash" ? (
                <>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    onClick={() => void action(() => props.onTrash(menu.id))}
                  >
                    Move to trash
                  </MenuItem>
                </>
              ) : null}
            </Menu>,
            document.body,
          )
        : null}
    </div>,
    document.body,
  );
}
