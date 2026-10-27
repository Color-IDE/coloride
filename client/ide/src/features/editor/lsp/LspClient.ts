import { api } from "../../../shared/api/client";
import type { LspSessionInfo } from "../../../shared/api/types";

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

type NotificationHandler = (method: string, params: unknown) => void;

const TS_SUGGEST = {
  autoImports: true,
  includeCompletionsForImportStatements: true,
};

const TS_PREFERENCES = {
  includeCompletionsForModuleExports: true,
  includeCompletionsForImportStatements: true,
  includePackageJsonAutoImports: "on" as const,
  includeCompletionsWithSnippetText: true,
  includeAutomaticOptionalChainCompletions: true,
};

const VTSLS_EXPERIMENTAL = {
  experimental: {
    completion: {
      enableServerSideFuzzyMatch: true,
      entriesLimit: 80,
    },
  },
};

const TS_FORMAT = { enable: true };

const TS_INLAY_HINTS = {
  parameterNames: { enabled: "literals" },
  parameterTypes: { enabled: false },
  variableTypes: { enabled: true },
  propertyDeclarationTypes: { enabled: true },
  functionLikeReturnTypes: { enabled: true },
  enumMemberValues: { enabled: true },
};

const VTSLS_SETTINGS = {
  typescript: {
    tsserver: { maxTsServerMemory: 3072 },
    suggest: TS_SUGGEST,
    preferences: TS_PREFERENCES,
    format: TS_FORMAT,
    inlayHints: TS_INLAY_HINTS,
  },
  javascript: {
    suggest: TS_SUGGEST,
    preferences: TS_PREFERENCES,
    format: TS_FORMAT,
    inlayHints: TS_INLAY_HINTS,
  },
  vtsls: VTSLS_EXPERIMENTAL,
};

/**
 * JSON-RPC client over the desktop LSP WebSocket.
 * Framing is handled by the sidecar.
 */
export class LspClient {
  readonly sessionId: string;
  readonly rootPath: string;
  readonly language: string;

  private socket: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private openPromise: Promise<void> | null = null;
  private closed = false;
  private notificationHandlers = new Set<NotificationHandler>();
  private capabilities: Record<string, unknown> = {};
  initialized = false;

  constructor(info: LspSessionInfo) {
    this.sessionId = info.sessionId;
    this.rootPath = info.rootPath;
    this.language = info.language || "typescript";
  }

  get isReady() {
    return this.initialized && this.socket?.readyState === WebSocket.OPEN;
  }

  onNotification(handler: NotificationHandler) {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  async connect(): Promise<void> {
    if (this.openPromise) return this.openPromise;
    this.openPromise = new Promise<void>((resolve, reject) => {
      const socket = api.lspSocket(this.sessionId);
      this.socket = socket;
      const timer = window.setTimeout(() => {
        reject(new Error("LSP WebSocket connect timeout"));
        socket.close();
      }, 15_000);

      socket.addEventListener("open", () => {
        window.clearTimeout(timer);
        resolve();
      });
      socket.addEventListener("error", () => {
        window.clearTimeout(timer);
        reject(new Error("LSP WebSocket error"));
      });
      socket.addEventListener("close", () => {
        this.rejectAll(new Error("LSP connection closed"));
      });
      socket.addEventListener("message", (event) => {
        this.handleRaw(String(event.data));
      });
    });
    await this.openPromise;
  }

  async initialize(rootPath: string): Promise<void> {
    await this.connect();
    const rootUri = pathToFileUri(rootPath);
    console.info("[LSP] initialize sent");
    const settings = settingsForServer(this.language);
    const result = (await this.request("initialize", {
      processId: null,
      clientInfo: { name: "Coloride", version: "0.1.0" },
      rootUri,
      rootPath,
      capabilities: {
        workspace: {
          configuration: true,
          didChangeConfiguration: { dynamicRegistration: false },
          workspaceFolders: true,
        },
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: true,
          },
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: true,
            tagSupport: { valueSet: [1, 2] },
          },
          definition: { linkSupport: true },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          inlayHint: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          rename: { dynamicRegistration: false, prepareSupport: true },
          formatting: { dynamicRegistration: false },
          rangeFormatting: { dynamicRegistration: false },
          codeAction: {
            dynamicRegistration: false,
            resolveSupport: { properties: ["edit"] },
            codeActionLiteralSupport: {
              codeActionKind: { valueSet: ["source.organizeImports"] },
            },
          },
          signatureHelp: {
            dynamicRegistration: false,
            contextSupport: true,
          },
          completion: {
            dynamicRegistration: false,
            contextSupport: true,
            completionItem: {
              snippetSupport: false,
              documentationFormat: ["plaintext", "markdown"],
              insertReplaceSupport: true,
              labelDetailsSupport: true,
              resolveSupport: { properties: ["detail", "documentation", "additionalTextEdits"] },
            },
          },
        },
      },
      workspaceFolders: [
        { uri: rootUri, name: rootPath.split("/").filter(Boolean).at(-1) ?? "workspace" },
      ],
      initializationOptions: settings,
    })) as { capabilities?: Record<string, unknown> } | null;
    console.info("[LSP] initialize response received", result?.capabilities ? "ok" : "empty");
    this.capabilities = result?.capabilities && typeof result.capabilities === "object" ? result.capabilities : {};
    await this.notify("initialized", {});
    await this.notify("workspace/didChangeConfiguration", { settings });
    console.info("[LSP] initialized sent");
    this.initialized = true;
  }

  supportsSignatureHelp() {
    return Boolean(this.capabilities.signatureHelpProvider);
  }

  async request(method: string, params?: unknown, timeoutMs = 120_000): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("LSP socket not open");
    }
    const id = this.nextId++;
    const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      });
    });
    this.socket.send(JSON.stringify({ type: "rpc", message }));
    return result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const message: JsonRpcMessage = { jsonrpc: "2.0", method, params };
    this.socket.send(JSON.stringify({ type: "rpc", message }));
  }

  async dispose() {
    if (this.closed) return;
    this.closed = true;
    this.rejectAll(new Error("LSP client disposed"));
    try {
      if (this.initialized && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "rpc", message: { jsonrpc: "2.0", method: "shutdown" } }));
        this.socket.send(JSON.stringify({ type: "rpc", message: { jsonrpc: "2.0", method: "exit" } }));
      }
    } catch {
      // ignore
    }
    this.socket?.close();
    this.socket = null;
    await api.lspStop(this.sessionId).catch(() => undefined);
  }

  private handleRaw(raw: string) {
    let payload: { type?: string; message?: JsonRpcMessage; status?: string; detail?: string | null };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return;
    }
    if (payload.type === "status") {
      console.info("[LSP] server status", payload.status, payload.detail ?? "");
      if (payload.status === "exited" || payload.status === "error") {
        this.rejectAll(new Error(`LSP ${payload.status}${payload.detail ? `: ${payload.detail}` : ""}`));
      }
      return;
    }
    if (payload.type !== "rpc" || !payload.message) return;
    const message = payload.message;
    if (
      message.id != null
      && message.method
      && message.result === undefined
      && message.error === undefined
    ) {
      this.handleServerRequest(message);
      return;
    }
    if (message.id != null && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id) ?? this.pending.get(Number(message.id)) ?? this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(message.id);
      this.pending.delete(Number(message.id));
      this.pending.delete(String(message.id));
      if (message.error) {
        // Server does not implement this method (e.g. CSS has no signatureHelp).
        if (message.error.code === -32601) pending.resolve(null);
        else pending.reject(new Error(message.error.message || "LSP error"));
      } else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      for (const handler of this.notificationHandlers) {
        try {
          handler(message.method, message.params);
        } catch {
          // ignore
        }
      }
    }
  }

  private handleServerRequest(message: JsonRpcMessage) {
    const id = message.id;
    if (id == null) return;
    let result: unknown = null;
    if (message.method === "workspace/configuration") {
      const items = (message.params as { items?: Array<{ section?: string }> } | undefined)?.items ?? [];
      result = items.map((item) => {
        const section = item.section ?? "";
        const settings = settingsForServer(this.language) as Record<string, unknown>;
        if (section && section in settings) return settings[section];
        if (!section) return settings;
        return {};
      });
    } else if (message.method === "workspace/workspaceFolders") {
      result = [
        {
          uri: pathToFileUri(this.rootPath),
          name: this.rootPath.split("/").filter(Boolean).at(-1) ?? "workspace",
        },
      ];
    }
    this.socket?.send(JSON.stringify({ type: "rpc", message: { jsonrpc: "2.0", id, result } }));
  }

  private rejectAll(error: Error) {
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }
}

function settingsForServer(language: string): Record<string, unknown> {
  if (language === "cpp") {
    return {
      clangd: {
        arguments: [
          "--background-index",
          "--clang-tidy",
          "--header-insertion=never",
        ],
      },
    };
  }
  if (language === "typescript") return VTSLS_SETTINGS;
  if (language === "python") {
    return {
      python: {
        analysis: {
          autoSearchPaths: true,
          diagnosticMode: "openFilesOnly",
          useLibraryCodeForTypes: true,
        },
      },
    };
  }
  if (language === "json") {
    return {
      json: { validate: { enable: true }, format: { enable: true } },
      provideFormatter: true,
    };
  }
  if (language === "yaml") {
    return {
      yaml: {
        validate: true,
        hover: true,
        completion: true,
        format: { enable: true },
        keyOrdering: false,
      },
    };
  }
  if (language === "css") {
    return {
      css: { validate: true },
      scss: { validate: true },
      less: { validate: true },
    };
  }
  if (language === "html") {
    return {
      html: {
        format: { wrapLineLength: 120 },
        hover: { documentation: true },
      },
      css: { validate: true },
      javascript: { validate: true },
      embeddedLanguages: { css: true, javascript: true },
    };
  }
  return {};
}

function pathToFileUri(path: string): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  return `file://${absolute.split("/").map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join("/")}`;
}
