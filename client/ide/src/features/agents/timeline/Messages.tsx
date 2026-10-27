import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { api } from "../../../shared/api/client";
import { resolveAgentPlugin } from "../sessionPlugins";
import { pluginArtworkSrc } from "../SlashCommandMenu";
import { CopyCheckIcon, CopyMessageIcon, DislikeIcon, LikeIcon } from "./icons";
import { AgentMessageText } from "./Markdown";
import {
  USER_MESSAGE_CLAMP_LINES,
  hasNonEmptyTextSelection,
} from "./Primitives";
import { type AgentTimelineEntry, type AgentUserAttachment } from "./types";

export const IMAGE_PREVIEW_GAP = 6;

export const IMAGE_PREVIEW_MAX_WIDTH = 760;

export const IMAGE_PREVIEW_MAX_HEIGHT = 620;

export const IMAGE_PREVIEW_DELAY_MS = 500;

export const imagePreviewCache = new Map<string, string>();

export function fitImagePreview(
  naturalW: number,
  naturalH: number,
  maxW: number,
  maxH: number,
) {
  const scale = Math.min(
    1,
    maxW / Math.max(naturalW, 1),
    maxH / Math.max(naturalH, 1),
  );
  return {
    width: Math.max(1, Math.round(naturalW * scale)),
    height: Math.max(1, Math.round(naturalH * scale)),
  };
}

export function formatUserAttachmentSize(bytes?: number): string {
  if (bytes == null || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UserImageAttachment({
  name,
  path,
  size,
  src,
}: {
  name: string;
  path?: string | null;
  size?: number;
  src: string;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CSSProperties | null>(null);
  const [fullSrc, setFullSrc] = useState(src);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const sizeLabel = formatUserAttachmentSize(size);
  const thumbSrc = src || fullSrc;

  useEffect(() => {
    if (src) {
      setFullSrc(src);
      return;
    }
    if (!path) return;
    const cached = imagePreviewCache.get(path);
    if (cached) {
      setFullSrc(cached);
      return;
    }
    void api
      .readFile(path)
      .then((file) => {
        const mime = name.toLowerCase().endsWith(".png")
          ? "image/png"
          : name.toLowerCase().endsWith(".webp")
            ? "image/webp"
            : name.toLowerCase().endsWith(".gif")
              ? "image/gif"
              : "image/jpeg";
        const next = file.content.startsWith("data:")
          ? file.content
          : `data:${mime};base64,${file.content}`;
        imagePreviewCache.set(path, next);
        setFullSrc(next);
      })
      .catch(() => {
        /* keep placeholder */
      });
  }, [name, path, src]);

  useEffect(() => {
    if (!fullSrc) return;
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setNatural({ w: image.naturalWidth, h: image.naturalHeight });
      }
    };
    image.src = fullSrc;
  }, [fullSrc]);

  const placePreview = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    const spaceAbove = Math.max(80, rect.top - 12);
    const spaceBelow = Math.max(80, window.innerHeight - rect.bottom - 12);
    const naturalW = natural?.w ?? 1600;
    const naturalH = natural?.h ?? 1000;
    const placeBelow =
      spaceAbove <
        Math.min(IMAGE_PREVIEW_MAX_HEIGHT, naturalH) + IMAGE_PREVIEW_GAP &&
      spaceBelow > spaceAbove;
    const maxW = Math.min(IMAGE_PREVIEW_MAX_WIDTH, window.innerWidth - 24);
    const maxH = Math.min(
      IMAGE_PREVIEW_MAX_HEIGHT,
      placeBelow ? spaceBelow : spaceAbove,
    );
    const size = fitImagePreview(naturalW, naturalH, maxW, maxH);
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - size.width - 12),
    );
    return {
      left,
      width: size.width,
      height: size.height,
      top: placeBelow ? rect.bottom + IMAGE_PREVIEW_GAP : undefined,
      bottom: placeBelow
        ? undefined
        : window.innerHeight - rect.top + IMAGE_PREVIEW_GAP,
    } satisfies CSSProperties;
  }, [natural]);

  const openPreview = useCallback(() => {
    setOpen(true);
    setPreview(placePreview());
    if (!path || imagePreviewCache.has(path) || fullSrc !== src) {
      const cached = path ? imagePreviewCache.get(path) : null;
      if (cached) setFullSrc(cached);
      return;
    }
    void api
      .readFile(path)
      .then((file) => {
        const mime = name.toLowerCase().endsWith(".png")
          ? "image/png"
          : name.toLowerCase().endsWith(".webp")
            ? "image/webp"
            : name.toLowerCase().endsWith(".gif")
              ? "image/gif"
              : "image/jpeg";
        const next = file.content.startsWith("data:")
          ? file.content
          : `data:${mime};base64,${file.content}`;
        imagePreviewCache.set(path, next);
        setFullSrc(next);
      })
      .catch(() => {
        /* keep compact preview */
      });
  }, [fullSrc, name, path, placePreview, src]);

  const showPreview = useCallback(() => {
    if (hoverTimerRef.current != null)
      window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      openPreview();
    }, IMAGE_PREVIEW_DELAY_MS);
  }, [openPreview]);

  const hidePreview = useCallback(() => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setOpen(false);
    setPreview(null);
  }, []);

  useEffect(
    () => () => {
      if (hoverTimerRef.current != null)
        window.clearTimeout(hoverTimerRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const next = placePreview();
    if (next) setPreview(next);
    const onMove = () => {
      const moved = placePreview();
      if (moved) setPreview(moved);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [natural, open, placePreview]);

  return (
    <div
      className="agent-user-attachment is-image"
      onMouseEnter={showPreview}
      onMouseLeave={hidePreview}
      ref={triggerRef}
      title={sizeLabel ? `${name} · ${sizeLabel}` : name}
    >
      {thumbSrc ? (
        <img
          alt=""
          className="agent-user-attachment-thumb"
          draggable={false}
          src={thumbSrc}
        />
      ) : (
        <span
          aria-hidden="true"
          className="agent-user-attachment-thumb is-placeholder"
        />
      )}
      <span className="agent-user-attachment-meta">
        <span className="agent-user-attachment-name">{name}</span>
        {sizeLabel ? (
          <span className="agent-user-attachment-size">{sizeLabel}</span>
        ) : null}
      </span>
      {preview && thumbSrc && typeof document !== "undefined"
        ? createPortal(
            <div
              className="agent-user-attachment-preview is-open"
              style={preview}
            >
              <img alt="" draggable={false} src={fullSrc || thumbSrc} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function AgentUserMessage({
  text,
  sticky,
  attachments = [],
  pluginIds = [],
}: {
  text: string;
  sticky: boolean;
  attachments?: AgentUserAttachment[];
  pluginIds?: string[];
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  // Strip legacy wall-of-text attachment dumps when we have structured attachments.
  const displayText = useMemo(() => stripLegacyAttachmentText(text), [text]);

  const measureOverflow = useCallback(() => {
    const measure = measureRef.current;
    const visible = textRef.current;
    if (!measure || !visible) return;
    const styles = window.getComputedStyle(visible);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 18;
    const padY =
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0);
    const clampHeight = lineHeight * USER_MESSAGE_CLAMP_LINES + padY;
    setOverflowing(measure.scrollHeight > clampHeight + 1);
  }, []);

  useLayoutEffect(() => {
    measureOverflow();
  }, [displayText, expanded, measureOverflow]);

  useEffect(() => {
    const el = measureRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureOverflow());
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureOverflow]);

  // Fresh message → start clamped again.
  useEffect(() => {
    setExpanded(false);
  }, [displayText]);

  // Always clamp unless the user expanded. Fade only when content overflows 3 lines.
  const showClamp = !expanded;
  const showFade = showClamp && overflowing;
  const interactive = overflowing || expanded;
  const hasText = Boolean(displayText.trim());

  return (
    <div className={`agent-user-message-wrap${sticky ? " is-sticky" : ""}`}>
      <div
        className={`agent-user-message${showClamp ? " is-clamped" : ""}${expanded ? " is-expanded" : ""}${showFade ? " has-fade" : ""}${attachments.length ? " has-attachments" : ""}${pluginIds.length ? " has-plugins" : ""}`}
      >
        {attachments.length > 0 ? (
          <div className="agent-user-attachments" aria-label="Attached files">
            {attachments.map((item, index) => {
              const key = `${item.name}-${index}`;
              const isImage =
                item.kind === "image" || Boolean(item.previewDataUrl);
              if (isImage) {
                return (
                  <UserImageAttachment
                    key={key}
                    name={item.name || "Image"}
                    path={item.path}
                    size={item.size}
                    src={item.previewDataUrl || ""}
                  />
                );
              }
              if (item.kind === "code") {
                const range =
                  item.startLine != null
                    ? `${item.startLine}:${item.endLine ?? item.startLine}`
                    : null;
                return (
                  <div
                    className="agent-user-attachment is-code-chip"
                    key={key}
                    title={item.path || item.name}
                  >
                    <span
                      aria-hidden="true"
                      className="agent-user-code-chip-icon"
                    >
                      <svg
                        fill="none"
                        height="14"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.75"
                        viewBox="0 0 24 24"
                        width="14"
                      >
                        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                        <path d="M14 3v5h5" />
                      </svg>
                    </span>
                    <span className="agent-user-code-chip-label">
                      {item.name}
                      {range ? (
                        <span className="agent-user-code-chip-range">
                          {" "}
                          ({range})
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              }
              return (
                <div
                  className="agent-user-attachment is-file"
                  key={key}
                  title={item.path || item.name}
                >
                  <span className="agent-user-attachment-ext">
                    {(item.name.includes(".")
                      ? item.name.split(".").pop()
                      : "FILE"
                    )
                      ?.slice(0, 5)
                      .toUpperCase() || "FILE"}
                  </span>
                  <span className="agent-user-attachment-name">
                    {item.name}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        {pluginIds.length ? (
          <div className="agent-user-plugin-badges" aria-label="Plugins">
            {pluginIds.map((id) => {
              const plugin = resolveAgentPlugin(id);
              const artwork = pluginArtworkSrc(plugin.id);
              return (
                <span
                  className="agent-user-plugin-badge"
                  key={plugin.id}
                  title={plugin.name}
                >
                  {artwork ? (
                    <img
                      alt=""
                      className="agent-user-plugin-badge-mark"
                      src={artwork}
                    />
                  ) : null}
                  <span>{plugin.name}</span>
                </span>
              );
            })}
          </div>
        ) : null}
        {hasText ? (
          <>
            {/* Hidden full-height twin used only to detect overflow without chicken/egg. */}
            <div
              aria-hidden="true"
              className="agent-user-message-measure"
              ref={measureRef}
            >
              {displayText}
            </div>
            <div
              className={`agent-user-message-text${showClamp ? " is-clamped" : ""}${showFade ? " has-fade" : ""}`}
              onClick={() => {
                // Selecting text fires click on mouseup — don't toggle clamp and wipe the selection.
                if (!interactive || hasNonEmptyTextSelection()) return;
                setExpanded((value) => !value);
              }}
              ref={textRef}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              title={
                interactive
                  ? expanded
                    ? "Show less"
                    : "Show full message"
                  : undefined
              }
              onKeyDown={(event) => {
                if (!interactive) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setExpanded((value) => !value);
              }}
            >
              {displayText}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Drop old "Attached files: / [Image attachment saved…]" blobs from history text. */
export function stripLegacyAttachmentText(text: string): string {
  const cleaned = text
    .replace(/\n*Attached files:\n(?:\d+\.\s+.+\n?)+/gi, "\n")
    .replace(/\n*\[Image attachment saved to workspace:[^\]]*\]/gi, "")
    .replace(/\n*\[File attachment saved to workspace:[^\]]*\]/gi, "")
    .replace(/\n*\[Image attachment:[^\]]*\]/gi, "")
    .replace(/\n*\[File attachment:[^\]]*\]/gi, "")
    // Code-ref bodies inlined for the model — UI shows chips instead.
    .replace(
      /(?:^|\n)---\s+.+?\s+\(\d+:\d+\)\s+---\n[\s\S]*?(?=\n---\s+|$)/g,
      "\n",
    )
    .replace(/(?:^|\n)---\s+.+?\s+---\n[\s\S]*?(?=\n---\s+|$)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned;
}

export const AgentAssistantActions = memo(function AgentAssistantActions({
  entry,
}: {
  entry: Extract<AgentTimelineEntry, { kind: "assistant" }>;
}) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [copied, setCopied] = useState(false);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Ignore clipboard failures (permissions / insecure context).
    }
  };

  return (
    <div className="agent-assistant-footer agent-timeline-enter-soft">
      <AgentAssistantRelativeTime iso={entry.finishedAt} />
      <div className="agent-assistant-actions">
        <button
          aria-label="Like response"
          aria-pressed={feedback === "up"}
          className={`agent-assistant-action agent-assistant-like${feedback === "up" ? " is-active" : ""}`}
          onClick={() =>
            setFeedback((current) => (current === "up" ? null : "up"))
          }
          type="button"
        >
          <LikeIcon />
        </button>
        <button
          aria-label="Dislike response"
          aria-pressed={feedback === "down"}
          className={`agent-assistant-action agent-assistant-dislike${feedback === "down" ? " is-active" : ""}`}
          onClick={() =>
            setFeedback((current) => (current === "down" ? null : "down"))
          }
          type="button"
        >
          <DislikeIcon />
        </button>
        <button
          aria-label={copied ? "Copied" : "Copy response"}
          className={`agent-assistant-action${copied ? " is-active is-copied" : ""}`}
          onClick={() => void copyMessage()}
          type="button"
        >
          {copied ? <CopyCheckIcon /> : <CopyMessageIcon />}
        </button>
      </div>
    </div>
  );
});

export const AgentAssistantMessage = memo(function AgentAssistantMessage({
  entry,
  onOpenBrowserUrl,
}: {
  entry: Extract<AgentTimelineEntry, { kind: "assistant" }>;
  turnActive: boolean;
  onOpenBrowserUrl?: (url: string) => void;
}) {
  // Like/copy only on the true end-of-turn bubble (see applyAssistantFinality).
  // Intermediate text before tools must never show the footer icons.
  const finished = !entry.streaming && entry.final;

  if (!entry.text.trim()) return null;

  return (
    <div
      className={`agent-assistant-message mb-3 text-sm leading-6${entry.streaming ? " is-streaming" : ""}${finished ? " is-finished" : ""}`}
    >
      <AgentMessageText
        onOpenBrowserUrl={onOpenBrowserUrl}
        streaming={entry.streaming}
        text={entry.text}
      />
      {finished ? <AgentAssistantActions entry={entry} /> : null}
    </div>
  );
});

/** Own component: interval state must not re-render the message body / markdown. */
export function AgentAssistantRelativeTime({ iso }: { iso: string | null }) {
  const relative = useRelativeTime(iso, Boolean(iso));
  if (!relative) return null;
  return <span className="agent-assistant-time">{relative}</span>;
}

export function useRelativeTime(iso: string | null, active: boolean) {
  const [label, setLabel] = useState(() => relativeTimeLabel(iso));

  useEffect(() => {
    if (!active || !iso) {
      setLabel("");
      return;
    }
    const tick = () => {
      const next = relativeTimeLabel(iso);
      setLabel((current) => (current === next ? current : next));
    };
    tick();
    // Tick every second while young so "just now" / "Xs ago" stay accurate.
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [active, iso]);

  return label;
}

export function relativeTimeLabel(iso: string | null): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  return formatRelativeTime(Math.max(0, Date.now() - then));
}

export function formatRelativeTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
