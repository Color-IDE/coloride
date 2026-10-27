import { api } from "../../shared/api/client";
import type { TerminalSessionStatus } from "./terminalTypes";

type TerminalWorkspaceIdentity = {
  workspaceId?: string;
  workspaceKind: "local" | "ssh";
  connectionId?: string | null;
  cwd?: string | null;
};

type AttachOptions = TerminalWorkspaceIdentity & {
  sessionId: string;
  sessionName?: string;
  cols: number;
  rows: number;
  onData: (data: string | Uint8Array) => void | Promise<void>;
  onReset?: (truncated: boolean) => void;
  onStatus: (status: TerminalSessionStatus) => void;
};

type ManagedSession = {
  sessionId: string;
  termId: string | null;
  status: TerminalSessionStatus;
  socket: WebSocket | null;
  createPromise: Promise<string> | null;
  dataListeners: Set<(data: string | Uint8Array) => void | Promise<void>>;
  offset: number | null;
  processing: Promise<void>;
  pendingSize: { cols: number; rows: number } | null;
  appliedSize: string | null;
  resizing: Promise<void> | null;
  statusListeners: Set<(status: TerminalSessionStatus) => void>;
  output: Array<string | Uint8Array>;
  outputBytes: number;
  lastOptions: AttachOptions | null;
  reconnectTimer: number | null;
  closing: boolean;
  restored: boolean;
};

const managers = new Map<string, TerminalSessionManager>();
const MAX_REPLAY_BYTES = 2 * 1024 * 1024;

export function terminalSessionManagerKey(identity: TerminalWorkspaceIdentity) {
  return identity.workspaceId || `${identity.workspaceKind}:${identity.connectionId || "local"}:${identity.cwd || "workspace"}`;
}

export function getTerminalSessionManager(identity: TerminalWorkspaceIdentity) {
  const key = terminalSessionManagerKey(identity);
  let manager = managers.get(key);
  if (!manager) {
    manager = new TerminalSessionManager(identity);
    managers.set(key, manager);
  }
  return manager;
}

export async function closeManagedTerminalSession(sessionId: string) {
  for (const manager of managers.values()) {
    if (manager.has(sessionId)) {
      await manager.close(sessionId);
      return true;
    }
  }
  return false;
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(private readonly identity: TerminalWorkspaceIdentity) {}

  has(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  attach(options: AttachOptions) {
    const session = this.ensureRecord(options.sessionId);
    session.dataListeners.add(options.onData);
    session.statusListeners.add(options.onStatus);
    options.onStatus(session.status);
    for (const chunk of session.output) options.onData(chunk);
    const ready = this.ensureConnected(session, options);
    return {
      ready,
      detach: () => {
        session.dataListeners.delete(options.onData);
        session.statusListeners.delete(options.onStatus);
        if (this.identity.workspaceKind === "local" && !session.dataListeners.size) {
          session.closing = true;
          session.socket?.close();
          session.socket = null;
          session.offset = null;
        }
      },
    };
  }

  send(sessionId: string, data: Uint8Array) {
    if (!data.byteLength) return;
    const session = this.ensureRecord(sessionId);
    const socket = session.socket;
    if (socket?.readyState === WebSocket.OPEN && session.status === "ready") {
      try {
        socket.send(data);
        return;
      } catch {
        // Delivery is uncertain after a transport failure. Never replay an
        // input command into a subsequently reconnected shell.
      }
    }
    // Input typed while disconnected is never deferred into a later shell.
    window.dispatchEvent(new CustomEvent("coloride:terminal-input-blocked", { detail: { sessionId } }));
  }

  async resize(sessionId: string, cols: number, rows: number) {
    const session = this.sessions.get(sessionId);
    if (!session?.termId) return;
    session.pendingSize = { cols, rows };
    if (!session.resizing) {
      session.resizing = (async () => {
        while (session.pendingSize) {
          const size = session.pendingSize;
          session.pendingSize = null;
          const key = `${size.cols}:${size.rows}`;
          if (session.appliedSize === key) continue;
          await api.resizeTerminal(session.termId!, size);
          session.appliedSize = key;
        }
      })().finally(() => { session.resizing = null; });
    }
    await session.resizing;
  }

  async clear(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.output = [];
    session.outputBytes = 0;
    if (session.termId) await api.clearTerminal(session.termId);
  }

  termId(sessionId: string) {
    return this.sessions.get(sessionId)?.termId ?? null;
  }

  wasRestored(sessionId: string) {
    return this.sessions.get(sessionId)?.restored ?? false;
  }

  async close(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.closing = true;
    session.socket?.close();
    if (session.reconnectTimer !== null) window.clearTimeout(session.reconnectTimer);
    if (session.termId) await api.closeTerminal(session.termId);
    this.sessions.delete(sessionId);
    this.emitTelemetry("closed", sessionId);
  }

  suspendAll() {
    for (const session of this.sessions.values()) {
      session.closing = true;
      session.socket?.close();
      session.socket = null;
      this.setStatus(session, "disconnected");
      if (session.termId) void api.suspendTerminal(session.termId).catch(() => {});
      this.emitTelemetry("suspended", session.sessionId);
    }
  }

  private ensureRecord(sessionId: string): ManagedSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        createPromise: null,
        offset: null,
        processing: Promise.resolve(),
        pendingSize: null,
        appliedSize: null,
        resizing: null,
        closing: false,
        dataListeners: new Set(),
        output: [],
        outputBytes: 0,
        restored: false,
        lastOptions: null,
        reconnectTimer: null,
        sessionId,
        socket: null,
        status: "connecting",
        statusListeners: new Set(),
        termId: null,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private ensureConnected(session: ManagedSession, options: AttachOptions) {
    session.lastOptions = options;
    session.closing = false;
    if (
      session.termId
      && session.socket
      && (session.socket.readyState === WebSocket.OPEN || session.socket.readyState === WebSocket.CONNECTING)
    ) return Promise.resolve(session.termId);
    if (session.createPromise) return session.createPromise;
    if (session.termId) {
      // Both local host and tmux replay authoritative scrollback on attach.
      // Drop the renderer cache so reconnecting cannot duplicate old output.
      session.output = [];
      session.outputBytes = 0;
    }
    this.setStatus(session, "connecting");
    session.createPromise = api.createTerminal({
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd || undefined,
      sessionId: options.sessionId,
      sessionName: options.sessionName,
      workspaceKind: options.workspaceKind,
      connectionId: options.connectionId,
    }).then(({ termId, restored }) => {
      session.termId = termId;
      session.restored = restored;
      const local = this.identity.workspaceKind === "local";
      let acknowledgedProtocol = false;
      let legacyLocal = false;
      const socket = api.terminal(termId, local ? { offset: session.offset } : undefined);
      socket.binaryType = "arraybuffer";
      session.socket = socket;
      socket.onopen = () => {
        if (!local) this.setStatus(session, "ready");
        this.emitTelemetry(restored ? "restored" : "created", session.sessionId);
      };
      socket.onmessage = (event) => {
        session.processing = session.processing.then(async () => {
          if (session.socket !== socket) return;
          if (local && typeof event.data === "string") {
            const control = JSON.parse(event.data);
            if (control.type === "replay_start") {
              if (control.version !== 2 || !Number.isSafeInteger(control.startOffset) ||
                  !Number.isSafeInteger(control.endOffset) || control.startOffset < 0 || control.endOffset < control.startOffset) {
                throw new Error("Unsupported local terminal protocol");
              }
              acknowledgedProtocol = true;
              session.offset = control.startOffset;
              if (control.reset) session.lastOptions?.onReset?.(Boolean(control.truncated));
            } else if (control.type === "replay_end") {
              this.setStatus(session, "ready");
            } else if (control.type === "exit") {
              this.setStatus(session, "exited");
            }
            return;
          }
          // Existing v1 hosts may remain alive during a development update.
          // Never send JSON acknowledgements to their bytes-only input socket.
          if (local && !acknowledgedProtocol && !legacyLocal) {
            legacyLocal = true;
            session.lastOptions?.onReset?.(false);
            this.setStatus(session, "ready");
          }
          const chunk = typeof event.data === "string" ? event.data : new Uint8Array(event.data as ArrayBuffer);
          if (!local) this.remember(session, chunk);
          await Promise.all([...session.dataListeners].map((listener) => listener(chunk)));
          if (local && acknowledgedProtocol && session.socket === socket) {
            session.offset = (session.offset ?? 0) + (chunk as Uint8Array).byteLength;
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ack", offset: session.offset }));
          }
        }).catch(() => {
          this.setStatus(session, "error");
          socket.close();
        });
      };
      socket.onclose = (event) => {
        if (session.socket !== socket) return;
        const exited = event.code === 4001;
        this.setStatus(session, exited ? "exited" : "disconnected");
        if (!exited && !session.closing && session.statusListeners.size > 0 && session.lastOptions) {
          if (session.reconnectTimer !== null) window.clearTimeout(session.reconnectTimer);
          session.reconnectTimer = window.setTimeout(() => {
            session.reconnectTimer = null;
            if (!session.closing && session.statusListeners.size > 0 && session.lastOptions) {
              void session.processing.then(() => {
                if (session.socket === socket) session.socket = null;
                return this.ensureConnected(session, session.lastOptions!);
              }).then(() => {
                this.emitTelemetry("reconnected", session.sessionId);
              }).catch(() => {});
            }
          }, 750);
        }
      };
      socket.onerror = () => this.setStatus(session, "error");
      return termId;
    }).catch((error) => {
      this.setStatus(session, "error");
      window.dispatchEvent(new CustomEvent("coloride:terminal-telemetry", {
        detail: { event: "failed", workspaceKind: this.identity.workspaceKind },
      }));
      throw error;
    }).finally(() => {
      session.createPromise = null;
    });
    return session.createPromise;
  }

  private remember(session: ManagedSession, chunk: string | Uint8Array) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk).byteLength : chunk.byteLength;
    session.output.push(chunk);
    session.outputBytes += bytes;
    while (session.outputBytes > MAX_REPLAY_BYTES && session.output.length > 1) {
      const removed = session.output.shift();
      if (removed == null) break;
      session.outputBytes -= typeof removed === "string"
        ? new TextEncoder().encode(removed).byteLength
        : removed.byteLength;
    }
  }

  private setStatus(session: ManagedSession, status: TerminalSessionStatus) {
    if (session.status === status) return;
    session.status = status;
    for (const listener of session.statusListeners) listener(status);
  }

  private emitTelemetry(event: "created" | "restored" | "suspended" | "reconnected" | "closed", sessionId: string) {
    window.dispatchEvent(new CustomEvent("coloride:terminal-telemetry", {
      detail: { event, sessionId, workspaceKind: this.identity.workspaceKind },
    }));
  }
}
