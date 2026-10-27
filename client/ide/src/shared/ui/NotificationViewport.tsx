import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  dismissAllNotifications, dismissNotification, getNotifications, notify,
  subscribeNotifications, type AppNotification, type NotificationKind,
} from "./notifications";

/** Mount once in the app shell; features only need notify(). */
export function NotificationViewport() {
  const notices = useSyncExternalStore(subscribeNotifications, getNotifications, getNotifications);
  const reducedMotion = useReducedMotion();
  if (typeof document === "undefined") return null;
  return createPortal(
    <section aria-label="Notifications" className="notification-viewport">
      {notices.length > 1 && (
        <div className="notification-summary">
          <span>{notices.length > 3 ? `${notices.length - 3} more ${notices.length === 4 ? "notification" : "notifications"}` : "Notifications"}</span>
          <button type="button" onClick={dismissAllNotifications}>Clear all</button>
        </div>
      )}
      <ol className="notification-stack">
        <AnimatePresence initial={false}>
          {notices.slice(0, 3).map(notice => (
            <motion.li
              key={`${notice.id}:${notice.revision}`}
              layout={!reducedMotion}
              initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: reducedMotion ? 0 : 12 }}
              transition={{ duration: reducedMotion ? 0 : 0.16 }}
            >
              <NotificationCard notice={notice} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>,
    document.body,
  );
}

function NotificationCard({ notice }: { notice: AppNotification }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [busy, setBusy] = useState(false);
  const remaining = useRef(notice.duration);
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    if (!notice.duration || hovered || focused || hidden || busy) return;
    const started = performance.now();
    const timer = window.setTimeout(() => {
      if (getNotifications().some(item => item.id === notice.id && item.revision === notice.revision)) {
        dismissNotification(notice.id);
      }
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [notice.id, notice.revision, notice.duration, hovered, focused, hidden, busy]);

  const runAction = async () => {
    if (!notice.action || busy) return;
    setBusy(true);
    try {
      await notice.action.onClick();
      if (getNotifications().some(item => item.id === notice.id && item.revision === notice.revision)) {
        dismissNotification(notice.id);
      }
    } catch (error) {
      if (getNotifications().some(item => item.id === notice.id && item.revision === notice.revision)) {
        // Keep the failure and retry action visible in the original slot,
        // even when the notification queue is full.
        notify({ id: notice.id, title: notice.title, kind: "error", action: notice.action,
          description: error instanceof Error ? error.message : "Please try again." });
      }
    } finally { setBusy(false); }
  };

  return (
    <article
      className="notification-card" data-kind={notice.kind}
      role={notice.kind === "error" ? "alert" : "status"} aria-atomic="true"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span className="notification-icon"><NotificationIcon kind={notice.kind} /></span>
      <div className="notification-content">
        <p className="notification-title">{notice.title}</p>
        {notice.description && <p className="notification-description">{notice.description}</p>}
        {notice.action && (
          <button className="notification-action" type="button" disabled={busy} aria-busy={busy}
            onClick={() => void runAction()}>{busy ? "Working…" : notice.action.label}</button>
        )}
      </div>
      <button className="notification-close" type="button" aria-label={`Dismiss: ${notice.title}`}
        onClick={() => dismissNotification(notice.id)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
      </button>
    </article>
  );
}

function NotificationIcon({ kind }: { kind: NotificationKind }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {kind === "success" ? <><circle cx="10" cy="10" r="7.25" /><path d="m6.5 10 2.25 2.25 4.75-4.75" /></>
        : kind === "warning" ? <><path d="M8.45 3.7a1.8 1.8 0 0 1 3.1 0l5.6 9.8a1.8 1.8 0 0 1-1.55 2.7H4.4a1.8 1.8 0 0 1-1.55-2.7Z" /><path d="M10 7v3.5m0 2.5h.01" /></>
          : <><circle cx="10" cy="10" r="7.25" /><path d={kind === "error" ? "M10 6v4.5m0 3h.01" : "M10 9v5m0-8h.01"} /></>}
    </svg>
  );
}
