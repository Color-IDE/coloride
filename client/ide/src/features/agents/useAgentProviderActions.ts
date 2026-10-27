import type {
  AgentMode,
  AgentProvider,
  AgentProviderConfig,
  AgentSessionSummary,
} from "@coloride/contracts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { api } from "../../shared/api/client";
import { type LlmCreditsSnapshot } from "../auth/llmCredits";
import {
  setDefaultAgentAccessLevel,
  type AgentAccessLevel,
} from "../settings/agentAccess";
import { writeStoredComposerReasoning } from "./agentStorage";
import {
  PROVIDER_OPTIONS,
  type ComposerModelOption,
} from "./composer/modelCatalog";
import {
  reasoningLevelsForModel,
  snapReasoningEffort,
  type ComposerReasoning,
} from "./composer/modelReasoning";

interface Dependencies {
  providerModel: string;
  providerKey: string;
  providerConfig: AgentProviderConfig | null;
  provider: AgentProvider;
  setError: Dispatch<SetStateAction<string>>;
  configSeqRef: RefObject<number>;
  setSavingProvider: Dispatch<SetStateAction<boolean>>;
  setProviderConfig: Dispatch<SetStateAction<AgentProviderConfig | null>>;
  setProvider: Dispatch<SetStateAction<AgentProvider>>;
  setProviderModel: Dispatch<SetStateAction<string>>;
  setProviderKey: Dispatch<SetStateAction<string>>;
  messageFromError: (error: unknown) => string;
  savingProvider: boolean;
  hasModelCredits: (snapshot: LlmCreditsSnapshot | null | undefined) => boolean;
  llmCredits: LlmCreditsSnapshot | null;
  composerReasoning: ComposerReasoning;
  setComposerReasoning: Dispatch<SetStateAction<ComposerReasoning>>;
  sessionPane: "sidebar" | "agent";
  activeMode: AgentMode;
  changingMode: boolean;
  selectedSession: AgentSessionSummary | null;
  modeRef: RefObject<AgentMode>;
  setMode: Dispatch<SetStateAction<AgentMode>>;
  setChangingMode: Dispatch<SetStateAction<boolean>>;
  setSessions: Dispatch<SetStateAction<AgentSessionSummary[]>>;
  accessLevelRef: RefObject<AgentAccessLevel>;
  effectiveAccessLevel: AgentAccessLevel;
  setNewTaskAccessLevel: Dispatch<SetStateAction<AgentAccessLevel>>;
}
export function useAgentProviderActions({
  providerModel,
  providerKey,
  providerConfig,
  provider,
  setError,
  configSeqRef,
  setSavingProvider,
  setProviderConfig,
  setProvider,
  setProviderModel,
  setProviderKey,
  messageFromError,
  savingProvider,
  hasModelCredits,
  llmCredits,
  composerReasoning,
  setComposerReasoning,
  sessionPane,
  activeMode,
  changingMode,
  selectedSession,
  modeRef,
  setMode,
  setChangingMode,
  setSessions,
  accessLevelRef,
  effectiveAccessLevel,
  setNewTaskAccessLevel,
}: Dependencies) {
  const saveProvider = async () => {
    const model = providerModel.trim();
    const apiKey = providerKey.trim();
    const needsNewKey =
      !providerConfig?.configured || providerConfig.provider !== provider;
    if (!model || (needsNewKey && !apiKey)) {
      setError(`Enter a model and a ${PROVIDER_OPTIONS[provider].keyLabel}.`);
      return;
    }
    const seq = ++configSeqRef.current;
    setSavingProvider(true);
    setError("");
    try {
      const updated = await api.updateAgentConfig({
        provider,
        model,
        ...(apiKey ? { apiKey } : {}),
      });
      if (seq < configSeqRef.current) return;
      setProviderConfig(updated);
      setProvider(updated.provider);
      setProviderModel(updated.model);
      setProviderKey("");
    } catch (reason) {
      if (seq < configSeqRef.current) return;
      setError(messageFromError(reason));
    } finally {
      if (seq >= configSeqRef.current) {
        setSavingProvider(false);
      }
    }
  };

  const selectProvider = (nextProvider: AgentProvider) => {
    if (nextProvider === provider) return;
    setProvider(nextProvider);
    setProviderModel(
      nextProvider === providerConfig?.provider
        ? providerConfig.model
        : PROVIDER_OPTIONS[nextProvider].model,
    );
    setProviderKey("");
  };

  const selectComposerModel = async (option: ComposerModelOption) => {
    if (!option.provider || savingProvider) return;
    if (option.requiresPaidPlan && !hasModelCredits(llmCredits)) {
      setError(`${option.label} needs AI credits. Add credits to use it.`);
      return;
    }
    const seq = ++configSeqRef.current;
    setSavingProvider(true);
    setError("");
    setProvider(option.provider);
    setProviderModel(option.model);
    const snapped = snapReasoningEffort(composerReasoning, option.model);
    if (
      snapped !== composerReasoning &&
      reasoningLevelsForModel(option.model).length > 0
    ) {
      setComposerReasoning(snapped);
      writeStoredComposerReasoning(sessionPane, snapped);
    }
    setProviderKey("");
    try {
      const updated = await api.updateAgentConfig({
        provider: option.provider,
        model: option.model,
      });
      if (seq < configSeqRef.current) return;
      setProviderConfig(updated);
      setProvider(updated.provider);
      setProviderModel(updated.model);
      if (!updated.configured) {
        setError(
          `Configure a ${PROVIDER_OPTIONS[updated.provider].label} API key to use ${option.label}.`,
        );
      }
    } catch (reason) {
      if (seq < configSeqRef.current) return;
      setError(messageFromError(reason));
    } finally {
      if (seq >= configSeqRef.current) {
        setSavingProvider(false);
      }
    }
  };

  const changeMode = async (nextMode: AgentMode) => {
    if (nextMode === activeMode || changingMode) return;
    if (nextMode === "act" && providerConfig?.capabilities?.tools === false) {
      setError(
        `${providerConfig.model} does not support tools for autonomous implementation. Switch to Ask/Plan or select a compatible model.`,
      );
      return;
    }
    if (!selectedSession) {
      modeRef.current = nextMode;
      setMode(nextMode);
      return;
    }
    if (
      ["starting", "running", "waiting-approval"].includes(
        selectedSession.state,
      )
    ) {
      setError("Stop the active turn before changing agent mode.");
      return;
    }
    setChangingMode(true);
    setError("");
    try {
      const updated = await api.setAgentMode(
        selectedSession.sessionId,
        nextMode,
      );
      setSessions((current) =>
        current.map((session) =>
          session.sessionId === updated.sessionId ? updated : session,
        ),
      );
      modeRef.current = nextMode;
      setMode(nextMode);
    } catch (reason) {
      setError(messageFromError(reason));
    } finally {
      setChangingMode(false);
    }
  };

  const changeAccess = async (level: AgentAccessLevel) => {
    accessLevelRef.current = level;
    if (level === effectiveAccessLevel) {
      setDefaultAgentAccessLevel(level);
      return;
    }
    if (!selectedSession) {
      setNewTaskAccessLevel(level);
      setDefaultAgentAccessLevel(level);
      return;
    }
    if (
      ["starting", "running", "waiting-approval"].includes(
        selectedSession.state,
      )
    ) {
      throw new Error("Stop the active turn before changing access.");
    }
    const updated = await api.setAgentAccess(selectedSession.sessionId, level);
    setSessions((current) =>
      current.map((session) =>
        session.sessionId === updated.sessionId ? updated : session,
      ),
    );
  };

  return {
    saveProvider,
    selectProvider,
    selectComposerModel,
    changeMode,
    changeAccess,
  };
}
