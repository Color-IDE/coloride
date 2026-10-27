/**
 * Native-style Windows caption buttons for frameless Electron windows.
 * Shown only on win32 when windowControls IPC is available.
 */
import { useEffect, useState } from "react";

export const isWindowsDesktop = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /Win/i.test(platform) || /Windows/i.test(ua);
};

/** True on Windows Electron — used for layout (no Mac traffic-light inset). */
export function useIsWindowsDesktop() {
  return typeof navigator !== "undefined" && isWindowsDesktop();
}

export function useShowWindowsControls() {
  // Layout/chrome: prefer Windows UA immediately so left controls aren't inset for Mac lights.
  const [show, setShow] = useState(() => isWindowsDesktop());
  useEffect(() => {
    const win = isWindowsDesktop();
    const hasApi = Boolean(window.colorideDesktop?.windowControls);
    // Show caption buttons when API exists; still treat as Windows layout via isWindowsDesktop.
    setShow(win && (hasApi || Boolean(window.colorideDesktop)));
  }, []);
  return show;
}

export function WindowsWindowControls({ className = "" }: { className?: string }) {
  const show = useShowWindowsControls();
  const [maximized, setMaximized] = useState(false);
  const api = typeof window !== "undefined" ? window.colorideDesktop?.windowControls : undefined;

  useEffect(() => {
    if (!api) return;
    const applyMax = (value: boolean) => {
      setMaximized(value);
      document.documentElement.classList.toggle("is-window-maximized", value);
      document.body.classList.toggle("is-window-maximized", value);
    };
    void api.isMaximized().then(applyMax).catch(() => undefined);
    const unsub = api.onMaximizedChange?.(applyMax);
    return () => {
      unsub?.();
      document.documentElement.classList.remove("is-window-maximized");
      document.body.classList.remove("is-window-maximized");
    };
  }, [api]);

  if (!show || !api) return null;

  return (
    <div
      className={`windows-window-controls flex h-full shrink-0 items-stretch [-webkit-app-region:no-drag] ${className}`}
      role="group"
      aria-label="Window controls"
    >
      <button
        aria-label="Minimize"
        className="windows-caption-btn"
        onClick={() => void api.minimize()}
        type="button"
        title="Minimize"
      >
        <MinimizeIcon />
      </button>
      <button
        aria-label={maximized ? "Restore" : "Maximize"}
        className="windows-caption-btn"
        onClick={() => void api.toggleMaximize().then(setMaximized).catch(() => undefined)}
        type="button"
        title={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        aria-label="Close"
        className="windows-caption-btn is-close"
        onClick={() => void api.close()}
        type="button"
        title="Close"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function MinimizeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none">
      <path d="M1.5 6h9" stroke="currentColor" strokeWidth="1.15" strokeLinecap="square" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none">
      <rect x="1.75" y="1.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none">
      <path d="M3.5 3.5h5.25V8.75" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="miter" />
      <rect x="1.75" y="3.25" width="6.5" height="6.5" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none">
      <path d="M1.8 1.8l8.4 8.4M10.2 1.8l-8.4 8.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="square" />
    </svg>
  );
}
