const EVENT = "coloride:agent-config-changed";
const channel = () => typeof window.BroadcastChannel === "function"
  ? new window.BroadcastChannel(EVENT) : null;

/** Only invalidation signals cross windows; credentials never enter this channel. */
export function notifyAgentConfigChanged() {
  const bridge = channel();
  bridge?.postMessage("changed");
  bridge?.close();
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeAgentConfigChanges(listener: () => void) {
  const bridge = channel();
  if (bridge) bridge.onmessage = event => { if (event.data === "changed") listener(); };
  window.addEventListener(EVENT, listener);
  return () => { bridge?.close(); window.removeEventListener(EVENT, listener); };
}
