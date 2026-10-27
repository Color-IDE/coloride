(() => {
  // Resolve the saved theme before the first paint, including system mode.
  try {
    const saved = JSON.parse(localStorage.getItem("coloride.app-preferences.v1") || "{}");
    const preference = saved.theme || window.colorideDesktop?.startupAppearance || "system";
    const theme = preference === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : preference === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.startup = "loading";
    if (window.colorideDesktop?.nativeStartupSplash) document.documentElement.dataset.startupSurface = "native";
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === "light" ? "#f7f8f9" : "#171717";
    document.addEventListener("DOMContentLoaded", () => {
      document.body.dataset.theme = theme;
      if (navigator.userAgent.toLowerCase().includes("electron")) document.body.classList.add("electron-frameless");
    });
  } catch {}

  // Apply pointer-cursors preference before React so controls never boot
  // without the hand cursor after a restart (matches Appearance default: on).
  try {
    let pointerOn = true;
    const raw = localStorage.getItem("coloride.app-preferences.v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.pointerCursors === "boolean") {
        pointerOn = parsed.pointerCursors;
      }
    }
    const applyPointer = (el) => {
      if (!el) return;
      el.dataset.pointerCursors = pointerOn ? "true" : "false";
      el.classList.toggle("pointer-cursors-on", pointerOn);
      el.classList.toggle("pointer-cursors-off", !pointerOn);
    };
    applyPointer(document.documentElement);
    document.addEventListener("DOMContentLoaded", () => applyPointer(document.body));
    applyPointer(document.body);
  } catch {}

})();
