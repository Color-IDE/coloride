import { AgentAccountUsage } from "../../features/external-agents";
import { useMemo } from "react";
import { FileIcon, fileTreeIconColor } from "../../features/explorer/filetree/FileTree";

type AppStatusBarProps = {
  filePath?: string | null;
  workspacePath?: string | null;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
  onInfo?: () => void;
};

type PathCrumb = {
  name: string;
  kind: "folder" | "file";
};

export function AppStatusBar({
  filePath = null,
  workspacePath = null,
  terminalOpen = false,
  onToggleTerminal,
  onInfo,
}: AppStatusBarProps) {
  const crumbs = useMemo(
    () => pathCrumbs(filePath, workspacePath),
    [filePath, workspacePath],
  );
  const fullPath = (filePath || workspacePath || "").trim();

  return (
    <footer className="app-status-bar" role="status" aria-label="Status">
      <div className="app-status-bar-actions">
        <button
          aria-label={terminalOpen ? "Hide terminal" : "Show terminal"}
          aria-pressed={terminalOpen}
          className={`app-status-bar-btn app-status-bar-btn-terminal${terminalOpen ? " is-active" : ""}`}
          onClick={onToggleTerminal}
          title={terminalOpen ? "Hide terminal" : "Show terminal"}
          type="button"
        >
          <TerminalIcon />
        </button>
        <button
          aria-label="About"
          className="app-status-bar-btn"
          onClick={onInfo}
          title="About"
          type="button"
        >
          <InfoIcon />
        </button>
      </div>
      {crumbs.length === 0 ? (
        <span className="app-status-bar-empty">No workspace</span>
      ) : (
        <ol className="app-status-bar-crumbs" title={fullPath || undefined}>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li
                className={`app-status-bar-crumb${last ? " is-last" : ""}${crumb.kind === "file" ? " is-file" : ""}`}
                key={`${index}-${crumb.name}`}
              >
                {index > 0 ? <PathSep /> : null}
                <span className="app-status-bar-crumb-inner">
                  {crumb.kind === "file" ? (
                    <FileIcon className={`app-status-bar-icon ${fileTreeIconColor(crumb.name)}`} name={crumb.name} />
                  ) : null}
                  <span className="app-status-bar-name">{crumb.name}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <AgentAccountUsage />
    </footer>
  );
}

function TerminalIcon() {
  return (
    <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="M18.25 3H5.75A2.755 2.755 0 0 0 3 5.75v12.5A2.755 2.755 0 0 0 5.75 21h12.5A2.755 2.755 0 0 0 21 18.25V5.75A2.755 2.755 0 0 0 18.25 3m-7.575 9.885L7.53 16.03l-1.06-1.06L9.44 12L6.47 9.03l1.06-1.06l3.145 3.145c.485.485.485 1.28 0 1.77M16.5 16.5h-5V15h5z"
        fill="currentColor"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg aria-hidden="true" height="14" viewBox="0 0 1024 1024" width="14" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0h1024v1024H0z" fill="none" />
      <path
        d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448s448-200.6 448-448S759.4 64 512 64m32 664c0 4.4-3.6 8-8 8h-48c-4.4 0-8-3.6-8-8V456c0-4.4 3.6-8 8-8h48c4.4 0 8 3.6 8 8zm-32-344a48.01 48.01 0 0 1 0-96a48.01 48.01 0 0 1 0 96"
        fill="currentColor"
      />
    </svg>
  );
}

function PathSep() {
  return (
    <span aria-hidden="true" className="app-status-bar-sep">
      <svg fill="none" height="14" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg">
        <path d="M0 0h24v24H0z" fill="none" />
        <path
          d="m9 6 6 6-6 6"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </span>
  );
}

function pathCrumbs(filePath?: string | null, workspacePath?: string | null): PathCrumb[] {
  const openFile = usablePath(filePath);
  const workspace = usablePath(workspacePath);
  const projectName = workspace ? pathBasename(workspace) : null;

  if (!openFile) {
    return projectName ? [{ name: projectName, kind: "folder" }] : [];
  }

  const relative = relativeToWorkspace(openFile, workspace);
  if (relative == null) {
    return [{ name: pathBasename(openFile), kind: "file" }];
  }

  const parts = relative.split("/").filter(Boolean);
  const crumbs: PathCrumb[] = [];
  if (projectName) crumbs.push({ name: projectName, kind: "folder" });
  parts.forEach((name, index) => {
    crumbs.push({
      name,
      kind: index === parts.length - 1 ? "file" : "folder",
    });
  });
  return crumbs;
}

function usablePath(path?: string | null): string | null {
  const clean = (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").trim();
  if (!clean) return null;
  if (clean.startsWith("browser:")) return null;
  if (clean.startsWith("agent-log:")) {
    return clean.slice("agent-log:".length) || "agent-log.json";
  }
  return clean;
}

function relativeToWorkspace(file: string, workspace: string | null): string | null {
  if (!workspace) return null;
  const fileKey = /^[a-zA-Z]:\//.test(file) ? file.toLowerCase() : file;
  const rootKey = /^[a-zA-Z]:\//.test(workspace) ? workspace.toLowerCase() : workspace;
  if (fileKey === rootKey) return "";
  const prefix = rootKey === "/" ? "/" : `${rootKey}/`;
  if (!fileKey.startsWith(prefix)) return null;
  return file.slice(prefix.length);
}

function pathBasename(path: string): string {
  if (path === "/") return "/";
  return path.split("/").filter(Boolean).at(-1) || path;
}
