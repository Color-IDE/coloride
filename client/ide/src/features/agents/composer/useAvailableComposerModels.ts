import type { AgentProviderConfig } from "@coloride/contracts";
import { useEffect, useState } from "react";
import { api } from "../../../shared/api/client";
import { subscribeAgentConfigChanges } from "../providerConfigEvents";
import { COMPOSER_MODEL_GROUPS, COMPOSER_MODELS, PROVIDER_OPTIONS, type ComposerModelOption } from "./modelCatalog";

export function useAvailableComposerModels(open: boolean) {
  const [config, setConfig] = useState<AgentProviderConfig | null>(null);
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    const refresh = () => {
      void api.agentConfig(true).then(async value => {
        if (!mounted) return;
        setConfig(value);
        if (value.credentialSource === "coloride" || (value.managedLlm && value.credentialSource === "none")) return;
        const missing = value.providers?.filter(entry => entry.configured && !entry.availableModels?.length) || [];
        if (!missing.length) return;
        await Promise.allSettled(missing.map(entry => api.connectAgentProvider(entry.provider)));
        if (!mounted) return;
        const refreshed = await api.agentConfig(true);
        if (mounted) setConfig(refreshed);
      }).catch(() => {});
    };
    refresh();
    const unsubscribe = subscribeAgentConfigChanges(refresh);
    window.addEventListener("focus", refresh);
    return () => { mounted = false; unsubscribe(); window.removeEventListener("focus", refresh); };
  }, [open]);
  if (!config) return [];
  if (!config.providers || config.credentialSource === "coloride" || (config.managedLlm && config.credentialSource === "none")) return COMPOSER_MODEL_GROUPS;
  return config.providers.filter(entry => entry.configured).map(entry => ({
    label: entry.label || PROVIDER_OPTIONS[entry.provider]?.label || entry.provider,
    models: (entry.availableModels || []).map(model => {
      const known = COMPOSER_MODELS.find(item => item.provider === entry.provider && item.model === model.id);
      return { ...(known || { description: "Recommended coding model available through your API key.", price: 0, coding: 0, visual: 0, inputPerM: 0, outputPerM: 0, detailsUnavailable: true }),
        capabilities: model.capabilities || undefined, model: model.id, label: model.label, provider: entry.provider, requiresPaidPlan: false } satisfies ComposerModelOption;
    }),
  })).filter(group => group.models.length);
}
