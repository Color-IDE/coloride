import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";

type LogoutConfirmDialogProps = {
  open: boolean;
  loggingOut?: boolean;
  email?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Centered logout confirmation: blurred backdrop, Enter = log out, Esc = cancel.
 */
export function LogoutConfirmDialog({
  open,
  loggingOut = false,
  email,
  onCancel,
  onConfirm,
}: LogoutConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => confirmRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!loggingOut) onCancel();
        return;
      }
      if (event.key === "Enter") {
        // Only when focus isn't on Cancel (default is Log out).
        const target = event.target as HTMLElement | null;
        if (target?.closest?.("[data-logout-cancel]")) return;
        event.preventDefault();
        event.stopPropagation();
        if (!loggingOut) onConfirm();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, loggingOut, onCancel, onConfirm]);

  if (typeof document === "undefined") return null;

  const detail = email?.trim()
    ? `You will be signed out of Coloride on this device as ${email.trim()}.`
    : "You will be signed out of Coloride on this device.";

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="logout-confirm-overlay fixed inset-0 z-[1200] flex items-center justify-center p-6"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
        >
          <button
            aria-label="Dismiss"
            className="logout-confirm-backdrop absolute inset-0 cursor-default border-0 bg-black/45"
            disabled={loggingOut}
            onClick={() => {
              if (!loggingOut) onCancel();
            }}
            type="button"
          />
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            aria-describedby="logout-confirm-desc"
            aria-labelledby="logout-confirm-title"
            aria-modal="true"
            className="logout-confirm-card relative z-10 w-full max-w-[400px] rounded-lg bg-[#2a2a2a] p-5"
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            role="dialog"
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <h2
              className="text-[17px] font-semibold tracking-tight text-[#f4f4f5]"
              id="logout-confirm-title"
            >
              Log out?
            </h2>
            <p
              className="mt-2 text-[13px] leading-5 text-[#a1a1aa]"
              id="logout-confirm-desc"
            >
              {detail}
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                className="logout-confirm-cancel flex h-7 items-center justify-center rounded-[4px] px-2.5 text-[12px] font-medium text-[#e4e4e7] transition-colors hover:bg-white/[0.06] disabled:opacity-50"
                data-logout-cancel="true"
                disabled={loggingOut}
                onClick={onCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="logout-confirm-submit flex h-7 items-center justify-center rounded-[4px] bg-red-500/90 px-2.5 text-[12px] font-medium text-white transition-[filter,opacity] hover:brightness-110 disabled:opacity-60"
                disabled={loggingOut}
                onClick={onConfirm}
                ref={confirmRef}
                type="button"
              >
                {loggingOut ? "Logging out…" : "Log out"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
