import { cloudConfig } from "../../shared/api/cloudConfig";
import {
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "../../shared/ui/Icon";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ColorideMark } from "../server/ConnectServerModal";
import {
  bootstrapCloudAuth,
  getSessionSnapshot,
  startBrowserLinkLogin,
  subscribeCloudAuth,
  type BrowserLinkSession,
  type CloudAuthSession,
} from "./cloudAuth";
import { applyResolvedThemeToDocument, useResolvedTheme } from "../settings/preferences";
import { WindowsWindowControls } from "../../shared/ui/WindowsWindowControls";

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && /cancel/i.test(error.message);
}

const FADE_MS = 0.32;
const fadeEase = [0.22, 1, 0.36, 1] as const;

/**
 * Cloud-only surfaces wait for an authenticated account. With allowLocal,
 * editing and terminals stay available while the account restores in the background.
 *
 * While bootstrapping a stored session we show a blank dark splash — never the
 * Log In page — so a signed-in user does not flash login for a second.
 * Sign-out crossfades the app out, then the login screen in.
 */
export function LoginGate({ children, allowLocal = false }: { children: ReactNode; allowLocal?: boolean }) {
  const [session, setSession] = useState<CloudAuthSession | null>(() => getSessionSnapshot());
  // A remembered profile without an access token still needs authentication.
  const [booting, setBooting] = useState(() => {
    const restored = getSessionSnapshot();
    return !restored?.accessToken || Boolean(restored.pendingRefresh);
  });
  const [linkSession, setLinkSession] = useState<BrowserLinkSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bootDoneRef = useRef(!booting);
  // A cached profile with `pendingRefresh` is only provisional. Rendering the
  // workspace before it resolves causes a one-frame Welcome wordmark flash
  // when the refresh token was revoked.
  const bootstrapResolvedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const onSession = (next: CloudAuthSession | null) => {
      if (cancelled) return;
      setSession(next);
      // Only end boot when we have a real session mid-bootstrap — never on the
      // initial null snapshot from subscribe (that used to flash the login page).
      if (next?.user && next.accessToken && !next.pendingRefresh && !bootDoneRef.current) {
        bootDoneRef.current = true;
        setBooting(false);
      }
      // Sign Out after the app is up must leave boot immediately so LoginGate
      // can show the login page instead of sitting on the splash.
      if (!next && (bootDoneRef.current || bootstrapResolvedRef.current) && !cancelled) {
        bootDoneRef.current = true;
        setBooting(false);
      }
    };
    const unsubscribe = subscribeCloudAuth(onSession);
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<CloudAuthSession | null>).detail ?? null;
      onSession(detail);
    };
    window.addEventListener("coloride:cloud-auth-changed", onEvent);

    // Restore saved login from disk immediately. Cloud refresh runs in the
    // background — never hold the splash on api.coloride.com.
    const bootCap = window.setTimeout(() => {
      if (cancelled || bootDoneRef.current) return;
      bootDoneRef.current = true;
      setBooting(false);
    }, 2500);
    void bootstrapCloudAuth()
      .then((restored) => {
        if (cancelled) return;
        bootstrapResolvedRef.current = true;
        onSession(restored);
        // Keep a provisional account behind the cloud gate until refresh settles
        // or the cap expires. Local workspaces remain available through allowLocal.
        if (restored?.pendingRefresh) return;
        bootDoneRef.current = true;
        setBooting(false);
      })
      .catch(() => {
        if (cancelled) return;
        bootstrapResolvedRef.current = true;
        bootDoneRef.current = true;
        setBooting(false);
      })
      .finally(() => {
        // A provisional cached profile deliberately keeps the cap alive. If
        // the network never answers, the cap still prevents an endless splash.
        if (bootDoneRef.current) window.clearTimeout(bootCap);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(bootCap);
      unsubscribe();
      window.removeEventListener("coloride:cloud-auth-changed", onEvent);
    };
  }, []);

  // A remembered profile is not an authenticated app session. Keeping it out
  // of the app phase prevents Welcome (and its large wordmark) from flashing
  // between the small boot mark and the login screen.
  const signedIn = Boolean(session?.user && session.accessToken && !session.pendingRefresh);

  const resolvedTheme = useResolvedTheme();

  // Login follows the saved theme. It used to force dark even in light mode.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const showLoginChrome = !allowLocal && (booting || !signedIn);
    const isElectron =
      !!window.colorideDesktop || navigator.userAgent.toLowerCase().includes("electron");
    if (isElectron) {
      document.body.classList.add("electron-frameless");
      document.documentElement.classList.remove("electron-custom-radius");
      document.body.classList.remove("electron-custom-radius");
    }

    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");

    const setLoginDom = () => {
      html.classList.add("login-gate-active");
      body.classList.add("login-gate-active");
      const resolved = applyResolvedThemeToDocument();
      const plate = resolved === "light" ? "#ffffff" : "#171717";
      html.style.setProperty("background", plate, "important");
      html.style.setProperty("background-color", plate, "important");
      body.style.setProperty("background", plate, "important");
      body.style.setProperty("background-color", plate, "important");
      if (root) {
        root.style.setProperty("background", plate, "important");
        root.style.setProperty("background-color", plate, "important");
      }
      void window.colorideDesktop?.setWindowBackdrop?.("opaque", {
        appearance: resolved === "light" ? "light" : "dark",
      });
    };

    const setOpaqueDom = () => {
      html.classList.remove("login-gate-active");
      body.classList.remove("login-gate-active");
      html.style.removeProperty("background");
      html.style.removeProperty("background-color");
      body.style.removeProperty("background");
      body.style.removeProperty("background-color");
      if (root) {
        root.style.removeProperty("background");
        root.style.removeProperty("background-color");
      }
      const resolved = applyResolvedThemeToDocument();
      void window.colorideDesktop?.setWindowBackdrop?.("opaque", {
        appearance: resolved === "light" ? "light" : "dark",
      });
    };

    if (showLoginChrome) {
      setLoginDom();
      return () => {
        if (getSessionSnapshot()?.user) setOpaqueDom();
      };
    }

    setOpaqueDom();
    return undefined;
  }, [allowLocal, booting, signedIn, resolvedTheme]);

  useEffect(() => {
    return () => {
      linkSession?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkSession]);

  const linking = Boolean(linkSession) || busy;

  const beginSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      const next = await startBrowserLinkLogin();
      setLinkSession(next);
      try {
        await next.done;
        setLinkSession(null);
      } catch (err) {
        if (!isCancelledError(err)) {
          setError(err instanceof Error ? err.message : "Could not sign in.");
        }
        setLinkSession(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the sign-in link.");
      setLinkSession(null);
    } finally {
      setBusy(false);
    }
  };

  const isElectron =
    typeof window !== "undefined" &&
    (!!window.colorideDesktop || navigator.userAgent.toLowerCase().includes("electron"));

  // boot | app | login — never show login while still restoring a stored session.
  // Local editing and terminals never wait for a network account refresh.
  const phase: "boot" | "app" | "login" = allowLocal ? "app" : booting ? "boot" : signedIn ? "app" : "login";
  // The startup splash owns the initial reveal. Paint its destination fully
  // underneath it instead of running a second, competing opacity animation.
  const startupCovered = typeof document !== "undefined" && document.documentElement.hasAttribute("data-startup");

  if (!allowLocal && !cloudConfig.enabled) return <p>Cloud services are unavailable in this distribution.</p>;

  return (
    <div className="login-gate-root relative h-full min-h-0 w-full flex-1 overflow-hidden bg-[#171717]">
      <AnimatePresence mode="wait" initial={false}>
        {phase === "boot" ? (
          <motion.div
            key="boot-shell"
            animate={{ opacity: 1 }}
            className="login-gate-boot absolute inset-0 flex min-h-0 w-full flex-col bg-[#171717]"
            exit={{ opacity: 0 }}
            initial={{ opacity: 1 }}
            transition={{ duration: 0.18, ease: fadeEase }}
          >
            {isElectron ? (
              <div className="login-gate-drag relative flex h-10 w-full shrink-0 items-center justify-end [-webkit-app-region:drag]">
                <WindowsWindowControls />
              </div>
            ) : null}
            <div
              aria-busy="true"
              aria-label="Loading Coloride"
              className="flex min-h-0 flex-1 flex-col items-center justify-center [-webkit-app-region:no-drag]"
            >
              <div className="login-gate-boot-mark" aria-hidden="true">
                <ColorideMark className="h-full w-full" shimmer />
              </div>
            </div>
          </motion.div>
        ) : phase === "app" ? (
          <motion.div
            key="app-shell"
            animate={{ opacity: 1 }}
            className="login-gate-app absolute inset-0 flex min-h-0 flex-col"
            exit={{ opacity: 0 }}
            initial={startupCovered ? false : { opacity: 0 }}
            transition={{ duration: FADE_MS, ease: fadeEase }}
          >
            {children}
          </motion.div>
        ) : (
          <motion.div
            key="login-shell"
            animate={{ opacity: 1 }}
            className="login-gate absolute inset-0 flex min-h-0 w-full flex-col bg-transparent"
            exit={{ opacity: 0 }}
            initial={startupCovered ? false : { opacity: 0 }}
            transition={{ duration: FADE_MS, ease: fadeEase }}
          >
            {isElectron ? (
              <div className="login-gate-drag relative flex h-10 w-full shrink-0 items-center justify-end [-webkit-app-region:drag]">
                <WindowsWindowControls />
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-20 [-webkit-app-region:no-drag]">
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="login-gate-content flex w-full flex-col items-center text-center"
                initial={{ opacity: 0, y: 14 }}
                transition={{ duration: 0.36, ease: fadeEase, delay: 0.04 }}
              >
                <div aria-hidden="true" className="login-gate-login-mark mb-8 flex items-center justify-center">
                  <ColorideMark className="text-[#71717a] dark:text-[#9a9a9f]" />
                </div>

                <h1 className="login-gate-title">Welcome back</h1>
                <p className="login-gate-subtitle mt-3 text-[14px] font-normal leading-relaxed text-[#a1a1a6]">
                  {linking ? "Finish signing in in your browser." : "Sign in to continue with Coloride"}
                </p>

                {error ? (
                  <p className="mt-4 w-full text-xs leading-5 text-[#f0a0a0]" role="alert">
                    {error}
                  </p>
                ) : null}

                <button
                  className="login-gate-primary mt-6 flex w-full items-center justify-center gap-2 px-5 text-[14px] font-medium transition-[background,border-color,box-shadow,transform,opacity] active:scale-[0.985] disabled:cursor-wait disabled:opacity-60"
                  disabled={linking}
                  onClick={() => void beginSignIn()}
                  type="button"
                >
                  {linking ? (
                    <Icon icon={Loading03Icon} aria-hidden="true" className="account-auth-spin size-3.5" strokeWidth={2} />
                  ) : null}
                  {linking ? "Signing in…" : "Log in"}
                </button>
                {!linking ? <p className="login-gate-footnote">Secure sign in opens in your browser.</p> : null}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
