import { useEffect, useId, useReducer, type Dispatch, type SetStateAction } from "react";
import { dismissNotification, getNotifications, notify } from "../../shared/ui/notifications";

/** Preserve error state for recovery while presenting feedback in the shared viewport. */
export function useAgentErrorNotification({ title = "Agent", suppressed = false } = {}):
  readonly [string, Dispatch<SetStateAction<string>>] {
  const notificationId = `agent-error:${useId()}`;
  const [state, setError] = useReducer((current: { message: string; attempt: number }, update: SetStateAction<string>) => {
    const message = typeof update === "function" ? update(current.message) : update;
    if (!message && !current.message) return current;
    return { message, attempt: current.attempt + 1 };
  }, { message: "", attempt: 0 });

  useEffect(() => {
    if (!state.message || suppressed) {
      dismissNotification(notificationId);
      return;
    }
    const existing = getNotifications().find(item => item.id === notificationId);
    // Repeated events do not animate an already visible error. A new attempt
    // after dismissal must still show the same error again.
    if (existing?.description === state.message && existing.title === title) return;
    notify({ id: notificationId, title, description: state.message, kind: "error" });
  }, [notificationId, state, title, suppressed]);

  useEffect(() => () => dismissNotification(notificationId), [notificationId]);
  return [state.message, setError] as const;
}
