import { cloudConfig } from "../../shared/api/cloudConfig";
import { notify, dismissNotification } from "../../shared/ui/notifications";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import {
  getSessionSnapshot,
  logoutCloudAuth,
  resolveCloudAvatarUrl,
  subscribeCloudAuth,
  startBrowserLinkLogin,
  type BrowserLinkSession,
  type CloudAuthSession,
} from "../../features/auth/cloudAuth";
import {
  getCachedLlmCredits,
  refreshLlmCredits,
  subscribeLlmCredits,
  type LlmCreditsSnapshot,
} from "../../features/auth/llmCredits";
import { LogoutConfirmDialog } from "../../features/auth/LogoutConfirmDialog";
import { buildUpgradeProPill, TitleBarPills } from "./TitleBarPills";
import { AppMenuBar } from "./AppMenuBar";
import {
  isWindowsDesktop,
  useShowWindowsControls,
  WindowsWindowControls,
} from "../../shared/ui/WindowsWindowControls";

/** Free-tier plans that should see the Upgrade Pro pill. */
function isFreePlan(plan: string | null | undefined): boolean {
  const normalized = (plan ?? "").trim().toLowerCase();
  return normalized === "free" || normalized === "starter";
}

interface DesktopTitleBarProps {
  accountActive?: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isElectron: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onOpenSettings?: () => void;
  /** Open Coloride's embedded browser workspace. */
  onOpenBrowser: () => void;
  onToggleSidePanel: () => void;
  onToggleTerminal: () => void;
  /** Toggle Explorer right agent dock (or Agents tools rail). */
  onToggleRightPanel?: () => void;
  sidePanelAvailable: boolean;
  sidePanelOpen: boolean;
  rightPanelOpen?: boolean;
  rightPanelAvailable?: boolean;
  /** Browser needs an SSH tunnel or an open local folder. */
  browserAvailable?: boolean;
  /** Local folder: traffic is this computer, not the VPS. */
  browserLocal?: boolean;
  /** Terminal needs a connected server (can still close when open). */
  terminalAvailable?: boolean;
  terminalOpen: boolean;
}

export function DesktopTitleBar({
  accountActive = false,
  canGoBack,
  canGoForward,
  isElectron,
  onGoBack,
  onGoForward,
  onOpenSettings,
  onOpenBrowser,
  onToggleSidePanel,
  onToggleTerminal,
  onToggleRightPanel,
  sidePanelAvailable,
  sidePanelOpen,
  rightPanelOpen = false,
  rightPanelAvailable = false,
  browserAvailable = false,
  browserLocal = false,
  terminalAvailable = false,
  terminalOpen,
}: DesktopTitleBarProps) {
  const rightPanelControls = useAnimationControls();
  const [signingIn, setSigningIn] = useState(false);
  const [linkSession, setLinkSession] = useState<BrowserLinkSession | null>(null);
  const loginRef = useRef<BrowserLinkSession | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; loginRef.current?.cancel(); };
  }, []);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [signInMenuOpen, setSignInMenuOpen] = useState(false);
  const signInMenuRef = useRef<HTMLDivElement>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [cloudSession, setCloudSession] = useState<CloudAuthSession | null>(() => getSessionSnapshot());
  const [llmCredits, setLlmCredits] = useState<LlmCreditsSnapshot | null>(() => getCachedLlmCredits());
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const showWinControls = useShowWindowsControls();
  // No Mac traffic-light gutter on Windows — left tools flush to the edge.
  const isWinLayout = isWindowsDesktop() || showWinControls;

  useEffect(() => subscribeCloudAuth(setCloudSession), []);
  useEffect(() => subscribeLlmCredits((snapshot) => setLlmCredits(snapshot)), []);
  useEffect(() => {
    if (cloudSession?.accessToken) {
      void refreshLlmCredits();
    }
  }, [cloudSession?.accessToken]);

  useEffect(() => {
    if (!accountMenuOpen && !signInMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (accountMenuOpen && !accountMenuRef.current?.contains(target)) {
        setAccountMenuOpen(false);
      }
      if (signInMenuOpen && !signInMenuRef.current?.contains(target)) {
        setSignInMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountMenuOpen(false);
      setSignInMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [accountMenuOpen, signInMenuOpen]);

  const user = cloudSession?.user ?? null;
  const displayName =
    user?.name?.trim()
    || [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim()
    || user?.email?.split("@")[0]
    || "Account";
  const email = user?.email?.trim() || "";
  const showUpgradePro = Boolean(cloudSession?.accessToken) && isFreePlan(llmCredits?.plan);

  const requestLogout = () => {
    setAccountMenuOpen(false);
    setLogoutConfirmOpen(true);
  };

  useEffect(() => {
    const onSignOut = () => setLogoutConfirmOpen(true);
    window.addEventListener("coloride:sign-out", onSignOut);
    return () => window.removeEventListener("coloride:sign-out", onSignOut);
  }, []);

  const cancelLogout = useCallback(() => {
    if (loggingOut) return;
    setLogoutConfirmOpen(false);
  }, [loggingOut]);

  const confirmLogout = useCallback(() => {
    if (loggingOut) return;
    setLoggingOut(true);
    // logoutCloudAuth wipes memory + notifies LoginGate synchronously.
    void Promise.resolve()
      .then(() => logoutCloudAuth({ remote: true }))
      .catch(() => undefined)
      .finally(() => {
        setLoggingOut(false);
        setLogoutConfirmOpen(false);
      });
  }, [loggingOut]);

  const beginSignIn = async () => {
    if (linkSession) { linkSession.cancel(); return; }
    if (signingIn) return;
    dismissNotification("cloud-sign-in");
    setSigningIn(true);
    try {
      const next = await startBrowserLinkLogin();
      if (!mountedRef.current) {
        next.cancel();
        await next.done.catch(() => undefined);
        return;
      }
      loginRef.current = next;
      setLinkSession(next);
      await next.done;
    } catch (error) {
      if (mountedRef.current && !(error instanceof Error && /cancel/i.test(error.message))) {
        notify({ id: "cloud-sign-in", title: "Could not sign in", kind: "error",
          description: error instanceof Error ? error.message : "Please try again." });
      }
    } finally {
      loginRef.current = null;
      if (mountedRef.current) { setSigningIn(false); setLinkSession(null); }
    }
  };

  if (!isElectron) return null;
  const signedIn = Boolean(user && cloudSession?.accessToken && !cloudSession.pendingRefresh);

  return (
    <>
    <div
      className={`desktop-titlebar relative flex h-10 w-full shrink-0 items-center bg-[#171717] [-webkit-app-region:drag] ${
        isWinLayout ? "desktop-titlebar--windows pr-0" : "desktop-titlebar--mac pl-[82px] pr-2"
      }`}
    >
      {/*
        macOS: native traffic lights sit in this corner (hiddenInset @ x:16 y:13).
        Windows: no left inset — caption buttons live on the right.
      */}
      {!isWinLayout ? (
        <div
          aria-hidden="true"
          className="desktop-titlebar-traffic-lights pointer-events-none absolute inset-y-0 left-0 w-[76px] [-webkit-app-region:no-drag]"
        />
      ) : null}

      {isWinLayout ? (
        /* Windows: File/Edit/… menu, then sidebar + back/forward next to Help */
        <div className="desktop-titlebar-left desktop-titlebar-left--menu flex h-full min-w-0 shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
          <AppMenuBar />
          <span aria-hidden="true" className="mx-1 h-3.5 w-px shrink-0 bg-white/[0.1]" />
          <div className="flex h-full items-center gap-0.5">
            <TitleBarButton
              disabled={!sidePanelAvailable}
              label={sidePanelOpen ? "Hide side panel" : "Show side panel"}
              onClick={onToggleSidePanel}
            >
              <AnimatePresence initial={false} mode="wait">
                <motion.span
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  className="flex"
                  exit={{ opacity: 0, rotate: sidePanelOpen ? -12 : 12, scale: 0.82 }}
                  initial={{ opacity: 0, rotate: sidePanelOpen ? 12 : -12, scale: 0.82 }}
                  key={sidePanelOpen ? "panel-open" : "panel-closed"}
                  transition={{ duration: 0.14, ease: "easeOut" }}
                >
                  {sidePanelOpen ? <PanelOpenIcon /> : <PanelClosedIcon />}
                </motion.span>
              </AnimatePresence>
            </TitleBarButton>
            <TitleBarButton disabled={!canGoBack} label="Go back" onClick={onGoBack}>
              <BackIcon />
            </TitleBarButton>
            <TitleBarButton disabled={!canGoForward} label="Go forward" onClick={onGoForward}>
              <ForwardIcon />
            </TitleBarButton>
          </div>
        </div>
      ) : (
        <div className="desktop-titlebar-left flex h-full shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
          <TitleBarButton
            disabled={!sidePanelAvailable}
            label={sidePanelOpen ? "Hide side panel" : "Show side panel"}
            onClick={onToggleSidePanel}
          >
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                className="flex"
                exit={{ opacity: 0, rotate: sidePanelOpen ? -12 : 12, scale: 0.82 }}
                initial={{ opacity: 0, rotate: sidePanelOpen ? 12 : -12, scale: 0.82 }}
                key={sidePanelOpen ? "panel-open" : "panel-closed"}
                transition={{ duration: 0.14, ease: "easeOut" }}
              >
                {sidePanelOpen ? <PanelOpenIcon /> : <PanelClosedIcon />}
              </motion.span>
            </AnimatePresence>
          </TitleBarButton>
          <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-white/[0.08]" />
          <TitleBarButton disabled={!canGoBack} label="Go back" onClick={onGoBack}>
            <BackIcon />
          </TitleBarButton>
          <TitleBarButton disabled={!canGoForward} label="Go forward" onClick={onGoForward}>
            <ForwardIcon />
          </TitleBarButton>
        </div>
      )}

      <div className="ml-auto flex h-full items-center gap-1.5 [-webkit-app-region:no-drag]">
        {/* Extensible top-right chips: updates, Upgrade Pro, future banners… */}
        <TitleBarPills
          extra={[buildUpgradeProPill(showUpgradePro)].filter(
            (pill): pill is NonNullable<typeof pill> => Boolean(pill),
          )}
        />
        <TitleBarButton
          disabled={!browserAvailable}
          label={
            browserAvailable
              ? browserLocal
                ? "Open browser (this computer)"
                : "Open Coloride browser"
              : "Connect a server or open a local folder to use the browser"
          }
          onClick={onOpenBrowser}
        >
          <ExternalBrowserIcon />
        </TitleBarButton>
        <TitleBarButton
          disabled={!terminalAvailable && !terminalOpen}
          label={
            terminalOpen
              ? "Hide terminal"
              : terminalAvailable
                ? "Show terminal"
                : "Connect a server to open terminal"
          }
          onClick={onToggleTerminal}
        >
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              className="flex"
              exit={{ opacity: 0, rotate: terminalOpen ? 10 : -10, scale: 0.82 }}
              initial={{ opacity: 0, rotate: terminalOpen ? -10 : 10, scale: 0.82 }}
              key={terminalOpen ? "terminal-open" : "terminal-closed"}
              transition={{ duration: 0.14, ease: "easeOut" }}
            >
              {terminalOpen ? <TerminalOpenIcon /> : <TerminalClosedIcon />}
            </motion.span>
          </AnimatePresence>
        </TitleBarButton>

        <motion.div animate={rightPanelControls}>
          <TitleBarButton
            disabled={!rightPanelAvailable}
            label={
              rightPanelAvailable
                ? rightPanelOpen
                  ? "Hide agent panel"
                  : "Show agent panel"
                : "Open Explorer on a connected server to use the agent panel"
            }
            onClick={() => {
              if (!rightPanelAvailable) return;
              onToggleRightPanel?.();
            }}
          >
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                className="flex"
                exit={{ opacity: 0, scale: 0.82 }}
                initial={{ opacity: 0, scale: 0.82 }}
                key={rightPanelAvailable && rightPanelOpen ? "right-open" : "right-closed"}
                transition={{ duration: 0.14, ease: "easeOut" }}
              >
                {rightPanelAvailable && rightPanelOpen ? (
                  <RightPanelOpenIcon />
                ) : (
                  <RightPanelClosedIcon />
                )}
              </motion.span>
            </AnimatePresence>
          </TitleBarButton>
        </motion.div>

        {!signedIn && cloudConfig.enabled ? (
          <div className="titlebar-sign-in-split relative ml-1 flex h-6 shrink-0 items-stretch overflow-hidden rounded-md [-webkit-app-region:no-drag]" ref={signInMenuRef}>
            <button
              className="titlebar-sign-in flex shrink-0 items-center justify-center rounded-l-md border-0 bg-transparent px-2 text-xs font-medium text-[#8b8b90] transition-colors hover:bg-white/[0.08] hover:text-[#f0f4f8] disabled:opacity-60"
              disabled={signingIn && !linkSession}
              onClick={() => void beginSignIn()}
              type="button"
            >
              {linkSession ? "Cancel sign in" : signingIn ? "Signing in…" : "Sign in"}
            </button>
            <button
              aria-expanded={signInMenuOpen}
              aria-haspopup="menu"
              aria-label="Sign in options"
              className={`titlebar-sign-in-menu flex w-6 shrink-0 items-center justify-center rounded-r-md border-0 bg-transparent transition-colors hover:bg-white/[0.08] hover:text-[#f0f4f8] disabled:opacity-60 ${signInMenuOpen ? "text-[#f0f4f8]" : "text-[#8b8b90]"}`}
              disabled={signingIn && !linkSession}
              onClick={() => setSignInMenuOpen((open) => !open)}
              title="Sign in options"
              type="button"
            >
              <SignInChevronIcon open={signInMenuOpen} />
            </button>
            <AnimatePresence>
              {signInMenuOpen ? (
                <motion.div
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className="titlebar-account-menu absolute right-0 top-[calc(100%+6px)] z-[900] min-w-[180px] origin-top-right"
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  role="menu"
                  transition={{ duration: 0.12, ease: "easeOut" }}
                >
                  <button
                    className="titlebar-account-item"
                    onClick={() => {
                      setSignInMenuOpen(false);
                      void beginSignIn();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span className="titlebar-account-item-label">Sign in with browser</span>
                  </button>
                  <button
                    className="titlebar-account-item"
                    onClick={() => {
                      setSignInMenuOpen(false);
                      onOpenSettings?.();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span className="titlebar-account-item-label">Settings</span>
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : signedIn ? (
        <div className="relative ml-0.5" ref={accountMenuRef}>
          <button
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
            aria-label="Account menu"
            className="flex size-[20px] shrink-0 items-center justify-center overflow-hidden rounded-full border-0 bg-transparent p-0 opacity-90 transition-[transform,opacity] hover:opacity-100 active:scale-95"
            data-active={accountActive || accountMenuOpen ? "true" : "false"}
            onClick={() => setAccountMenuOpen((open) => !open)}
            title="Account"
            type="button"
          >
            <img
              alt=""
              className="size-full object-cover"
              draggable={false}
              src={resolveCloudAvatarUrl(user)}
              onError={(event) => {
                const img = event.currentTarget;
                if (!img.src.endsWith("/default-user-avatar.png")) {
                  img.src = "/default-user-avatar.png";
                }
              }}
            />
          </button>

          <AnimatePresence>
            {accountMenuOpen ? (
              <motion.div
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="titlebar-account-menu absolute right-0 top-[calc(100%+6px)] z-[900] min-w-[232px] origin-top-right"
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                role="menu"
                transition={{ duration: 0.12, ease: "easeOut" }}
              >
                <div className="titlebar-account-identity">
                  <img
                    alt=""
                    className="size-6 shrink-0 rounded-full object-cover"
                    draggable={false}
                    src={resolveCloudAvatarUrl(user)}
                    onError={(event) => {
                      const img = event.currentTarget;
                      if (!img.src.endsWith("/default-user-avatar.png")) {
                        img.src = "/default-user-avatar.png";
                      }
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="titlebar-account-name truncate">{displayName}</p>
                    <p className="titlebar-account-email mt-0.5 truncate">
                      {email || "Not signed in"}
                    </p>
                  </div>
                </div>
                <div className="titlebar-account-separator" />
                <button
                  className="titlebar-account-item"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onOpenSettings?.();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <AccountMenuSettingsIcon />
                  <span className="titlebar-account-item-label">Settings</span>
                  <span className="titlebar-account-shortcut" aria-label="Command comma">⌘,</span>
                </button>
                <button
                  className="titlebar-account-item is-danger"
                  disabled={loggingOut}
                  onClick={requestLogout}
                  role="menuitem"
                  type="button"
                >
                  <AccountMenuLogoutIcon />
                  <span className="titlebar-account-item-label">Sign Out</span>
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        ) : null}

        {/* Windows frameless: min / max / close (far right, like native caption). */}
        {showWinControls ? <WindowsWindowControls /> : null}
      </div>
    </div>
    <LogoutConfirmDialog
      email={email}
      loggingOut={loggingOut}
      onCancel={cancelLogout}
      onConfirm={confirmLogout}
      open={logoutConfirmOpen}
    />
    </>
  );
}

function SignInChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`size-3 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      height="1em"
      viewBox="0 0 24 24"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="m4 9l8 8l8-8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function TitleBarButton({ children, disabled, label, onClick }: { children: ReactNode; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      title={disabled ? undefined : label}
      type="button"
      className="titlebar-button flex size-6 items-center justify-center rounded-md text-[#8b8b90] transition-all hover:bg-white/[0.08] hover:text-[#f0f4f8] active:scale-95 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function PanelOpenIcon() {
  return <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M13 3H11C7.22876 3 5.34315 3 4.17157 4.17157C3 5.34315 3 7.22876 3 11V13C3 16.7712 3 18.6569 4.17157 19.8284C5.34315 21 7.22876 21 11 21H13C16.7712 21 18.6569 21 19.8284 19.8284C21 18.6569 21 16.7712 21 13V11C21 7.22876 21 5.34315 19.8284 4.17157C18.6569 3 16.7712 3 13 3Z" /><path d="M9 3V21" /></svg>;
}

function PanelClosedIcon() {
  return <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M11 3H13C16.7712 3 18.6569 3 19.8284 4.17157C21 5.34315 21 7.22876 21 11V13C21 16.7712 21 18.6569 19.8284 19.8284C18.6569 21 16.7712 21 13 21H11C7.22876 21 5.34315 21 4.17157 19.8284C3 18.6569 3 16.7712 3 13V11C3 7.22876 3 5.34315 4.17157 4.17157C5.34315 3 7.22876 3 11 3Z" /><path d="M8.00488 16.0049V8.00488" /></svg>;
}

function BackIcon() {
  return <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M5.5 12.002H19" /><path d="M10.9999 18.002C10.9999 18.002 4.99998 13.583 4.99997 12.0019C4.99996 10.4208 11 6.00195 11 6.00195" /></svg>;
}

function ForwardIcon() {
  return <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M18.5 12H4.99997" /><path d="M13 18C13 18 19 13.5811 19 12C19 10.4188 13 6 13 6" /></svg>;
}

function ExternalBrowserIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12C8 18 12 22 12 22C12 22 16 18 16 12C16 6 12 2 12 2C12 2 8 6 8 12Z" strokeLinejoin="round" />
      <path d="M21 15H3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 9H3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TerminalClosedIcon() {
  return <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M11 3H13C16.7712 3 18.6569 3 19.8284 4.17157C21 5.34315 21 7.22876 21 11V13C21 16.7712 21 18.6569 19.8284 19.8284C18.6569 21 16.7712 21 13 21H11C7.22876 21 5.34315 21 4.17157 19.8284C3 18.6569 3 16.7712 3 13V11C3 7.22876 3 5.34315 4.17157 4.17157C5.34315 3 7.22876 3 11 3Z" /><path d="M16 16H8" /></svg>;
}

function TerminalOpenIcon() {
  return <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M2.99219 15.0001H20.9922" strokeLinecap="round" strokeLinejoin="round" /><path d="M2.49219 12.0001C2.49219 7.52178 2.49219 5.28261 3.88343 3.89136C5.27467 2.50012 7.51384 2.50012 11.9922 2.50012C16.4705 2.50012 18.7097 2.50012 20.1009 3.89136C21.4922 5.28261 21.4922 7.52178 21.4922 12.0001C21.4922 16.4785 21.4922 18.7176 20.1009 20.1089C18.7097 21.5001 16.4705 21.5001 11.9922 21.5001C7.51384 21.5001 5.27467 21.5001 3.88343 20.1089C2.49219 18.7176 2.49219 16.4785 2.49219 12.0001Z" /></svg>;
}


function RightPanelClosedIcon() {
  return <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M11 3H13C16.7712 3 18.6569 3 19.8284 4.17157C21 5.34315 21 7.22876 21 11V13C21 16.7712 21 18.6569 19.8284 19.8284C18.6569 21 16.7712 21 13 21H11C7.22876 21 5.34315 21 4.17157 19.8284C3 18.6569 3 16.7712 3 13V11C3 7.22876 3 5.34315 4.17157 4.17157C5.34315 3 7.22876 3 11 3Z" /><path d="M16 8V16" /></svg>;
}

function RightPanelOpenIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24">
      <path d="M11 3H13C16.7712 3 18.6569 3 19.8284 4.17157C21 5.34315 21 7.22876 21 11V13C21 16.7712 21 18.6569 19.8284 19.8284C18.6569 21 16.7712 21 13 21H11C7.22876 21 5.34315 21 4.17157 19.8284C3 18.6569 3 16.7712 3 13V11C3 7.22876 3 5.34315 4.17157 4.17157C5.34315 3 7.22876 3 11 3Z" />
      <path d="M15 3V21" />
      <path d="M15 3H13C16.7712 3 18.6569 3 19.8284 4.17157C21 5.34315 21 7.22876 21 11V13C21 16.7712 21 18.6569 19.8284 19.8284C18.6569 21 16.7712 21 13 21H15" fill="currentColor" fillOpacity="0.18" stroke="none" />
    </svg>
  );
}



function AccountMenuSettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M15.5 12C15.5 13.933 13.933 15.5 12 15.5C10.067 15.5 8.5 13.933 8.5 12C8.5 10.067 10.067 8.5 12 8.5C13.933 8.5 15.5 10.067 15.5 12Z" />
      <path d="M20.7906 9.15201C21.5969 10.5418 22 11.2366 22 12C22 12.7634 21.5969 13.4582 20.7906 14.848L18.8669 18.1638C18.0638 19.548 17.6623 20.2402 17.0019 20.6201C16.3416 21 15.5402 21 13.9373 21L10.0627 21C8.45982 21 7.6584 21 6.99807 20.6201C6.33774 20.2402 5.93619 19.548 5.13311 18.1638L3.20942 14.848C2.40314 13.4582 2 12.7634 2 12C2 11.2366 2.40314 10.5418 3.20942 9.152L5.13311 5.83621C5.93619 4.45196 6.33774 3.75984 6.99807 3.37992C7.6584 3 8.45982 3 10.0627 3L13.9373 3C15.5402 3 16.3416 3 17.0019 3.37992C17.6623 3.75984 18.0638 4.45197 18.8669 5.83622L20.7906 9.15201Z" />
    </svg>
  );
}

function AccountMenuLogoutIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M18.189 9a15 15 0 0 1 2.654 2.556c.105.13.157.287.157.444m-2.811 3a15 15 0 0 0 2.654-2.556A.7.7 0 0 0 21 12m0 0H8m5-7.472A6 6 0 0 0 3 9v6a6 6 0 0 0 10 4.472" />
    </svg>
  );
}
