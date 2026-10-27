import type { AgentMode } from "@coloride/contracts";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { type ColorideCodeRefPayload } from "../../editor/codeRefClipboard";
import { type AgentAccessLevel } from "../../settings/agentAccess";
import {
  PluginAddedBar,
  PluginConfirmCard,
  PluginPickMenu,
  SlashCommandMenu,
} from "../SlashCommandMenu";
import {
  clearComposerDraft,
  composerDraftKeyFor,
  getComposerDraft,
  setComposerDraft,
} from "../composerDrafts";
import {
  readSessionPluginAdded,
  readSessionPlugins,
  writeSessionPluginAdded,
} from "../sessionPlugins";
import {
  AGENT_PLUGIN_CHOICES,
  filterAgentPlugins,
  filterSlashCommands,
  findExactAgentPlugin,
  findSlashCommand,
  parseSlashInput,
  pluginCommandMode,
  splitPluginCommand,
  splitSlashCommands,
  type AgentPluginChoice,
  type SlashCommandInvocation,
  type SlashCommandResult,
} from "../slashCommands";
import { ComposerAttachments } from "./ComposerAttachments";
import {
  ComposerCodeReferences,
  type ComposerCodeRef,
} from "./ComposerCodeReferences";
import { ComposerInput } from "./ComposerInput";
import { ComposerPlugins } from "./ComposerPlugins";
import { ComposerQueue } from "./ComposerQueue";
import { ComposerSurface } from "./ComposerSurface";
import { ComposerToolbar } from "./ComposerToolbar";
import {
  buildPromptWithAttachments,
  createComposerCodeRef,
  MAX_COMPOSER_ATTACHMENTS,
  type BuiltAgentPrompt,
} from "./attachmentPrompt";
import { formatContextTokens, type ComposerContextUsage } from "./contextUsage";
import { type ComposerModelOption } from "./modelCatalog";
import { type ComposerReasoning } from "./modelReasoning";
import { useComposerAttachments } from "./useComposerAttachments";
import { useComposerModelMenu } from "./useComposerModelMenu";
import { useComposerPaste } from "./useComposerPaste";
import { useComposerPluginActions } from "./useComposerPluginActions";

export const AgentComposerCard = memo(function AgentComposerCard({
  accessLevel,
  activeMode,
  autoModel,
  hasPaidModelAccess,
  centered = false,
  compact = false,
  newTask = false,
  composerDisabled,
  composerReasoning,
  contextUsage = { inputTokens: 0, maxTokens: 500_000, pct: 0 },
  draftKey = 0,
  draftSessionId = null,
  retryDraft = null,
  retryError = "",
  onChangeAccess,
  onChangeMode,
  onBrowseComplements,
  onOpenBrowser: _onOpenBrowser,
  onRestoreQueuedFollowUp,
  onSelectModel,
  onSlashCommand,
  onSlashMenuOpenChange,
  onStop,
  onSubmit,
  placeholder,
  providerModel,
  queuedFollowUps = [],
  savingProvider,
  sendBlocked,
  setAutoModel,
  setComposerReasoning,
  stopping = false,
  turnActive = false,
  workspacePath = null,
}: {
  accessLevel: AgentAccessLevel;
  activeMode: AgentMode;
  autoModel: boolean;
  hasPaidModelAccess: boolean;
  centered?: boolean;
  /** Narrow explorer dock — keep empty input to one line. */
  compact?: boolean;
  /** Blank Agents New Task — design-only chrome, not used on open chats. */
  newTask?: boolean;
  composerDisabled: boolean;
  composerReasoning: ComposerReasoning;
  /** Latest prompt context fill from model usage events. */
  contextUsage?: ComposerContextUsage;
  /** Increment to wipe the local draft (new task / successful send). */
  draftKey?: number;
  /** Agent session id — drafts are stored per chat and restored on switch. */
  draftSessionId?: string | null;
  /** Text returned after a recoverable provider failure. */
  retryDraft?: { sessionId: string; text: string; key: number } | null;
  /** Visible only for the retryable provider failure that restored the draft. */
  retryError?: string;
  onChangeAccess?: (level: AgentAccessLevel) => void;
  onChangeMode: (mode: AgentMode) => void;
  onBrowseComplements?: () => void;
  onOpenBrowser: () => void;
  /** Pull a queued message back into the input for editing (by index). */
  onRestoreQueuedFollowUp?: (index: number) => void;
  onSelectModel: (option: ComposerModelOption) => void;
  onSlashCommand: (
    command: SlashCommandInvocation,
  ) => Promise<SlashCommandResult>;
  onSlashMenuOpenChange?: (open: boolean) => void;
  onStop: () => void;
  /** Return true when the message was accepted so the draft can clear. */
  onSubmit: (prompt: string | BuiltAgentPrompt) => Promise<boolean>;
  placeholder: string;
  providerModel: string;
  /** Follow-ups queued for when the current turn finishes (FIFO). */
  queuedFollowUps?: string[];
  savingProvider: boolean;
  sendBlocked: boolean;
  setAutoModel: (value: boolean) => void;
  setComposerReasoning: (value: ComposerReasoning) => void;
  stopping?: boolean;
  /** When set, binary attachments (fonts, zip, …) are saved into the workspace. */
  workspacePath?: string | null;
  turnActive?: boolean;
}) {
  // Keep keystrokes local so AgentView (timeline, scrubber, side rail) does not re-render per char.
  const modelMenu = useComposerModelMenu(autoModel);
  const {
    setComposerModelOpen,
    setComposerModelsFlyoutOpen,
  } = modelMenu;
  const {
    attachments,
    attachmentsRef,
    dragOver,
    setDragOver,
    dragDepthRef,
    clearAttachments,
    addFiles,
    removeAttachment,
    onComposerDragEnter,
    onComposerDragLeave,
    onComposerDragOver,
    onComposerDrop,
  } = useComposerAttachments(composerDisabled);
  const draftScope = composerDraftKeyFor(draftSessionId);
  const [message, setMessage] = useState(() =>
    getComposerDraft(draftSessionId),
  );
  const [hasText, setHasText] = useState(() =>
    Boolean(getComposerDraft(draftSessionId).trim()),
  );

  const [codeRefs, setCodeRefs] = useState<ComposerCodeRef[]>([]);

  const [queueExpanded, setQueueExpanded] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  /** Hide labels / controls when the composer bar is too narrow. */
  const [modeLabelVisible, setModeLabelVisible] = useState(true);
  const [modeBadgeVisible, setModeBadgeVisible] = useState(true);
  /** Context meter cloud — portaled so it never sits on the textarea. */
  const [contextHoverTip, setContextHoverTip] = useState<{
    top: number;
    left: number;
    label: string;
  } | null>(null);
  const composerActionsRef = useRef<HTMLDivElement>(null);
  const contextMeterRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const onOpenModel = () => setComposerModelOpen(true);
    const onInsertSlash = () => {
      messageRef.current = "/";
      setMessage("/");
      setHasText(true);
      setComposerDraft(draftSessionId, "/");
      requestAnimationFrame(() =>
        textareaRef.current?.focus({ preventScroll: true }),
      );
    };
    window.addEventListener("coloride:composer-open-model", onOpenModel);
    window.addEventListener("coloride:composer-insert-slash", onInsertSlash);
    return () => {
      window.removeEventListener("coloride:composer-open-model", onOpenModel);
      window.removeEventListener(
        "coloride:composer-insert-slash",
        onInsertSlash,
      );
    };
  }, [draftSessionId]);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const composerRootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageRef = useRef("");

  const codeRefsRef = useRef<ComposerCodeRef[]>([]);

  const submittingRef = useRef(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashNotice, setSlashNotice] = useState("");
  const [pluginPick, setPluginPick] = useState<"add" | "remove" | null>(null);
  const [pluginPickIndex, setPluginPickIndex] = useState(0);
  const [pluginConfirm, setPluginConfirm] = useState<{
    mode: "add" | "remove";
    plugin: AgentPluginChoice;
  } | null>(null);
  const [pluginAdded, setPluginAdded] = useState<AgentPluginChoice | null>(() =>
    readSessionPluginAdded(draftSessionId),
  );
  const [pluginCatalog, setPluginCatalog] = useState<AgentPluginChoice[]>(
    () => [...AGENT_PLUGIN_CHOICES],
  );
  const [attachedPlugins, setAttachedPlugins] = useState<AgentPluginChoice[]>(
    () => readSessionPlugins(draftSessionId),
  );

  /** Grow with content up to max lines, then scroll. */
  const resizeComposer = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const styles = window.getComputedStyle(el);
    const lineHeight =
      Number.parseFloat(styles.lineHeight) || (compact ? 22 : 24);
    const padY =
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0);
    const inSidebar = compact || Boolean(el.closest(".agent-view-sidebar"));
    const maxLines = inSidebar ? 6 : 14;
    // New sidebar tasks start taller; follow-ups keep the compact single-line dock.
    const pickingPlugin = Boolean(
      el
        .closest(".agent-composer-input-row")
        ?.querySelector(
          ".agent-composer-plugin-token, .agent-composer-plugin-chip",
        ),
    );
    const minHeight = pickingPlugin
      ? 22
      : inSidebar
        ? newTask
          ? 110
          : 22
        : newTask
          ? Math.max(36, lineHeight + padY)
          : lineHeight + padY;
    const maxHeight = lineHeight * maxLines + padY;
    el.style.setProperty("min-height", `${minHeight}px`, "important");
    if (!el.value) {
      el.style.setProperty("height", `${minHeight}px`, "important");
      el.style.setProperty("overflow-y", "hidden", "important");
      return;
    }
    // Measure with full width + pre-wrap so scrollHeight matches real wrapped lines.
    el.style.setProperty("height", "auto", "important");
    el.style.setProperty("overflow-y", "hidden", "important");
    // Force reflow after clearing height.
    const contentHeight = Math.max(el.scrollHeight, minHeight);
    const next = Math.max(minHeight, Math.min(contentHeight, maxHeight));
    el.style.setProperty("height", `${next}px`, "important");
    el.style.setProperty(
      "overflow-y",
      contentHeight > maxHeight + 1 ? "auto" : "hidden",
      "important",
    );
  }, [compact, newTask]);

  useEffect(() => {
    codeRefsRef.current = codeRefs;
  }, [codeRefs]);

  // Restore this chat's draft when switching sessions (or after "new task" / send clear).
  useEffect(() => {
    const restored = getComposerDraft(draftSessionId);
    const parsed = parseSlashInput(restored);
    const mode = parsed ? pluginCommandMode(parsed.name) : null;
    const pluginDraft =
      mode &&
      (parsed?.name === "add-plugin" || parsed?.name === "remove-plugin");
    const nextText = pluginDraft && parsed ? parsed.args : restored;
    messageRef.current = nextText;
    setMessage(nextText);
    setHasText(Boolean(nextText.trim()));
    clearAttachments();
    setCodeRefs([]);
    setDragOver(false);
    dragDepthRef.current = 0;
    setQueueExpanded(false);
    setSlashIndex(0);
    setSlashNotice("");
    setPluginPick(pluginDraft ? mode : null);
    setPluginPickIndex(0);
    setPluginConfirm(null);
    setPluginAdded(readSessionPluginAdded(draftSessionId));
    setAttachedPlugins(readSessionPlugins(draftSessionId));
  }, [draftKey, draftScope, draftSessionId, clearAttachments]);

  useEffect(() => {
    if (queuedFollowUps.length <= 1) setQueueExpanded(false);
  }, [queuedFollowUps.length]);

  useEffect(() => {
    if (!queueExpanded) return;
    const closeOnOutside = (event: PointerEvent) => {
      const root = composerRootRef.current;
      if (!root) return;
      const target = event.target as Node | null;
      if (
        target &&
        root.querySelector(".agent-composer-queue-stack")?.contains(target)
      )
        return;
      setQueueExpanded(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setQueueExpanded(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [queueExpanded]);

  // Apply the new-task/follow-up height before paint so moving the composer
  // to the footer cannot briefly shrink the timeline with its previous height.
  useLayoutEffect(() => {
    resizeComposer();
  }, [
    pluginPick,
    message,
    draftKey,
    centered,
    attachments.length,
    codeRefs.length,
    attachedPlugins.length,
    resizeComposer,
  ]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!attachMenuRef.current?.contains(event.target as Node))
        setAttachMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setAttachMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [attachMenuOpen]);

  useEffect(() => {
    const el = composerActionsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = (width: number) => {
      // Show labels whenever the actions bar is wide enough (including sidebar).
      // Hide controls only when the bar is extremely tight.
      const showLabels = width >= 300;
      setModeLabelVisible(showLabels);
      setModeBadgeVisible(width >= 200);
    };
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      apply(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showContextHoverTip = useCallback(
    (el: HTMLElement) => {
      const badge = el.getBoundingClientRect();
      const gap = 8;
      const edgePad = 8;
      // Above the meter; portaled + fixed so it floats over the input (not clipped under it).
      const left = Math.min(
        Math.max(badge.left + badge.width / 2, edgePad + 40),
        window.innerWidth - edgePad - 40,
      );
      const label = `${formatContextTokens(contextUsage.inputTokens)} / ${formatContextTokens(contextUsage.maxTokens)}`;
      setContextHoverTip({ top: badge.top - gap, left, label });
    },
    [contextUsage.inputTokens, contextUsage.maxTokens],
  );

  useEffect(() => {
    if (!contextHoverTip) return;
    const clear = () => setContextHoverTip(null);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, [contextHoverTip]);

  const handleMessageChange = useCallback(
    (value: string) => {
      if (!pluginPick) {
        const parsed = parseSlashInput(value);
        const mode = parsed ? pluginCommandMode(parsed.name) : null;
        if (
          mode &&
          (parsed?.name === "add-plugin" || parsed?.name === "remove-plugin")
        ) {
          setPluginPick(mode);
          setPluginPickIndex(0);
          messageRef.current = parsed.args;
          setMessage(parsed.args);
          setComposerDraft(draftSessionId, parsed.args);
          setHasText(Boolean(parsed.args.trim()));
          return;
        }
      }
      messageRef.current = value;
      setMessage(value);
      setComposerDraft(draftSessionId, value);
      const nextHasText = value.trim().length > 0;
      setHasText((current) =>
        current === nextHasText ? current : nextHasText,
      );
    },
    [draftSessionId, pluginPick],
  );

  const openFilePicker = useCallback((imagesOnly = false) => {
    setAttachMenuOpen(false);
    const input = imagesOnly ? imageInputRef.current : fileInputRef.current;
    input?.click();
  }, []);

  const insertPlainTextAtCaret = useCallback(
    (text: string) => {
      if (!text) return;
      const el = textareaRef.current;
      const current = messageRef.current;
      const start = el?.selectionStart ?? current.length;
      const end = el?.selectionEnd ?? current.length;
      const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
      handleMessageChange(next);
      requestAnimationFrame(() => {
        if (!el) return;
        const caret = start + text.length;
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [handleMessageChange],
  );

  const addCodeRef = useCallback(
    (payload: ColorideCodeRefPayload) => {
      if (composerDisabled) return;
      setCodeRefs((current) => {
        if (current.length >= MAX_COMPOSER_ATTACHMENTS) return current;
        const dup = current.some(
          (item) =>
            item.path === payload.path &&
            item.startLine === payload.startLine &&
            item.endLine === payload.endLine &&
            item.text === payload.text,
        );
        if (dup) return current;
        return [...current, createComposerCodeRef(payload)];
      });
    },
    [composerDisabled],
  );

  const removeCodeRef = useCallback((id: string) => {
    setCodeRefs((current) => current.filter((item) => item.id !== id));
  }, []);

  const onComposerPaste = useComposerPaste(
    composerDisabled,
    addCodeRef,
    addFiles,
    insertPlainTextAtCaret,
  );
  const slashDraft = parseSlashInput(message);
  const namedPlugin = slashDraft
    ? findExactAgentPlugin(
      slashDraft.args.split(/\s+/, 1)[0] ?? "",
      pluginCatalog,
    )
    : undefined;
  const slashPluginMode = pluginCommandMode(slashDraft?.name ?? "");
  const activePluginPick =
    pluginPick ?? (slashPluginMode && !namedPlugin ? slashPluginMode : null);
  const pluginFilter = slashDraft?.args ?? (activePluginPick ? message : "");
  const slashSplit =
    slashDraft && !activePluginPick
      ? splitSlashCommands(
        filterSlashCommands(slashDraft.name),
        slashDraft.name,
      )
      : null;
  const slashMatches = slashSplit?.rows ?? [];
  const slashMenuOpen =
    Boolean(slashDraft) && !composerDisabled && !activePluginPick;
  const pluginPickChoices =
    activePluginPick === "remove"
      ? filterAgentPlugins(pluginFilter, attachedPlugins)
      : filterAgentPlugins(
        pluginFilter,
        pluginCatalog.filter(
          (plugin) => !attachedPlugins.some((item) => item.id === plugin.id),
        ),
      );

  useEffect(() => {
    setSlashIndex(0);
  }, [slashDraft?.name]);

  useEffect(() => {
    onSlashMenuOpenChange?.(
      slashMenuOpen || Boolean(activePluginPick) || Boolean(pluginConfirm),
    );
  }, [onSlashMenuOpenChange, activePluginPick, pluginConfirm, slashMenuOpen]);

  const writeComposerText = useCallback(
    (value: string) => {
      messageRef.current = value;
      setMessage(value);
      setHasText(Boolean(value.trim()));
      setComposerDraft(draftSessionId, value);
    },
    [draftSessionId],
  );

  useEffect(() => {
    if (
      !retryDraft ||
      retryDraft.sessionId !== draftSessionId ||
      !retryDraft.text
    )
      return;
    writeComposerText(retryDraft.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el || el.disabled) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(retryDraft.text.length, retryDraft.text.length);
    });
  }, [draftSessionId, retryDraft, writeComposerText]);

  const {
    acceptPluginConfirm,
    confirmPluginPick,
    attachPluginChip,
    detachPluginChip,
    runSlashCommand,
    cancelPluginConfirm,
    beginPluginCommand,
    tryAddedPlugin,
  } = useComposerPluginActions({
    setAttachedPlugins,
    draftSessionId,
    setPluginAdded,
    setPluginConfirm,
    setPluginPick,
    setPluginPickIndex,
    writeComposerText,
    setSlashNotice,
    activePluginPick,
    pluginConfirm,
    pluginAdded,
    submittingRef,
    sendBlocked,
    composerDisabled,
    onSubmit,
    attachedPlugins,
    textareaRef,
    setPluginCatalog,
    pluginFilter,
    namedPlugin,
    slashPluginMode,
    onSlashCommand,
    setSlashIndex,
  });
  const handleSubmit = useCallback(async () => {
    // Allow queueing while a turn is active; only block real hard disables.
    if (submittingRef.current || sendBlocked || composerDisabled) return;
    if (pluginConfirm) {
      acceptPluginConfirm();
      return;
    }
    if (activePluginPick && !namedPlugin) {
      const selected =
        pluginPickChoices[
        Math.min(pluginPickIndex, Math.max(pluginPickChoices.length - 1, 0))
        ];
      if (selected) confirmPluginPick(selected);
      else
        setSlashNotice(
          activePluginPick === "add"
            ? "Select a plugin to add."
            : "Select a plugin to remove.",
        );
      return;
    }
    const text = messageRef.current;
    const pluginCmd = splitPluginCommand(text, pluginCatalog);
    if (pluginCmd) {
      if (pluginCmd.plugin) {
        if (pluginCmd.mode === "add") attachPluginChip(pluginCmd.plugin.id);
        else detachPluginChip(pluginCmd.plugin.id);
      } else {
        setSlashNotice(
          pluginCmd.mode === "add"
            ? "Select a plugin to add."
            : "Select a plugin to remove.",
        );
        return;
      }
      if (!pluginCmd.remainder.trim()) {
        writeComposerText("");
        return;
      }
    }
    const sendText = pluginCmd?.remainder ?? text;
    const parsed = parseSlashInput(sendText);
    if (parsed) {
      const command = findSlashCommand(parsed.name);
      if (command && !pluginCommandMode(command.name)) {
        await runSlashCommand(command, parsed.args);
        return;
      }
      if (parsed.name) {
        setSlashNotice(`Unknown command /${parsed.name}. Type /help.`);
        return;
      }
      return;
    }
    const currentAttachments = attachmentsRef.current;
    const currentCodeRefs = codeRefsRef.current;
    if (
      !sendText.trim() &&
      currentAttachments.length === 0 &&
      currentCodeRefs.length === 0
    )
      return;
    submittingRef.current = true;
    try {
      const built = await buildPromptWithAttachments(
        sendText,
        currentAttachments,
        workspacePath,
        currentCodeRefs,
      );
      if (!built.text.trim() && !built.attachments.length) return;
      const ok = await onSubmit({
        ...built,
        pluginIds: attachedPlugins.map((plugin) => plugin.id),
      });
      if (ok) {
        messageRef.current = "";
        setMessage("");
        setHasText(false);
        clearComposerDraft(draftSessionId);
        clearAttachments();
        setCodeRefs([]);
        setSlashNotice("");
        setPluginAdded(null);
        writeSessionPluginAdded(draftSessionId, null);
      }
    } finally {
      submittingRef.current = false;
    }
  }, [
    acceptPluginConfirm,
    activePluginPick,
    attachPluginChip,
    attachedPlugins,
    clearAttachments,
    composerDisabled,
    confirmPluginPick,
    detachPluginChip,
    draftSessionId,
    namedPlugin,
    onSubmit,
    pluginCatalog,
    pluginConfirm,
    pluginPickChoices,
    pluginPickIndex,
    runSlashCommand,
    sendBlocked,
    workspacePath,
    writeComposerText,
  ]);

  const handlePrimaryAction = useCallback(() => {
    // Prefer queue/send when there is draft text or attachments; otherwise Stop while generating.
    if (hasText || attachments.length > 0 || codeRefs.length > 0) {
      void handleSubmit();
      return;
    }
    if (turnActive) {
      if (!stopping) onStop();
      return;
    }
    void handleSubmit();
  }, [
    attachments.length,
    codeRefs.length,
    handleSubmit,
    hasText,
    onStop,
    stopping,
    turnActive,
  ]);

  const onComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Keep the familiar select-all shortcut inside the composer. In
      // particular, macOS maps Ctrl+A to "start of line" natively, whereas
      // Coloride's editor-style input should treat Ctrl/Cmd+A consistently.
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.select();
        return;
      }
      if (pluginConfirm && !event.nativeEvent.isComposing) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelPluginConfirm();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          acceptPluginConfirm();
          return;
        }
      }
      if (activePluginPick && !namedPlugin && !event.nativeEvent.isComposing) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setPluginPickIndex((index) =>
            pluginPickChoices.length
              ? (index + 1) % pluginPickChoices.length
              : 0,
          );
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setPluginPickIndex((index) =>
            pluginPickChoices.length
              ? (index - 1 + pluginPickChoices.length) %
              pluginPickChoices.length
              : 0,
          );
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setPluginPick(null);
          setPluginPickIndex(0);
          writeComposerText("");
          setSlashNotice("");
          return;
        }
        if (
          (event.key === "Backspace" || event.key === "Delete") &&
          !messageRef.current
        ) {
          const el = textareaRef.current;
          const atStart = !el || el.selectionStart === 0;
          if (atStart) {
            event.preventDefault();
            setPluginPick(null);
            setPluginPickIndex(0);
            setSlashNotice("");
            return;
          }
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const selected =
            pluginPickChoices[
            Math.min(
              pluginPickIndex,
              Math.max(pluginPickChoices.length - 1, 0),
            )
            ];
          if (selected) confirmPluginPick(selected);
          else
            setSlashNotice(
              activePluginPick === "add"
                ? "Select a plugin to add."
                : "Select a plugin to remove.",
            );
          return;
        }
      }
      const parsed = parseSlashInput(messageRef.current);
      const matches = parsed
        ? splitSlashCommands(filterSlashCommands(parsed.name), parsed.name).rows
        : [];
      const menuOpen = Boolean(parsed) && !activePluginPick;
      if (menuOpen && !event.nativeEvent.isComposing) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashIndex((index) =>
            matches.length ? (index + 1) % matches.length : 0,
          );
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashIndex((index) =>
            matches.length ? (index - 1 + matches.length) % matches.length : 0,
          );
          return;
        }
        if (event.key === "Tab" && matches[0]) {
          event.preventDefault();
          const selected =
            matches[Math.min(slashIndex, matches.length - 1)] ?? matches[0];
          if (pluginCommandMode(selected.name)) {
            beginPluginCommand(
              selected.name === "add-plugin" ? "add" : "remove",
            );
            return;
          }
          writeComposerText(`/${selected.name}${selected.hint ? " " : ""}`);
          setSlashIndex(0);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          writeComposerText("");
          setSlashNotice("");
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const selected =
            matches[Math.min(slashIndex, Math.max(matches.length - 1, 0))];
          if (selected) {
            if (pluginCommandMode(selected.name)) {
              beginPluginCommand(
                selected.name === "add-plugin" ? "add" : "remove",
              );
              return;
            }
            const exact = parsed && parsed.name === selected.name;
            void runSlashCommand(selected, exact ? parsed.args : "");
            return;
          }
          void handleSubmit();
          return;
        }
      }
      // Backspace on empty field removes the last chip (code first, then plugin).
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.nativeEvent.isComposing &&
        !messageRef.current
      ) {
        const el = textareaRef.current;
        const atStart = !el || el.selectionStart === 0;
        if (atStart && codeRefsRef.current.length > 0) {
          event.preventDefault();
          const last = codeRefsRef.current[codeRefsRef.current.length - 1];
          if (last) removeCodeRef(last.id);
          return;
        }
        if (atStart && attachedPlugins.length > 0) {
          event.preventDefault();
          const last = attachedPlugins[attachedPlugins.length - 1];
          if (last) detachPluginChip(last.id);
          return;
        }
      }
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.nativeEvent.isComposing
      )
        return;
      event.preventDefault();
      void handleSubmit();
    },
    [
      acceptPluginConfirm,
      activePluginPick,
      attachedPlugins,
      beginPluginCommand,
      cancelPluginConfirm,
      confirmPluginPick,
      detachPluginChip,
      handleSubmit,
      namedPlugin,
      pluginConfirm,
      pluginPickChoices,
      pluginPickIndex,
      removeCodeRef,
      runSlashCommand,
      slashIndex,
      writeComposerText,
    ],
  );

  const hasContent = hasText || attachments.length > 0 || codeRefs.length > 0;
  const showStop = turnActive && !hasContent;
  const primaryDisabled = showStop
    ? stopping
    : sendBlocked || composerDisabled || !hasContent;
  const primaryLabel = showStop
    ? "Stop generating"
    : turnActive
      ? "Queue next message"
      : "Send";

  return (
    <div className="agent-composer-plugin-stack">
      {pluginConfirm ? (
        <PluginConfirmCard
          mode={pluginConfirm.mode}
          plugin={pluginConfirm.plugin}
          onBrowse={onBrowseComplements}
          onCancel={cancelPluginConfirm}
          onConfirm={acceptPluginConfirm}
        />
      ) : pluginAdded ? (
        <PluginAddedBar
          plugin={pluginAdded}
          onBrowse={onBrowseComplements}
          onTry={tryAddedPlugin}
        />
      ) : null}
      <ComposerSurface
        centered={centered}
        compact={compact}
        disabled={composerDisabled}
        dragOver={dragOver}
        inputRef={textareaRef}
        newTask={newTask}
        onDragEnter={onComposerDragEnter}
        onDragLeave={onComposerDragLeave}
        onDragOver={onComposerDragOver}
        onDrop={onComposerDrop}
        onPaste={onComposerPaste}
        providerError={Boolean(retryError)}
        ref={composerRootRef}
      >
        <input
          accept="*/*"
          className="hidden"
          multiple
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />
        <input
          accept="image/*"
          className="hidden"
          multiple
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
          ref={imageInputRef}
          type="file"
        />
        {activePluginPick ? (
          <PluginPickMenu
            activeIndex={pluginPickIndex}
            mode={activePluginPick}
            plugins={pluginPickChoices}
            onBrowse={onBrowseComplements}
            onHover={setPluginPickIndex}
            onSelect={confirmPluginPick}
          />
        ) : slashMenuOpen ? (
          <SlashCommandMenu
            activeIndex={slashIndex}
            commands={slashMatches}
            query={slashDraft?.name ?? ""}
            onHover={setSlashIndex}
            onSelect={(command) => {
              if (pluginCommandMode(command.name)) {
                beginPluginCommand(
                  command.name === "add-plugin" ? "add" : "remove",
                );
                return;
              }
              const exact = slashDraft?.name === command.name;
              void runSlashCommand(
                command,
                exact ? (slashDraft?.args ?? "") : "",
              );
            }}
          />
        ) : null}
        {slashNotice ? (
          <div className="agent-slash-notice">{slashNotice}</div>
        ) : null}
        {dragOver ? (
          <div aria-hidden="true" className="agent-composer-drop-overlay">
            <div className="agent-composer-drop-overlay-card">
              <span>Drop files to attach</span>
            </div>
          </div>
        ) : null}
        {queuedFollowUps.length > 0
          ? (() => {
            const removeQueued = (index: number) => {
              onRestoreQueuedFollowUp?.(index);
            };
            const restoreQueued = (index: number) => {
              const pending = queuedFollowUps[index];
              if (!pending) return;
              onRestoreQueuedFollowUp?.(index);
              messageRef.current = pending;
              setMessage(pending);
              setComposerDraft(draftSessionId, pending);
              setHasText(pending.trim().length > 0);
              setQueueExpanded(false);
              requestAnimationFrame(() => {
                const el = textareaRef.current;
                if (!el) return;
                el.focus();
                const end = pending.length;
                el.setSelectionRange(end, end);
              });
            };
            return (
              <ComposerQueue
                expanded={queueExpanded}
                messages={queuedFollowUps}
                onDelete={removeQueued}
                onExpand={() => setQueueExpanded(true)}
                onRestore={restoreQueued}
              />
            );
          })()
          : null}
        <ComposerAttachments
          attachments={attachments}
          onRemove={removeAttachment}
        />
        <div
          className={`agent-composer-input-row${codeRefs.length || attachedPlugins.length || activePluginPick ? " has-code-refs" : ""}`}
        >
          <ComposerPlugins
            activePick={activePluginPick}
            onDetach={detachPluginChip}
            plugins={attachedPlugins}
          />
          <ComposerCodeReferences
            references={codeRefs}
            onRemove={removeCodeRef}
          />
          <ComposerInput
            aria-label="Message agent"
            compact={compact}
            disabled={composerDisabled}
            hasChips={Boolean(
              codeRefs.length || attachedPlugins.length || activePluginPick,
            )}
            newTask={newTask}
            onChange={(event) => handleMessageChange(event.target.value)}
            onInput={() => resizeComposer()}
            onKeyDown={onComposerKeyDown}
            onPaste={onComposerPaste}
            placeholder={
              activePluginPick
                ? message.trim()
                  ? ""
                  : "Search or paste link"
                : compact && placeholder.length > 42
                  ? "Ask Coloride…"
                  : placeholder
            }
            ref={textareaRef}
            value={message}
          />
        </div>
        {/* Toolbar: + attach/modes · model · context · mode badge · spacer · send */}
        <ComposerToolbar
          composerActionsRef={composerActionsRef}
          attachMenuRef={attachMenuRef}
          attachMenuOpen={attachMenuOpen}
          composerDisabled={composerDisabled}
          setComposerModelOpen={setComposerModelOpen}
          setComposerModelsFlyoutOpen={setComposerModelsFlyoutOpen}
          setAttachMenuOpen={setAttachMenuOpen}
          modelMenu={modelMenu}
          providerModel={providerModel}
          autoModel={autoModel}
          hasPaidModelAccess={hasPaidModelAccess}
          composerReasoning={composerReasoning}
          savingProvider={savingProvider}
          setAutoModel={setAutoModel}
          setComposerReasoning={setComposerReasoning}
          onSelectModel={onSelectModel}
          contextUsage={contextUsage}
          setContextHoverTip={setContextHoverTip}
          showContextHoverTip={showContextHoverTip}
          contextMeterRef={contextMeterRef}
          contextHoverTip={contextHoverTip}
          modeBadgeVisible={modeBadgeVisible}
          activeMode={activeMode}
          modeLabelVisible={modeLabelVisible}
          onChangeMode={onChangeMode}
          accessLevel={accessLevel}
          onChangeAccess={onChangeAccess}
          openFilePicker={openFilePicker}
          primaryLabel={primaryLabel}
          showStop={showStop}
          primaryDisabled={primaryDisabled}
          handlePrimaryAction={handlePrimaryAction}
        />
      </ComposerSurface>
    </div>
  );
});
