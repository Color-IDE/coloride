import {
  type AgentUserAttachment,
  type DiffTableRow,
  type ToolTimelineEntry,
} from "./types";

export function switchUserName(entry: ToolTimelineEntry) {
  const wanted = stringArgument(entry.arguments.target);
  const username = stringArgument(entry.metadata.username);
  if (username) return username;
  if (wanted === "admin") return "admin";
  if (wanted === "coloride") return "coloride";
  return wanted || "user";
}

export function mcpPluginId(tool: string): string {
  if (!tool.startsWith("mcp__")) return "";
  return tool.split("__")[1] || "";
}

export function formatListFilesActionParts(entry: ToolTimelineEntry) {
  const path =
    stringArgument(entry.arguments.path) ||
    stringArgument(entry.metadata.path) ||
    ".";
  const recursive = Boolean(entry.arguments.recursive);
  const verb = entry.complete || entry.failed ? "Listed" : "Listing";
  const detail = `${path}${recursive ? " (recursive)" : ""}`;
  return { verb, detail };
}

export function formatListFilesAction(entry: ToolTimelineEntry) {
  const parts = formatListFilesActionParts(entry);
  return `${parts.verb} ${parts.detail}`.trim();
}

export function formatSearchFilesActionParts(entry: ToolTimelineEntry) {
  const query = stringArgument(entry.arguments.query);
  const path = stringArgument(entry.arguments.path) || ".";
  const verb = entry.complete || entry.failed ? "Searched" : "Searching";
  const detail = query ? `“${query}” in ${path}` : path;
  return { verb, detail };
}

export function formatSearchFilesAction(entry: ToolTimelineEntry) {
  const parts = formatSearchFilesActionParts(entry);
  return `${parts.verb} ${parts.detail}`.trim();
}

export function formatReadFileActionParts(entry: ToolTimelineEntry) {
  const path =
    stringArgument(entry.arguments.path) ||
    stringArgument(entry.arguments.Path) ||
    "file";
  const start =
    numberValue(entry.arguments.start_line) ??
    numberValue(entry.arguments.startLine) ??
    numberValue(entry.metadata.start_line) ??
    numberValue(entry.metadata.startLine);
  const end =
    numberValue(entry.arguments.end_line) ??
    numberValue(entry.arguments.endLine) ??
    numberValue(entry.metadata.end_line) ??
    numberValue(entry.metadata.endLine);
  let range = "";
  if (start !== null && end !== null)
    range = ` L${Math.trunc(start)}-${Math.trunc(end)}`;
  else if (start !== null) range = ` L${Math.trunc(start)}`;
  else if (end !== null) range = ` L${Math.trunc(end)}`;
  const verb = entry.complete || entry.failed ? "Read" : "Reading";
  return { verb, detail: `${path}${range}`, path, start, end, range };
}

export function formatReadFileAction(entry: ToolTimelineEntry) {
  const parts = formatReadFileActionParts(entry);
  return `${parts.verb} ${parts.detail}`.trim();
}

export function toolActionParts(entry: ToolTimelineEntry): {
  verb: string;
  detail: string;
} {
  if (entry.tool === "read_file") return formatReadFileActionParts(entry);
  if (entry.tool === "list_files") return formatListFilesActionParts(entry);
  if (entry.tool === "search_files") return formatSearchFilesActionParts(entry);

  const done = entry.complete || entry.failed;
  const values = entry.arguments;

  if (entry.tool === "write_file" || entry.tool === "replace_in_file") {
    return {
      verb: done
        ? entry.tool === "write_file"
          ? "Wrote"
          : "Edited"
        : entry.tool === "write_file"
          ? "Writing"
          : "Editing",
      detail: stringArgument(values.path),
    };
  }
  if (entry.tool === "change_workspace") {
    return {
      verb: done
        ? entry.failed
          ? "Workspace change failed"
          : "Changed workspace"
        : "Changing workspace",
      detail:
        stringArgument(values.path) || stringArgument(entry.metadata.cwd) || "",
    };
  }
  if (entry.tool === "switch_user") {
    const user =
      stringArgument(entry.metadata.username) ||
      (stringArgument(values.target) === "admin"
        ? "admin"
        : stringArgument(values.target) === "coloride"
          ? "coloride"
          : stringArgument(values.target));
    return {
      verb: done
        ? entry.failed
          ? "User switch failed"
          : "Switched user"
        : "Switching user",
      detail: user || "user",
    };
  }
  if (entry.tool === "delete_path") {
    return {
      verb: done ? (entry.failed ? "Delete failed" : "Deleted") : "Deleting",
      detail: stringArgument(values.path) || "path",
    };
  }
  if (entry.tool === "create_directory") {
    return {
      verb: done ? "Created" : "Creating",
      detail: stringArgument(values.path) || "directory",
    };
  }
  if (entry.tool === "rename_path") {
    const from = stringArgument(values.path);
    const name = stringArgument(values.new_name);
    const to =
      from && name
        ? `${from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : ""}${name}`
        : name;
    return {
      verb: done ? (entry.failed ? "Rename failed" : "Renamed") : "Renaming",
      detail: from && to ? `${from} to ${to}` : from || to,
    };
  }
  if (entry.tool === "move_path") {
    const from = stringArgument(values.old_path);
    const to = stringArgument(values.new_path);
    return {
      verb: done ? (entry.failed ? "Move failed" : "Moved") : "Moving",
      detail: from && to ? `${from} to ${to}` : from || to,
    };
  }
  if (
    entry.tool === "execute_command" ||
    entry.tool === "run_terminal_command"
  ) {
    return {
      verb: entry.metadata.interrupted === true ? "Stopped command" : done ? "Ran command" : "Running command",
      detail:
        commandName(stringArgument(values.command)) ||
        stringArgument(values.cwd) ||
        "",
    };
  }
  if (entry.tool === "create_terminal") {
    return {
      verb: done
        ? entry.failed
          ? "Create terminal failed"
          : "Created terminal"
        : "Creating terminal",
      detail: stringArgument(values.title) || "Terminal",
    };
  }
  if (entry.tool === "list_terminals")
    return { verb: done ? "Listed" : "Listing", detail: "terminals" };
  if (entry.tool === "read_terminal")
    return { verb: done ? "Read" : "Reading", detail: "terminal output" };
  if (entry.tool === "start_process") {
    const command = stringArgument(values.command);
    return {
      verb: done
        ? entry.failed
          ? "Start process failed"
          : "Started process"
        : "Starting process",
      detail: commandName(command) || command || "process",
    };
  }
  if (entry.tool === "read_process") {
    return {
      verb: done
        ? entry.failed
          ? "Read process failed"
          : "Read process"
        : "Reading process",
      detail: stringArgument(values.process_id) || "process",
    };
  }
  if (entry.tool === "stop_process") {
    return {
      verb: done
        ? entry.failed
          ? "Stop process failed"
          : "Stopped process"
        : "Stopping process",
      detail: stringArgument(values.process_id) || "process",
    };
  }
  if (entry.tool === "get_diagnostics") {
    const path = stringArgument(values.path);
    return {
      verb: done
        ? entry.failed
          ? "Diagnostics failed"
          : "Checked"
        : "Checking",
      detail: path ? `diagnostics ${path}` : "diagnostics",
    };
  }
  if (entry.tool === "fetch_url") {
    return {
      verb: done ? (entry.failed ? "Read failed" : "Read") : "Reading",
      detail: stringArgument(values.url) || "web page",
    };
  }
  if (entry.tool === "browser_open") {
    return {
      verb: done
        ? entry.failed
          ? "Browser failed"
          : "Analyzed browser"
        : "Analyzing browser",
      detail: "",
    };
  }
  if (entry.tool === "browser_snapshot") {
    return {
      verb: done
        ? entry.failed
          ? "Snapshot failed"
          : "Analyzed browser"
        : "Analyzing browser",
      detail: "",
    };
  }
  if (entry.tool === "browser_screenshot") {
    return {
      verb: done
        ? entry.failed
          ? "Screenshot failed"
          : "Captured browser"
        : "Capturing browser",
      detail: "",
    };
  }
  if (entry.tool === "browser_click") {
    return {
      verb: done ? (entry.failed ? "Click failed" : "Clicked") : "Clicking",
      detail: stringArgument(values.ref) || "element",
    };
  }
  if (entry.tool === "browser_type") {
    return {
      verb: done ? (entry.failed ? "Type failed" : "Typed") : "Typing",
      detail: stringArgument(values.ref) || "field",
    };
  }
  if (entry.tool === "browser_press") {
    return {
      verb: done ? (entry.failed ? "Key failed" : "Pressed") : "Pressing",
      detail: stringArgument(values.key) || "key",
    };
  }
  if (entry.tool === "browser_close") {
    return {
      verb: done
        ? entry.failed
          ? "Close failed"
          : "Closed browser"
        : "Closing browser",
      detail: "",
    };
  }
  if (entry.tool === "git_status") {
    return {
      verb: done
        ? entry.failed
          ? "Git status failed"
          : "Checked"
        : "Checking",
      detail: "Git status",
    };
  }
  if (entry.tool === "git_diff") {
    const staged = values.staged === true;
    const path = stringArgument(values.path);
    const scope = staged ? "staged" : "unstaged";
    return {
      verb: done ? (entry.failed ? "Git diff failed" : "Read") : "Reading",
      detail: path ? `Git diff ${scope} ${path}` : `Git diff ${scope}`,
    };
  }
  if (entry.tool.startsWith("mcp__")) {
    const name =
      entry.tool.split("__").at(-1)?.replaceAll("_", " ") ?? "MCP tool";
    return {
      verb: done ? (entry.failed ? "Failed" : "Used") : "Using",
      detail: name,
    };
  }

  const fallback = entry.title || toolLabel(entry.tool);
  return { verb: fallback, detail: "" };
}

export function toolAction(entry: ToolTimelineEntry) {
  const parts = toolActionParts(entry);
  return `${parts.verb}${parts.detail ? ` ${parts.detail}` : ""}`.trim();
}

export function toolTarget(entry: ToolTimelineEntry) {
  // Detail now lives in toolActionParts for solo tools; keep target empty to avoid duplicates.
  void entry;
  return "";
}

export function parseUnifiedDiff(patch: string, preferredPath: string) {
  const lines = patch
    .split("\n")
    .filter(
      (line, index, values) => !(line === "" && index === values.length - 1),
    );
  const targetHeader =
    lines
      .find((line) => line.startsWith("+++ "))
      ?.slice(4)
      .trim() ?? "";
  const sourceHeader =
    lines
      .find((line) => line.startsWith("--- "))
      ?.slice(4)
      .trim() ?? "";
  const path = preferredPath || cleanDiffPath(targetHeader || sourceHeader);
  const additions = lines.filter(
    (line) => line.startsWith("+") && !line.startsWith("+++"),
  ).length;
  const deletions = lines.filter(
    (line) => line.startsWith("-") && !line.startsWith("---"),
  ).length;
  const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  const rows: DiffTableRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const line of lines) {
    if (
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("similarity ")
    ) {
      continue;
    }
    const hunk = hunkHeader.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({
        kind: "addition",
        text: line.slice(1),
        oldLine: null,
        newLine,
      });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({
        kind: "deletion",
        text: line.slice(1),
        oldLine,
        newLine: null,
      });
      oldLine += 1;
      continue;
    }
    if (line.startsWith("\\")) continue;
    rows.push({
      kind: "context",
      text: line.startsWith(" ") ? line.slice(1) : line,
      oldLine,
      newLine,
    });
    oldLine += 1;
    newLine += 1;
  }
  return {
    path,
    rows: rows.length
      ? rows
      : [
          {
            kind: "context" as const,
            text: "(content unchanged)",
            oldLine: null,
            newLine: null,
          },
        ],
    additions,
    deletions,
  };
}

export const cleanDiffPath = (value: string) =>
  value.replace(/^[ab]\//, "").split("\t", 1)[0] ?? value;

export const stringValue = (value: unknown) =>
  typeof value === "string" ? value : value == null ? "" : String(value);

export const stringArgument = (value: unknown) =>
  typeof value === "string" ? value : "";

export function parseUserAttachments(
  value: unknown,
): AgentUserAttachment[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const items: AgentUserAttachment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = stringValue(row.name).trim();
    if (!name) continue;
    const kindRaw = stringValue(row.kind).toLowerCase();
    const kind =
      kindRaw === "image" ? "image" : kindRaw === "code" ? "code" : "file";
    const preview =
      typeof row.previewDataUrl === "string"
        ? row.previewDataUrl
        : typeof row.preview_data_url === "string"
          ? row.preview_data_url
          : null;
    items.push({
      name,
      kind,
      mime: stringValue(row.mime) || undefined,
      size: typeof row.size === "number" ? row.size : undefined,
      path: typeof row.path === "string" ? row.path : null,
      previewDataUrl:
        preview && preview.startsWith("data:image/") ? preview : null,
      startLine:
        typeof row.startLine === "number"
          ? row.startLine
          : typeof row.start_line === "number"
            ? row.start_line
            : undefined,
      endLine:
        typeof row.endLine === "number"
          ? row.endLine
          : typeof row.end_line === "number"
            ? row.end_line
            : undefined,
    });
  }
  return items.length ? items : undefined;
}

export function parseUserPluginIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const ids = [
    ...new Set(
      value.map((item) => String(item).trim().toLowerCase()).filter(Boolean),
    ),
  ];
  return ids.length ? ids : undefined;
}

export const stripExitCodePrefix = (value: string) =>
  value.replace(/^Exit code:\s*-?\d+\s*\n?/i, "").trim();

export const looksLikeUnifiedDiff = (value: string) =>
  /^(diff --git |@@ |\+\+\+ |--- )/m.test(value);

export const WRITE_APPROVAL_TOOLS = new Set([
  "write_file",
  "replace_in_file",
  "create_directory",
  "rename_path",
  "move_path",
  "delete_path",
]);

export function fileBaseName(path: string) {
  const trimmed = path.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.split("/").pop() || trimmed;
}

export function fileEditVerb(tool: string) {
  if (tool === "create_directory") return "Create";
  if (tool === "rename_path") return "Rename";
  if (tool === "move_path") return "Move";
  if (tool === "delete_path") return "Delete";
  if (tool === "write_file") return "Write";
  return "Edit";
}

export function fileEditTitle(tool: string, name: string) {
  if (tool === "create_directory") return `Do you want to create ${name}?`;
  if (tool === "rename_path") return `Do you want to rename ${name}?`;
  if (tool === "move_path") return `Do you want to move ${name}?`;
  if (tool === "delete_path") return `Do you want to delete ${name}?`;
  if (tool === "write_file") return `Do you want to write ${name}?`;
  return `Do you want to edit ${name}?`;
}

/** First token of a shell command (e.g. `npm test -- --watch` → `npm`). */
export function commandName(command: string) {
  const trimmed = command.trim();
  if (!trimmed) return "";
  // Skip common env assignments: FOO=bar npm test
  const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  for (const token of tokens) {
    const bare = token.replace(/^["']|["']$/g, "");
    if (!bare || bare.includes("=")) continue;
    const base = bare.split(/[/\\]/).pop() || bare;
    return base;
  }
  return tokens[0]?.replace(/^["']|["']$/g, "") || trimmed;
}

export const numberValue = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

export const recordValue = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const formatArgument = (value: unknown) =>
  typeof value === "boolean" ? (value ? "Yes" : "No") : stringValue(value);

export const formatDuration = (durationMs: number) =>
  durationMs < 1_000
    ? `${durationMs} ms`
    : `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;

export const formatThoughtDuration = (durationMs: number) => {
  if (durationMs < 1_000)
    return `${Math.max(1, Math.round(durationMs / 100) * 100)} ms`;
  const seconds = durationMs / 1_000;
  if (seconds < 10) return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  return `${Math.round(seconds)}s`;
};

export const argumentLabel = (value: string) =>
  value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());

export const detailLabel = (value: string) =>
  ({
    oldPath: "From",
    newPath: "To",
    remoteTool: "Remote tool",
    processId: "Process",
    path: "Path",
    server: "Server",
  })[value] ?? value;

export const toolLabel = (value: string) =>
  (({
    list_files: "List files",
    read_file: "Read file",
    search_files: "Search files",
    write_file: "Write file",
    replace_in_file: "Edit file",
    create_directory: "Create directory",
    rename_path: "Rename path",
    move_path: "Move path",
    delete_path: "Delete path",
    change_workspace: "Change workspace",
    submit_plan: "Submit plan",
    update_plan_step: "Update plan step",
    execute_command: "Command",
    create_terminal: "Create terminal",
    list_terminals: "List terminals",
    read_terminal: "Read terminal",
    run_terminal_command: "Command",
    start_process: "Start process",
    read_process: "Read process",
    stop_process: "Stop process",
    get_diagnostics: "Workspace diagnostics",
    fetch_url: "Read web page",
    browser_open: "Analyze browser",
    browser_snapshot: "Analyze browser",
    browser_screenshot: "Browser screenshot",
    browser_click: "Browser click",
    browser_type: "Browser type",
    browser_press: "Browser key",
    browser_close: "Close browser",
    git_status: "Git status",
    git_diff: "Git diff",
  })[value] ??
    (value.startsWith("mcp__")
      ? `MCP · ${value.split("__").at(-1)?.replaceAll("_", " ")}`
      : value)) ||
  "Tool";
