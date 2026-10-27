import type {
  AgentProvider,
  AgentProviderConfig
} from "@coloride/contracts";
import type { RefObject } from "react";
import {
  useEffect, useRef,
  useState
} from "react";
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

  const [providerKey, setProviderKey] = useState("");

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
    providerKey,
    savingProvider,
    setProviderConfig,
    setProvider,
    setProviderModel,
    setProviderKey,
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
