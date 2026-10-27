import { forEachDiagnostic } from "@codemirror/lint";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import { unsavedChangeRanges } from "./changeGutter";

const FADE_MS = 1100;
const MIN_THUMB = 28;
const MARK_H = 2;
const RAIL = 10;
const REAL_OVERFLOW = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type Mark = { y: number; color: string; rank: number };

function lineToY(line: number, docLines: number, track: number) {
  if (docLines <= 1) return 0;
  return ((line - 1) / docLines) * track;
}

function collectMarks(view: EditorView, track: number): Mark[] {
  const docLines = view.state.doc.lines;
  const byLine = new Map<number, Mark>();
  const put = (line: number, color: string, rank: number) => {
    const current = byLine.get(line);
    if (current && current.rank <= rank) return;
    byLine.set(line, { y: lineToY(line, docLines, track), color, rank });
  };

  for (const range of unsavedChangeRanges(view.state)) {
    const color = range.kind === "add" ? "#3fb950" : "#d29922";
    const rank = range.kind === "add" ? 5 : 4;
    const from = Math.max(1, range.fromLine);
    const to = Math.max(from, range.toLine);
    for (let line = from; line <= to; line += 1) put(line, color, rank);
  }

  forEachDiagnostic(view.state, (diag, from) => {
    const line = view.state.doc.lineAt(from).number;
    if (diag.severity === "error") put(line, "#ff6b6b", 1);
    else if (diag.severity === "warning") put(line, "#e3b341", 2);
    else if (diag.severity === "info") put(line, "#6cb6ff", 3);
    else put(line, "#b0b8c0", 6);
  });

  return [...byLine.values()];
}

class OverlayScrollbar {
  readonly dom: HTMLDivElement;
  readonly thumb: HTMLDivElement;
  readonly marks: HTMLCanvasElement;
  private readonly vertical: boolean;
  private hideTimer = 0;
  private dragging = false;
  private dragOffset = 0;

  constructor(vertical: boolean) {
    this.vertical = vertical;
    this.dom = document.createElement("div");
    this.dom.className = `cm-overlay-scrollbar ${vertical ? "is-vert" : "is-horiz"}`;
    this.marks = document.createElement("canvas");
    this.marks.className = "cm-overlay-scrollbar-marks";
    this.thumb = document.createElement("div");
    this.thumb.className = "cm-overlay-scrollbar-thumb";
    this.dom.append(this.marks, this.thumb);
  }

  attach(view: EditorView) {
    view.dom.appendChild(this.dom);
    this.thumb.addEventListener("pointerdown", (event) => this.onPointerDown(view, event));
    this.dom.addEventListener("pointerdown", (event) => this.onTrackDown(view, event));
  }

  destroy() {
    window.clearTimeout(this.hideTimer);
    this.dom.remove();
  }

  flash(view: EditorView) {
    if (this.thumb.hidden) return;
    view.dom.classList.add("is-overlay-scroll-visible");
    window.clearTimeout(this.hideTimer);
    if (this.dragging) return;
    this.hideTimer = window.setTimeout(() => {
      if (!this.dragging) view.dom.classList.remove("is-overlay-scroll-visible");
    }, FADE_MS);
  }

  layout(view: EditorView) {
    const scroller = view.scrollDOM;
    const editor = view.dom.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (this.vertical) {
      const overflow = scroller.scrollHeight - scroller.clientHeight;
      const track = Math.max(0, box.height);
      const marks = collectMarks(view, track);
      const canScroll = overflow > REAL_OVERFLOW;
      this.dom.classList.toggle("is-needed", canScroll || marks.length > 0);
      if (!canScroll && marks.length === 0) return;
      this.dom.style.top = `${Math.round(box.top - editor.top)}px`;
      this.dom.style.left = `${Math.round(box.right - editor.left - RAIL)}px`;
      this.dom.style.right = "auto";
      this.dom.style.height = `${Math.round(track)}px`;
      this.paintMarks(marks, RAIL, track);
      if (canScroll) {
        this.thumb.hidden = false;
        const thumb = clamp((box.height / scroller.scrollHeight) * track, MIN_THUMB, track);
        const maxTop = Math.max(0, track - thumb);
        const top = overflow > 0 ? (scroller.scrollTop / overflow) * maxTop : 0;
        this.thumb.style.height = `${thumb}px`;
        this.thumb.style.transform = `translateY(${top}px)`;
      } else {
        this.thumb.hidden = true;
      }
      return;
    }
    const overflow = scroller.scrollWidth - scroller.clientWidth;
    const canScroll = overflow > REAL_OVERFLOW;
    this.dom.classList.toggle("is-needed", canScroll);
    if (!canScroll) {
      this.thumb.hidden = true;
      return;
    }
    const track = Math.max(0, box.width);
    const thumb = clamp((box.width / scroller.scrollWidth) * track, MIN_THUMB, track);
    const maxLeft = Math.max(0, track - thumb);
    const left = overflow > 0 ? (scroller.scrollLeft / overflow) * maxLeft : 0;
    this.dom.style.left = `${Math.round(box.left - editor.left)}px`;
    this.dom.style.bottom = `${Math.round(editor.bottom - box.bottom)}px`;
    this.dom.style.top = "auto";
    this.dom.style.width = `${Math.round(track)}px`;
    this.thumb.hidden = false;
    this.thumb.style.width = `${thumb}px`;
    this.thumb.style.transform = `translateX(${left}px)`;
  }

  private paintMarks(marks: Mark[], width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    this.marks.width = Math.max(1, Math.round(width * dpr));
    this.marks.height = Math.max(1, Math.round(height * dpr));
    this.marks.style.width = `${width}px`;
    this.marks.style.height = `${height}px`;
    const ctx = this.marks.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const mark of marks) {
      ctx.fillStyle = mark.color;
      ctx.fillRect(0, mark.y, width, MARK_H);
    }
  }

  private onTrackDown(view: EditorView, event: PointerEvent) {
    if (event.button !== 0 || event.target === this.thumb) return;
    if (this.thumb.hidden) return;
    event.preventDefault();
    const scroller = view.scrollDOM;
    const rail = this.dom.getBoundingClientRect();
    if (this.vertical) {
      const overflow = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      const ratio = clamp((event.clientY - rail.top) / Math.max(1, rail.height), 0, 1);
      scroller.scrollTop = ratio * overflow;
    } else {
      const overflow = Math.max(1, scroller.scrollWidth - scroller.clientWidth);
      const ratio = clamp((event.clientX - rail.left) / Math.max(1, rail.width), 0, 1);
      scroller.scrollLeft = ratio * overflow;
    }
  }

  private onPointerDown(view: EditorView, event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
    this.thumb.setPointerCapture(event.pointerId);
    const scroller = view.scrollDOM;
    const thumbBox = this.thumb.getBoundingClientRect();
    this.dragOffset = this.vertical ? event.clientY - thumbBox.top : event.clientX - thumbBox.left;
    const onMove = (move: PointerEvent) => {
      const rail = this.dom.getBoundingClientRect();
      if (this.vertical) {
        const maxTop = Math.max(1, scroller.clientHeight - this.thumb.offsetHeight);
        const overflow = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
        const top = clamp(move.clientY - rail.top - this.dragOffset, 0, maxTop);
        scroller.scrollTop = (top / maxTop) * overflow;
      } else {
        const maxLeft = Math.max(1, scroller.clientWidth - this.thumb.offsetWidth);
        const overflow = Math.max(1, scroller.scrollWidth - scroller.clientWidth);
        const left = clamp(move.clientX - rail.left - this.dragOffset, 0, maxLeft);
        scroller.scrollLeft = (left / maxLeft) * overflow;
      }
    };
    const onUp = () => {
      this.dragging = false;
      this.thumb.removeEventListener("pointermove", onMove);
      this.thumb.removeEventListener("pointerup", onUp);
      this.thumb.removeEventListener("pointercancel", onUp);
      this.flash(view);
    };
    this.thumb.addEventListener("pointermove", onMove);
    this.thumb.addEventListener("pointerup", onUp);
    this.thumb.addEventListener("pointercancel", onUp);
    this.flash(view);
  }
}

export function overlayScrollbar() {
  return ViewPlugin.fromClass(
    class {
      private readonly vertical = new OverlayScrollbar(true);
      private readonly horizontal = new OverlayScrollbar(false);

      constructor(readonly view: EditorView) {
        this.vertical.attach(view);
        this.horizontal.attach(view);
        this.sync();
        view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      }

      update() {
        this.sync();
      }

      destroy() {
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
        this.vertical.destroy();
        this.horizontal.destroy();
      }

      private readonly onScroll = () => {
        this.sync();
        this.vertical.flash(this.view);
        this.horizontal.flash(this.view);
      };

      private sync() {
        this.vertical.layout(this.view);
        this.horizontal.layout(this.view);
      }
    },
  );
}
