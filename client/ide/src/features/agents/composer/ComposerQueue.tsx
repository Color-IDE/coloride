function RestoreIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <path d="M4.47461 6.10018L5.31543 18.1768C5.40886 19.3365 6.28178 21.5536 8.51889 21.8022C10.756 22.0507 15.2503 21.9951 16.0699 21.9951C16.8895 21.9951 19.0128 21.4136 19.0128 19.0059C19.0128 16.5756 16.9833 15.9419 15.7077 15.9635H12.0554M12.0554 15.9635C12.0607 15.7494 12.1515 15.5372 12.3278 15.3828L14.487 13.4924M12.0554 15.9635C12.0497 16.1919 12.1412 16.4224 12.33 16.5864L14.487 18.4609M19.4701 5.82422L19.0023 13.4792" />
      <path d="M3 5.49561H21M16.0555 5.49561L15.3729 4.08911C14.9194 3.15481 14.6926 2.68766 14.3015 2.39631C14.2148 2.33168 14.1229 2.2742 14.0268 2.22442C13.5937 2 13.0739 2 12.0343 2C10.9686 2 10.4358 2 9.99549 2.23383C9.89791 2.28565 9.80479 2.34547 9.71729 2.41317C9.32164 2.7167 9.10044 3.20004 8.65842 4.16854L8.05273 5.49561" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <path d="M19.5 5.5L18.8803 15.5251C18.7219 18.0864 18.6428 19.3671 18.0008 20.2879C17.6833 20.7431 17.2747 21.1273 16.8007 21.416C15.8421 22 14.559 22 11.9927 22C9.42312 22 8.1383 22 7.17905 21.4149C6.7048 21.1257 6.296 20.7408 5.97868 20.2848C5.33688 19.3626 5.25945 18.0801 5.10461 15.5152L4.5 5.5" />
      <path d="M3 5.5H21M16.0557 5.5L15.3731 4.09173C14.9196 3.15626 14.6928 2.68852 14.3017 2.39681C14.215 2.3321 14.1231 2.27454 14.027 2.2247C13.5939 2 13.0741 2 12.0345 2C10.9688 2 10.436 2 9.99568 2.23412C9.8981 2.28601 9.80498 2.3459 9.71729 2.41317C9.32164 2.7167 9.10063 3.20155 8.65861 4.17126L8.05292 5.5" />
      <path d="M9.5 16.5V10.5M14.5 16.5V10.5" />
    </svg>
  );
}

export function ComposerQueue({
  expanded,
  messages,
  onDelete,
  onExpand,
  onRestore,
}: {
  expanded: boolean;
  messages: string[];
  onDelete: (index: number) => void;
  onExpand: () => void;
  onRestore: (index: number) => void;
}) {
  if (messages.length === 0) return null;

  const latest = messages[messages.length - 1] ?? "";
  const canExpand = messages.length > 1;
  const actions = (index: number, stopPropagation = false) => (
    <div className="agent-composer-queue-actions shrink-0">
      <button
        aria-label="Restore queued message to input"
        className="agent-composer-queue-restore"
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation();
          onRestore(index);
        }}
        type="button"
      >
        <RestoreIcon />
      </button>
      <button
        aria-label="Delete queued message"
        className="agent-composer-queue-delete"
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation();
          onDelete(index);
        }}
        type="button"
      >
        <DeleteIcon />
      </button>
    </div>
  );

  return (
    <div className={`agent-composer-queue-stack mb-1.5${expanded ? " is-expanded" : ""}${canExpand ? " is-stackable" : ""}`}>
      {expanded && canExpand ? (
        <div aria-label="Queued messages" className="agent-composer-queue-expanded" role="list">
          {[...messages].reverse().map((message, reverseIndex) => {
            const index = messages.length - 1 - reverseIndex;
            return (
              <div className="agent-composer-queue" key={`q-${index}-${message.slice(0, 24)}`} role="listitem" style={{ animationDelay: `${reverseIndex * 28}ms` }}>
                <span className="agent-composer-queue-text min-w-0 flex-1 truncate" title={message}>{message}</span>
                {actions(index)}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          aria-expanded={canExpand ? false : undefined}
          aria-label={canExpand ? `Show ${messages.length} queued messages` : "Queued message"}
          className={`agent-composer-queue-collapsed${canExpand ? " is-clickable" : ""}`}
          onClick={() => canExpand && onExpand()}
          onKeyDown={(event) => {
            if (!canExpand || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            onExpand();
          }}
          role={canExpand ? "button" : undefined}
          tabIndex={canExpand ? 0 : undefined}
        >
          {canExpand ? (
            <>
              {messages.length > 2 ? <span aria-hidden="true" className="agent-composer-queue-layer is-back" /> : null}
              <span aria-hidden="true" className="agent-composer-queue-layer is-mid" />
            </>
          ) : null}
          <div className="agent-composer-queue is-front">
            <span className="agent-composer-queue-text min-w-0 flex-1 truncate" title={latest}>{latest}</span>
            {canExpand ? <span aria-hidden="true" className="agent-composer-queue-count shrink-0">{messages.length}</span> : actions(messages.length - 1, true)}
          </div>
        </div>
      )}
    </div>
  );
}
