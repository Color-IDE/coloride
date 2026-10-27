export type NotificationKind = "info" | "success" | "warning" | "error";

export interface NotificationOptions {
  /** Reusing an id replaces the existing notice instead of stacking duplicates. */
  id?: string;
  title: string;
  description?: string;
  kind?: NotificationKind;
  /** Milliseconds on screen; zero stays until dismissed. Actions and errors stay by default. */
  duration?: number;
  action?: { label: string; onClick: () => void | Promise<void> };
}

export interface AppNotification extends Omit<NotificationOptions, "id" | "kind" | "duration"> {
  id: string;
  kind: NotificationKind;
  duration: number;
  revision: number;
}

let sequence = 0;
let notifications: readonly AppNotification[] = [];
const listeners = new Set<() => void>();

export const getNotifications = () => notifications;
export function subscribeNotifications(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: readonly AppNotification[]) {
  notifications = next;
  for (const listener of listeners) listener();
}

export function notify(options: NotificationOptions): string {
  const revision = ++sequence;
  const id = options.id ?? `notification-${revision}`;
  const kind = options.kind ?? "info";
  const duration = options.duration ?? (kind === "error" || options.action ? 0 : 5000);
  const notice: AppNotification = {
    ...options, id, kind, revision,
    duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
  };
  const existing = notifications.findIndex(item => item.id === id);
  publish(existing < 0
    ? [...notifications, notice]
    : notifications.map((item, index) => index === existing ? notice : item));
  return id;
}

export function dismissNotification(id: string) {
  const next = notifications.filter(item => item.id !== id);
  if (next.length !== notifications.length) publish(next);
}

export function dismissAllNotifications() {
  if (notifications.length) publish([]);
}
