import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect } from "react";
import { api } from "../../../shared/api/client";
import { clearComposerDraft } from "../composerDrafts";
import {
  attachSessionPlugin,
  detachSessionPlugin,
  mergePluginChoices,
  resolveAgentPlugin,
  writeSessionPluginAdded,
} from "../sessionPlugins";
import {
  AGENT_PLUGIN_CHOICES,
  rememberSlashCommand,
  type AgentPluginChoice,
  type SlashCommandDef,
  type SlashCommandInvocation,
  type SlashCommandResult,
} from "../slashCommands";
import { type BuiltAgentPrompt } from "./attachmentPrompt";

interface Dependencies {
  setAttachedPlugins: Dispatch<SetStateAction<AgentPluginChoice[]>>;
  draftSessionId: string | null;
  setPluginAdded: Dispatch<SetStateAction<AgentPluginChoice | null>>;
  setPluginConfirm: Dispatch<
    SetStateAction<{ mode: "add" | "remove"; plugin: AgentPluginChoice } | null>
  >;
  setPluginPick: Dispatch<SetStateAction<"add" | "remove" | null>>;
  setPluginPickIndex: Dispatch<SetStateAction<number>>;
  writeComposerText: (value: string) => void;
  setSlashNotice: Dispatch<SetStateAction<string>>;
  activePluginPick: "add" | "remove" | null;
  pluginConfirm: { mode: "add" | "remove"; plugin: AgentPluginChoice } | null;
  pluginAdded: AgentPluginChoice | null;
  submittingRef: RefObject<boolean>;
  sendBlocked: boolean;
  composerDisabled: boolean;
  onSubmit: (prompt: string | BuiltAgentPrompt) => Promise<boolean>;
  attachedPlugins: AgentPluginChoice[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setPluginCatalog: Dispatch<SetStateAction<AgentPluginChoice[]>>;
  pluginFilter: string;
  namedPlugin: AgentPluginChoice | undefined;
  slashPluginMode: "add" | "remove" | null;
  onSlashCommand: (
    command: SlashCommandInvocation,
  ) => Promise<SlashCommandResult>;
  setSlashIndex: Dispatch<SetStateAction<number>>;
}
export function useComposerPluginActions({
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
}: Dependencies) {
  const applyAttachedPlugins = useCallback((next: AgentPluginChoice[]) => {
    setAttachedPlugins(next);
  }, []);

  const attachPluginChip = useCallback(
    (pluginId: string) => {
      applyAttachedPlugins(attachSessionPlugin(draftSessionId, pluginId));
    },
    [applyAttachedPlugins, draftSessionId],
  );

  const detachPluginChip = useCallback(
    (pluginId: string) => {
      applyAttachedPlugins(detachSessionPlugin(draftSessionId, pluginId));
      setPluginAdded((current) => {
        if (current?.id !== pluginId) return current;
        writeSessionPluginAdded(draftSessionId, null);
        return null;
      });
    },
    [applyAttachedPlugins, draftSessionId],
  );

  const beginPluginCommand = useCallback(
    (mode: "add" | "remove", query = "") => {
      setPluginConfirm(null);
      setPluginAdded(null);
      writeSessionPluginAdded(draftSessionId, null);
      setPluginPick(mode);
      setPluginPickIndex(0);
      writeComposerText(query);
      setSlashNotice("");
    },
    [writeComposerText],
  );

  const confirmPluginPick = useCallback(
    (plugin: AgentPluginChoice) => {
      const mode = activePluginPick;
      if (!mode) return;
      setPluginConfirm({ mode, plugin });
      setPluginPick(null);
      setPluginPickIndex(0);
      writeComposerText("");
      setSlashNotice("");
    },
    [activePluginPick, writeComposerText],
  );

  const cancelPluginConfirm = useCallback(() => {
    setPluginConfirm(null);
  }, []);

  const acceptPluginConfirm = useCallback(() => {
    if (!pluginConfirm) return;
    if (pluginConfirm.mode === "add") {
      attachPluginChip(pluginConfirm.plugin.id);
      setPluginAdded(pluginConfirm.plugin);
      writeSessionPluginAdded(draftSessionId, pluginConfirm.plugin);
    } else {
      detachPluginChip(pluginConfirm.plugin.id);
      setPluginAdded(null);
      writeSessionPluginAdded(draftSessionId, null);
    }
    setPluginConfirm(null);
  }, [attachPluginChip, detachPluginChip, draftSessionId, pluginConfirm]);

  const tryAddedPlugin = useCallback(() => {
    if (
      !pluginAdded ||
      submittingRef.current ||
      sendBlocked ||
      composerDisabled
    )
      return;
    const prompt = `Show me how ${pluginAdded.name} works`;
    writeComposerText(prompt);
    submittingRef.current = true;
    void (async () => {
      try {
        const ok = await onSubmit({
          text: prompt,
          attachments: [],
          pluginIds: attachedPlugins.map((plugin) => plugin.id),
        });
        if (ok) {
          writeComposerText("");
          clearComposerDraft(draftSessionId);
          setPluginAdded(null);
          writeSessionPluginAdded(draftSessionId, null);
        }
      } finally {
        submittingRef.current = false;
        requestAnimationFrame(() =>
          textareaRef.current?.focus({ preventScroll: true }),
        );
      }
    })();
  }, [
    attachedPlugins,
    composerDisabled,
    draftSessionId,
    onSubmit,
    pluginAdded,
    sendBlocked,
    writeComposerText,
  ]);

  useEffect(() => {
    if (!activePluginPick) return;
    let cancelled = false;
    void api
      .agentIntegrations()
      .then((servers) => {
        if (cancelled) return;
        setPluginCatalog(
          mergePluginChoices(
            servers
              .filter((server) => server.enabled)
              .map((server) => resolveAgentPlugin(server.id)),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setPluginCatalog([...AGENT_PLUGIN_CHOICES]);
      });
    return () => {
      cancelled = true;
    };
  }, [activePluginPick]);

  useEffect(() => {
    setPluginPickIndex(0);
  }, [activePluginPick, pluginFilter]);

  useEffect(() => {
    if (!namedPlugin || !slashPluginMode) return;
    const already = attachedPlugins.some((item) => item.id === namedPlugin.id);
    if (slashPluginMode === "add" && !already) attachPluginChip(namedPlugin.id);
    if (slashPluginMode === "remove" && already)
      detachPluginChip(namedPlugin.id);
  }, [
    attachPluginChip,
    attachedPlugins,
    detachPluginChip,
    namedPlugin,
    slashPluginMode,
  ]);

  const runSlashCommand = useCallback(
    async (command: SlashCommandDef, args: string) => {
      if (submittingRef.current || composerDisabled) return;
      rememberSlashCommand(command.id);
      submittingRef.current = true;
      setSlashNotice("");
      try {
        const result = await onSlashCommand({
          id: command.id,
          args,
          raw: `/${command.name}${args ? ` ${args}` : ""}`,
        });
        if (result.notice) setSlashNotice(result.notice);
        if (result.attachPlugin) attachPluginChip(result.attachPlugin);
        if (result.detachPlugin) detachPluginChip(result.detachPlugin);
        if (result.pickPlugin) {
          beginPluginCommand(result.pickPlugin, args);
          return;
        }
        if (result.keepSlashMenu) {
          writeComposerText("/");
          setSlashIndex(0);
          return;
        }
        if (result.clearInput === false) return;
        writeComposerText("");
        if (result.submitRemainder) {
          const ok = await onSubmit(result.submitRemainder);
          if (!ok) writeComposerText(result.submitRemainder);
        }
      } catch (reason) {
        setSlashNotice(
          reason instanceof Error ? reason.message : "Command failed.",
        );
      } finally {
        submittingRef.current = false;
        requestAnimationFrame(() =>
          textareaRef.current?.focus({ preventScroll: true }),
        );
      }
    },
    [
      attachPluginChip,
      beginPluginCommand,
      composerDisabled,
      detachPluginChip,
      onSlashCommand,
      onSubmit,
      writeComposerText,
    ],
  );

  return {
    acceptPluginConfirm,
    confirmPluginPick,
    attachPluginChip,
    detachPluginChip,
    runSlashCommand,
    cancelPluginConfirm,
    beginPluginCommand,
    tryAddedPlugin,
  };
}
