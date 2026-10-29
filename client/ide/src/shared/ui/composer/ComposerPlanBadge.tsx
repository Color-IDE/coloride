import { motion } from "motion/react";

export function ComposerPlanBadge({
  onClear,
  disabled,
  compact = false,
  readOnly = false,
}: {
  onClear(): void;
  disabled?: boolean;
  compact?: boolean;
  readOnly?: boolean;
}) {
  return (
    <motion.span
      className={`agent-composer-mode-badge ${readOnly ? "is-ask" : "is-plan"}${compact ? " is-icon-only" : ""}`}
      initial={{ opacity: 0, scale: 0.94, x: -4 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.94, x: -4 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      {readOnly ? (
        <svg
          aria-hidden="true"
          className="shrink-0"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          className="shrink-0"
          fill="none"
          height="15"
          width="15"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            d="M12.9961 6L20.9961 6M12.9961 12L20.9961 12M12.9961 18L20.9961 18"
            strokeLinecap="round"
          />
          <path
            d="M4.23073 19.3478C4.59827 19.5 5.06421 19.5 5.99609 19.5C6.92798 19.5 7.39392 19.5 7.76146 19.3478C8.25152 19.1448 8.64086 18.7554 8.84385 18.2654C8.99609 17.8978 8.99609 17.4319 8.99609 16.5C8.99609 15.5681 8.99609 15.1022 8.84385 14.7346C8.64086 14.2446 8.25152 13.8552 7.76146 13.6522C7.39392 13.5 6.92798 13.5 5.99609 13.5C5.06421 13.5 4.59827 13.5 4.23073 13.6522C3.74067 13.8552 3.35132 14.2446 3.14833 14.7346C2.99609 15.1022 2.99609 15.5681 2.99609 16.5C2.99609 17.4319 2.99609 17.8978 3.14833 18.2654C3.35132 18.7554 3.74067 19.1448 4.23073 19.3478Z"
            strokeLinejoin="round"
          />
          <path
            d="M2.99609 7.16667C2.99609 7.16667 3.74609 7.16667 4.49609 8.5C4.49609 8.5 6.87845 5.16667 8.99609 4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {!compact ? (readOnly ? "Read-only" : "Plan") : null}
      <button
        aria-label={`Clear ${readOnly ? "Read-only" : "Plan"} mode`}
        className="agent-composer-mode-badge-clear"
        disabled={disabled}
        onClick={onClear}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="14"
          width="14"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6L12 12M12 12L6 18M12 12L18 18M12 12L6 6" />
        </svg>
      </button>
    </motion.span>
  );
}
