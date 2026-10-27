import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../shared/api/client";
import type {
  ContentSearchMatch,
  FileNameHit,
} from "../../../../shared/api/types";
import { VerticalScrollHairline } from "../../../../shared/ui/VerticalScrollHairline";
import {
  ChevronIcon,
  CloseIcon,
  FileIcon,
  LoadingSpinnerIcon,
  SearchIcon,
} from "./FileIcons";
import { type GroupedContentHits } from "./types";

export function SearchPanel({
  connected,
  onClose,
  onOpenFile,
  rootPath,
}: {
  connected: boolean;
  onClose: () => void;
  onOpenFile?: (
    path: string,
    options?: { line?: number; column?: number },
  ) => void | Promise<unknown>;
  rootPath?: string | null;
}) {
  const searchScrollRef = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [include, setInclude] = useState("");
  const [fileHits, setFileHits] = useState<FileNameHit[]>([]);
  const [contentResults, setContentResults] = useState<ContentSearchMatch[]>(
    [],
  );
  const [filesTruncated, setFilesTruncated] = useState(false);
  const [matchesTruncated, setMatchesTruncated] = useState(false);
  const [engine, setEngine] = useState<"rg" | "grep" | "none" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(
    () => new Set(),
  );
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || !connected || !rootPath) {
      setFileHits([]);
      setContentResults([]);
      setFilesTruncated(false);
      setMatchesTruncated(false);
      setEngine(null);
      setLoading(false);
      setError("");
      return;
    }

    // Short queries still search, but wait a touch longer to avoid flooding SSH.
    const debounceMs = trimmedQuery.length <= 2 ? 180 : 90;
    let cancelled = false;
    const requestId = ++requestIdRef.current;

    // Immediate light loading cue so the UI feels responsive.
    const loadingTimer = window.setTimeout(() => {
      if (!cancelled && requestIdRef.current === requestId) setLoading(true);
    }, 40);

    const timeout = window.setTimeout(() => {
      setError("");
      void api
        .searchWorkspace(rootPath, trimmedQuery, {
          include: include.trim(),
          nameLimit: 40,
          contentLimit: 80,
        })
        .then((response) => {
          if (cancelled || requestIdRef.current !== requestId) return;
          setFileHits(response.files ?? []);
          setContentResults(response.matches ?? []);
          setFilesTruncated(Boolean(response.filesTruncated));
          setMatchesTruncated(Boolean(response.matchesTruncated));
          setEngine(response.engine);
        })
        .catch((reason) => {
          if (cancelled || requestIdRef.current !== requestId) return;
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (!cancelled && requestIdRef.current === requestId)
            setLoading(false);
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.clearTimeout(loadingTimer);
    };
  }, [connected, include, query, rootPath]);

  const groupedContent = useMemo(() => {
    const groups = new Map<string, GroupedContentHits>();
    for (const match of contentResults) {
      const existing = groups.get(match.path);
      if (existing) {
        existing.matches.push(match);
      } else {
        const name = match.path.split("/").filter(Boolean).at(-1) ?? match.path;
        groups.set(match.path, { path: match.path, name, matches: [match] });
      }
    }
    return [...groups.values()];
  }, [contentResults]);

  const relativePath = (path: string) => {
    const root = rootPath?.replace(/\/+$/, "") ?? "";
    if (root && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
    if (path === root) return ".";
    return path;
  };

  const openFileHit = async (hit: FileNameHit) => {
    await onOpenFile?.(hit.path);
  };

  const openContentMatch = async (match: ContentSearchMatch) => {
    await onOpenFile?.(match.path, {
      line: match.line,
      column: match.column ?? undefined,
    });
  };

  const toggleFileGroup = (path: string) => {
    setCollapsedFiles((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const hasQuery = Boolean(query.trim());
  const hasAnyResults = fileHits.length > 0 || contentResults.length > 0;
  const truncated = filesTruncated || matchesTruncated;

  return (
    <div className="filetree-search-panel flex h-full flex-col text-[13px]">
      <div className="space-y-1.5 border-b border-[#333333] p-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-sm font-medium text-[#a6a6ad]">Search</span>
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-sm text-[#878888] transition-colors hover:bg-[#333333] hover:text-white active:scale-95 [&_svg]:stroke-[#878888] hover:[&_svg]:stroke-white"
            aria-label="Back to file tree"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1">
          <SearchIcon className="size-3.5 shrink-0 text-[#a6a6ad]" />
          <input
            autoComplete="off"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#f0f4f8] outline-none placeholder:text-[#878888]"
            data-1p-ignore="true"
            data-bwignore="true"
            data-form-type="other"
            data-lpignore="true"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files and contents..."
            type="text"
          />
          {loading && (
            <LoadingSpinnerIcon className="size-3.5 shrink-0 animate-spin text-[#878888]" />
          )}
        </div>
        {filtersOpen ? (
          <div className="space-y-1.5">
            <input
              autoComplete="off"
              className="w-full rounded-md bg-white/[0.06] px-2 py-1 text-sm text-[#f0f4f8] outline-none placeholder:text-[#878888]"
              data-1p-ignore="true"
              data-bwignore="true"
              data-form-type="other"
              data-lpignore="true"
              value={include}
              onChange={(event) => setInclude(event.target.value)}
              placeholder="Files to include (e.g., *.ts)"
              type="text"
            />
            <button
              className="px-0.5 text-[10px] !text-[#878888] transition-colors hover:!text-white"
              type="button"
              onClick={() => setFiltersOpen(false)}
            >
              Hide filters
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-0.5">
            <button
              className="text-[10px] !text-[#878888] transition-colors hover:!text-white"
              type="button"
              onClick={() => setFiltersOpen(true)}
            >
              Filters...
            </button>
            {engine && hasQuery && !loading && (
              <span className="text-[10px] text-[#5c5c62]">
                {fileHits.length + contentResults.length} results
              </span>
            )}
          </div>
        )}
      </div>
      <div className="vertical-scroll-surface relative min-h-0 flex-1">
        <div
          ref={searchScrollRef}
          className="filetree-scroll h-full min-h-0 overflow-y-auto p-1"
        >
          {!connected && (
            <div className="px-2 py-4 text-xs text-[#878888]">
              Connect to a server to search files.
            </div>
          )}
          {connected && !hasQuery && (
            <div className="px-2 py-4 text-xs text-[#878888]">
              Search file names and contents in one go.
            </div>
          )}
          {error && (
            <div className="px-2 py-4 text-xs text-[#f19b9b]">{error}</div>
          )}

          {!error && hasQuery && !loading && !hasAnyResults && (
            <div className="px-2 py-4 text-xs text-[#878888]">
              No matching files or content.
            </div>
          )}

          {!error && fileHits.length > 0 && (
            <div className="mb-1">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[#5c5c62]">
                Files{filesTruncated ? "+" : ""}
              </div>
              {fileHits.map((hit) => (
                <button
                  key={`file:${hit.path}`}
                  type="button"
                  onClick={() => void openFileHit(hit)}
                  title={hit.path}
                  className="group flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] text-[#b6b6bc] transition-colors hover:bg-white/[0.06] hover:text-[#f0f4f8]"
                >
                  <FileIcon
                    name={hit.name}
                    className="size-3.5 shrink-0 text-[#878888]/70 group-hover:text-[#a6a6ad]"
                  />
                  <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                  <span className="max-w-[48%] truncate text-[10px] text-[#74747a]">
                    {relativePath(hit.path)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!error && groupedContent.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[#5c5c62]">
                Content{matchesTruncated ? "+" : ""}
              </div>
              {groupedContent.map((group) => {
                const collapsed = collapsedFiles.has(group.path);
                return (
                  <div key={group.path} className="mb-0.5">
                    <button
                      type="button"
                      onClick={() => toggleFileGroup(group.path)}
                      className="group flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[12px] text-[#c8c8ce] transition-colors hover:bg-white/[0.05]"
                      title={group.path}
                    >
                      <ChevronIcon
                        className={`size-3.5 shrink-0 text-[#878888]/60 transition-transform ${collapsed ? "" : "rotate-90"}`}
                      />
                      <FileIcon
                        name={group.name}
                        className="size-3.5 shrink-0 text-[#878888]/70"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {group.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-[#5c5c62]">
                        {group.matches.length}
                      </span>
                    </button>
                    {!collapsed &&
                      group.matches.map((match, index) => (
                        <button
                          key={`${match.path}:${match.line}:${index}`}
                          type="button"
                          onClick={() => void openContentMatch(match)}
                          className="group flex w-full items-start gap-2 rounded-md py-1 pl-7 pr-2 text-left transition-colors hover:bg-white/[0.06]"
                          title={`${relativePath(match.path)}:${match.line}`}
                        >
                          <span className="mt-px w-7 shrink-0 text-right text-[10px] tabular-nums text-[#5c5c62] group-hover:text-[#85858b]">
                            {match.line}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-4 text-[#a6a6ad] group-hover:text-[#e4e4ea]">
                            {match.text || " "}
                          </span>
                        </button>
                      ))}
                  </div>
                );
              })}
            </div>
          )}

          {!error && truncated && hasAnyResults && (
            <div className="px-2 py-2 text-[10px] text-[#5c5c62]">
              Results capped — refine your query for more.
            </div>
          )}
        </div>
        <VerticalScrollHairline
          targetRef={searchScrollRef}
          label="Search results scroll"
        />
      </div>
    </div>
  );
}
