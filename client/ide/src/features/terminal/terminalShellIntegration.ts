import type { IDecoration, IDisposable, IMarker, Terminal } from "@xterm/xterm";

type CommandStatus = "prompt" | "running" | "success" | "error";

type CommandRecord = {
  command: string;
  decoration: IDecoration | undefined;
  element: HTMLElement | null;
  marker: IMarker;
  startedAt: number | null;
  status: CommandStatus;
  durationMs: number | null;
  exitCode: number | null;
};

type ShellIntegrationOptions = {
  copy: (command: string) => void | Promise<void>;
  rerun: (command: string) => void;
};

export type TerminalShellIntegration = IDisposable & {
  /** Adds the live-prompt marker after a persisted screen has been replayed. */
  ensurePromptMarker: () => boolean;
  /** Clears command-gutter state when the terminal itself is cleared. */
  reset: () => void;
};

function decodeCommand(value: string) {
  try {
    const binary = window.atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes).trim();
  } catch {
    return "";
  }
}

function formatDuration(durationMs: number | null) {
  if (durationMs == null) return "";
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs / 1000)}s`;
}

function renderRecord(record: CommandRecord, options: ShellIntegrationOptions) {
  const element = record.element;
  if (!element) return;
  const signature = `${record.status}:${record.exitCode ?? ""}:${record.durationMs == null ? "" : Math.round(record.durationMs)}`;
  if (element.dataset.commandRender === signature) return;
  element.dataset.commandRender = signature;
  element.replaceChildren();
  element.classList.remove("is-running", "is-success", "is-error");
  element.classList.add("coloride-terminal-command-decoration", `is-${record.status}`);

  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "coloride-terminal-command-pill";
  const status = document.createElement("span");
  status.className = "coloride-terminal-command-status";
  status.setAttribute("aria-hidden", "true");
  pill.append(status);

  const duration = formatDuration(record.durationMs);
  const outcome = record.status === "prompt"
    ? "Current prompt"
    : record.exitCode == null ? "running" : `exit ${record.exitCode}`;
  pill.title = record.status === "prompt"
    ? outcome
    : `${record.command} — ${outcome}${duration ? ` · ${duration}` : ""}\nDouble-click to run again · Right-click to copy`;
  pill.setAttribute("aria-label", record.status === "prompt" ? outcome : `${record.command}, ${outcome}`);
  // Keep the same lightweight command actions without turning the gutter
  // marker into a pill that steals horizontal space from the shell.
  pill.addEventListener("mousedown", (event) => event.preventDefault());
  pill.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!record.command || record.status === "prompt") return;
    options.rerun(record.command);
  });
  pill.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!record.command || record.status === "prompt") return;
    void options.copy(record.command);
  });
  element.append(pill);
}

/**
 * Consumes Coloride's OSC 633 markers and turns them into lightweight command
 * decorations. This is deliberately view-only: rerunning still travels through
 * xterm's normal onData -> PTY path.
 */
export function installTerminalShellIntegration(
  term: Terminal,
  options: ShellIntegrationOptions,
): TerminalShellIntegration {
  let current: CommandRecord | null = null;
  let prompt: CommandRecord | null = null;
  let clearingScreen = false;
  const records: CommandRecord[] = [];

  const createRecord = (
    marker: IMarker,
    status: CommandStatus,
    command = "",
  ): CommandRecord => {
    const record: CommandRecord = {
      command,
      decoration: undefined,
      durationMs: null,
      element: null,
      exitCode: null,
      marker,
      startedAt: status === "running" ? performance.now() : null,
      status,
    };
    record.decoration = term.registerDecoration({
      // Render in the small gutter already reserved by TerminalPanel. The
      // marker overlays no terminal cell and therefore never changes PTY
      // columns, wrapping or the position of command text.
      x: 0,
      anchor: "left",
      marker,
      width: 1,
    });
    record.decoration?.onRender((element) => {
      record.element = element;
      renderRecord(record, options);
    });
    records.push(record);
    if (records.length > 250) records.shift()?.decoration?.dispose();
    return record;
  };

  const finish = (exitCode: number | null) => {
    if (!current) return;
    current.durationMs = current.startedAt == null ? null : performance.now() - current.startedAt;
    current.exitCode = exitCode;
    current.status = exitCode === 0 ? "success" : "error";
    renderRecord(current, options);
    current = null;
  };

  const lineLooksLikePrompt = () => {
    const buffer = term.buffer.active;
    const line = buffer.getLine(buffer.baseY + buffer.cursorY);
    const text = line?.translateToString(true) ?? "";
    // Bash, zsh, fish and the common starship prompts all end with one of
    // these characters. Do not add a fake prompt marker while a restored
    // terminal is still printing command output.
    return /(?:[$#%❯›>])\s*$/.test(text);
  };

  const ensurePromptMarker = () => {
    if (current || prompt || !lineLooksLikePrompt()) return false;
    const marker = term.registerMarker(0);
    if (!marker) return false;
    prompt = createRecord(marker, "prompt");
    return true;
  };

  const osc = term.parser.registerOscHandler(633, (data) => {
    const firstSeparator = data.indexOf(";");
    const kind = firstSeparator === -1 ? data : data.slice(0, firstSeparator);
    const payload = firstSeparator === -1 ? "" : data.slice(firstSeparator + 1);
    if (kind === "ColorideStart") {
      // A second start without an end means the previous shell was interrupted.
      finish(130);
      const command = decodeCommand(payload);
      if (!command) return true;
      // `clear` is issued inside the shell, so it never passes through the
      // toolbar's imperative clear method. Drop the old marker set before the
      // terminal erases its screen, then wait for the following prompt rather
      // than leaving a completed blue dot at the top of an empty terminal.
      if (/^(?:clear|reset)(?:\s|$)/.test(command.trim())) {
        for (const record of records) record.decoration?.dispose();
        records.length = 0;
        current = null;
        prompt = null;
        clearingScreen = true;
        return true;
      }
      // The prompt marker already points at the command line. Reuse it so a
      // hollow current-prompt circle becomes the completed command marker,
      // exactly like VS Code, without ever rendering two circles on one line.
      if (prompt) {
        prompt.command = command;
        prompt.durationMs = null;
        prompt.exitCode = null;
        prompt.startedAt = performance.now();
        prompt.status = "running";
        renderRecord(prompt, options);
        current = prompt;
        prompt = null;
        return true;
      }
      const marker = term.registerMarker(-1) ?? term.registerMarker(0);
      if (!marker) return true;
      current = createRecord(marker, "running", command);
      return true;
    }
    if (kind === "ColorideEnd") {
      const exitCode = Number.parseInt(payload, 10);
      if (!clearingScreen) finish(Number.isFinite(exitCode) ? exitCode : 1);
      return true;
    }
    if (kind === "ColoridePrompt") {
      // Shell hooks emit this immediately before drawing PS1. Keep a hollow
      // circle on that live prompt even before the user types a command.
      // Some shell themes/proxies can drop the preceding end marker while
      // keeping the prompt marker. A fresh prompt is definitive evidence that
      // the command stopped, so never leave its gutter circle "running".
      if (current) finish(0);
      clearingScreen = false;
      prompt?.decoration?.dispose();
      const marker = term.registerMarker(0);
      if (marker) prompt = createRecord(marker, "prompt");
      return true;
    }
    return false;
  });

  return {
    ensurePromptMarker,
    reset: () => {
      for (const record of records) record.decoration?.dispose();
      records.length = 0;
      current = null;
      prompt = null;
      clearingScreen = false;
    },
    dispose: () => {
      osc.dispose();
      for (const record of records) record.decoration?.dispose();
      records.length = 0;
      current = null;
      prompt = null;
    },
  };
}
