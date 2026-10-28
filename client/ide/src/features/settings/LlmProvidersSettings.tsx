import type { AgentProvider, AgentProviderConfig, AgentProviderConfiguration } from "@coloride/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../shared/api/client";
import { PROVIDER_OPTIONS, notifyAgentConfigChanged } from "../agents/providerSettings";
import { AddLlmProvider } from "./AddLlmProvider";
import { SettingsRow } from "./SettingsControls";

const initialProviders: AgentProvider[] = ["openai", "gemini", "xai", "deepseek", "mistral", "groq", "ollama"];

export function LlmProvidersSettings({ onProvidersChange }: { onProvidersChange?: (labels: string[]) => void } = {}) {
  const [config, setConfig] = useState<AgentProviderConfig | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [customOpen, setCustomOpen] = useState(false);
  const providers = useMemo(() => {
    if (!config?.providers?.length) return initialProviders;
    const visible = config.providers.filter(entry => entry.showInSettings !== false && (entry.provider !== "fireworks" || entry.showInSettings === true)).map(entry => entry.provider);
    return [...initialProviders.filter(id => visible.includes(id)), ...visible.filter(id => !initialProviders.includes(id))];
  }, [config]);
  useEffect(() => { onProvidersChange?.(providers.map(id => config?.providers?.find(entry => entry.provider === id)?.label || PROVIDER_OPTIONS[id]?.label || id)); }, [config, providers, onProvidersChange]);
  useEffect(() => {
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = () => { void api.agentConfig(true).then(value => {
      if (!mounted) return;
      setConfig(value);
      setError("");
    }).catch(() => {
      if (!mounted) return;
      setError("Could not load providers. Retrying automatically…");
      retryTimer = setTimeout(load, 5000);
    }); };
    load();
    return () => { mounted = false; clearTimeout(retryTimer); };
  }, [revision]);
  if (customOpen) {
    return <AddLlmProvider onBack={() => setCustomOpen(false)} onAdded={() => { setRevision(value => value + 1); setCustomOpen(false); }} />;
  }
  return <div className="settings-llm-providers mt-6 pb-8">
    {error && <p className="settings-provider-feedback" role="alert">{error}</p>}
    {providers.map(provider => <ProviderSection key={provider} provider={provider}
      entry={config?.providers?.find(value => value.provider === provider)} loading={!config}
      onConnected={value => { setConfig(value); notifyAgentConfigChanged(); }} />)}
    <section className="llm-custom-entry">
      <div className="llm-custom-entry-row">
        <div>
          <h2>Custom provider</h2>
          <p>Connect an OpenAI-compatible endpoint, or a local server, and keep the built-in providers as they are.</p>
        </div>
        <button type="button" className="llm-custom-open" onClick={() => setCustomOpen(true)}>
          Add provider
          <svg aria-hidden="true" fill="none" height="12" viewBox="0 0 24 24" width="12">
            <path d="m4 9 8 8 8-8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" transform="rotate(-90 12 12)" />
          </svg>
        </button>
      </div>
    </section>
  </div>;
}

function OpenAiIcon() {
  return (
    <svg aria-hidden="true" className="llm-provider-icon" fill="none" height="18" viewBox="0.55 0.08 14.4 15.84" width="18" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0h16v16H0z" fill="none" />
      <path fill="currentColor" d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z" />
    </svg>
  );
}

function GeminiIcon() {
  return (
    <svg aria-hidden="true" className="llm-provider-icon" fill="none" height="18" viewBox="0.28 0 15.45 15.98" width="18" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0h16v16H0z" fill="none" />
      <path fill="currentColor" d="M7.987 0c.167 0 .313.114.354.277q.188.747.492 1.453a10.3 10.3 0 0 0 2.18 3.231 10.26 10.26 0 0 0 4.684 2.672.365.365 0 0 1 0 .708q-.747.188-1.454.492a10.3 10.3 0 0 0-3.23 2.18 10.26 10.26 0 0 0-2.672 4.684.365.365 0 0 1-.708 0 10.25 10.25 0 0 0-2.672-4.684A10.26 10.26 0 0 0 .277 8.34a.366.366 0 0 1 0-.708q.747-.188 1.453-.492a10.3 10.3 0 0 0 3.231-2.18A10.25 10.25 0 0 0 7.633.277.366.366 0 0 1 7.987 0" />
    </svg>
  );
}

function XaiIcon() {
  return (
    <svg aria-hidden="true" className="llm-provider-icon" fill="none" height="18" viewBox="3.8 3 19.2 18" width="18" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M3.8 21h3.8l1.9-2.71-1.9-2.71zm0-12.2L12.34 21h3.8L7.6 8.8zM17.4 21h2.49l.31-16.64-3.11 4.44zm-6.96-9.49 1.9 2.71L20.2 3h-3.8z" />
    </svg>
  );
}

function MistralIcon() {
  return (
    <svg aria-hidden="true" className="llm-provider-icon is-mistral" fill="none" height="16" viewBox="64 192 896 640" width="22" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0h1024v1024H0z" fill="none" />
      <path fill="currentColor" d="M704.005 192.016v127.979H575.99V448.01H448.011V319.995H319.995V192.053H192.053v511.99H64V832.02h384.01V704.043H319.996V576.027H448.01v128.016h128.016V576.027h127.978v128.016H576.027V832.02H960V704.043H831.947V192.016z" />
    </svg>
  );
}

function GroqIcon() {
  return (
    <svg aria-hidden="true" className="llm-provider-icon is-groq" fill="none" height="17" viewBox="5.6 6.4 12.2 11.2" width="17" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0h24v24H0z" fill="none" />
      <path fill="currentColor" d="M3 3v18h18V3zm11.72 13.37c-.41.38-.82.66-1.33.87l-.21.09c-.83.3-1.82.21-2.63-.1c-.45-.21-.82-.46-1.19-.8c.33-.41.66-.75 1.07-1.07l.27.21c.5.35 1 .47 1.61.41c.62-.12 1.12-.4 1.52-.9c.37-.61.41-1.09.41-1.8V10.4c0-.72-.15-1.18-.6-1.74c-.61-.49-1.17-.74-1.96-.7c-.66.11-1.19.42-1.59.95c-.33.53-.48 1.07-.37 1.69c.2.68.45 1.25 1.07 1.61c.52.27.98.32 1.56.33h.25c.2.02.4.02.61.03V14c-1.49.06-2.65.06-3.84-.97a4.22 4.22 0 0 1-1.23-2.8c.04-.88.35-1.6.86-2.32l.15-.23c1.43-1.51 3.7-1.61 5.31-.31l.17.14c.58.52.96 1.25 1.08 2.01c0 .16.01.33.01.49v3.6c0 1.05-.3 1.95-1.02 2.74Z" />
    </svg>
  );
}

function OllamaIcon() {
  return (
    <svg aria-hidden="true" className="llm-provider-icon" fill="none" height="18" viewBox="58 64 908 896" width="18" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0h1024v1024H0z" fill="none" />
      <path fill="currentColor" d="M674.81 447.04a33.38 33.38 0 0 0-20.831 17.547l-2.688 5.525l.037 7.728c0 7.205.15 8.101 2.203 13.179c2.837 7.205 5.674 11.648 10.864 16.725c8.96 8.885 19.04 11.2 32.554 7.653a32.1 32.1 0 0 0 19.302-16.277a28.08 28.08 0 0 0 2.986-18.592c-2.39-16.912-12.32-29.195-27.03-33.488a39.6 39.6 0 0 0-17.396 0m-343.578.187c-11.387 3.584-19.899 11.946-24.267 23.856a44.3 44.3 0 0 0-2.24 19.413c2.128 11.536 11.574 22.027 22.326 24.901c13.514 3.547 23.594 1.232 32.554-7.653c5.227-5.077 8.027-9.52 10.864-16.725c2.054-5.078 2.203-5.974 2.203-13.179l.037-7.728l-2.688-5.525a33.38 33.38 0 0 0-21.093-17.622a38.1 38.1 0 0 0-17.696.262m156.203 74.666c-4.891 2.651-8.326 9.334-7.28 14.299c1.157 5.339 5.861 10.752 13.178 15.195c3.92 2.352 4.182 2.688 4.368 5.077c.15 1.419-.373 5.45-1.082 9.072c-.747 3.51-1.344 7.243-1.344 8.288c.074 2.763 2.613 7.28 5.338 9.445c2.39 1.942 2.838 2.016 9.52 2.203c6.123.187 7.392.037 9.856-1.12c6.31-3.061 7.915-8.736 5.6-19.6c-1.941-9.072-1.568-10.453 3.248-13.253c5.115-2.987 10.491-8.176 12.096-11.723a13.627 13.627 0 0 0-6.533-17.92a14.7 14.7 0 0 0-6.757-1.232c-4.704 0-7.728 1.12-13.254 4.63l-3.173 1.978l-1.979-1.195c-8.176-4.853-9.669-5.413-14.597-5.338a14.8 14.8 0 0 0-7.205 1.194m14.56-81.946c-13.926 1.344-17.734 1.866-24.416 3.21c-10.864 2.24-25.387 7.28-35.504 12.246c-35.094 17.173-59.323 45.77-66.715 78.922c-1.493 6.571-1.68 8.736-1.68 19.787c0 10.976.187 13.328 1.605 19.563c9.856 43.306 49.728 75.3 101.323 81.125c11.2 1.232 59.584 1.232 70.784 0c41.44-4.667 77.056-27.141 93.072-58.65c4.256-8.438 6.31-13.889 8.213-22.475c1.456-6.235 1.643-8.587 1.643-19.526c0-11.088-.187-13.253-1.68-19.824c-10.752-48.16-57.456-86.016-114.688-93.221a257 257 0 0 0-31.92-1.157zm24.08 34.981a122.6 122.6 0 0 1 53.76 19.19c8.325 5.525 20.048 17.098 25.05 24.714c6.198 9.37 9.707 18.965 11.312 30.613c.747 5.339.374 9.371-1.605 17.995c-2.987 12.88-12.395 26.32-25.088 35.728a116.3 116.3 0 0 1-25.723 12.992c-14.261 4.555-23.594 5.376-56.933 5.152c-21.728-.224-25.61-.373-31.845-1.568c-21.28-3.995-38.155-12.47-50.4-25.387c-9.856-10.453-14.374-19.973-16.8-35.317c-1.12-7.168.933-19.003 5.114-28.97c5.078-12.171 18.219-27.254 31.211-35.953c15.045-10.042 34.87-17.173 53.088-19.114c6.981-.747 21.877-.747 28.859-.075M320.629 64.261a61.7 61.7 0 0 0-25.498 11.126c-21.43 16.24-38.006 50.81-45.024 93.856c-2.614 16.277-4.443 38.826-4.443 56.112c0 20.309 2.39 46.293 5.787 64.25c.746 3.995 1.157 7.542.858 7.766a303 303 0 0 1-6.981 5.674a198.8 198.8 0 0 0-35.43 38.08a204.96 204.96 0 0 0-35.093 87.323a247.3 247.3 0 0 0-.858 50.661c3.397 29.12 12.133 53.686 27.141 76.16l4.853 7.28l-1.381 2.39c-10.043 16.874-18.592 41.253-22.587 64.66c-3.136 18.518-3.546 23.484-3.546 48.31c0 25.014.336 29.979 3.285 47.264c3.547 20.72 10.752 42.672 18.779 57.27c2.65 4.778 9.072 14.672 9.856 15.194c.261.112-.523 2.502-1.718 5.264a276.5 276.5 0 0 0-20.458 69.926c-2.315 15.568-2.651 20.608-2.651 36.997c0 20.907 1.157 31.061 5.525 47.75l.635 2.426h55.179l-1.867-3.397c-11.088-20.608-12.133-58.8-2.539-96.955c4.368-17.621 9.334-30.576 18.592-48.384l5.526-10.827v-6.608c0-6.16-.112-6.87-2.128-10.938a34.2 34.2 0 0 0-7.243-9.334a65 65 0 0 1-14.373-20.272c-15.83-34.346-18.891-85.344-7.766-128.837c4.63-18.144 12.283-34.272 20.31-43.083a29.38 29.38 0 0 0 8.325-19.824c0-7.28-2.613-13.253-8.363-19.488a117.1 117.1 0 0 1-30.501-64.549c-5.227-35.84 4.256-74.853 25.76-105.803c21.019-30.389 50.512-49.877 83.515-55.066c7.429-1.232 21.28-1.046 28.97.373c8.438 1.493 13.702 1.045 19.115-1.53c6.683-3.174 10.005-7.094 13.963-16.091c3.472-8.027 6.16-12.432 13.44-21.504c8.736-10.827 17.173-18.256 30.688-27.216c15.418-10.08 33.002-17.435 50.474-20.944c6.347-1.307 9.334-1.494 21.243-1.494c11.91 0 14.859.187 21.243 1.494a151.95 151.95 0 0 1 71.456 37.221c4.368 4.07 14.858 17.061 18.218 22.475c1.27 2.128 3.547 6.608 4.928 9.968c3.92 8.997 7.28 12.917 13.963 16.053c5.227 2.539 10.677 3.061 18.779 1.68c12.805-2.165 22.66-1.979 35.205.597c42.71 8.587 79.893 43.792 96.357 90.982c14.374 41.365 10.304 84.634-11.05 117.712c-3.622 5.6-7.206 10.08-12.432 15.642c-11.238 12.022-11.238 26.955-.038 39.312c18.406 20.123 29.904 69.664 26.432 113.344c-2.314 28.822-9.706 54.619-19.898 69.216a78 78 0 0 1-8.363 9.632a34.2 34.2 0 0 0-7.243 9.334c-2.016 4.069-2.128 4.778-2.128 10.938v6.646l5.526 10.826c9.258 17.77 14.186 30.726 18.592 48.347c9.445 37.632 8.624 75.04-2.203 96.357a32 32 0 0 0-1.643 3.659c0 .224 12.283.336 27.328.336h27.254l.746-2.763l1.344-5.002c.71-2.838 2.128-11.2 3.286-19.264c1.082-8.102 1.082-37.931 0-46.966c-4.107-32.666-11.014-58.613-22.288-83.104c-1.195-2.762-1.98-5.152-1.718-5.264c.299-.186 2.128-2.762 4.032-5.674c14.038-21.243 22.662-47.936 27.03-83.18c1.157-9.706 1.157-51.444 0-60.778c-3.1-24.08-6.795-40.394-12.992-56.933a227 227 0 0 0-12.283-26.133l-1.419-2.39l4.89-7.242c15.009-22.55 23.745-47.115 27.142-76.16a247.3 247.3 0 0 0-.896-50.699a205.8 205.8 0 0 0-35.056-87.323a198.8 198.8 0 0 0-35.466-38.08a302 302 0 0 1-6.944-5.674a25.8 25.8 0 0 1 .858-7.766c7.766-40.581 7.504-91.205-.634-130.778c-7.094-34.496-19.974-61.899-36.587-77.728c-13.216-12.619-26.73-17.995-42.933-16.987c-37.184 2.203-67.2 44.987-78.998 112.373a254 254 0 0 0-3.621 27.104c0 1.344-.261 2.464-.56 2.464a36 36 0 0 1-5.563-2.912A181.33 181.33 0 0 0 512 177.12c-31.061 0-62.981 9.072-91.69 26.059a36 36 0 0 1-5.526 2.912c-.299 0-.56-1.12-.56-2.464a251 251 0 0 0-3.621-27.067c-10.715-60.592-35.355-100.65-68.096-110.768a78.3 78.3 0 0 0-21.84-1.53Zm10.939 52.342c9.259 7.354 19.525 28.336 25.461 51.818c1.12 4.219 2.24 9.11 2.576 10.902c.262 1.754.971 5.674 1.531 8.698c2.501 13.627 3.659 28.374 3.808 46.294l.075 17.733l-4.48 6.533l-4.406 6.646h-10.378c-12.096 0-24.118 1.53-35.616 4.629l-8.886 2.24c-1.232.261-1.418-.112-2.128-5.376a315 315 0 0 1 .598-86.725c4.629-29.419 15.418-56.038 25.984-63.878c2.501-1.866 2.949-1.829 5.861.486m366.8-.448c6.347 4.704 13.365 17.173 18.592 33.152c10.453 31.882 13.44 75.712 7.915 117.413c-.71 5.227-.896 5.637-2.128 5.376l-8.886-2.24a138 138 0 0 0-35.616-4.63h-10.378l-4.443-6.645l-4.443-6.533l.075-17.696c.15-24.976 2.464-44.427 7.99-66.155c5.86-23.258 16.202-44.24 25.386-51.594c2.912-2.315 3.36-2.352 5.936-.448" />
    </svg>
  );
}

function DeepSeekIcon() {
  return (
    <svg aria-hidden="true" className="llm-provider-icon is-wide" fill="none" height="16" viewBox="40 150 940 720" width="23" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M950.592 237.637c-9.483-4.629-13.59 4.219-19.115 8.699-1.904 1.493-3.51 3.36-5.114 5.115-13.888 14.821-30.091 24.528-51.26 23.37-30.948-1.717-57.38 7.99-80.751 31.659-4.965-29.195-21.467-46.592-46.555-57.792-13.141-5.787-26.432-11.61-35.653-24.267-6.421-8.96-8.176-19.002-11.387-28.896-2.053-5.973-4.106-12.058-10.938-13.066-7.467-1.158-10.38 5.077-13.291 10.304-11.685 21.354-16.203 44.874-15.755 68.693 1.008 53.61 23.632 96.32 68.619 126.672 5.115 3.51 6.421 6.981 4.816 12.059-3.061 10.453-6.72 20.645-9.93 31.098-2.054 6.683-5.115 8.139-12.246 5.227a205.3 205.3 0 0 1-64.848-44.016c-31.995-30.912-60.89-65.072-96.955-91.84a448 448 0 0 0-25.722-17.547c-36.774-35.728 4.853-65.072 14.448-68.544 10.08-3.658 3.509-16.165-29.046-15.978-32.554.112-62.346 11.013-100.314 25.573a112 112 0 0 1-17.36 5.077 358.4 358.4 0 0 0-107.632-3.77c-70.374 7.84-126.56 41.066-167.888 97.888-49.654 68.282-61.339 145.861-47.04 226.725 15.045 85.27 58.538 155.867 125.44 211.045 69.328 57.232 149.221 85.27 240.352 79.894 55.328-3.174 116.928-10.603 186.442-69.44 17.547 8.736 35.915 12.245 66.454 14.858 23.482 2.166 46.106-1.157 63.653-4.816 27.44-5.786 25.536-31.21 15.605-35.877-80.453-37.483-62.794-22.213-78.848-34.57 40.88-48.347 103.339-134.326 122.603-251.366 1.867-12.917 4.293-31.136 4.032-41.59-.15-6.383 1.307-8.885 8.587-9.594a156.8 156.8 0 0 0 57.68-17.733c52.154-28.486 73.173-75.264 78.138-131.302.747-8.586-.15-17.434-9.221-21.952M496.32 742.272c-77.952-61.301-115.77-81.499-131.413-80.64-14.56.896-11.947 17.621-8.736 28.485 3.36 10.752 7.728 18.182 13.85 27.627 4.256 6.235 7.168 15.53-4.218 22.512-25.126 15.53-68.768-5.227-70.822-6.272-50.81-29.904-93.333-69.44-123.237-123.424-28.933-52.005-45.733-107.819-48.496-167.328-.747-14.373 3.51-19.488 17.808-22.101a175.5 175.5 0 0 1 57.12-1.419c79.557 11.61 147.317 47.19 204.101 103.563 32.406 32.106 56.934 70.448 82.208 107.893 26.88 39.797 55.776 77.728 92.587 108.827 12.992 10.864 23.37 19.152 33.301 25.274-29.941 3.36-79.893 4.07-114.053-22.96zm37.37-240.427a11.424 11.424 0 0 1 15.494-10.714 11.2 11.2 0 0 1 4.219 2.762 11.2 11.2 0 0 1 3.21 7.99c0 6.346-5.077 11.461-11.498 11.461a11.31 11.31 0 0 1-11.424-11.461m116.106 59.584c-7.466 3.024-14.933 5.637-22.064 5.973a46.67 46.67 0 0 1-29.792-9.483c-10.229-8.586-17.546-13.365-20.57-28.298a63.5 63.5 0 0 1 .56-21.952c2.613-12.208-.262-20.048-8.886-27.142-7.018-5.824-15.904-7.429-25.722-7.429a22.4 22.4 0 0 1-9.483-2.912 9.445 9.445 0 0 1-4.256-13.365 37.3 37.3 0 0 1 7.168-7.84c13.29-7.542 28.635-5.078 42.784.597 13.141 5.376 23.072 15.232 37.37 29.195 14.635 16.837 17.249 21.504 25.574 34.16 6.57 9.856 12.544 20.01 16.65 31.658 2.465 7.243-.746 13.179-9.333 16.8" />
    </svg>
  );
}

function ProviderIcon({ provider, label }: { provider: AgentProvider; label: string }) {
  if (provider === "openai") return <OpenAiIcon />;
  if (provider === "gemini") return <GeminiIcon />;
  if (provider === "xai") return <XaiIcon />;
  if (provider === "deepseek") return <DeepSeekIcon />;
  if (provider === "mistral") return <MistralIcon />;
  if (provider === "groq") return <GroqIcon />;
  if (provider === "ollama") return <OllamaIcon />;
  return <span aria-hidden="true">{label.slice(0, 1)}</span>;
}

function ProviderSection({ provider, entry, loading, onConnected }: {
  provider: AgentProvider; entry?: AgentProviderConfiguration; loading: boolean;
  onConnected: (value: AgentProviderConfig) => void;
}) {
  const label = entry?.label || PROVIDER_OPTIONS[provider]?.label || provider;
  const [key, setKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [phase, setPhase] = useState<"idle" | "checking" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const callback = useRef(onConnected);
  callback.current = onConnected;
  const initialized = useRef(false);
  const pasted = useRef(false);
  const busy = phase === "checking";
  useEffect(() => {
    if (loading || !entry) return;
    const submittedKey = key.trim();
    const refreshSaved = (!initialized.current || retry > 0) && (entry.configured || entry.requiresKey === false) && !submittedKey;
    if (!submittedKey && !refreshSaved) return;
    initialized.current = true;
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const delay = pasted.current ? 0 : 900;
    pasted.current = false;
    const timer = setTimeout(() => {
      setPhase("checking"); setError("");
      void api.connectAgentProvider(provider, submittedKey || undefined).then(value => {
        if (!mounted) return;
        callback.current(value);
        setPhase("ready");
        setKey("");
        setReplacing(false);
      }).catch(reason => {
        if (!mounted) return;
        // Never display upstream bodies or credentials. A failed replacement
        // leaves the previously saved key/model list intact.
        const raw = reason instanceof Error ? reason.message : "";
        const rejected = /rejected|permissions|environment API key|no recommended coding|no supported coding|No local models|Ollama is not running|404|Not Found/i.test(raw);
        setError(/404|Not Found/i.test(raw) ? "This provider is not available in the running session yet. Restart Coloride and try again."
          : /Ollama is not running/i.test(raw) ? "Ollama is not running. Start it and pull a model, then try again."
          : /No local models with tool support/i.test(raw) ? "No local models with tool support are installed. Pull one with Ollama, then try again."
          : /environment API key/i.test(raw) ? "An environment API key is active. Update it in your environment."
          : /no recommended coding|no supported coding/i.test(raw) ? "No supported coding models are available with this key."
          : rejected ? "The provider rejected this key or its model-list permissions."
          : "Could not connect. Retrying automatically; your saved configuration is unchanged.");
        setPhase("error");
        if (!rejected) retryTimer = setTimeout(() => { if (mounted) setRetry(value => value + 1); }, 15000);
      });
    }, submittedKey ? delay : 0);
    return () => { mounted = false; clearTimeout(timer); clearTimeout(retryTimer); };
    // entry updates from other providers must not interrupt an in-flight save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loading, provider, retry]);
  const models = entry?.availableModels || [];
  return <section className="settings-section-group llm-provider-section" data-settings-group={label} id={`settings-group-${label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}>
    <header className="llm-provider-heading">
      <ProviderIcon provider={provider} label={label} />
      <h2>{label}</h2>
      <span className="llm-provider-key-status" data-configured={!!entry?.configured}>{busy ? "Connecting…" : entry?.configured ? (models.length ? "Connected" : entry.requiresKey === false ? "No key required" : "Key saved") : "No API key"}</span>
      {entry?.active && entry.configured && <span className="llm-provider-active">In use</span>}
    </header>
    <div role="group" aria-label={`${label} configuration`}>
      <SettingsRow label={entry?.requiresKey === false ? "Authentication" : "API key"} description={provider === "ollama" ? "Uses the Ollama server on this Mac. No API key is stored." : entry?.requiresKey === false ? "This endpoint requires no API key. Models are discovered automatically." : entry?.configured && !replacing ? `A ${label} key is saved. Change it to load a different account.` : `Paste your ${label} key. Coloride saves it securely and loads compatible coding models automatically.`}>
        {entry?.configured && !replacing && entry.requiresKey !== false && entry.credentialSource !== "environment" ? (
          <button type="button" className="llm-change-key" onClick={() => setReplacing(true)}>Change API key</button>
        ) : (
          <input className="settings-provider-input" aria-label={`${label} API key`} type="password" autoComplete="off" spellCheck={false}
            onPaste={event => {
              const text = event.clipboardData.getData("text");
              if (!text.trim()) return;
              event.preventDefault(); pasted.current = true; setKey(text); setError(""); setPhase("idle");
            }}
            value={key} onChange={event => { setKey(event.target.value); setError(""); setPhase("idle"); }} disabled={loading || !entry || busy || entry.requiresKey === false || entry.credentialSource === "environment"}
            placeholder={entry?.requiresKey === false ? "No API key required" : entry?.credentialSource === "environment" ? "Using environment API key" : "Paste API key"} />
        )}
      </SettingsRow>
      <SettingsRow label="Available models" description="Models available through your API. Model capabilities determine which agent features can be used.">
        <ul className="llm-available-models" aria-label={`${label} available models`}>
          {models.map(model => <li key={model.id}>{model.label}{model.capabilities && !model.capabilities.tools ? " · Ask only" : ""}</li>)}
          {!models.length && <li className="llm-model-empty">{busy ? "Discovering models…" : entry?.configured ? "Waiting for model discovery" : "Add an API key to discover models"}</li>}
        </ul>
      </SettingsRow>
      <div className="llm-provider-feedback" aria-live="polite">
        {busy ? <p role="status">Validating key and discovering models…</p> : error ? <p role="alert">{error}</p>
          : phase === "ready" ? <p role="status">{entry?.requiresKey === false ? "Models updated automatically" : "Saved securely · models updated automatically"}</p> : null}
      </div>
    </div>
  </section>;
}
