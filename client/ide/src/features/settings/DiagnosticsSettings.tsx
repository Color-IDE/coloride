import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api/client";
import { SettingsGroup, SettingsRow } from "./SettingsControls";
import { useResolvedTheme } from "./preferences";

type CheckStatus = "checking" | "ok" | "warning" | "error";

interface DiagnosticCheck {
  detail: string;
  label: string;
  status: CheckStatus;
}

const initialChecks: DiagnosticCheck[] = [
  { label: "Desktop integration", detail: "Not checked", status: "checking" },
  { label: "Local sidecar", detail: "Not checked", status: "checking" },
  { label: "Local storage", detail: "Not checked", status: "checking" },
  { label: "Notifications", detail: "Not checked", status: "checking" },
];

export function DiagnosticsSettings() {
  const theme = useResolvedTheme();
  const [checks, setChecks] = useState(initialChecks);
  const [appInfo, setAppInfo] = useState<ColorideAppInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const runDiagnostics = useCallback(async () => {
    setRunning(true);
    setCopied(false);
    setChecks(initialChecks);

    const bridge = window.colorideDesktop;
    const desktopCheck: DiagnosticCheck = bridge
      ? {
          label: "Desktop integration",
          detail: "Electron bridge available",
          status: "ok",
        }
      : {
          label: "Desktop integration",
          detail: "Running outside the desktop shell",
          status: "warning",
        };

    let nextAppInfo: ColorideAppInfo | null = null;
    if (bridge?.getAppInfo) {
      try {
        nextAppInfo = await bridge.getAppInfo();
      } catch {}
    }
    setAppInfo(nextAppInfo);

    let sidecarCheck: DiagnosticCheck;
    try {
      const health = await api.health();
      sidecarCheck =
        health.status === "ok"
          ? {
              label: "Local sidecar",
              detail: "API responding normally",
              status: "ok",
            }
          : {
              label: "Local sidecar",
              detail: `Unexpected status: ${health.status}`,
              status: "warning",
            };
    } catch (error) {
      sidecarCheck = {
        label: "Local sidecar",
        detail:
          error instanceof Error
            ? sanitizeError(error.message)
            : "API unavailable",
        status: "error",
      };
    }

    let storageCheck: DiagnosticCheck;
    try {
      const probeKey = "coloride.diagnostics.storage-probe";
      window.localStorage.setItem(probeKey, "ok");
      const available = window.localStorage.getItem(probeKey) === "ok";
      window.localStorage.removeItem(probeKey);
      storageCheck = available
        ? {
            label: "Local storage",
            detail: "Read and write available",
            status: "ok",
          }
        : {
            label: "Local storage",
            detail: "Stored value could not be read",
            status: "error",
          };
    } catch {
      storageCheck = {
        label: "Local storage",
        detail: "Browser storage is unavailable",
        status: "error",
      };
    }

    const notificationPermission =
      typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission;
    const notificationCheck: DiagnosticCheck =
      notificationPermission === "granted"
        ? { label: "Notifications", detail: "Permission granted", status: "ok" }
        : notificationPermission === "denied"
          ? {
              label: "Notifications",
              detail: "Permission denied",
              status: "warning",
            }
          : notificationPermission === "default"
            ? {
                label: "Notifications",
                detail: "Permission not requested",
                status: "warning",
              }
            : {
                label: "Notifications",
                detail: "Not supported by this runtime",
                status: "warning",
              };

    setChecks([desktopCheck, sidecarCheck, storageCheck, notificationCheck]);
    setLastRunAt(new Date().toISOString());
    setRunning(false);
  }, []);

  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  const report = useMemo(
    () => buildReport({ appInfo, checks, lastRunAt, theme }),
    [appInfo, checks, lastRunAt, theme],
  );

  return (
    <div className="settings-diagnostics mt-6 pb-8">
      <SettingsGroup title="System checks">
        {checks.map((check) => (
          <SettingsRow
            description={check.detail}
            key={check.label}
            label={check.label}
          >
            <DiagnosticStatus status={running ? "checking" : check.status} />
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Runtime">
        <SettingsRow
          description="The Coloride desktop version included in this diagnostic report."
          label="Application"
        >
          <DiagnosticValue>
            {appInfo ? `Coloride ${appInfo.version}` : "Unavailable"}
          </DiagnosticValue>
        </SettingsRow>
        <SettingsRow
          description="The operating system and processor architecture of this build."
          label="Platform"
        >
          <DiagnosticValue>
            {appInfo
              ? `${formatPlatform(appInfo.platform)} · ${appInfo.arch}`
              : "Unavailable"}
          </DiagnosticValue>
        </SettingsRow>
        <SettingsRow
          description="Embedded runtime versions used by the desktop application."
          label="Runtime versions"
        >
          <DiagnosticValue>
            {appInfo
              ? `Electron ${appInfo.electronVersion} · Chrome ${appInfo.chromeVersion}`
              : "Unavailable"}
          </DiagnosticValue>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Diagnostic report">
        <SettingsRow
          description="Run all checks again. This does not connect to your VPS or read workspace files."
          label="Refresh checks"
        >
          <button
            className="settings-action-button h-7 rounded-lg bg-[#2c2c2c] px-2.5 text-xs font-medium text-[#d0d0d3] transition-colors hover:bg-[#353535] hover:text-white disabled:cursor-wait disabled:opacity-50"
            disabled={running}
            onClick={() => void runDiagnostics()}
            type="button"
          >
            {running ? "Running..." : "Run diagnostics"}
          </button>
        </SettingsRow>
        <SettingsRow
          description="Copy a sanitized report without passwords, tokens, hostnames, file paths or terminal output."
          label="Copy report"
        >
          <div className="flex items-center gap-2">
            {copied && (
              <span className="diagnostics-copy-success text-xs font-medium text-[#65bc89]">
                Copied
              </span>
            )}
            <button
              className="settings-action-button h-7 rounded-lg bg-[#2c2c2c] px-2.5 text-xs font-medium text-[#d0d0d3] transition-colors hover:bg-[#353535] hover:text-white"
              onClick={async () => {
                await navigator.clipboard.writeText(report);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2_000);
              }}
              type="button"
            >
              Copy diagnostic report
            </button>
          </div>
        </SettingsRow>
        {lastRunAt && (
          <p className="diagnostics-last-run -mt-1 pb-2 text-right text-[11px] text-[#77777c]">
            Last run {formatDate(lastRunAt)}
          </p>
        )}
      </SettingsGroup>
    </div>
  );
}

function DiagnosticStatus({ status }: { status: CheckStatus }) {
  const labels: Record<CheckStatus, string> = {
    checking: "Checking",
    ok: "Passed",
    warning: "Attention",
    error: "Failed",
  };
  return (
    <span
      className="diagnostics-status inline-flex h-7 items-center rounded-lg bg-[#2c2c2c] px-2.5 text-xs font-medium"
      data-status={status}
    >
      {labels[status]}
    </span>
  );
}

function DiagnosticValue({ children }: { children: string }) {
  return (
    <span className="diagnostics-value text-right text-xs font-medium text-[#d8d8db]">
      {children}
    </span>
  );
}

function sanitizeError(message: string) {
  return message
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/token=[^&\s]+/gi, "token=[redacted]")
    .replace(/https?:\/\/[^\s/]+/gi, "[local service]")
    .slice(0, 180);
}

function buildReport({
  appInfo,
  checks,
  lastRunAt,
  theme,
}: {
  appInfo: ColorideAppInfo | null;
  checks: DiagnosticCheck[];
  lastRunAt: string | null;
  theme: "light" | "dark";
}) {
  return [
    "Coloride diagnostic report",
    `Generated: ${lastRunAt ?? new Date().toISOString()}`,
    `Version: ${appInfo?.version ?? "unavailable"}`,
    `Platform: ${appInfo ? `${appInfo.platform}/${appInfo.arch}` : "unavailable"}`,
    `Packaged: ${appInfo?.packaged ?? false}`,
    `Electron: ${appInfo?.electronVersion ?? "unavailable"}`,
    `Chrome: ${appInfo?.chromeVersion ?? "unavailable"}`,
    `Node: ${appInfo?.nodeVersion ?? "unavailable"}`,
    `Theme: ${theme}`,
    "",
    ...checks.map(
      (check) => `${check.label}: ${check.status} - ${check.detail}`,
    ),
    "",
    "Excluded: credentials, server identity, file paths, file contents and terminal output.",
  ].join("\n");
}

function formatPlatform(platform: string) {
  return (
    (
      { darwin: "macOS", linux: "Linux", win32: "Windows" } as Record<
        string,
        string
      >
    )[platform] ?? platform
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
