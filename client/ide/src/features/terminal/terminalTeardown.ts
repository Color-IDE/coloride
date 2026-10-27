import type { Terminal } from "@xterm/xterm";

type Xterm55Viewport = {
  syncScrollArea: (immediate?: boolean) => void;
  _refreshAnimationFrame: number | null;
};

/** Dispose only the presentation; the session manager owns the persistent PTY. */
export function disposeTerminalView(term: Terminal): void {
  // xterm 5.5's Viewport constructor/reset leave a timeout and RAF that call
  // syncScrollArea after RenderService.dispose has removed its renderer.
  // Confine this version-specific adaptation to teardown: active rendering,
  // input and scrolling use public APIs. The Electron open/reset/dispose
  // regression must pass before removing this adapter on an xterm upgrade.
  const viewport = (term as unknown as { _core?: { viewport?: Xterm55Viewport } })._core?.viewport;
  if (viewport) {
    viewport.syncScrollArea = () => {};
    if (viewport._refreshAnimationFrame !== null) {
      term.element?.ownerDocument.defaultView?.cancelAnimationFrame(viewport._refreshAnimationFrame);
      viewport._refreshAnimationFrame = null;
    }
  }
  term.dispose();
}
