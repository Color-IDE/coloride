import {
  Alert02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "../../shared/ui/Icon";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../shared/api/client";
import { applyBrowserProxy } from "./browserProxy";

type IconProps = { className?: string; size?: number };

function IconBack({ className, size = 16 }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M5.5 12.002H19" />
      <path d="M10.9999 18.002C10.9999 18.002 4.99998 13.583 4.99997 12.0019C4.99996 10.4208 11 6.00195 11 6.00195" />
    </svg>
  );
}

function IconForward({ className, size = 16 }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M18.5 12L4.99997 12" />
      <path d="M13 18C13 18 19 13.5811 19 12C19 10.4188 13 6 13 6" />
    </svg>
  );
}

function IconReload({ className, size = 16 }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M15.1667 0.999756L15.7646 2.11753C16.1689 2.87322 16.371 3.25107 16.2374 3.41289C16.1037 3.57471 15.6635 3.44402 14.7831 3.18264C13.9029 2.92131 12.9684 2.78071 12 2.78071C6.75329 2.78071 2.5 6.90822 2.5 11.9998C2.5 13.6789 2.96262 15.2533 3.77093 16.6093M8.83333 22.9998L8.23536 21.882C7.83108 21.1263 7.62894 20.7484 7.7626 20.5866C7.89627 20.4248 8.33649 20.5555 9.21689 20.8169C10.0971 21.0782 11.0316 21.2188 12 21.2188C17.2467 21.2188 21.5 17.0913 21.5 11.9998C21.5 10.3206 21.0374 8.74623 20.2291 7.39023" />
    </svg>
  );
}

function IconExternal({ className, size = 16 }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M11.1004 3.00208C7.4515 3.00864 5.54073 3.09822 4.31962 4.31931C3.00183 5.63706 3.00183 7.75796 3.00183 11.9997C3.00183 16.2415 3.00183 18.3624 4.31962 19.6801C5.6374 20.9979 7.75836 20.9979 12.0003 20.9979C16.2421 20.9979 18.3631 20.9979 19.6809 19.6801C20.902 18.4591 20.9916 16.5484 20.9982 12.8996" />
      <path d="M20.4803 3.51751L14.931 9.0515M20.4803 3.51751C19.9863 3.023 16.6587 3.0691 15.9552 3.0791M20.4803 3.51751C20.9742 4.01202 20.9282 7.34329 20.9182 8.04754" />
    </svg>
  );
}

/** Expand browser to fill the agent workspace (corners out). */
function IconExpand({ className, size = 16 }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M15.5 21C16.8956 21 17.5933 21 18.1611 20.8278C19.4395 20.44 20.44 19.4395 20.8278 18.1611C21 17.5933 21 16.8956 21 15.5M21 8.5C21 7.10444 21 6.40666 20.8278 5.83886C20.44 4.56046 19.4395 3.56004 18.1611 3.17224C17.5933 3 16.8956 3 15.5 3M8.5 21C7.10444 21 6.40666 21 5.83886 20.8278C4.56046 20.44 3.56004 19.4395 3.17224 18.1611C3 17.5933 3 16.8956 3 15.5M3 8.5C3 7.10444 3 6.40666 3.17224 5.83886C3.56004 4.56046 4.56046 3.56004 5.83886 3.17224C6.40666 3 7.10444 3 8.5 3" />
    </svg>
  );
}

/** Collapse browser back beside chat (corners in). */
function IconCollapse({ className, size = 16 }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-hidden
    >
      <path d="M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z" />
      <path
        d="M11.0167 11.0167C11.5915 10.4419 11.4959 8 11.4959 8M11.0167 11.0167C10.4419 11.5915 8 11.4958 8 11.4958M11.0167 11.0167L7 7M12.9869 12.9868C13.5617 12.412 16.0036 12.5077 16.0036 12.5077M12.9869 12.9868C12.4121 13.5616 12.5078 16.0035 12.5078 16.0035M12.9869 12.9868L17 16.9999"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Return browser from separate window into Coloride (inverse of external arrow). */
function IconDock({ className, size = 16 }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12.8996 20.9979C16.5484 20.9913 18.4591 20.9017 19.6801 19.6806C20.9979 18.3629 20.9979 16.242 20.9979 12.0002C20.9979 7.75844 20.9979 5.63748 19.6801 4.3197C18.3624 3.00191 16.2414 3.00191 11.9997 3.00191C7.75786 3.00191 5.6369 3.00191 4.31912 4.3197C3.09802 5.54075 3.00844 7.45152 3.00188 11.1003" />
      <path d="M3.5197 20.4825L9.069 14.9485M3.5197 20.4825C4.01372 20.977 7.34129 20.9309 8.04478 20.9209M3.5197 20.4825C3.02568 19.988 3.07178 16.6567 3.08178 15.9525" />
    </svg>
  );
}

export type BrowserTabState = {
  /** Stable id for the embed (and legacy remote session id). */
  browserId: string;
  url: string;
  title: string;
  /** @deprecated JPEG path removed — kept optional so old state doesn't break. */
  imageUrl?: string | null;
  loading: boolean;
  error: string;
  /**
   * Bumped when the parent wants a navigation (chat link / agent browser_open).
   * BrowserPane watches this so an already-open embed navigates without remount.
   */
  navToken?: number;
};

type BrowserPaneProps = {
  tab: BrowserTabState;
  /** Local folders use this computer; SSH keeps VPS SOCKS. */
  workspaceKind?: "local" | "ssh";
  onUpdate: (next: Partial<BrowserTabState>) => void;
  /**
   * When true, fully hide the native Electron WebContentsView overlay so HTML UI
   * can receive clicks. Prefer keeping menus in the HTML tab bar instead.
   */
  overlaySuspended?: boolean;
  /** Whether the browser currently fills the agent workspace (beside chat collapsed). */
  expanded?: boolean;
  /** Toggle expanded layout. When omitted the expand control is hidden. */
  onToggleExpanded?: () => void;
};

type EmbedBounds = { x: number; y: number; width: number; height: number };

type EmbedEvent = {
  tabId: string;
  type: string;
  loading?: boolean;
  url?: string;
  title?: string;
  message?: string;
};

function hasEmbedBridge(): boolean {
  return Boolean(window.colorideDesktop?.browserEmbed?.open);
}

/**
 * Normalize address-bar input.
 * Loopback (localhost / 127.0.0.1 / ::1) defaults to http — most local dev
 * servers of any stack skip TLS. Bare public hosts default to https.
 * Stack-agnostic: any process listening on the VPS (web, API docs, admin UI…).
 */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  let withScheme = trimmed;
  if (!/^https?:\/\//i.test(withScheme)) {
    // localhost:PORT → http (not https). Real domains → https.
    if (/^(localhost|127\.0\.0\.1|\[?::1\]?)(:|\/|$)/i.test(withScheme)) {
      withScheme = `http://${withScheme}`;
    } else {
      withScheme = `https://${withScheme}`;
    }
  }

  // Local dev rarely speaks TLS on loopback. Force http so a pasted
  // https://localhost:PORT does not black-screen (any language/framework).
  try {
    const parsed = new URL(withScheme);
    const host = parsed.hostname.toLowerCase();
    if (
      (host === "localhost" || host === "127.0.0.1" || host === "::1") &&
      parsed.protocol === "https:"
    ) {
      parsed.protocol = "http:";
      return parsed.toString();
    }
  } catch {
    // keep withScheme
  }
  return withScheme;
}

function isLoopbackUrl(raw: string): boolean {
  try {
    const host = new URL(normalizeUrl(raw) || raw).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[?::1\]?)/i.test(String(raw || ""));
  }
}

/** Hide internal blank targets from the address bar. */
function displayUrl(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (/^about:blank\/?$/i.test(trimmed)) return "";
  // Idle dark blank document from Electron — keep the address bar empty.
  if (
    /^data:text\/html/i.test(trimmed) &&
    (/background:\s*#1e1e1e/i.test(trimmed) || /background%3a(%20)?%231e1e1e/i.test(trimmed))
  ) {
    return "";
  }
  return trimmed;
}

export function BrowserPane({
  tab,
  workspaceKind = "ssh",
  onUpdate,
  overlaySuspended = false,
  expanded = false,
  onToggleExpanded,
}: BrowserPaneProps) {
  const [urlDraft, setUrlDraft] = useState(tab.url);
  const [ready, setReady] = useState(false);
  /** True while the native embed lives in a separate OS window. */
  const [poppedOut, setPoppedOut] = useState(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const lastBoundsRef = useRef<EmbedBounds | null>(null);
  const boundsRafRef = useRef<number | null>(null);
  const overlaySuspendedRef = useRef(overlaySuspended);
  const poppedOutRef = useRef(false);
  onUpdateRef.current = onUpdate;
  overlaySuspendedRef.current = overlaySuspended;
  poppedOutRef.current = poppedOut;
  const tabId = tab.browserId;
  const embed = hasEmbedBridge();

  useEffect(() => {
    setUrlDraft(displayUrl(tab.url));
  }, [tab.url]);

  const lastNavTokenRef = useRef(tab.navToken ?? 0);

  const measureBounds = useCallback((): EmbedBounds | null => {
    const el = surfaceRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    // Skip unsettled layout (0-size during panel animations / first paint).
    if (rect.width < 2 || rect.height < 2) return null;
    // Electron WebContentsView.setBounds uses CSS DIP coords (same as getBoundingClientRect).
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  }, []);

  const boundsEqual = (a: EmbedBounds | null, b: EmbedBounds | null) =>
    Boolean(
      a &&
        b &&
        a.x === b.x &&
        a.y === b.y &&
        a.width === b.width &&
        a.height === b.height,
    );

  const pushBounds = useCallback(
    async (visible = true, force = false) => {
      if (!embed || !tabId || !window.colorideDesktop?.browserEmbed) return;
      // Popped-out embeds live in their own window — main pane must not steal them.
      if (poppedOutRef.current) return;
      // Native WebContentsView paints above all HTML — never show while suspended.
      const wantVisible = visible && !overlaySuspendedRef.current;
      if (!wantVisible) {
        try {
          await window.colorideDesktop.browserEmbed.hide({ tabId });
        } catch {
          // ignore
        }
        return;
      }
      const bounds = measureBounds();
      if (!bounds) return;
      if (!force && boundsEqual(lastBoundsRef.current, bounds)) return;
      lastBoundsRef.current = bounds;
      try {
        await window.colorideDesktop.browserEmbed.setBounds({
          tabId,
          bounds,
          visible: true,
        });
      } catch {
        // ignore layout races while unmounting
      }
    },
    [embed, measureBounds, tabId],
  );

  // Dropdowns / menus / app-tab switches suspend the native embed.
  useEffect(() => {
    if (!embed || !tabId || !ready || poppedOut) return;
    if (overlaySuspended) {
      void window.colorideDesktop?.browserEmbed?.hide({ tabId });
      return;
    }
    // Restore after suspend. Parent may still be finishing layout (invisible →
    // visible app tab), so retry bounds a few times until the surface has size.
    lastBoundsRef.current = null;
    void pushBounds(true, true);
    const timers = [40, 120, 280, 500].map((ms) =>
      window.setTimeout(() => {
        lastBoundsRef.current = null;
        void pushBounds(true, true);
      }, ms),
    );
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [embed, overlaySuspended, poppedOut, pushBounds, ready, tabId]);

  // Full-screen toggle animates flex layout — re-measure after the transition settles.
  useEffect(() => {
    if (!embed || !tabId || !ready || overlaySuspended || poppedOut) return;
    lastBoundsRef.current = null;
    void pushBounds(true, true);
    const t1 = window.setTimeout(() => {
      lastBoundsRef.current = null;
      void pushBounds(true, true);
    }, 80);
    const t2 = window.setTimeout(() => {
      lastBoundsRef.current = null;
      void pushBounds(true, true);
    }, 220);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [embed, expanded, overlaySuspended, poppedOut, pushBounds, ready, tabId]);

  /** Coalesce layout thrash into one bounds push per frame. */
  const schedulePushBounds = useCallback(
    (force = false) => {
      if (boundsRafRef.current != null) {
        cancelAnimationFrame(boundsRafRef.current);
      }
      boundsRafRef.current = requestAnimationFrame(() => {
        boundsRafRef.current = null;
        void pushBounds(true, force);
      });
    },
    [pushBounds],
  );

  /** After open / panel transitions, remeasure a few times until layout settles. */
  const settleBounds = useCallback(() => {
    schedulePushBounds(true);
    // Double-rAF catches post-paint layout.
    requestAnimationFrame(() => schedulePushBounds(true));
    const t1 = window.setTimeout(() => schedulePushBounds(true), 50);
    const t2 = window.setTimeout(() => schedulePushBounds(true), 120);
    // Sidebar width transition is ~200ms — catch the end state.
    const t3 = window.setTimeout(() => schedulePushBounds(true), 240);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [schedulePushBounds]);

  // Subscribe to Chromium embed navigation / load events.
  useEffect(() => {
    if (!embed || !tabId || !window.colorideDesktop?.browserEmbed?.onEvent) return;
    return window.colorideDesktop.browserEmbed.onEvent((event: EmbedEvent) => {
      if (event.tabId !== tabId) return;
      if (event.type === "popout") {
        setPoppedOut(true);
        poppedOutRef.current = true;
        return;
      }
      if (event.type === "dock") {
        setPoppedOut(false);
        poppedOutRef.current = false;
        lastBoundsRef.current = null;
        // Re-attach into the main pane after the OS window closes.
        window.setTimeout(() => {
          void pushBounds(true, true);
        }, 40);
        return;
      }
      if (event.type === "loading") {
        const nextUrl =
          typeof event.url === "string" && event.url ? displayUrl(event.url) : undefined;
        onUpdateRef.current({
          loading: Boolean(event.loading),
          ...(nextUrl !== undefined ? { url: nextUrl } : {}),
          ...(typeof event.title === "string" ? { title: event.title } : {}),
          error: "",
        });
        setReady(true);
        return;
      }
      if (event.type === "navigate" || event.type === "title") {
        const nextUrl =
          typeof event.url === "string" && event.url ? displayUrl(event.url) : undefined;
        onUpdateRef.current({
          ...(nextUrl !== undefined ? { url: nextUrl } : {}),
          ...(typeof event.title === "string" ? { title: event.title } : {}),
          loading: false,
          error: "",
        });
        setReady(true);
        return;
      }
      if (event.type === "error") {
        onUpdateRef.current({
          loading: false,
          error: String(event.message || "Failed to load page"),
        });
      }
    });
  }, [embed, pushBounds, tabId]);

  // Open / keep the real Chromium view for this tab.
  // Empty tabs open a dark blank surface; the URL bar stays empty.
  // WebContentsView is a native Electron overlay — must hide on unmount or it
  // stays painted over Monaco / other explorer tabs.
  useEffect(() => {
    if (!embed || !tabId) return;
    let cancelled = false;
    const embedApi = window.colorideDesktop?.browserEmbed;
    if (!embedApi) return;

    const boot = async () => {
      const targetUrl = normalizeUrl(tab.url); // "" → blank embed
      // Only show spinner when actually loading a real page.
      if (targetUrl) onUpdateRef.current({ loading: true, error: "" });
      else onUpdateRef.current({ loading: false, error: "" });
      try {
        // Prefer live SOCKS from connection state (port can change after reconnect).
        // Localhost in this browser = VPS loopback via SSH SOCKS — never the Mac.
        let socksPort: number | null = null;
        try {
          const state = await api.connectionState();
          socksPort = state.socksPort ?? null;
        } catch {
          socksPort = null;
        }

        if (cancelled) return;

        // Restore pop-out state if main process still has this tab detached.
        try {
          const status = await embedApi.isPoppedOut?.({ tabId });
          if (status?.poppedOut) {
            setPoppedOut(true);
            poppedOutRef.current = true;
          }
        } catch {
          // older Electron without isPoppedOut
        }

        if (targetUrl && isLoopbackUrl(targetUrl) && !socksPort) {
          onUpdateRef.current({
            loading: false,
            url: displayUrl(targetUrl),
            error:
              "No SOCKS tunnel: connect SSH to the VPS. localhost here is the VPS, not this Mac.",
          });
          // Still open a blank embed so the surface is ready once SOCKS appears.
        }

        // Wait one frame so flex/layout has real pixel sizes before first open.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (cancelled) return;
        const bounds = measureBounds() || { x: 0, y: 0, width: 800, height: 600 };
        const result = await embedApi.open({
          tabId,
          // Empty → main loads dark idle surface (no white about:blank).
          // Skip loading loopback until SOCKS is up (would hit the Mac and black-screen).
          url: targetUrl && isLoopbackUrl(targetUrl) && !socksPort ? "" : targetUrl || "",
          socksPort,
          bounds,
        });
        // open() may have shown the view while we unmounted — force hide
        // only when the embed is still docked in the main window.
        if (cancelled) {
          if (!poppedOutRef.current) void embedApi.hide({ tabId });
          return;
        }
        lastBoundsRef.current = bounds;
        setReady(true);
        if (result && "poppedOut" in result && result.poppedOut) {
          setPoppedOut(true);
          poppedOutRef.current = true;
        }
        const skippedLoopback = Boolean(targetUrl && isLoopbackUrl(targetUrl) && !socksPort);
        onUpdateRef.current({
          loading: false,
          // Keep address bar empty while on blank; never show about:blank.
          url: displayUrl(skippedLoopback ? targetUrl : result.url || targetUrl),
          title: skippedLoopback ? "" : result.title || tab.title,
          error: skippedLoopback
            ? "No SOCKS tunnel: connect SSH to the VPS. localhost here is the VPS, not this Mac."
            : "",
        });
        // Re-fit after paint + sidebar/terminal transitions (docked only).
        if (!poppedOutRef.current) settleBounds();
      } catch (error) {
        if (cancelled) {
          if (!poppedOutRef.current) void embedApi.hide({ tabId });
          return;
        }
        onUpdateRef.current({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to open embedded browser",
        });
      }
    };

    void boot();

    return () => {
      cancelled = true;
      // Hide (don't destroy) when switching tabs so history survives.
      // Leave popped-out windows alone.
      if (!poppedOutRef.current) void embedApi.hide({ tabId });
    };
    // Only re-boot when the tab id changes — URL nav is handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed, tabId]);

  // Keep WebContentsView bounds synced with the pane (resize / layout).
  useEffect(() => {
    if (!embed || !tabId || poppedOut) return;
    const el = surfaceRef.current;
    if (!el) return;
    let alive = true;
    const cancelSettle = settleBounds();

    const onLayout = () => {
      if (!alive) return;
      schedulePushBounds(false);
    };

    // Observe the surface and ancestors — sidebar / terminal resizes often
    // change our position without changing the surface's own box model first.
    const ro = new ResizeObserver(onLayout);
    ro.observe(el);
    let parent: HTMLElement | null = el.parentElement;
    let depth = 0;
    while (parent && depth < 8) {
      ro.observe(parent);
      parent = parent.parentElement;
      depth += 1;
    }

    window.addEventListener("resize", onLayout);
    window.visualViewport?.addEventListener("resize", onLayout);
    window.visualViewport?.addEventListener("scroll", onLayout);
    // Capture scroll of ancestors (sidebar open, terminal drawer, etc.).
    window.addEventListener("scroll", onLayout, true);
    // Panel width uses CSS transitions — remeasure when they finish.
    const onTransitionEnd = (event: TransitionEvent) => {
      if (!alive) return;
      const prop = event.propertyName;
      if (prop === "width" || prop === "height" || prop === "transform" || prop === "flex-basis") {
        settleBounds();
      }
    };
    document.addEventListener("transitionend", onTransitionEnd, true);

    return () => {
      alive = false;
      cancelSettle();
      if (boundsRafRef.current != null) {
        cancelAnimationFrame(boundsRafRef.current);
        boundsRafRef.current = null;
      }
      ro.disconnect();
      window.removeEventListener("resize", onLayout);
      window.visualViewport?.removeEventListener("resize", onLayout);
      window.visualViewport?.removeEventListener("scroll", onLayout);
      window.removeEventListener("scroll", onLayout, true);
      document.removeEventListener("transitionend", onTransitionEnd, true);
      // Belt-and-suspenders: hide overlay when layout effect tears down (docked only).
      if (!poppedOutRef.current) {
        void window.colorideDesktop?.browserEmbed?.hide({ tabId });
      }
    };
  }, [embed, poppedOut, schedulePushBounds, settleBounds, tabId]);

  // Destroy embed when the React tab is fully closed (component unmount with no remount).
  // Parent should also call close on tab close; this is a safety net for unmount.
  useEffect(() => {
    return () => {
      // Intentionally do not destroy here — Explorer closes tabs explicitly via closeBrowserEmbed.
    };
  }, []);

  const navigate = useCallback(async (nextUrl: string) => {
    const url = normalizeUrl(nextUrl);
    if (!url) return;
    setUrlDraft(displayUrl(url) || url);
    onUpdateRef.current({ loading: true, error: "", url: displayUrl(url) || url });

    if (embed && tabId && window.colorideDesktop?.browserEmbed) {
      try {
        const local = workspaceKind === "local";
        let socksPort: number | null = null;
        try {
          if (local) {
            await applyBrowserProxy("local");
          } else {
            const state = await api.connectionState();
            socksPort = state.socksPort ?? null;
            if (socksPort) {
              await window.colorideDesktop.browserEmbed.setSocks({ socksPort });
            }
          }
        } catch {
          // keep previous proxy
        }

        if (isLoopbackUrl(url) && !local && !socksPort) {
          onUpdateRef.current({
            loading: false,
            url: displayUrl(url) || url,
            error:
              "No SOCKS tunnel: connect SSH to the VPS. localhost here is the VPS, not this computer.",
          });
          return;
        }

        // Embed not ready yet (first paint): open with the real URL.
        if (!ready) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const bounds = measureBounds() || { x: 0, y: 0, width: 800, height: 600 };
          const result = await window.colorideDesktop.browserEmbed.open({
            tabId,
            url,
            socksPort,
            bounds,
          });
          lastBoundsRef.current = bounds;
          setReady(true);
          onUpdateRef.current({
            loading: false,
            url: displayUrl(result.url || url),
            title: result.title || "",
            error: local || result.socks || !isLoopbackUrl(url)
              ? ""
              : "SOCKS inactive — localhost will not reach the VPS until the SSH tunnel is up.",
          });
          settleBounds();
          return;
        }

        await window.colorideDesktop.browserEmbed.navigate({ tabId, url });
        onUpdateRef.current({ loading: false, url: displayUrl(url) });
      } catch (error) {
        onUpdateRef.current({
          loading: false,
          error: error instanceof Error ? error.message : "Navigation failed",
        });
      }
      return;
    }

    // Non-Electron fallback: open system browser.
    try {
      if (window.colorideDesktop?.openExternal) {
        await window.colorideDesktop.openExternal(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      onUpdateRef.current({ loading: false });
    } catch (error) {
      onUpdateRef.current({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to open URL",
      });
    }
  }, [embed, measureBounds, ready, settleBounds, tabId, workspaceKind]);

  // External navigate (agent / chat link) while this pane is already mounted.
  useEffect(() => {
    const token = tab.navToken ?? 0;
    if (token === 0 || token === lastNavTokenRef.current) return;
    lastNavTokenRef.current = token;
    const url = normalizeUrl(tab.url);
    if (!url) return;
    void navigate(url);
  }, [navigate, tab.navToken, tab.url]);

  const reload = async () => {
    if (embed && tabId && window.colorideDesktop?.browserEmbed) {
      onUpdate({ loading: true, error: "" });
      try {
        await window.colorideDesktop.browserEmbed.reload({ tabId });
      } catch (error) {
        onUpdate({
          loading: false,
          error: error instanceof Error ? error.message : "Reload failed",
        });
      }
      return;
    }
    if (tab.url) void navigate(tab.url);
  };

  const goBack = async () => {
    if (!embed || !tabId) return;
    try {
      await window.colorideDesktop?.browserEmbed?.goBack({ tabId });
    } catch {
      // ignore
    }
  };

  const goForward = async () => {
    if (!embed || !tabId) return;
    try {
      await window.colorideDesktop?.browserEmbed?.goForward({ tabId });
    } catch {
      // ignore
    }
  };

  /**
   * Right-side action: pop out into a Coloride browser window (same SOCKS/VPS).
   * Falls back to the system browser only when the desktop pop-out API is missing.
   */
  const openExternalOrPopOut = async () => {
    if (poppedOut) {
      await dock();
      return;
    }
    if (embed && tabId && window.colorideDesktop?.browserEmbed?.popOut) {
      await popOut();
      return;
    }
    // Non-desktop fallback — system browser (no VPS SOCKS).
    const target = normalizeUrl(tab.url || urlDraft);
    if (!target) return;
    if (isLoopbackUrl(target) && workspaceKind !== "local") {
      onUpdateRef.current({
        error:
          "localhost only works inside Coloride (SSH tunnel → VPS). The system browser would hit this computer.",
      });
      return;
    }
    try {
      if (window.colorideDesktop?.openExternal) {
        await window.colorideDesktop.openExternal(target);
      } else {
        window.open(target, "_blank", "noopener,noreferrer");
      }
    } catch {
      window.open(target, "_blank", "noopener,noreferrer");
    }
  };

  const popOut = async () => {
    if (!embed || !tabId || !window.colorideDesktop?.browserEmbed?.popOut) return;
    try {
      try {
        await applyBrowserProxy(workspaceKind);
      } catch {
        // keep previous proxy
      }
      const result = await window.colorideDesktop.browserEmbed.popOut({
        tabId,
        url: normalizeUrl(tab.url || urlDraft) || undefined,
        title: tab.title || displayUrl(tab.url) || "Browser",
      });
      if (result?.poppedOut) {
        setPoppedOut(true);
        poppedOutRef.current = true;
        // Exit in-app full-screen when leaving the main window.
        if (expanded && onToggleExpanded) onToggleExpanded();
      }
    } catch (error) {
      onUpdateRef.current({
        error: error instanceof Error ? error.message : "Failed to open browser window",
      });
    }
  };

  const dock = async () => {
    if (!embed || !tabId || !window.colorideDesktop?.browserEmbed?.dock) return;
    try {
      await window.colorideDesktop.browserEmbed.dock({ tabId });
      setPoppedOut(false);
      poppedOutRef.current = false;
      lastBoundsRef.current = null;
      window.setTimeout(() => {
        void pushBounds(true, true);
      }, 40);
    } catch (error) {
      onUpdateRef.current({
        error: error instanceof Error ? error.message : "Failed to dock browser",
      });
    }
  };

  const hasUrl = Boolean(normalizeUrl(tab.url) || normalizeUrl(urlDraft));
  const canDesktopPopOut = Boolean(embed && window.colorideDesktop?.browserEmbed?.popOut);

  return (
    <div className="browser-pane flex h-full min-h-0 flex-col overflow-hidden bg-[#1e1e1e]">
      <div className="browser-chrome-header flex h-10 flex-shrink-0 items-center gap-0.5 bg-[#1e1e1e] px-1.5">
        <button
          className="flex size-7 flex-shrink-0 items-center justify-center rounded-[10px] bg-transparent text-[#878888] transition-all hover:bg-[#262626] hover:text-[#f0f4f8] active:scale-95 disabled:pointer-events-none disabled:opacity-30"
          disabled={!embed || !ready}
          onClick={() => void goBack()}
          title="Back"
          type="button"
        >
          <IconBack size={15} />
        </button>
        <button
          className="flex size-7 flex-shrink-0 items-center justify-center rounded-[10px] bg-transparent text-[#878888] transition-all hover:bg-[#262626] hover:text-[#f0f4f8] active:scale-95 disabled:pointer-events-none disabled:opacity-30"
          disabled={!embed || !ready}
          onClick={() => void goForward()}
          title="Forward"
          type="button"
        >
          <IconForward size={15} />
        </button>
        <button
          className="flex size-7 flex-shrink-0 items-center justify-center rounded-[10px] bg-transparent text-[#878888] transition-all hover:bg-[#262626] hover:text-[#f0f4f8] active:scale-95 disabled:pointer-events-none disabled:opacity-30"
          disabled={!hasUrl && !ready}
          onClick={() => void reload()}
          title="Reload"
          type="button"
        >
          {tab.loading ? <Icon icon={Loading03Icon} size={15} className="animate-spin" /> : <IconReload size={15} />}
        </button>
        <form
          className="mx-1 flex min-w-0 flex-1 items-center"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate(urlDraft);
          }}
        >
          <input
            aria-label="Browser URL"
            className="browser-url-input min-w-0 flex-1 rounded-[10px] border-0 bg-[#2a2a2a] px-2.5 py-1 text-[12px] text-[#f0f4f8] outline-none transition-[background-color] duration-200 ease-out placeholder:text-[#6b6b6b] focus:bg-[#383838]"
            onChange={(event) => setUrlDraft(event.target.value)}
            placeholder="Search or enter URL"
            spellCheck={false}
            value={urlDraft}
          />
        </form>
        {onToggleExpanded && !poppedOut ? (
          <button
            aria-label={expanded ? "Exit full screen" : "Full screen"}
            aria-pressed={expanded}
            className="flex size-7 flex-shrink-0 items-center justify-center rounded-[10px] bg-transparent text-[#878888] transition-all hover:bg-[#262626] hover:text-[#f0f4f8] active:scale-95"
            onClick={onToggleExpanded}
            title={expanded ? "Exit full screen" : "Full screen"}
            type="button"
          >
            {expanded ? <IconCollapse size={15} /> : <IconExpand size={15} />}
          </button>
        ) : null}
        <button
          aria-label={
            poppedOut
              ? "Dock browser in Coloride"
              : canDesktopPopOut
                ? "Open browser in new window"
                : "Open in system browser"
          }
          aria-pressed={poppedOut}
          className={`flex size-7 flex-shrink-0 items-center justify-center rounded-[10px] bg-transparent transition-all hover:bg-[#262626] hover:text-[#f0f4f8] active:scale-95 disabled:pointer-events-none disabled:opacity-30 ${
            poppedOut ? "text-[#7dd3fc]" : "text-[#878888]"
          }`}
          disabled={poppedOut ? false : canDesktopPopOut ? !ready && !hasUrl : !hasUrl}
          onClick={() => void openExternalOrPopOut()}
          title={
            poppedOut
              ? "Return to Coloride"
              : canDesktopPopOut
                ? "Open in separate window"
                : "Open in system browser"
          }
          type="button"
        >
          {poppedOut ? <IconDock size={15} /> : <IconExternal size={15} />}
        </button>
      </div>

      {/*
        Transparent hole for the native WebContentsView overlay.
        Empty (no URL) surface stays #1e1e1e in dark mode.
        When popped out, show a dock placeholder instead of the live surface.
      */}
      <div
        className="browser-surface relative min-h-0 flex-1 overflow-hidden bg-[#1e1e1e]"
        ref={surfaceRef}
        aria-label="Embedded browser surface"
      >
        {poppedOut ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white/[0.04] text-[#7dd3fc]">
              <IconExternal size={22} />
            </div>
            <div className="max-w-sm space-y-1">
              <p className="text-[13px] font-medium text-[#f0f4f8]">
                Browser open in another window
              </p>
              <p className="text-[12px] leading-relaxed text-[#878888]">
                Still using the SSH tunnel → VPS. Close that window or click here to bring it back into Coloride.
              </p>
            </div>
            <button
              className="rounded-lg border border-[#3a3a3a] bg-[#212121] px-3 py-1.5 text-[12px] text-[#f0f4f8] transition-colors hover:bg-white/8 active:scale-[0.98]"
              onClick={() => void dock()}
              type="button"
            >
              Return to Coloride
            </button>
          </div>
        ) : null}
        {!poppedOut && tab.loading && !ready && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[#878888]">
            <Icon icon={Loading03Icon} size={22} className="animate-spin" />
            <span className="text-[12px]">Opening Chromium…</span>
          </div>
        )}
        {tab.error && !poppedOut && (
          <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-[#24211b]/95 px-3 py-2 text-[12px] text-amber-200 shadow-lg">
            <Icon icon={Alert02Icon} size={14} className="mt-0.5 flex-shrink-0" strokeWidth={1.8} />
            <span className="min-w-0 break-words">{tab.error}</span>
          </div>
        )}
        {!embed && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[#878888]">
            <p className="max-w-sm text-[13px] leading-relaxed">
              The embedded browser is only available in the Coloride desktop app.
              Use the external button to open the URL in your system browser.
            </p>
            <button
              className="rounded-lg border border-[#3a3a3a] bg-[#212121] px-3 py-1.5 text-[12px] text-[#f0f4f8] transition-colors hover:bg-white/8"
              onClick={() => void openExternalOrPopOut()}
              type="button"
            >
              Open externally
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Close the native embed when an explorer browser tab is closed. */
export async function closeBrowserEmbed(tabId: string): Promise<void> {
  if (!tabId || !window.colorideDesktop?.browserEmbed?.close) return;
  try {
    await window.colorideDesktop.browserEmbed.close({ tabId });
  } catch {
    // ignore
  }
}

export function browserTabKey(browserId: string): string {
  return `browser:${browserId}`;
}

export function isBrowserTabKey(key: string): boolean {
  return key.startsWith("browser:");
}

export function browserIdFromTabKey(key: string): string {
  return key.slice("browser:".length);
}

export function browserTabLabel(tab: Pick<BrowserTabState, "title" | "url">): string {
  if (tab.title.trim()) return tab.title.trim();
  try {
    const host = new URL(tab.url).hostname;
    return host || tab.url || "Browser";
  } catch {
    return tab.url || "Browser";
  }
}
