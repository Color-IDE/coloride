import type {
  AgentProvider,
  AgentProviderConfig
} from "@coloride/contracts";
import type { RefObject } from "react";
import {
  useEffect, useRef,
  useState
} from "react";
import { notifyAgentConfigChanged, subscribeAgentConfigChanges } from "./providerConfigEvents";
import { api } from "../../shared/api/client";
import { getValidAccessToken, subscribeCloudAuth } from "../auth/cloudAuth";
import { getCachedLlmCredits, refreshLlmCredits, subscribeLlmCredits, type LlmCreditsSnapshot } from "../auth/llmCredits";

interface Dependencies { configSeqRef: RefObject<number>; viewActive: boolean; }

export function useAgentProviderState({ configSeqRef, viewActive }: Dependencies) {
  const [llmCredits, setLlmCredits] = useState<LlmCreditsSnapshot | null>(() =>
    getCachedLlmCredits(),
  );
  const [outOfCreditsOpen, setOutOfCreditsOpen] = useState(false);
  const [outOfCreditsPeriodEnd, setOutOfCreditsPeriodEnd] = useState<
    string | null
  >(null);
  const llmCreditsRefreshAfterTurnRef = useRef(false);

  const [providerConfig, setProviderConfig] =
    useState<AgentProviderConfig | null>(null);

  const [provider, setProvider] = useState<AgentProvider>("xai");

  const [providerModel, setProviderModel] = useState("grok-4.5");


  const [savingProvider, setSavingProvider] = useState(false);
  // Keep sidecar JWT in sync so managed LLM calls work after login/refresh.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        // Always validate the access JWT before handing it to the sidecar.
        // A snapshot can be expired, and a late panel mount used to overwrite
        // a freshly renewed token with that stale value.
        const token = await getValidAccessToken();
        if (cancelled) return;
        // Do not clear the sidecar token for a transient refresh failure. A
        // real logout explicitly clears it in logoutCloudAuth.
        if (token) await api.setCloudAgentToken(token);
        if (cancelled) return;
        const seq = ++configSeqRef.current;
        const nextConfig = await api.agentConfig();
        if (cancelled || seq < configSeqRef.current) return;
        setProviderConfig(nextConfig);
        if (nextConfig.provider) setProvider(nextConfig.provider);
        if (nextConfig.model) setProviderModel(nextConfig.model);
        const credits = await refreshLlmCredits({ force: true });
        if (cancelled) return;
        setLlmCredits(credits);
      } catch {
        // Cloud refresh failures must not block the local workspace.
      }
    };
    void sync();
    const unsubscribe = subscribeCloudAuth(() => { void sync(); });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  const [providerRevision, setProviderRevision] = useState(0);
  useEffect(() => {
    const invalidate = () => setProviderRevision(value => value + 1);
    const unsubscribe = subscribeAgentConfigChanges(invalidate);
    window.addEventListener("focus", invalidate);
    return () => { unsubscribe(); window.removeEventListener("focus", invalidate); };
  }, []);
  useEffect(() => {
    if (!providerRevision || savingProvider) return;
    let active = true;
    const seq = ++configSeqRef.current;
    void api.agentConfig().then(value => {
      if (!active || seq < configSeqRef.current) return;
      setProviderConfig(value);
      setProvider(value.provider);
      setProviderModel(value.model);
    }).catch(() => { /* Preserve the last configuration if the host is unavailable. */ });
    return () => { active = false; };
  }, [providerRevision, savingProvider, configSeqRef]);

  // A saved key is enough to connect. Discovery runs once per open panel, so
  // the composer appears when a model is actually available.
  useEffect(() => {
    if (!viewActive || savingProvider) return;
    let active = true;
    void api.agentConfig(true).then(async value => {
      if (!active) return;
      const pending = value.providers?.filter(entry => entry.configured && !entry.availableModels?.length) || [];
      if (!pending.length) return;
      await Promise.allSettled(pending.map(entry => api.connectAgentProvider(entry.provider)));
      if (active) notifyAgentConfigChanged();
    }).catch(() => {});
    return () => { active = false; };
  }, [viewActive, savingProvider]);

  // Subscribe to shared credits cache (other refresh paths).
  useEffect(
    () =>
      subscribeLlmCredits((snap) => {
        setLlmCredits(snap);
      }),
    [],
  );

  // Refresh credits when agent panel is shown / app returns to foreground (stale > 60s).
  useEffect(() => {
    if (!viewActive) return;
    const maybeRefresh = () => {
      const cached = getCachedLlmCredits();
      const stale = !cached || Date.now() - cached.fetchedAt > 60_000;
      if (!stale) return;
      void refreshLlmCredits({ force: true }).then((snap) => {
        setLlmCredits(snap);
      });
    };
    maybeRefresh();
    const onVis = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [viewActive]);

  return {
    providerConfig,
    provider,
    providerModel,
    savingProvider,
    setProviderConfig,
    setProvider,
    setProviderModel,
    setSavingProvider,
    setOutOfCreditsPeriodEnd,
    llmCreditsRefreshAfterTurnRef,
    llmCredits,
    setLlmCredits,
    outOfCreditsOpen,
    setOutOfCreditsOpen,
    outOfCreditsPeriodEnd,
  };
}
