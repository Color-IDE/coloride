import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { EditorFindStatus, EditorHandle } from "./core/types";

type TipState = {
  text: string;
  anchorX: number;
  y: number;
  shiftX: number;
  hiding?: boolean;
};

const TIP_EDGE_PAD = 10;

export type EditorFindBarProps = {
  open: boolean;
  handle: EditorHandle | null;
  onClose: () => void;
};

const emptyStatus: EditorFindStatus = { current: 0, total: 0 };

/**
 * In-file find / replace bar (Cursor style) — under the path breadcrumb.
 * Uses EditorHandle search API; not CodeMirror’s default panel.
 */
export function EditorFindBar({ open, handle, onClose }: EditorFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [inSelection, setInSelection] = useState(false);
  /** Document range captured when enabling "find in selection". */
  const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [status, setStatus] = useState<EditorFindStatus>(emptyStatus);
  const [tooltip, setTooltip] = useState<TipState | null>(null);
  const tipShowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  const clearTipTimers = useCallback(() => {
    if (tipShowTimer.current) {
      clearTimeout(tipShowTimer.current);
      tipShowTimer.current = null;
    }
    if (tipHideTimer.current) {
      clearTimeout(tipHideTimer.current);
      tipHideTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearTipTimers(), [clearTipTimers]);

  // Hide tip when find bar closes.
  useEffect(() => {
    if (open) return;
    clearTipTimers();
    setTooltip(null);
  }, [open, clearTipTimers]);

  useLayoutEffect(() => {
    if (!tooltip || tooltip.hiding) return;
    const bubble = tipRef.current?.querySelector<HTMLElement>(".app-status-tooltip-label");
    if (!bubble) return;
    const half = bubble.offsetWidth / 2;
    const minCenter = TIP_EDGE_PAD + half;
    const maxCenter = window.innerWidth - TIP_EDGE_PAD - half;
    const clampedCenter = Math.min(maxCenter, Math.max(minCenter, tooltip.anchorX));
    const nextShift = clampedCenter - tooltip.anchorX;
    if (Math.abs(nextShift - tooltip.shiftX) > 0.5) {
      setTooltip((current) => (current ? { ...current, shiftX: nextShift } : null));
    }
  }, [tooltip]);

  const showTip = useCallback(
    (label: string, event: ReactMouseEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const anchorX = rect.left + rect.width / 2;
      const y = rect.top - 8;
      clearTipTimers();
      if (tooltip && !tooltip.hiding) {
        setTooltip({ ...tooltip, hiding: true });
        tipHideTimer.current = setTimeout(() => {
          setTooltip({ text: label, anchorX, y, shiftX: 0 });
          tipHideTimer.current = null;
        }, 80);
        return;
      }
      tipShowTimer.current = setTimeout(() => {
        setTooltip({ text: label, anchorX, y, shiftX: 0 });
        tipShowTimer.current = null;
      }, 120);
    },
    [clearTipTimers, tooltip],
  );

  const hideTip = useCallback(() => {
    clearTipTimers();
    setTooltip((current) => {
      if (!current || current.hiding) return current;
      return { ...current, hiding: true };
    });
    tipHideTimer.current = setTimeout(() => {
      setTooltip(null);
      tipHideTimer.current = null;
    }, 140);
  }, [clearTipTimers]);

  const tipHandlers = {
    onMouseEnter: (label: string) => (event: ReactMouseEvent<HTMLElement>) => showTip(label, event),
    onMouseLeave: hideTip,
  };

  const options = useCallback(
    () => ({
      query,
      caseSensitive,
      wholeWord,
      regexp,
      replace: replaceText,
      range: inSelection ? selectionRange : null,
    }),
    [query, caseSensitive, wholeWord, regexp, replaceText, inSelection, selectionRange],
  );

  const toggleInSelection = useCallback(() => {
    if (inSelection) {
      setInSelection(false);
      setSelectionRange(null);
      // Clear scope highlight; keep search query if any.
      handle?.setFindQuery({
        query,
        caseSensitive,
        wholeWord,
        regexp,
        replace: replaceText,
        range: null,
      });
      return;
    }
    const range = handle?.getSelectionRange() ?? null;
    if (!range) return; // need a non-empty selection to scope the search
    setSelectionRange(range);
    setInSelection(true);
    // Paint scope immediately (different color) even before the user types.
    handle?.setFindQuery({
      query,
      caseSensitive,
      wholeWord,
      regexp,
      replace: replaceText,
      range,
    });
  }, [handle, inSelection, query, caseSensitive, wholeWord, regexp, replaceText]);

  const runQuery = useCallback(
    (jump: "next" | "none" = "none") => {
      if (!handle) {
        setStatus(emptyStatus);
        return emptyStatus;
      }
      // Always push options so selection-scope highlight stays while typing.
      const next = handle.setFindQuery(options(), jump);
      setStatus(query ? next : emptyStatus);
      return query ? next : emptyStatus;
    },
    [handle, options, query],
  );

  // Focus + seed from selection when opening.
  useEffect(() => {
    if (!open) return;
    const selected = handle?.getSelectedText()?.trim() ?? "";
    if (selected && selected.length < 200 && !selected.includes("\n")) {
      setQuery(selected);
    }
    const id = window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, handle]);

  // Focus replace field when opening replace row.
  useEffect(() => {
    if (!open || !replaceOpen) return;
    const id = window.requestAnimationFrame(() => {
      replaceInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, replaceOpen]);

  // Push query to editor while open.
  useEffect(() => {
    if (!open) return;
    runQuery("none");
  }, [open, query, caseSensitive, wholeWord, regexp, replaceText, inSelection, selectionRange, runQuery]);

  // Clear highlights when closing / unmount.
  useEffect(() => {
    if (open) return;
    handle?.clearFind();
    setStatus(emptyStatus);
    setReplaceOpen(false);
    setInSelection(false);
    setSelectionRange(null);
  }, [open, handle]);

  useEffect(() => {
    return () => {
      handle?.clearFind();
    };
  }, [handle]);

  const goNext = () => {
    if (!handle || !query) return;
    // Re-sync query (highlights) then move to the next match.
    handle.setFindQuery(options(), "none");
    setStatus(handle.findNext());
  };

  const goPrev = () => {
    if (!handle || !query) return;
    handle.setFindQuery(options(), "none");
    setStatus(handle.findPrevious());
  };

  const doReplace = () => {
    if (!handle || !query) return;
    // Ensure replace text is on the query before running.
    handle.setFindQuery(options(), "none");
    setStatus(handle.replaceNext());
  };

  const doReplaceAll = () => {
    if (!handle || !query) return;
    handle.setFindQuery(options(), "none");
    setStatus(handle.replaceAll());
  };

  const close = () => {
    handle?.clearFind();
    setStatus(emptyStatus);
    setReplaceOpen(false);
    setInSelection(false);
    setSelectionRange(null);
    onClose();
    handle?.focus();
  };

  if (!open) return null;

  const countLabel =
    !query || status.total === 0
      ? "No results"
      : `${status.current || 0}/${status.total}`;

  const canReplace = Boolean(query && status.total > 0);

  return (
    <>
    <div
      className={`editor-find-bar${replaceOpen ? " is-replace-open" : ""}`}
      role="search"
      aria-label="Search in file"
    >
      {/* Single grid: both rows share column widths so fields match */}
      <div className="editor-find-field editor-find-field-search">
        <input
          ref={inputRef}
          aria-label="Search"
          className="editor-find-input"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) goPrev();
              else goNext();
            }
          }}
          placeholder="Search..."
          spellCheck={false}
          value={query}
        />
        <div className="editor-find-toggles" role="group" aria-label="Match options">
          <FindToggle
            active={caseSensitive}
            label="Match Case"
            onClick={() => setCaseSensitive((v) => !v)}
            onTipEnter={tipHandlers.onMouseEnter("Match Case")}
            onTipLeave={tipHandlers.onMouseLeave}
          >
            <MatchCaseIcon />
          </FindToggle>
          <FindToggle
            active={wholeWord}
            label="Match Whole Word"
            onClick={() => setWholeWord((v) => !v)}
            onTipEnter={tipHandlers.onMouseEnter("Match Whole Word")}
            onTipLeave={tipHandlers.onMouseLeave}
          >
            <WholeWordIcon />
          </FindToggle>
          <FindToggle
            active={regexp}
            label="Use Regular Expression"
            onClick={() => setRegexp((v) => !v)}
            onTipEnter={tipHandlers.onMouseEnter("Use Regular Expression")}
            onTipLeave={tipHandlers.onMouseLeave}
          >
            <RegexpIcon />
          </FindToggle>
        </div>
      </div>

      <button
        aria-label="Find in Selection"
        aria-pressed={inSelection}
        className={`editor-find-selection-btn${inSelection ? " is-active" : ""}`}
        onClick={toggleInSelection}
        onMouseEnter={tipHandlers.onMouseEnter("Find in Selection")}
        onMouseLeave={tipHandlers.onMouseLeave}
        type="button"
      >
        <InSelectionIcon />
      </button>

      <button
        aria-label="Toggle replace"
        aria-pressed={replaceOpen}
        className={`editor-find-replace-btn${replaceOpen ? " is-active" : ""}`}
        onClick={() => setReplaceOpen((v) => !v)}
        onMouseEnter={tipHandlers.onMouseEnter("Toggle Replace")}
        onMouseLeave={tipHandlers.onMouseLeave}
        type="button"
      >
        <ToggleReplaceIcon />
      </button>

      <div className="editor-find-actions">
        <button
          aria-label="Previous match"
          className="editor-find-icon-btn"
          disabled={!query || status.total === 0}
          onClick={goPrev}
          onMouseEnter={tipHandlers.onMouseEnter("Previous Match")}
          onMouseLeave={tipHandlers.onMouseLeave}
          type="button"
        >
          <ChevronIcon dir="up" />
        </button>
        <button
          aria-label="Next match"
          className="editor-find-icon-btn"
          disabled={!query || status.total === 0}
          onClick={goNext}
          onMouseEnter={tipHandlers.onMouseEnter("Next Match")}
          onMouseLeave={tipHandlers.onMouseLeave}
          type="button"
        >
          <ChevronIcon dir="down" />
        </button>
        <span
          className={`editor-find-count${query && status.total === 0 ? " is-empty" : ""}`}
          aria-live="polite"
        >
          {countLabel}
        </span>
        <button
          aria-label="Close search"
          className="editor-find-icon-btn"
          onClick={close}
          onMouseEnter={tipHandlers.onMouseEnter("Close")}
          onMouseLeave={tipHandlers.onMouseLeave}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>

      {replaceOpen ? (
        <>
          <div className="editor-find-field editor-find-field-replace">
            <input
              ref={replaceInputRef}
              aria-label="Replace"
              className="editor-find-input"
              onChange={(event) => setReplaceText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setReplaceOpen(false);
                  inputRef.current?.focus();
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (event.metaKey || event.ctrlKey) doReplaceAll();
                  else doReplace();
                }
              }}
              placeholder="Replace..."
              spellCheck={false}
              value={replaceText}
            />
          </div>
          <div className="editor-find-replace-actions">
            <button
              aria-label="Replace"
              className="editor-find-icon-btn"
              disabled={!canReplace}
              onClick={doReplace}
              onMouseEnter={tipHandlers.onMouseEnter("Replace")}
              onMouseLeave={tipHandlers.onMouseLeave}
              type="button"
            >
              <ReplaceIcon />
            </button>
            <button
              aria-label="Replace all"
              className="editor-find-icon-btn"
              disabled={!canReplace}
              onClick={doReplaceAll}
              onMouseEnter={tipHandlers.onMouseEnter("Replace All")}
              onMouseLeave={tipHandlers.onMouseLeave}
              type="button"
            >
              <ReplaceAllIcon />
            </button>
          </div>
        </>
      ) : null}
    </div>
    {tooltip
      ? createPortal(
          <div
            key={tooltip.text + String(tooltip.anchorX)}
            ref={tipRef}
            className={`app-status-tooltip${tooltip.hiding ? " is-hiding" : ""}`}
            style={
              {
                left: tooltip.anchorX,
                top: tooltip.y,
                ["--tip-shift" as string]: `${tooltip.shiftX}px`,
              } as CSSProperties
            }
          >
            <div className="app-status-tooltip-label">{tooltip.text}</div>
            <span className="app-status-tooltip-pin" aria-hidden="true" />
          </div>,
          document.body,
        )
      : null}
    </>
  );
}

function FindToggle({
  active,
  label,
  onClick,
  onTipEnter,
  onTipLeave,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  onTipEnter?: (event: ReactMouseEvent<HTMLElement>) => void;
  onTipLeave?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`editor-find-toggle${active ? " is-active" : ""}`}
      onClick={onClick}
      onMouseEnter={onTipEnter}
      onMouseLeave={onTipLeave}
      type="button"
    >
      {children}
    </button>
  );
}

function MatchCaseIcon() {
  return (
    <svg
      aria-hidden="true"
      height="17"
      viewBox="0 0 24 24"
      width="17"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="m6.156 14.208l-.915 2.628q-.062.16-.181.243q-.12.082-.28.082q-.263 0-.41-.214t-.049-.466l3.373-9.22q.062-.159.194-.245q.131-.085.29-.085h.374q.16 0 .294.085q.135.086.196.245l3.431 9.206q.098.252-.061.474q-.16.22-.418.22q-.16 0-.298-.095t-.2-.254l-.91-2.604zM6.5 13.3h3.756l-1.85-5.223h-.062zm9.644 4.092q-1.16 0-1.861-.649t-.702-1.62q0-1.061.834-1.697q.833-.636 2.145-.636q.536 0 1.086.11t.97.304v-.589q0-.975-.494-1.482q-.493-.508-1.44-.508q-.413 0-.814.132t-.74.357q-.17.134-.333.078t-.26-.198q-.099-.142-.08-.302t.199-.283q.442-.303.971-.452t1.063-.15q1.437 0 2.133.736t.696 2.207v3.964q0 .19-.131.319q-.132.128-.322.128q-.191 0-.32-.131t-.128-.322v-.567h-.1q-.427.632-.999.942q-.57.31-1.373.31m.07-.812q1.028 0 1.718-.735q.69-.734.69-1.842q-.35-.2-.887-.313q-.535-.112-1.049-.112q-.992 0-1.577.398q-.584.398-.584 1.146q0 .616.467 1.037t1.221.42"
        fill="currentColor"
      />
    </svg>
  );
}

function WholeWordIcon() {
  return (
    <svg
      aria-hidden="true"
      height="17"
      viewBox="0 0 24 24"
      width="17"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="M3.616 18.025q-.672 0-1.144-.472T2 16.41v-1.385q0-.213.143-.357t.357-.143t.357.143t.143.357v1.385q0 .269.173.442t.443.173h16.769q.269 0 .442-.173T21 16.41v-1.385q0-.213.143-.357t.357-.143t.357.143t.143.357v1.385q0 .67-.472 1.143q-.472.472-1.143.472zm4.003-2.82q-1.071 0-1.703-.579q-.633-.58-.633-1.564q0-1.05.745-1.703t1.943-.653q.518 0 1.015.107q.497.106.866.306v-.542q0-.963-.472-1.46q-.472-.496-1.388-.496q-.433 0-.808.113q-.376.112-.748.35q-.148.099-.324.105t-.304-.112q-.13-.118-.131-.293q-.002-.176.14-.28q.47-.367.995-.525q.526-.158 1.167-.158q1.396 0 2.077.719t.68 2.137v3.867q0 .185-.126.31t-.31.127q-.19 0-.316-.126t-.126-.316v-.562h-.094q-.345.615-.885.922t-1.26.307m.512-3.729q-.896 0-1.417.418q-.522.419-.522 1.147q0 .635.404 1.005t1.062.37q.953 0 1.574-.716q.62-.716.62-1.805q-.33-.2-.8-.31t-.921-.109m7.79 3.748q-.794 0-1.36-.334q-.567-.335-.832-.816h-.056v.652q0 .165-.116.282q-.117.116-.282.116t-.294-.129t-.129-.294V5.423q0-.19.129-.32q.129-.128.319-.128t.32.129q.128.129.128.319v2.896l-.075 1h.056q.306-.471.86-.81q.553-.34 1.352-.34q1.311 0 2.101.977t.79 2.593q0 1.577-.777 2.531q-.778.955-2.134.955M15.85 9.05q-.961 0-1.57.776t-.607 1.907q0 1.136.608 1.9t1.569.763t1.505-.734t.543-1.93t-.543-1.938t-1.505-.744"
        fill="currentColor"
      />
    </svg>
  );
}

function RegexpIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M16.6626 3V13M20.9952 5.49567L12.335 10.4957M21.0002 10.4961L12.34 5.49609" />
      <path d="M9.80959 15.3837C10 15.8221 10 16.3814 10 17.5C10 18.6186 10 19.1779 9.80959 19.6163C9.57739 20.1509 9.1509 20.5774 8.61632 20.8096C8.17795 21 7.61863 21 6.5 21C5.38137 21 4.82205 21 4.38368 20.8096C3.8491 20.5774 3.42261 20.1509 3.19041 19.6163C3 19.1779 3 18.6186 3 17.5C3 16.3814 3 15.8221 3.19041 15.3837C3.42261 14.8491 3.8491 14.4226 4.38368 14.1904C4.82205 14 5.38137 14 6.5 14C7.61863 14 8.17795 14 8.61632 14.1904C9.1509 14.4226 9.57739 14.8491 9.80959 15.3837Z" />
    </svg>
  );
}

function InSelectionIcon() {
  return (
    <svg
      aria-hidden="true"
      height="15"
      viewBox="0 0 24 24"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="M18.502 18.5L21 21m-1-6.5a5.5 5.5 0 1 0-11 0a5.5 5.5 0 0 0 11 0M10 3h4M3 10v4m3.5 7A3.5 3.5 0 0 1 3 17.5M17.5 3A3.5 3.5 0 0 1 21 6.5m-18 0A3.5 3.5 0 0 1 6.5 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ToggleReplaceIcon() {
  return (
    <svg
      aria-hidden="true"
      height="15"
      viewBox="0 0 16 16"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h16v16H0z" fill="none" />
      <g fill="currentColor">
        <path d="M14 13v-3c0-1.65-1.35-3-3-3H5.12l-1 1H11c1.1 0 2 .9 2 2v4c.55 0 1-.45 1-1" />
        <path
          clipRule="evenodd"
          d="M10.999 5.5V2.75c0-.985-.879-1.5-1.749-1.5c-.888 0-1.261.303-1.354.396a.515.515 0 0 0-.014.719a.483.483 0 0 0 .693.013c.012-.008.197-.128.674-.128c.03 0 .75.006.75.5v.306A5 5 0 0 0 9.249 3c-1.313 0-2 .754-2 1.5s.687 1.5 2 1.5c.372 0 .661-.063.895-.149a.5.5 0 0 0 .855-.351M9.25 4c.372 0 .606.038.75.074v.737c-.093.074-.303.189-.75.189c-.649 0-1-.258-1-.5s.351-.5 1-.5"
          fillRule="evenodd"
        />
        <path d="M5.001 13.074a3 3 0 0 0-.75-.074c-.649 0-1 .258-1 .5s.351.5 1 .5c.447 0 .657-.115.75-.189z" />
        <path
          clipRule="evenodd"
          d="M12 15v-5a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1m-7.749-4.75c.87 0 1.749.515 1.749 1.5v2.75a.5.5 0 0 1-.855.351A2.6 2.6 0 0 1 4.25 15c-1.313 0-2-.754-2-1.5s.687-1.5 2-1.5c.302 0 .546.023.75.056v-.306c0-.494-.72-.5-.75-.5c-.463 0-.65.113-.672.127l-.002.001a.483.483 0 0 1-.693-.013a.515.515 0 0 1 .014-.719c.093-.093.466-.396 1.354-.396m4.079 1.361A1.62 1.62 0 0 0 8 12.625c0 .388.117.748.33 1.014c.369.462.98.343 1.209.139a.499.499 0 1 1 .669.742C9.86 14.834 9.442 15 9 15c-.555 0-1.071-.261-1.451-.736A2.63 2.63 0 0 1 7 12.625c0-.614.195-1.196.549-1.639c.684-.852 1.873-.966 2.66-.256a.5.5 0 1 1-.669.742c-.229-.206-.839-.325-1.21.139M14 6c1.103 0 2-1.009 2-2.25s-.897-2.25-2-2.25c-.366 0-.705.119-1 .313V.5a.5.5 0 0 0-1 0v5a.5.5 0 0 0 .5.5c.217 0 .397-.14.466-.334c.303.207.654.334 1.034.334m0-3.5c.552 0 1 .561 1 1.25S14.552 5 14 5s-1-.561-1-1.25s.448-1.25 1-1.25"
          fillRule="evenodd"
        />
        <path d="M2 4.5C2 3.673 2.673 3 3.5 3h2.002a.5.5 0 0 1 0 1h-2a.5.5 0 0 0-.5.5v1.793l1.146-1.146a.5.5 0 0 1 .707.707l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 .707-.707L2 6.293z" />
      </g>
    </svg>
  );
}


function ReplaceIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9.66294 20.1111C10 19.6067 10 18.9045 10 17.5C10 16.0955 10 15.3933 9.66294 14.8889C9.51702 14.6705 9.32952 14.483 9.11114 14.3371C8.60669 14 7.90446 14 6.5 14C5.09554 14 4.39331 14 3.88886 14.3371C3.67048 14.483 3.48298 14.6705 3.33706 14.8889C3 15.3933 3 16.0955 3 17.5C3 18.9045 3 19.6067 3.33706 20.1111C3.48298 20.3295 3.67048 20.517 3.88886 20.6629C4.39331 21 5.09554 21 6.5 21C7.90446 21 8.60669 21 9.11114 20.6629C9.32952 20.517 9.51702 20.3295 9.66294 20.1111Z" />
      <path d="M19.5559 3C19.8034 3.05129 20.0058 3.12947 20.1841 3.24863C20.4086 3.39863 20.6014 3.59137 20.7514 3.81586C20.8705 3.99419 20.9487 4.19657 21 4.44408M19.5559 10C19.8034 9.94871 20.0058 9.87053 20.1841 9.75137C20.4086 9.60137 20.6014 9.40863 20.7514 9.18414C20.8705 9.00581 20.9487 8.80343 21 8.55592M14 4.44408C14.0513 4.19657 14.1295 3.99419 14.2486 3.81586C14.3986 3.59137 14.5914 3.39863 14.8159 3.24863C14.9942 3.12947 15.1966 3.05129 15.4441 3M15.4441 10C15.1966 9.94871 14.9942 9.87053 14.8159 9.75137C14.5914 9.60137 14.3986 9.40863 14.2486 9.18414C14.1295 9.00581 14.0513 8.80343 14 8.55592" />
      <path d="M4 7.5C4 7.5 5.84122 9.99998 6.50002 9.99998C7.15882 9.99999 9 7.49998 9 7.49998M6.50002 8.5V6.49998C6.50002 6.03558 6.50002 5.80338 6.52568 5.60843C6.70291 4.26222 7.76224 3.20289 9.10845 3.02566C9.3034 3 9.5356 3 10 3" />
    </svg>
  );
}

function ReplaceAllIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9.66294 20.1111C10 19.6067 10 18.9045 10 17.5C10 16.0955 10 15.3933 9.66294 14.8889C9.51702 14.6705 9.32952 14.483 9.11114 14.3371C8.60669 14 7.90446 14 6.5 14C5.09554 14 4.39331 14 3.88886 14.3371C3.67048 14.483 3.48298 14.6705 3.33706 14.8889C3 15.3933 3 16.0955 3 17.5C3 18.9045 3 19.6067 3.33706 20.1111C3.48298 20.3295 3.67048 20.517 3.88886 20.6629C4.39331 21 5.09554 21 6.5 21C7.90446 21 8.60669 21 9.11114 20.6629C9.32952 20.517 9.51702 20.3295 9.66294 20.1111Z" />
      <path d="M19.5559 3C19.8034 3.05129 20.0058 3.12947 20.1841 3.24863C20.4086 3.39863 20.6014 3.59137 20.7514 3.81586C20.8705 3.99419 20.9487 4.19657 21 4.44408M19.5559 10C19.8034 9.94871 20.0058 9.87053 20.1841 9.75137C20.4086 9.60137 20.6014 9.40863 20.7514 9.18414C20.8705 9.00581 20.9487 8.80343 21 8.55592M14 4.44408C14.0513 4.19657 14.1295 3.99419 14.2486 3.81586C14.3986 3.59137 14.5914 3.39863 14.8159 3.24863C14.9942 3.12947 15.1966 3.05129 15.4441 3M15.4441 10C15.1966 9.94871 14.9942 9.87053 14.8159 9.75137C14.5914 9.60137 14.3986 9.40863 14.2486 9.18414C14.1295 9.00581 14.0513 8.80343 14 8.55592" />
      <path d="M18 14.001C19.0789 14.0057 19.6705 14.0429 20.1111 14.3374C20.3295 14.4833 20.517 14.6708 20.6629 14.8892C21 15.3936 21 16.0958 21 17.5003C21 18.9048 21 19.607 20.6629 20.1114C20.517 20.3298 20.3295 20.5173 20.1111 20.6632C19.6705 20.9577 19.0789 20.9949 18 20.9996" />
      <path d="M12.3371 13.999C13.416 14.0037 14.0076 14.041 14.4482 14.3354C14.6666 14.4813 14.8541 14.6688 15 14.8872C15.3371 15.3916 15.3371 16.0939 15.3371 17.4983C15.3371 18.9028 15.3371 19.605 15 20.1095C14.8541 20.3279 14.6666 20.5154 14.4482 20.6613C14.0076 20.9557 13.416 20.993 12.3371 20.9977" />
      <path d="M4 7.5C4 7.5 5.84122 9.99998 6.50002 9.99998C7.15882 9.99999 9 7.49998 9 7.49998M6.50002 8.5V6.49998C6.50002 6.03558 6.50002 5.80338 6.52568 5.60843C6.70291 4.26222 7.76224 3.20289 9.10845 3.02566C9.3034 3 9.5356 3 10 3" />
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: "up" | "down" }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="15"
      xmlns="http://www.w3.org/2000/svg"
    >
      {dir === "up" ? (
        <path d="M17.9998 15C17.9998 15 13.5809 9.00001 11.9998 9C10.4187 8.99999 5.99985 15 5.99985 15" />
      ) : (
        <path d="M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9" />
      )}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="15"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
