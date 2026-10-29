import type {
  ExternalAgentConfig,
  ExternalAgentImage,
  ExternalAgentEvent,
  ExternalAgentInstallation,
  ExternalAgentPromptAcceptance,
  ExternalAgentRegistryEntry,
  ExternalAgentSession,
} from "@coloride/contracts";
import { request } from "../../shared/api/client";

const root = "/api/external-agents";

export const externalAgentsApi = {
  registry: () => request<ExternalAgentRegistryEntry[]>(`${root}/registry`),
  installations: () => request<ExternalAgentInstallation[]>(`${root}/installations`),
  install: (agentId: string, version?: string) =>
    request<ExternalAgentInstallation>(`${root}/installations`, {
      method: "POST",
      body: JSON.stringify({ agentId, version }),
    }),
  uninstall: (id: string) =>
    request<{ ok: boolean }>(`${root}/installations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  openSession: (body: { sessionId?: string; agentId: string; workspacePath: string; executionTarget: "local" }) =>
    request<ExternalAgentSession>(`${root}/sessions`, { method: "POST", body: JSON.stringify(body) }),
  session: (id: string) => request<ExternalAgentSession>(`${root}/sessions/${encodeURIComponent(id)}`),
  events: (id: string, after = 0) =>
    request<ExternalAgentEvent[]>(`${root}/sessions/${encodeURIComponent(id)}/events?after=${after}`),
  authenticate: (id: string, methodId: string) =>
    request<ExternalAgentSession>(`${root}/sessions/${encodeURIComponent(id)}/authenticate`, {
      method: "POST",
      body: JSON.stringify({ methodId }),
    }),
  setConfig: (id: string, configId: string, value: string | boolean) =>
    request<ExternalAgentConfig>(`${root}/sessions/${encodeURIComponent(id)}/config`, {
      method: "PATCH",
      body: JSON.stringify({ configId, value }),
    }),
  prompt: (id: string, text: string, images: ExternalAgentImage[] = []) =>
    request<ExternalAgentPromptAcceptance>(`${root}/sessions/${encodeURIComponent(id)}/prompts`, {
      method: "POST",
      body: JSON.stringify({ text, ...(images.length ? { images } : {}) }),
    }),
  cancel: (id: string) =>
    request<{ ok: boolean }>(`${root}/sessions/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  resolvePermission: (id: string, requestId: string, optionId: string | null, outcome: "selected" | "cancelled") =>
    request<{ ok: boolean }>(
      `${root}/sessions/${encodeURIComponent(id)}/permissions/${encodeURIComponent(requestId)}`,
      { method: "POST", body: JSON.stringify({ optionId, outcome }) },
    ),
  close: (id: string) =>
    request<{ ok: boolean }>(`${root}/sessions/${encodeURIComponent(id)}/close`, { method: "POST" }),
  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`${root}/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
