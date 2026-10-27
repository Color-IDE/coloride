/** Keep the frosted splash above the first real UI, then reveal it gradually. */
export function installStartupTransition() {
  const overlay = document.querySelector<HTMLElement>(".coloride-boot-splash");
  const root = document.getElementById("root");
  if (!overlay || !root) return;
  let revealing = false;
  let finished = false;
  const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const finish = () => {
    if (finished) return;
    finished = true;
    overlay.remove();
    delete document.documentElement.dataset.startup;
    delete document.documentElement.dataset.startupSurface;
  };
  const observer = new MutationObserver(() => { void reveal(); });
  const fallback = window.setTimeout(() => { void reveal(); }, 8_000);
  const reveal = async () => {
    if (revealing || !root.querySelector(".login-gate-app, .login-gate")) return;
    revealing = true;
    observer.disconnect();
    window.clearTimeout(fallback);
    // Commit the destination behind one persistent splash. Electron owns
    // that splash across navigation, so its SVG never restarts here.
    await nextPaint();
    const nativeSplash = window.colorideDesktop?.nativeStartupSplash;
    if (nativeSplash) document.documentElement.dataset.startup = "leaving";
    try {
      await window.colorideDesktop?.finishStartup?.();
    } catch { /* A detached native window must not leave the web overlay stuck. */ }
    if (nativeSplash) {
      finish();
      return;
    }
    // Older desktop hosts settle their native backing before the web fade.
    await nextPaint();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const timeout = window.setTimeout(finish, 560);
    overlay.addEventListener("transitionend", (event) => {
      if (event.target === overlay && event.propertyName === "opacity") {
        window.clearTimeout(timeout);
        finish();
      }
    });
    document.documentElement.dataset.startup = "leaving";
    // CSS transitions do not tick while a window is hidden or background-
    // throttled. The Web Animations timeline still does, so the frosted
    // overlay reaches an intermediate opacity before it is removed.
    overlay.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 420, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" },
    );
  };
  observer.observe(root, { childList: true, subtree: true });
  void reveal();
}
