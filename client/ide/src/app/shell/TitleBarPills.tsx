/**
 * Top-right title bar action pills.
 * Plug new chips into `TitleBarPills` — they stack left of the avatar.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { openPricingPage } from "../../features/auth/llmCredits";
import { useAppPreferences } from "../../features/settings/preferences";
import {
  checkForUpdates,
  downloadUpdate,
  refreshUpdateStateFromMain,
  useUpdateState,
} from "../../features/settings/updates";

export type TitleBarPillTone = "neutral" | "accent" | "success" | "warning" | "pro";

export type TitleBarPillModel = {
  id: string;
  label: string;
  /** Optional trailing glyph (e.g. →). */
  trailing?: ReactNode;
  /** Leading icon. */
  leading?: ReactNode;
  tone?: TitleBarPillTone;
  title?: string;
  busy?: boolean;
  onClick?: () => void;
};

type TitleBarPillsProps = {
  /** Extra pills from the host (account upgrade, etc.). Rendered after system pills. */
  extra?: TitleBarPillModel[];
};

export function TitleBarPills({ extra = [] }: TitleBarPillsProps) {
  const updatePill = useUpdatePill();
  const pills = [...(updatePill ? [updatePill] : []), ...extra];

  if (!pills.length) return null;

  return (
    <div className="titlebar-pills flex h-full items-center gap-1.5">
      <AnimatePresence initial={false} mode="popLayout">
        {pills.map((pill) => (
          <motion.div
            animate={{ opacity: 1, scale: 1, x: 0 }}
            className="flex"
            exit={{ opacity: 0, scale: 0.92, x: 6 }}
            initial={{ opacity: 0, scale: 0.92, x: 6 }}
            key={pill.id}
            layout
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <TitleBarPillButton pill={pill} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function TitleBarPillButton({ pill }: { pill: TitleBarPillModel }) {
  const tone = pill.tone ?? "neutral";
  const interactive = Boolean(pill.onClick) && !pill.busy;
  const className = [
    "titlebar-pill",
    `titlebar-pill--${tone}`,
    interactive ? "is-interactive" : "",
    pill.busy ? "is-busy" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      aria-busy={pill.busy || undefined}
      aria-label={pill.title || pill.label}
      className={className}
      disabled={!interactive}
      onClick={() => pill.onClick?.()}
      title={pill.title || pill.label}
      type="button"
    >
      {pill.leading ? <span className="titlebar-pill-leading">{pill.leading}</span> : null}
      <span className="titlebar-pill-label">{pill.label}</span>
      {pill.trailing ? <span className="titlebar-pill-trailing">{pill.trailing}</span> : null}
    </button>
  );
}

/** Build the update pill from electron-updater state; auto-downloads when available. */
function useUpdatePill(): TitleBarPillModel | null {
  const preferences = useAppPreferences();
  const updateState = useUpdateState();
  const autoDownloadStarted = useRef(false);

  useEffect(() => {
    void refreshUpdateStateFromMain();
  }, []);

  // When a packaged update is available, start the download once.
  useEffect(() => {
    const status = updateState.status;
    const auto = updateState.autoUpdateEnabled || Boolean(updateState.result?.autoUpdateEnabled);
    if (!auto) return;
    if (status !== "available") {
      if (status === "downloaded" || status === "idle" || status === "not-available") {
        autoDownloadStarted.current = false;
      }
      return;
    }
    if (autoDownloadStarted.current) return;
    autoDownloadStarted.current = true;
    void downloadUpdate().catch(() => {
      autoDownloadStarted.current = false;
    });
  }, [updateState.autoUpdateEnabled, updateState.result?.autoUpdateEnabled, updateState.status]);

  // Background check on mount; it never renders a transient progress state.
  useEffect(() => {
    if (!preferences.checkForUpdatesAutomatically) return;
    const t = window.setTimeout(() => {
      void checkForUpdates(preferences.updateChannel).catch(() => undefined);
    }, 4_000);
    return () => window.clearTimeout(t);
  }, [preferences.checkForUpdatesAutomatically, preferences.updateChannel]);

  // Update activity is intentionally silent. Settings exposes only settled state.
  return null;
}

/** Free-plan upgrade chip for the title bar slot. */
export function buildUpgradeProPill(show: boolean): TitleBarPillModel | null {
  if (!show) return null;
  return {
    id: "upgrade-pro",
    label: "Upgrade Pro",
    leading: <UpgradeSparkleIcon />,
    tone: "pro",
    title: "Upgrade to Pro",
    onClick: () => openPricingPage(),
  };
}

function UpgradeSparkleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d="M3 12C7.5 12 12 7.5 12 3C12 7.5 16.5 12 21 12C16.5 12 12 16.5 12 21C12 16.5 7.5 12 3 12Z" />
      <path d="M2 19.5C2.83333 19.5 4.5 17.8333 4.5 17C4.5 17.8333 6.16667 19.5 7 19.5C6.16667 19.5 4.5 21.1667 4.5 22C4.5 21.1667 2.83333 19.5 2 19.5Z" />
      <path d="M16 5C17 5 19 3 19 2C19 3 21 5 22 5C21 5 19 7 19 8C19 7 17 5 16 5Z" />
    </svg>
  );
}
