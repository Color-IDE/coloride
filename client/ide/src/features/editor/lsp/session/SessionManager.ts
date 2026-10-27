import { api } from "../../../../shared/api/client";
import type { DiagnosticMarker, EditorHandle } from "../../core/types";
import { LspClient } from "../LspClient";
import {
  lspDocumentLanguageId,
  lspServerIdForPath,
  pathToUri,
  uriToPath,
} from "../pathUri";
import type { LineTextEdit } from "../textEdits";
import {
  editsFromCodeActions,
  firstDefinition,
  lspSeverity,
  normalizePath,
  parseCompletionItem,
  parseCompletionList,
  parseDocumentSymbols,
  parseInlayHints,
  parseLocations,
  parseLspTextEdit,
  parsePrepareRename,
  parseSignatureHelp,
  parseWorkspaceEdit,
} from "./protocolParsers";
import {
  type DocState,
  type LspCompletionItem,
  type LspCompletionList,
  type LspDefinitionHit,
  type LspDocumentSymbol,
  type LspFileEdits,
  type LspInlayHint,
  type LspPrepareRename,
  type LspReferenceHit,
  type LspSignatureHelp,
} from "./types";

export const LSP_OWNER = "lsp";

export const CHANGE_DEBOUNCE_MS = 180;

/**
 * One language-server client per workspace + server id.
 * Document sync is queued so typing never waits on the network.
 */
export class LspSessionManagerImpl {
  private cppConfig = new Map<string, string>();
  private cppRefresh: Promise<void> | null = null;
  private restarting = new Map<string, Promise<void>>();
  private generation = 0;
  private clients = new Map<string, LspClient>();
  private starting = new Map<string, Promise<LspClient | null>>();
  private failed = new Map<string, number>();
  private lastClient: LspClient | null = null;
  private docs = new Map<string, DocState>();
  private rootPath: string | null = null;
  private connected = false;
  private changeTimers = new Map<string, number>();
  private pathQueues = new Map<string, Promise<void>>();
  private editors = new Map<string, EditorHandle>();
  private lastMarkers = new Map<string, DiagnosticMarker[]>();
  private treeListeners = new Set<(paths: ReadonlySet<string>) => void>();

  configure(options: { connected: boolean; rootPath: string | null }) {
    const rootChanged = options.rootPath !== this.rootPath;
    const disconnected = this.connected && !options.connected;
    this.connected = options.connected;
    this.rootPath = options.rootPath;
    if (disconnected || rootChanged) {
      this.disposeAll();
    }
    // A file can open before the workspace is marked ready. didOpen stored
    // the buffer and returned. Push it now that a server can start.
    if (this.connected && this.rootPath) this.flushPendingOpens();
  }

  private flushPendingOpens() {
    for (const doc of this.docs.values()) {
      if (doc.opened) continue;
      void this.didOpen(doc.path, doc.text);
    }
  }

  disposeAll() {
    this.generation += 1;
    this.cppConfig.clear();
    this.cppRefresh = null;
    this.restarting.clear();
    for (const timer of this.changeTimers.values()) window.clearTimeout(timer);
    this.changeTimers.clear();
    this.pathQueues.clear();
    this.docs.clear();
    this.lastMarkers.clear();
    for (const handle of this.editors.values()) {
      handle.clearMarkers(LSP_OWNER);
    }
    this.notifyTree();
    for (const client of this.clients.values()) client.dispose();
    this.clients.clear();
    this.starting.clear();
    this.failed.clear();
    this.lastClient = null;
  }

  subscribeTreeErrors(handler: (paths: ReadonlySet<string>) => void) {
    this.treeListeners.add(handler);
    handler(this.errorPaths());
    return () => {
      this.treeListeners.delete(handler);
    };
  }

  private errorPaths(): Set<string> {
    const out = new Set<string>();
    for (const [path, markers] of this.lastMarkers) {
      if (markers.some((marker) => marker.severity === "error")) out.add(path);
    }
    return out;
  }

  private notifyTree() {
    const paths = this.errorPaths();
    for (const handler of this.treeListeners) handler(paths);
  }

  registerEditor(path: string, handle: EditorHandle) {
    const key = normalizePath(path);
    this.editors.set(key, handle);
    const pending = this.lastMarkers.get(key);
    if (pending) handle.setMarkers(LSP_OWNER, pending);
  }

  unregisterEditor(path: string, handle?: EditorHandle) {
    const key = normalizePath(path);
    const existing = this.editors.get(key);
    if (!handle || existing === handle) {
      existing?.clearMarkers(LSP_OWNER);
      this.editors.delete(key);
    }
  }

  private enqueue(path: string, task: () => Promise<void>): Promise<void> {
    const prev = this.pathQueues.get(path) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(task)
      .catch((error) => {
        console.warn("[LSP] document sync failed", path, error);
      });
    this.pathQueues.set(path, next);
    return next;
  }

  private async ensureClientForPath(path: string): Promise<LspClient | null> {
    const serverId = lspServerIdForPath(path);
    if (!serverId) return null;
    return this.ensureClient(serverId);
  }

  private async ensureClient(serverId: string): Promise<LspClient | null> {
    const generation = this.generation;
    await this.restarting.get(serverId);
    if (generation !== this.generation || !this.connected || !this.rootPath)
      return null;
    const existing = this.clients.get(serverId);
    if (existing?.isReady) {
      this.lastClient = existing;
      return existing;
    }
    const pending = this.starting.get(serverId);
    if (pending) return pending;
    const failedAt = this.failed.get(serverId);
    if (failedAt !== undefined && Date.now() - failedAt < 8_000) return null;
    this.failed.delete(serverId);

    const rootPath = this.rootPath;
    const start = (async () => {
      try {
        if (serverId === "cpp") await this.readCppConfiguration();
        const info = await api.lspStart(serverId, rootPath);
        const client = new LspClient(info);
        client.onNotification((method, params) => {
          if (
            generation === this.generation &&
            this.clients.get(serverId) === client &&
            method === "textDocument/publishDiagnostics"
          ) {
            this.applyPublishDiagnostics(params);
          }
        });
        await client.initialize(rootPath);
        if (generation !== this.generation) {
          await client.dispose();
          return null;
        }
        this.clients.set(serverId, client);
        this.lastClient = client;
        return client;
      } catch (error) {
        if (generation === this.generation)
          this.failed.set(serverId, Date.now());
        const message = error instanceof Error ? error.message : String(error);
        if (!/404|not on PATH|lsp\.unavailable|unavailable/i.test(message)) {
          console.warn(`[LSP] failed to start ${serverId}`, error);
        }
        return null;
      } finally {
        if (generation === this.generation) this.starting.delete(serverId);
      }
    })();
    this.starting.set(serverId, start);
    return start;
  }

  // The file tree refresh does not invalidate clangd's cached compilation commands.
  // Probe configuration separately, including files that are not open in an editor.
  private async readCppConfiguration(): Promise<boolean> {
    const root = this.rootPath;
    if (!root) return false;
    const generation = this.generation;
    const dirs = new Set([root.replace(/\/$/, "")]);
    for (const doc of this.docs.values()) {
      if (lspServerIdForPath(doc.path) !== "cpp") continue;
      let dir = doc.path.slice(0, doc.path.lastIndexOf("/"));
      while (dir.startsWith(root + "/")) {
        dirs.add(dir);
        dir = dir.slice(0, dir.lastIndexOf("/"));
      }
    }
    const paths = [...dirs].flatMap((dir) =>
      [
        "compile_flags.txt",
        "compile_commands.json",
        ".clangd",
        "build/compile_commands.json",
      ].map((name) => `${dir}/${name}`),
    );
    try {
      const entries = [];
      for (let offset = 0; offset < paths.length; offset += 40) {
        entries.push(
          ...(await api.statFiles(paths.slice(offset, offset + 40))).entries,
        );
      }
      if (generation !== this.generation) return false;
      let changed = false;
      for (const entry of entries) {
        const signature = JSON.stringify([
          entry.exists,
          entry.etag,
          entry.size,
          entry.mtime,
        ]);
        const previous = this.cppConfig.get(entry.path);
        if (previous !== undefined && previous !== signature) changed = true;
        this.cppConfig.set(entry.path, signature);
      }
      return changed;
    } catch {
      // A transient filesystem failure must not restart a healthy server.
      return false;
    }
  }

  refreshCppConfiguration(): Promise<void> {
    if (this.cppRefresh) return this.cppRefresh;
    const client = this.clients.get("cpp");
    if (!client?.isReady) return Promise.resolve();
    const generation = this.generation;
    const refresh = (async () => {
      if (
        !(await this.readCppConfiguration()) ||
        generation !== this.generation ||
        this.clients.get("cpp") !== client
      )
        return;
      const stopped = client.dispose();
      this.restarting.set("cpp", stopped);
      this.clients.delete("cpp");
      this.failed.delete("cpp");
      if (this.lastClient === client) this.lastClient = null;
      for (const doc of this.docs.values()) {
        if (lspServerIdForPath(doc.path) !== "cpp") continue;
        doc.opened = false;
        doc.appliedDiagVersion = 0;
        const key = normalizePath(doc.path);
        this.lastMarkers.delete(key);
        this.editors.get(key)?.clearMarkers(LSP_OWNER);
      }
      this.notifyTree();
      await stopped;
      if (generation !== this.generation) return;
      this.restarting.delete("cpp");
      // Reopen the latest buffers, preserving unsaved edits and document versions.
      await Promise.all(
        [...this.docs.values()]
          .filter((doc) => lspServerIdForPath(doc.path) === "cpp")
          .map((doc) => this.syncNow(doc.path)),
      );
    })().finally(() => {
      if (this.cppRefresh === refresh) this.cppRefresh = null;
    });
    this.cppRefresh = refresh;
    return refresh;
  }

  async didOpen(path: string, text: string) {
    const languageId = lspDocumentLanguageId(path);
    if (!languageId) return;

    const existing = this.docs.get(path);
    if (existing) {
      existing.text = text;
      existing.languageId = languageId;
    } else {
      this.docs.set(path, {
        uri: pathToUri(path),
        path,
        languageId,
        version: 0,
        opened: false,
        text,
        syncedText: "",
        appliedDiagVersion: 0,
      });
    }

    return this.enqueue(path, async () => {
      const doc = this.docs.get(path);
      if (!doc) return;
      const client = await this.ensureClientForPath(path);
      if (!client) return;

      doc.uri = pathToUri(path);

      if (doc.opened) {
        if (doc.text === doc.syncedText) {
          await this.pullDiagnostics(client, doc);
          return;
        }
        await this.sendFullChange(client, doc);
        return;
      }

      const version = doc.version + 1;
      doc.version = version;
      await client.notify("textDocument/didOpen", {
        textDocument: {
          uri: doc.uri,
          languageId: doc.languageId,
          version,
          text: doc.text,
        },
      });
      doc.opened = true;
      doc.syncedText = doc.text;
      console.info("[LSP] didOpen", doc.uri, doc.languageId);
      await this.pullDiagnostics(client, doc);
    });
  }

  didChange(path: string, text: string) {
    if (!lspDocumentLanguageId(path)) return;
    const doc = this.docs.get(path);
    if (doc) {
      doc.text = text;
    } else {
      this.docs.set(path, {
        uri: pathToUri(path),
        path,
        languageId: lspDocumentLanguageId(path) ?? "plaintext",
        version: 0,
        opened: false,
        text,
        syncedText: "",
        appliedDiagVersion: 0,
      });
    }

    this.scheduleSync(path);
  }

  /** clangd often stays quiet after didOpen. Ask for the file's diagnostics. */
  private async pullDiagnostics(client: LspClient, doc: DocState) {
    try {
      const result = await client.request(
        "textDocument/diagnostic",
        { textDocument: { uri: doc.uri } },
        8_000,
      );
      const report = result as { items?: unknown; kind?: string } | null;
      if (
        !report ||
        report.kind === "unchanged" ||
        !Array.isArray(report.items)
      )
        return;
      this.applyPublishDiagnostics({
        uri: doc.uri,
        version: doc.version,
        diagnostics: report.items,
      });
    } catch {
      // Servers that only push diagnostics ignore this request.
    }
  }

  private scheduleSync(path: string) {
    const existing = this.changeTimers.get(path);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.changeTimers.delete(path);
      void this.syncNow(path);
    }, CHANGE_DEBOUNCE_MS);
    this.changeTimers.set(path, timer);
  }

  private clearChangeTimer(path: string) {
    const existing = this.changeTimers.get(path);
    if (existing) {
      window.clearTimeout(existing);
      this.changeTimers.delete(path);
    }
  }

  /** Push the latest buffer to vtsls (didOpen / didChange) before a request. */
  private async syncNow(path: string): Promise<void> {
    this.clearChangeTimer(path);
    return this.enqueue(path, async () => {
      const current = this.docs.get(path);
      if (!current) return;
      const client = await this.ensureClientForPath(path);
      if (!client) return;
      if (!current.opened) {
        const version = current.version + 1;
        current.version = version;
        await client.notify("textDocument/didOpen", {
          textDocument: {
            uri: current.uri,
            languageId: current.languageId,
            version,
            text: current.text,
          },
        });
        current.opened = true;
        current.syncedText = current.text;
        console.info("[LSP] didOpen", current.uri);
        await this.pullDiagnostics(client, current);
        return;
      }
      if (current.text === current.syncedText) return;
      await this.sendFullChange(client, current);
    });
  }

  private async sendFullChange(client: LspClient, doc: DocState) {
    doc.version += 1;
    await client.notify("textDocument/didChange", {
      textDocument: { uri: doc.uri, version: doc.version },
      contentChanges: [{ text: doc.text }],
    });
    doc.syncedText = doc.text;
    await this.pullDiagnostics(client, doc);
  }

  async didSave(path: string, text?: string) {
    return this.enqueue(path, async () => {
      const doc = this.docs.get(path);
      if (!doc) return;
      if (text !== undefined) doc.text = text;
      const client = await this.ensureClientForPath(path);
      if (!client || !doc.opened) return;
      await client.notify("textDocument/didSave", {
        textDocument: { uri: doc.uri },
        text: doc.text,
      });
    });
  }

  async didClose(path: string) {
    const timer = this.changeTimers.get(path);
    if (timer) {
      window.clearTimeout(timer);
      this.changeTimers.delete(path);
    }
    return this.enqueue(path, async () => {
      const doc = this.docs.get(path);
      if (!doc) return;
      if (doc.opened) {
        const client = await this.ensureClientForPath(path);
        if (client) {
          await client.notify("textDocument/didClose", {
            textDocument: { uri: doc.uri },
          });
        }
      }
      this.docs.delete(path);
      this.pathQueues.delete(path);
      this.lastMarkers.delete(normalizePath(path));
      this.notifyTree();
    });
  }

  private applyPublishDiagnostics(params: unknown) {
    if (!params || typeof params !== "object") return;
    const body = params as {
      uri?: string;
      version?: number;
      diagnostics?: Array<{
        range?: {
          start?: { line?: number; character?: number };
          end?: { line?: number; character?: number };
        };
        severity?: number;
        message?: string;
        source?: string;
        code?: string | number;
      }>;
    };
    const path = uriToPath(body.uri ?? "");
    if (!path) return;
    const key = normalizePath(path);
    const doc =
      this.docs.get(path) ??
      [...this.docs.values()].find((item) => normalizePath(item.path) === key);

    // Typing is faster than SSH. Drop results for an older buffer.
    if (typeof body.version === "number") {
      if (doc && body.version < doc.version) return;
      if (doc && body.version < doc.appliedDiagVersion) return;
    } else if (doc) {
      if (this.changeTimers.has(doc.path) || doc.text !== doc.syncedText)
        return;
    }

    const markers = (body.diagnostics ?? []).map((item) => ({
      severity: lspSeverity(item.severity),
      message: item.message || "",
      startLine: (item.range?.start?.line ?? 0) + 1,
      startColumn: (item.range?.start?.character ?? 0) + 1,
      endLine: (item.range?.end?.line ?? 0) + 1,
      endColumn: (item.range?.end?.character ?? 0) + 1,
      source: item.source,
      code: item.code != null ? String(item.code) : undefined,
    }));
    this.lastMarkers.set(key, markers);
    if (doc && typeof body.version === "number") {
      doc.appliedDiagVersion = body.version;
    }
    this.editors.get(key)?.setMarkers(LSP_OWNER, markers);
    this.notifyTree();
  }

  async goToDefinition(
    path: string,
    line: number,
    column: number,
  ): Promise<LspDefinitionHit | null> {
    if (!lspDocumentLanguageId(path)) return null;
    const client = await this.ensureClientForPath(path);
    if (!client) return null;
    const key = normalizePath(path);
    const existing = this.docs.get(path);
    if (!existing?.opened) {
      const text = this.editors.get(key)?.getValue() ?? existing?.text ?? "";
      await this.didOpen(path, text);
    }
    try {
      const result = await client.request("textDocument/definition", {
        textDocument: { uri: pathToUri(path) },
        position: {
          line: Math.max(0, line - 1),
          character: Math.max(0, column - 1),
        },
      });
      const hit = firstDefinition(result);
      if (hit) console.info("[LSP] definition", hit.path, hit.line);
      return hit;
    } catch (error) {
      console.warn("[LSP] definition failed", error);
      return null;
    }
  }

  async findReferences(
    path: string,
    line: number,
    column: number,
  ): Promise<LspReferenceHit[]> {
    if (!lspDocumentLanguageId(path)) return [];
    const client = await this.ensureClientForPath(path);
    if (!client) return [];
    const key = normalizePath(path);
    const existing = this.docs.get(path);
    if (!existing?.opened) {
      const text = this.editors.get(key)?.getValue() ?? existing?.text ?? "";
      await this.didOpen(path, text);
    }
    try {
      const result = await client.request(
        "textDocument/references",
        {
          textDocument: { uri: pathToUri(path) },
          position: {
            line: Math.max(0, line - 1),
            character: Math.max(0, column - 1),
          },
          context: { includeDeclaration: true },
        },
        12_000,
      );
      const hits = parseLocations(result);
      console.info("[LSP] references", hits.length);
      return hits;
    } catch (error) {
      console.warn("[LSP] references failed", error);
      return [];
    }
  }

  async prepareRename(
    path: string,
    line: number,
    column: number,
  ): Promise<LspPrepareRename | null> {
    if (!lspDocumentLanguageId(path)) return null;
    const client = await this.ensureClientForPath(path);
    if (!client) return null;
    const key = normalizePath(path);
    const existing = this.docs.get(path);
    if (!existing?.opened) {
      const text = this.editors.get(key)?.getValue() ?? existing?.text ?? "";
      await this.didOpen(path, text);
    }
    try {
      const result = await client.request(
        "textDocument/prepareRename",
        {
          textDocument: { uri: pathToUri(path) },
          position: {
            line: Math.max(0, line - 1),
            character: Math.max(0, column - 1),
          },
        },
        8_000,
      );
      return parsePrepareRename(result);
    } catch (error) {
      console.warn("[LSP] prepareRename failed", error);
      return null;
    }
  }

  async rename(
    path: string,
    line: number,
    column: number,
    newName: string,
  ): Promise<LspFileEdits[]> {
    if (!lspDocumentLanguageId(path)) return [];
    const client = await this.ensureClientForPath(path);
    if (!client) return [];
    const key = normalizePath(path);
    const existing = this.docs.get(path);
    if (!existing?.opened) {
      const text = this.editors.get(key)?.getValue() ?? existing?.text ?? "";
      await this.didOpen(path, text);
    }
    try {
      const result = await client.request(
        "textDocument/rename",
        {
          textDocument: { uri: pathToUri(path) },
          position: {
            line: Math.max(0, line - 1),
            character: Math.max(0, column - 1),
          },
          newName,
        },
        15_000,
      );
      const files = parseWorkspaceEdit(result);
      console.info("[LSP] rename", newName, files.length, "files");
      return files;
    } catch (error) {
      console.warn("[LSP] rename failed", error);
      return [];
    }
  }

  async formatDocument(
    path: string,
    options?: {
      tabSize?: number;
      insertSpaces?: boolean;
      range?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    },
  ): Promise<LineTextEdit[]> {
    if (!lspDocumentLanguageId(path)) return [];
    const client = await this.ensureClientForPath(path);
    if (!client) return [];
    const key = normalizePath(path);
    const existing = this.docs.get(path);
    if (!existing?.opened) {
      const text = this.editors.get(key)?.getValue() ?? existing?.text ?? "";
      await this.didOpen(path, text);
    }
    const fmt = {
      tabSize: Math.max(1, options?.tabSize ?? 2),
      insertSpaces: options?.insertSpaces !== false,
      trimTrailingWhitespace: true,
      insertFinalNewline: true,
      trimFinalNewlines: true,
    };
    try {
      const result = options?.range
        ? await client.request(
            "textDocument/rangeFormatting",
            {
              textDocument: { uri: pathToUri(path) },
              range: {
                start: {
                  line: Math.max(0, options.range.startLine - 1),
                  character: Math.max(0, options.range.startColumn - 1),
                },
                end: {
                  line: Math.max(0, options.range.endLine - 1),
                  character: Math.max(0, options.range.endColumn - 1),
                },
              },
              options: fmt,
            },
            15_000,
          )
        : await client.request(
            "textDocument/formatting",
            {
              textDocument: { uri: pathToUri(path) },
              options: fmt,
            },
            15_000,
          );
      const edits: LineTextEdit[] = [];
      if (Array.isArray(result)) {
        for (const item of result) {
          const edit = parseLspTextEdit(item);
          if (edit) edits.push(edit);
        }
      }
      console.info("[LSP] format", edits.length);
      return edits;
    } catch (error) {
      console.warn("[LSP] format failed", error);
      return [];
    }
  }

  async organizeImports(path: string): Promise<LineTextEdit[]> {
    if (!lspDocumentLanguageId(path)) return [];
    const key = normalizePath(path);
    const existing = this.docs.get(path);
    const text = this.editors.get(key)?.getValue() ?? existing?.text ?? "";
    if (existing) existing.text = text;
    else {
      this.docs.set(path, {
        uri: pathToUri(path),
        path,
        languageId: lspDocumentLanguageId(path) ?? "plaintext",
        version: 0,
        opened: false,
        text,
        syncedText: "",
        appliedDiagVersion: 0,
      });
    }

    let edits: LineTextEdit[] = [];
    await this.enqueue(path, async () => {
      const doc = this.docs.get(path);
      if (!doc) return;
      const client = await this.ensureClientForPath(path);
      if (!client) return;
      try {
        if (!doc.opened) {
          const version = doc.version + 1;
          doc.version = version;
          await client.notify("textDocument/didOpen", {
            textDocument: {
              uri: doc.uri,
              languageId: doc.languageId,
              version,
              text: doc.text,
            },
          });
          doc.opened = true;
          doc.syncedText = doc.text;
        } else if (doc.text !== doc.syncedText) {
          await this.sendFullChange(client, doc);
        }
        const synced = doc.syncedText;
        const lines = synced.split("\n");
        const lastLine = lines.at(-1) ?? "";
        const endLine = Math.max(0, lines.length - 1);
        const result = await client.request(
          "textDocument/codeAction",
          {
            textDocument: { uri: pathToUri(path) },
            range: {
              start: { line: 0, character: 0 },
              end: { line: endLine, character: lastLine.length },
            },
            context: {
              diagnostics: [],
              only: ["source.organizeImports"],
              triggerKind: 1,
            },
          },
          12_000,
        );
        let files = editsFromCodeActions(result);
        if (!files.length && Array.isArray(result) && result[0]) {
          const resolved = await client.request(
            "codeAction/resolve",
            result[0],
            12_000,
          );
          files = editsFromCodeActions([resolved]);
        }
        const mine =
          files.find((file) => normalizePath(file.path) === key) ??
          files.find((file) => file.path === path);
        edits = mine?.edits ?? [];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/out of range/i.test(message)) {
          console.warn("[LSP] organizeImports failed", error);
        }
      }
    });
    return edits;
  }

  async complete(
    path: string,
    line: number,
    column: number,
    options?: {
      text?: string;
      explicit?: boolean;
      triggerCharacter?: string;
    },
  ): Promise<LspCompletionList | null> {
    if (!lspDocumentLanguageId(path)) return null;

    if (options?.text !== undefined) {
      const existing = this.docs.get(path);
      if (existing) {
        existing.text = options.text;
      } else {
        this.docs.set(path, {
          uri: pathToUri(path),
          path,
          languageId: lspDocumentLanguageId(path) ?? "plaintext",
          version: 0,
          opened: false,
          text: options.text,
          syncedText: "",
          appliedDiagVersion: 0,
        });
      }
    }

    this.clearChangeTimer(path);

    let parsed: LspCompletionList | null = null;
    await this.enqueue(path, async () => {
      const current = this.docs.get(path);
      if (!current) return;
      const client = await this.ensureClientForPath(path);
      if (!client) return;
      if (!current.opened) {
        const version = current.version + 1;
        current.version = version;
        await client.notify("textDocument/didOpen", {
          textDocument: {
            uri: current.uri,
            languageId: current.languageId,
            version,
            text: current.text,
          },
        });
        current.opened = true;
        current.syncedText = current.text;
        console.info("[LSP] didOpen", current.uri);
      } else if (current.text !== current.syncedText) {
        await this.sendFullChange(client, current);
      }

      const triggerCharacter = options?.triggerCharacter;
      try {
        const result = await client.request(
          "textDocument/completion",
          {
            textDocument: { uri: pathToUri(path) },
            position: {
              line: Math.max(0, line - 1),
              character: Math.max(0, column - 1),
            },
            context: {
              triggerKind: triggerCharacter ? 2 : 1,
              ...(triggerCharacter ? { triggerCharacter } : {}),
            },
          },
          8_000,
        );
        parsed = parseCompletionList(result);
      } catch (error) {
        console.warn("[LSP] completion failed", error);
      }
    });
    return parsed;
  }

  async signatureHelp(
    path: string,
    line: number,
    column: number,
    options?: {
      text?: string;
      triggerCharacter?: string;
      retrigger?: boolean;
    },
  ): Promise<LspSignatureHelp | null> {
    if (!lspDocumentLanguageId(path)) return null;
    if (options?.text !== undefined) {
      const existing = this.docs.get(path);
      if (existing) existing.text = options.text;
    }
    this.clearChangeTimer(path);

    let parsed: LspSignatureHelp | null = null;
    await this.enqueue(path, async () => {
      const current = this.docs.get(path);
      if (!current) return;
      const client = await this.ensureClientForPath(path);
      if (!client) return;
      if (!current.opened) {
        const version = current.version + 1;
        current.version = version;
        await client.notify("textDocument/didOpen", {
          textDocument: {
            uri: current.uri,
            languageId: current.languageId,
            version,
            text: current.text,
          },
        });
        current.opened = true;
        current.syncedText = current.text;
      } else if (current.text !== current.syncedText) {
        await this.sendFullChange(client, current);
      }
      if (!client.supportsSignatureHelp()) return;
      const triggerCharacter = options?.triggerCharacter;
      try {
        const result = await client.request(
          "textDocument/signatureHelp",
          {
            textDocument: { uri: pathToUri(path) },
            position: {
              line: Math.max(0, line - 1),
              character: Math.max(0, column - 1),
            },
            context: {
              triggerKind: triggerCharacter ? 2 : options?.retrigger ? 3 : 1,
              isRetrigger: Boolean(options?.retrigger),
              ...(triggerCharacter ? { triggerCharacter } : {}),
            },
          },
          6_000,
        );
        parsed = parseSignatureHelp(result);
      } catch {
        // Optional feature — missing method or timeout should not spam the console.
      }
    });
    return parsed;
  }

  async resolveCompletion(
    item: LspCompletionItem,
  ): Promise<LspCompletionItem | null> {
    if (!item.data && (item.documentation || item.detail)) return item;
    const client = this.lastClient;
    if (!client) return item;
    try {
      const result = await client.request(
        "completionItem/resolve",
        {
          label: item.label,
          kind: item.kind,
          detail: item.detail,
          documentation: item.documentation,
          insertText: item.insertText,
          insertTextFormat: item.insertTextFormat,
          data: item.data,
        },
        8_000,
      );
      const resolved = parseCompletionItem(result);
      if (resolved) console.info("[LSP] completion resolve", item.label);
      return resolved ?? item;
    } catch (error) {
      console.warn("[LSP] completion resolve failed", error);
      return item;
    }
  }

  async documentSymbols(path: string): Promise<LspDocumentSymbol[]> {
    if (!lspDocumentLanguageId(path)) return [];
    const client = await this.ensureClientForPath(path);
    if (!client) return [];
    const key = normalizePath(path);
    const existing = this.docs.get(path);
    if (!existing?.opened) {
      const text = this.editors.get(key)?.getValue() ?? existing?.text ?? "";
      await this.didOpen(path, text);
    }
    try {
      const result = await client.request(
        "textDocument/documentSymbol",
        { textDocument: { uri: pathToUri(path) } },
        8_000,
      );
      return parseDocumentSymbols(result);
    } catch (error) {
      console.warn("[LSP] documentSymbol failed", error);
      return [];
    }
  }

  async inlayHints(
    path: string,
    range: {
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
    },
  ): Promise<LspInlayHint[]> {
    if (!lspDocumentLanguageId(path)) return [];
    const client = await this.ensureClientForPath(path);
    if (!client) return [];
    const key = normalizePath(path);
    const existing = this.docs.get(path);
    if (!existing?.opened) {
      const text = this.editors.get(key)?.getValue() ?? existing?.text ?? "";
      await this.didOpen(path, text);
    }
    try {
      const result = await client.request(
        "textDocument/inlayHint",
        {
          textDocument: { uri: pathToUri(path) },
          range: {
            start: {
              line: Math.max(0, range.startLine - 1),
              character: Math.max(0, range.startColumn - 1),
            },
            end: {
              line: Math.max(0, range.endLine - 1),
              character: Math.max(0, range.endColumn - 1),
            },
          },
        },
        8_000,
      );
      return parseInlayHints(result);
    } catch (error) {
      console.warn("[LSP] inlayHint failed", error);
      return [];
    }
  }
}

export const lspSessionManager = new LspSessionManagerImpl();
