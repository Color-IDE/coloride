import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { ColorideMark } from "../../shared/ui/ColorideBrand";
import { isWindowsDesktop, WindowsWindowControls } from "../../shared/ui/WindowsWindowControls";
import {
  type PermissionMode,
  type ThemePreference,
  updateAppPreference,
  useAppPreferences,
} from "../settings/preferences";
import {
  setDefaultAgentAccessLevel,
  useDefaultAgentAccessLevel,
  type AgentAccessLevel,
} from "../settings/agentAccess";
import requestApprovalPreview from "../../shared/assets/onboarding/request-approval.jpg";
import agentDecidesPreview from "../../shared/assets/onboarding/agent-decides.jpg";
import fullAccessPreview from "../../shared/assets/onboarding/full-access.jpg";

/** First-run onboarding (agent access + theme). Off for now; set true to restore. */
export const ONBOARDING_FLOW_ENABLED = false;

const permissionModeForAccess = (access: AgentAccessLevel): PermissionMode =>
  access === "full" ? "read-write" : "confirm-changes";

const ACCENTS = ["#4ebdff", "#7c6cff", "#e56b8c", "#e59a4d", "#43b581"];

const ONBOARDING_PREVIEWS = [
  requestApprovalPreview,
  agentDecidesPreview,
  fullAccessPreview,
] as const;

function decodePreview(source: string) {
  return new Promise<void>((resolve) => {
    const preview = new Image();
    const finish = () => resolve();
    const timeout = window.setTimeout(finish, 2500);
    preview.decoding = "async";
    preview.onload = () => {
      const decoded = preview.decode?.();
      if (decoded && typeof decoded.then === "function") {
        void decoded
          .then(() => {
            window.clearTimeout(timeout);
            finish();
          })
          .catch(() => {
            window.clearTimeout(timeout);
            finish();
          });
        return;
      }
      window.clearTimeout(timeout);
      finish();
    };
    preview.onerror = () => {
      window.clearTimeout(timeout);
      finish();
    };
    preview.src = source;
  });
}

const previewsReadyPromise =
  typeof window === "undefined"
    ? Promise.resolve()
    : Promise.all(ONBOARDING_PREVIEWS.map(decodePreview)).then(() => undefined);

export function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const preferences = useAppPreferences();
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [previewsReady, setPreviewsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void previewsReadyPromise.finally(() => {
      if (!cancelled) setPreviewsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const storedAccess = useDefaultAgentAccessLevel();
  const [access, setAccess] = useState<AgentAccessLevel>(storedAccess);

  const finish = () => {
    setDefaultAgentAccessLevel(access);
    // Agent autonomy and the editor's write setting are separate controls, but
    // the onboarding choice must not leave Full access in a read-only editor.
    updateAppPreference("permissionMode", permissionModeForAccess(access));
    onComplete();
  };

  const continueToNext = () => {
    if (step === 1) finish();
    else {
      const nextStep = step + 1;
      setFurthestStep((current) => Math.max(current, nextStep));
      setStep(nextStep);
    }
  };

  const goForward = () => {
    if (step < furthestStep) setStep((current) => current + 1);
  };

  if (!previewsReady) {
    return (
      <div className="onboarding-shell onboarding-shell-loading fixed inset-0 z-[1000] flex flex-col bg-[#171717]" aria-busy="true" aria-label="Loading">
        <OnboardingWindowChrome />
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="login-gate-boot-mark" aria-hidden="true">
            <ColorideMark className="h-full w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="onboarding-shell fixed inset-0 z-[1000] flex items-center justify-center bg-[#171717] p-6">
      <OnboardingWindowChrome>
        <button aria-label="Back" className="onboarding-navigation-button" disabled={step === 0} onClick={() => setStep((current) => current - 1)} title={step === 0 ? undefined : "Back"} type="button">
          <OnboardingBackIcon />
        </button>
        <button aria-label="Go forward" className="onboarding-navigation-button" disabled={step >= furthestStep} onClick={goForward} title={step < furthestStep ? "Go forward" : undefined} type="button">
          <OnboardingForwardIcon />
        </button>
      </OnboardingWindowChrome>
      <motion.section
        animate={{ opacity: 1, y: 0 }}
        className="onboarding-flow flex w-full max-w-[760px] flex-col"
        initial={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {step === 0 ? (
          <OnboardingStep title="How should the agent work?" description="The agent always works inside a Coloride folder on the server. Choose how much it may do on its own.">
            <div className="onboarding-agent-layout">
              <div className="onboarding-agent-options">
                <AgentBehaviorOption active={access === "request"} description="Ask before changing files or running commands." onClick={() => setAccess("request")} title="Request approval" />
                <AgentBehaviorOption active={access === "agent"} description="Handle routine file changes; ask before commands." onClick={() => setAccess("agent")} title="Agent decides" />
                <AgentBehaviorOption active={access === "full"} description="Work automatically inside the Coloride folder." onClick={() => setAccess("full")} title="Full access" />
              </div>
              <AgentBehaviorPreview access={access} />
            </div>
          </OnboardingStep>
        ) : null}

        {step === 1 ? (
          <OnboardingStep title="Make Coloride yours" description="Your preferences apply immediately and can be changed later.">
            <div>
              <div className="mb-3 text-sm font-medium text-[#f0f0f2]">Theme</div>
              <div aria-label="Application theme" className="onboarding-theme-options grid grid-cols-3 gap-3" role="radiogroup">
                <OnboardingThemePreview label="System" mode="system" selected={preferences.theme === "system"} />
                <OnboardingThemePreview label="Light" mode="light" selected={preferences.theme === "light"} />
                <OnboardingThemePreview label="Dark" mode="dark" selected={preferences.theme === "dark"} />
              </div>
            </div>
            <div className="onboarding-setting mt-3 rounded-2xl border border-white/[0.08] bg-[#212121] p-4">
              <div className="text-sm font-medium text-[#f0f0f2]">Accent</div>
              <div className="mt-3 flex items-center gap-3">
                {ACCENTS.map((accent) => (
                  <button aria-label={`Use ${accent} accent`} className={`onboarding-accent size-7 rounded-full ${preferences.accentColor === accent ? "is-selected" : ""}`} key={accent} onClick={() => updateAppPreference("accentColor", accent)} style={{ background: accent }} type="button" />
                ))}
              </div>
            </div>
          </OnboardingStep>
        ) : null}

        <div className="mt-9 flex justify-end">
          <button autoFocus className="onboarding-continue h-8 min-w-[122px] rounded-[10px] border border-[#f4f4f5] bg-[#f4f4f5] px-4 text-[13px] font-medium text-[#0b0b0c] transition-[filter,transform] hover:brightness-95 active:scale-[0.99]" onClick={continueToNext} type="button">
            {step === 1 ? "Start using Coloride" : "Continue"}
          </button>
        </div>
      </motion.section>
    </main>
  );
}

function OnboardingWindowChrome({ children }: { children?: ReactNode }) {
  const isWin = isWindowsDesktop();
  return (
    <header className="onboarding-chrome">
      <div className={`onboarding-navigation ${isWin ? "is-windows" : "is-mac"}`}>
        {children}
      </div>
      {isWin ? <WindowsWindowControls /> : null}
    </header>
  );
}

function OnboardingStep({ children, description, title }: { children: ReactNode; description: string; title: string }) {
  return <div><h1 className="text-[28px] font-medium tracking-[-0.035em] text-[#f5f4f0]">{title}</h1><p className="mt-2 max-w-[420px] text-[14px] leading-6 text-[#929297]">{description}</p><div className="mt-7">{children}</div></div>;
}

function AgentBehaviorOption({ active, description, onClick, title }: { active: boolean; description: string; onClick: () => void; title: string }) {
  return <button aria-pressed={active} className={`onboarding-agent-option ${active ? "is-selected" : ""}`} onClick={onClick} type="button"><span className="min-w-0 flex-1 text-left"><span className="block text-sm font-medium text-[#f1f1f2]">{title}</span><span className="mt-1 block text-xs leading-5 text-[#99999f]">{description}</span></span></button>;
}

function AgentBehaviorPreview({ access }: { access: AgentAccessLevel }) {
  const previews: Array<[AgentAccessLevel, string]> = [["request", requestApprovalPreview], ["agent", agentDecidesPreview], ["full", fullAccessPreview]];
  return (
    <div className="onboarding-agent-preview" aria-hidden="true">
      {previews.map(([mode, image]) => (
        <motion.img
          animate={mode === access ? { opacity: 1 } : { opacity: 0 }}
          alt=""
          decoding="async"
          key={mode}
          src={image}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </div>
  );
}

function OnboardingThemePreview({ label, mode, selected }: { label: string; mode: ThemePreference; selected: boolean }) {
  const light = mode === "light";
  const split = mode === "system";
  return <button aria-checked={selected} aria-label={`${label} theme`} className="appearance-theme-option group relative min-w-0 text-left active:scale-[0.99]" data-mode={mode} data-selected={selected} onClick={() => updateAppPreference("theme", mode)} role="radio" type="button"><span className={`appearance-theme-preview relative block aspect-[1.45/1] overflow-hidden rounded-xl border transition-colors ${selected ? "border-[#9a9a9f]" : "border-[#3b3b3b]"} ${light ? "bg-[#ededed]" : "bg-[#2b2b2b]"}`}>{split ? <span className="theme-preview-split absolute inset-y-0 left-0 w-1/2 bg-[#dedede]" /> : null}<span className={`theme-preview-header absolute left-[13%] right-[13%] top-[24%] h-2 rounded-full ${light ? "bg-[#c8c8c8]" : "bg-[#727272]"}`} /><span className={`theme-preview-panel absolute bottom-0 left-[9%] right-[9%] h-[52%] rounded-t-lg ${light ? "bg-white" : "bg-[#171717]"}`} /><span className={`theme-preview-line-primary absolute bottom-[31%] left-[15%] h-2 w-[28%] rounded-full ${light ? "bg-[#d8d8d8]" : "bg-[#555]"}`} /><span className={`theme-preview-line-secondary absolute bottom-[17%] left-[15%] h-1.5 w-[50%] rounded-full ${light ? "bg-[#e5e5e5]" : "bg-[#3f3f3f]"}`} />{selected ? <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-[var(--accent-color)] text-[11px] font-bold text-[#10202b]">✓</span> : null}</span><span className={`appearance-theme-label mt-1.5 block text-center text-xs ${selected ? "text-white" : "text-[#a0a0a5]"}`}>{label}</span></button>;
}

function OnboardingBackIcon() {
  return <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M5.5 12.002H19" /><path d="M10.9999 18.002C10.9999 18.002 4.99998 13.583 4.99997 12.0019C4.99996 10.4208 11 6.00195 11 6.00195" /></svg>;
}

function OnboardingForwardIcon() {
  return <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M18.5 12H4.99997" /><path d="M13 18C13 18 19 13.5811 19 12C19 10.4188 13 6 13 6" /></svg>;
}
