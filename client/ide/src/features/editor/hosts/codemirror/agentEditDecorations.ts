import {
  Annotation,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";

/** Marks doc updates from Accept/Reject hunk actions (not user typing). */
export const agentEditRemoteAnnotation = Annotation.define<boolean>();
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutterLineClass,
  gutterWidgetClass,
  lineNumberMarkers,
  lineNumberWidgetMarker,
} from "@codemirror/view";

export type AgentEditMark =
  | { type: "add"; /** 1-based line in the new document */ line: number }
  | {
    type: "del";
    /** Insert ghost before this 1-based line (doc.lines+1 = after last) */
    line: number;
    text: string;
  };

export type AgentEditHunk = {
  id: number;
  /** First affected line in the current (after) document. */
  startLine: number;
  /** Last added line (or startLine when del-only) — actions anchor under this. */
  endLine: number;
  addLines: number[];
  /** Text of each added line, same order as addLines. Used to tell a real edit from a new line. */
  addedTexts?: string[];
  dels: Array<{ text: string; insertBeforeLine: number }>;
};

export const setAgentEditMarks = StateEffect.define<AgentEditMark[] | null>();

export const setAgentEditSession = StateEffect.define<{
  baseline: string;
  hunks: AgentEditHunk[];
} | null>();

const addLineDeco = Decoration.line({ class: "cm-agent-line-add" });
// Number cell shares the line wash. A separate gutter column shoved the
// numbers and clipped the indent guides.
const agentAddBar = new (class extends GutterMarker {
  elementClass = "coloride-hunk-gutter-add";
})();
class DeletedNumberMarker extends GutterMarker {
  elementClass = "coloride-hunk-gutter-del";
  constructor(readonly widget: DeletedLineWidget) {
    super();
  }
  toDOM() {
    return document.createTextNode("");
  }
}
// Fold-chevron column sits between the digits and the code. It needs the
// same wash or it reads as a gap.
const foldAddWash = new (class extends GutterMarker {
  elementClass = "coloride-fold-wash-add";
})();
const foldDelWash = new (class extends GutterMarker {
  elementClass = "coloride-fold-wash-del";
})();

class DeletedLineWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: DeletedLineWidget) {
    return other.text === this.text;
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-agent-line-del-wrap";
    const el = document.createElement("div");
    el.className = "cm-agent-line-del";
    if (!this.text.trim().length) {
      wrap.classList.add("is-empty");
      el.classList.add("is-empty");
    } else {
      el.textContent = this.text;
    }
    el.title = "Previous version — not part of the current file";
    wrap.append(el);
    return wrap;
  }

  updateDOM(dom: HTMLElement) {
    alignDeletedLine(dom);
    return true;
  }

  /**
   * CodeMirror inserts a zero-width caret image before a block widget.
   * That image still takes the line's left padding, so the red row starts
   * with a gap. Measure from the widget itself.
   */
  coordsAt(dom: HTMLElement, _pos: number, side: number) {
    const rect = dom.getBoundingClientRect();
    const x = side < 0 ? rect.left : rect.right;
    return { left: x, right: x, top: rect.top, bottom: rect.bottom };
  }

  ignoreEvent() {
    return true;
  }
}

function alignDeletedLines(view: EditorView) {
  view.requestMeasure({
    read: (v) => {
      const content = v.dom.querySelector(".cm-content");
      const line = content?.querySelector<HTMLElement>(".cm-line");
      const wrap = content?.querySelector<HTMLElement>(".cm-agent-line-del-wrap");
      const text = wrap?.querySelector<HTMLElement>(".cm-agent-line-del");
      if (!line || !wrap || !text) return null;
      // How far the ghost text sits left of real code, ignoring our own margin.
      const applied = parseFloat(text.style.marginLeft) || 0;
      return Math.round(line.getBoundingClientRect().left - (text.getBoundingClientRect().left - applied));
    },
    write: (inset, v) => {
      if (v !== view || inset == null) return;
      const next = `${inset}px`;
      v.dom.querySelectorAll<HTMLElement>(".cm-agent-line-del").forEach((text) => {
        if (text.style.marginLeft !== next) text.style.marginLeft = next;
      });
    },
  });
}

function alignDeletedLine(wrap: HTMLElement) {
  const text = wrap.querySelector<HTMLElement>(".cm-agent-line-del");
  const content = wrap.closest(".cm-content");
  const line = content?.querySelector<HTMLElement>(".cm-line");
  if (!text || !line) return;
  const applied = parseFloat(text.style.marginLeft) || 0;
  const inset = Math.round(line.getBoundingClientRect().left - (text.getBoundingClientRect().left - applied));
  const next = `${inset}px`;
  if (text.style.marginLeft !== next) text.style.marginLeft = next;
}

/**
 * Two review UIs (both live in a viewport overlay — never inside contentDOM):
 *  1) Static bottom-right card:  [ ^ 1/1 v ]  Undo  [Keep]
 *  2) Float under active hunk:   [ ^ n of m v ] Undo⌘N Keep⌘Y
 */
class AgentHunkActionsLayer {
  readonly dom: HTMLElement;
  private card: HTMLElement | null = null;
  private cardCountEl: HTMLElement | null = null;
  private cardPrevBtn: HTMLButtonElement | null = null;
  private cardNextBtn: HTMLButtonElement | null = null;
  private float: HTMLElement | null = null;
  private floatCountEl: HTMLElement | null = null;
  private floatPrevBtn: HTMLButtonElement | null = null;
  private floatNextBtn: HTMLButtonElement | null = null;
  view: EditorView;
  private raf = 0;
  private activeIndex = 0;
  private lastHunkKey = "";
  private navLocked = false;
  /** Cached scroller offset within editor root (stable while scrolling). */
  private scrollerOffsetTop = 0;

  constructor(view: EditorView) {
    this.view = view;
    this.dom = document.createElement("div");
    this.dom.className = "cm-agent-hunk-actions-layer";
    Object.assign(this.dom.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "40",
    });
    const parent = view.dom;
    if (getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }
    parent.appendChild(this.dom);
    view.contentDOM.querySelectorAll(".cm-agent-hunk-float").forEach((el) => el.remove());

    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize, { passive: true });
    view.dom.addEventListener("mousemove", this.onEditorMouseMove, { passive: true });
    this.cacheScrollerOffset();
    this.scheduleMeasure();
  }

  private cacheScrollerOffset() {
    const root = this.view.dom.getBoundingClientRect();
    const sc = this.view.scrollDOM.getBoundingClientRect();
    this.scrollerOffsetTop = sc.top - root.top;
  }

  private onScroll = () => {
    // Sync, no rAF — float top is pure scrollTop math so it tracks 1:1.
    this.positionFloat();
  };

  private onResize = () => {
    this.cacheScrollerOffset();
    this.scheduleMeasure();
  };

  private lockNavFromArrows() {
    this.navLocked = true;
  }

  private setVisible(el: HTMLElement | null, on: boolean) {
    if (!el) return;
    if (on) {
      el.classList.add("is-visible");
      el.style.display = "inline-flex";
      el.style.pointerEvents = "auto";
      el.style.visibility = "visible";
      el.style.opacity = "1";
    } else {
      el.classList.remove("is-visible");
      el.style.display = "none";
      el.style.pointerEvents = "none";
    }
  }

  private onEditorMouseMove = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".cm-agent-hunk-actions")) return;

    const idx = this.hunkIndexAtPoint(event.clientX, event.clientY);
    if (this.navLocked) {
      if (idx == null) this.navLocked = false;
      return;
    }
    if (idx == null || idx === this.activeIndex) return;
    this.activeIndex = idx;
    this.syncLabels(this.getHunks().length);
    this.scheduleMeasure();
  };

  private hunkIndexAtPoint(clientX: number, clientY: number): number | null {
    const hunks = this.getHunks();
    if (!hunks.length) return null;
    let pos: number | null = null;
    try {
      pos = this.view.posAtCoords({ x: clientX, y: clientY });
    } catch {
      pos = null;
    }
    if (pos == null) return null;
    const lineNo = this.view.state.doc.lineAt(pos).number;
    for (let i = 0; i < hunks.length; i += 1) {
      const h = hunks[i]!;
      const starts = [h.startLine, h.endLine, ...h.addLines, ...h.dels.map((d) => d.insertBeforeLine)];
      const start = Math.min(...starts);
      const end = Math.max(...starts, h.endLine);
      if (lineNo >= start && lineNo <= end + 1) return i;
    }
    return null;
  }

  scheduleMeasure() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.measure();
    });
  }

  update(update: { view: EditorView }) {
    this.view = update.view;
    if (!this.getHunks().length) {
      this.card?.remove();
      this.float?.remove();
      this.card = null;
      this.float = null;
    }
    this.scheduleMeasure();
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onResize);
    this.view.dom.removeEventListener("mousemove", this.onEditorMouseMove);
    this.view.contentDOM.querySelectorAll(".cm-agent-hunk-float").forEach((el) => el.remove());
    this.dom.remove();
    this.card = null;
    this.float = null;
  }

  private getHunks(): AgentEditHunk[] {
    try {
      return this.view.state.field(agentEditField).hunks;
    } catch {
      return [];
    }
  }

  private rightInset(): number {
    const root = this.view.dom;
    const candidates = root.querySelectorAll<HTMLElement>(
      ".cm-gutters-after, .cm-minimap-gutter, .coloride-minimap, .cm-minimap",
    );
    let mapW = 0;
    for (const el of candidates) {
      const w = el.getBoundingClientRect().width;
      if (w > mapW) mapW = w;
    }
    return Math.round(mapW) + 12;
  }

  private ensureUi() {
    if (!this.card) {
      this.card = this.buildCard();
      this.dom.appendChild(this.card);
    }
    if (!this.float) {
      this.float = this.buildFloat();
      this.dom.appendChild(this.float);
    } else if (this.float.parentElement !== this.dom) {
      // Recover from any bad contentDOM mount.
      this.dom.appendChild(this.float);
    }
  }

  measure() {
    const hunks = this.getHunks();
    const rightPx = this.rightInset();

    if (!hunks.length) {
      this.setVisible(this.card, false);
      this.setVisible(this.float, false);
      this.activeIndex = 0;
      this.lastHunkKey = "";
      this.navLocked = false;
      return;
    }

    const key = hunks.map((h) => h.id).join(",");
    if (key !== this.lastHunkKey) {
      this.lastHunkKey = key;
      this.activeIndex = Math.min(Math.max(0, this.activeIndex), hunks.length - 1);
      this.navLocked = false;
    }
    this.activeIndex = Math.max(0, Math.min(this.activeIndex, hunks.length - 1));

    this.ensureUi();
    this.syncLabels(hunks.length);
    this.cacheScrollerOffset();

    // Static card — fixed bottom, centered on editor X axis.
    const card = this.card!;
    this.setVisible(card, true);
    card.style.top = "auto";
    card.style.bottom = "12px";
    card.style.left = "50%";
    card.style.right = "auto";
    card.style.transform = "translateX(-50%)";

    if (this.float) {
      this.float.style.right = `${rightPx}px`;
      this.float.style.left = "auto";
      this.float.style.bottom = "auto";
    }
    this.positionFloat();
  }

  /**
   * Place the hover float under the active hunk using scrollTop math only.
   * Avoids coordsAtPos + getBoundingClientRect every frame (that lagged/jittered).
   */
  private positionFloat() {
    const float = this.float;
    if (!float) return;
    const hunks = this.getHunks();
    if (!hunks.length) {
      this.setVisible(float, false);
      return;
    }
    const view = this.view;
    const hunk = hunks[this.activeIndex];
    if (!hunk) {
      this.setVisible(float, false);
      return;
    }

    const doc = view.state.doc;
    const anchor = Math.max(1, Math.min(doc.lines, hunk.endLine || hunk.startLine || 1));
    let block: { top: number; bottom: number; height: number };
    try {
      block = view.lineBlockAt(doc.line(anchor).from);
    } catch {
      this.setVisible(float, false);
      return;
    }

    const scroller = view.scrollDOM;
    const barH = float.offsetHeight || 28;
    const cardH = this.card?.offsetHeight || 36;
    const layerH = this.dom.clientHeight || scroller.clientHeight;
    // Document Y → layer Y: block is in scroller content coords.
    const top = block.bottom - scroller.scrollTop + this.scrollerOffsetTop + 4;
    const minTop = 4;
    const maxTop = layerH - cardH - barH - 16;

    if (top + barH < minTop || top > maxTop + barH) {
      // Fully off-screen — hide without display:none thrash while scrolling.
      float.style.visibility = "hidden";
      float.style.pointerEvents = "none";
      float.style.top = `${Math.round(top)}px`;
      return;
    }

    float.classList.add("is-visible");
    float.style.display = "inline-flex";
    float.style.visibility = "visible";
    float.style.opacity = "1";
    float.style.pointerEvents = "auto";
    float.style.top = `${Math.round(top)}px`;
  }

  /** Best 1-based line to reveal for a hunk (adds, else del anchor, else start). */
  private hunkRevealLine(hunk: AgentEditHunk): number {
    if (hunk.addLines.length) return Math.min(...hunk.addLines);
    if (hunk.dels.length) {
      return Math.min(...hunk.dels.map((d) => d.insertBeforeLine));
    }
    return hunk.startLine || hunk.endLine || 1;
  }

  /**
   * Scroll so the active hunk is clearly in view (room above + below for
   * float / static card). Instant — smooth scroll was easy to cancel and
   * often left bottom hunks half-hidden.
   */
  private scrollToActiveHunk() {
    const hunks = this.getHunks();
    const hunk = hunks[this.activeIndex];
    if (!hunk) return;
    const view = this.view;
    const doc = view.state.doc;
    const scroller = view.scrollDOM;

    const lineNo = Math.max(1, Math.min(doc.lines, this.hunkRevealLine(hunk)));
    const endNo = Math.max(
      lineNo,
      Math.min(
        doc.lines,
        hunk.addLines.length ? Math.max(...hunk.addLines) : hunk.endLine || lineNo,
      ),
    );
    const line = doc.line(lineNo);
    const endLine = doc.line(endNo);

    // CM scroll effect first (updates internal scroll state).
    view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: "center", yMargin: 72 }),
    });

    // Force scrollTop so bottom hunks always move into a comfortable band.
    const apply = () => {
      try {
        const startBlock = view.lineBlockAt(line.from);
        const endBlock = view.lineBlockAt(endLine.from);
        const cardH = this.card?.offsetHeight || 40;
        const marginTop = 64;
        const marginBottom = cardH + 56;
        const viewH = scroller.clientHeight;
        const maxScroll = Math.max(0, scroller.scrollHeight - viewH);

        // Prefer centering the start; if the hunk spans tall, keep end above the card.
        let target = startBlock.top - viewH * 0.3;
        const endNeeds = endBlock.bottom - viewH + marginBottom;
        if (endNeeds > target) target = endNeeds;
        if (startBlock.top - marginTop < target) {
          target = startBlock.top - marginTop;
        }

        target = Math.max(0, Math.min(maxScroll, target));
        if (Math.abs(scroller.scrollTop - target) > 2) {
          scroller.scrollTop = target;
        }
      } catch {
        /* ignore */
      }
      this.cacheScrollerOffset();
      this.positionFloat();
    };

    // After layout from scrollIntoView.
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
    window.setTimeout(apply, 50);
    window.setTimeout(apply, 150);
  }

  private goPrev = () => {
    const hunks = this.getHunks();
    if (hunks.length <= 1) return;
    this.lockNavFromArrows();
    this.activeIndex = (this.activeIndex - 1 + hunks.length) % hunks.length;
    this.syncLabels(hunks.length);
    this.scrollToActiveHunk();
  };

  private goNext = () => {
    const hunks = this.getHunks();
    if (hunks.length <= 1) return;
    this.lockNavFromArrows();
    this.activeIndex = (this.activeIndex + 1) % hunks.length;
    this.syncLabels(hunks.length);
    this.scrollToActiveHunk();
  };

  private onUndo = () => {
    const hunks = this.getHunks();
    const hunk = hunks[this.activeIndex];
    if (!hunk) return;
    const idx = this.activeIndex;
    rejectAgentEditHunk(this.view, hunk.id);
    const next = this.getHunks();
    this.activeIndex = Math.min(idx, Math.max(0, next.length - 1));
    this.scheduleMeasure();
  };

  private onKeep = () => {
    const hunks = this.getHunks();
    const hunk = hunks[this.activeIndex];
    if (!hunk) return;
    const idx = this.activeIndex;
    acceptAgentEditHunk(this.view, hunk.id);
    const next = this.getHunks();
    this.activeIndex = Math.min(idx, Math.max(0, next.length - 1));
    this.scheduleMeasure();
  };

  private syncLabels(total: number) {
    const label = `${this.activeIndex + 1}/${total}`;
    const ofLabel = `${this.activeIndex + 1} of ${total}`;
    if (this.cardCountEl) this.cardCountEl.textContent = label;
    if (this.floatCountEl) this.floatCountEl.textContent = ofLabel;
    const multi = total > 1;
    if (this.cardPrevBtn) this.cardPrevBtn.disabled = !multi;
    if (this.cardNextBtn) this.cardNextBtn.disabled = !multi;
    if (this.floatPrevBtn) this.floatPrevBtn.disabled = !multi;
    if (this.floatNextBtn) this.floatNextBtn.disabled = !multi;
  }

  private isMac(): boolean {
    return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  }

  private mkSvg(pathD: string, size = 12) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.75");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    Object.assign(svg.style, {
      display: "block",
      width: `${size}px`,
      height: `${size}px`,
      flexShrink: "0",
    });
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  private mkKbd(keyLetter: string) {
    const k = document.createElement("span");
    k.className = "cm-agent-hunk-kbd";
    if (this.isMac()) {
      const letter = document.createElement("span");
      letter.textContent = keyLetter;
      k.append(
        this.mkSvg("M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3", 10),
        letter,
      );
    } else {
      k.textContent = `Ctrl+${keyLetter}`;
    }
    return k;
  }

  private wireClick(btn: HTMLButtonElement, onClick: () => void) {
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
  }

  private buildCard(): HTMLElement {
    const mac = this.isMac();
    const row = document.createElement("div");
    row.className = "cm-agent-hunk-actions cm-agent-hunk-card";
    Object.assign(row.style, { position: "absolute", zIndex: "41" });

    const nav = document.createElement("div");
    nav.className = "cm-agent-hunk-nav";

    const mkNavBtn = (pathD: string, title: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cm-agent-hunk-nav-btn";
      btn.title = title;
      btn.append(this.mkSvg(pathD, 13));
      this.wireClick(btn, onClick);
      return btn;
    };

    this.cardPrevBtn = mkNavBtn("m18 15-6-6-6 6", "Previous change", this.goPrev);
    this.cardNextBtn = mkNavBtn("m6 9 6 6 6-6", "Next change", this.goNext);
    this.cardCountEl = document.createElement("span");
    this.cardCountEl.className = "cm-agent-hunk-nav-count";
    this.cardCountEl.textContent = "1/1";
    nav.append(this.cardPrevBtn, this.cardCountEl, this.cardNextBtn);

    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "cm-agent-hunk-btn cm-agent-hunk-undo";
    undo.title = mac ? "Undo this change (⌘N)" : "Undo this change (Ctrl+N)";
    undo.textContent = "Undo";
    this.wireClick(undo, this.onUndo);

    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "cm-agent-hunk-btn cm-agent-hunk-keep";
    keep.title = mac ? "Keep this change (⌘Y)" : "Keep this change (Ctrl+Y)";
    keep.textContent = "Keep";
    this.wireClick(keep, this.onKeep);

    row.append(nav, undo, keep);
    return row;
  }

  private buildFloat(): HTMLElement {
    const mac = this.isMac();
    const row = document.createElement("div");
    row.className = "cm-agent-hunk-actions cm-agent-hunk-float";
    Object.assign(row.style, {
      position: "absolute",
      zIndex: "42",
      display: "none",
      margin: "0",
    });

    const nav = document.createElement("div");
    nav.className = "cm-agent-hunk-nav";

    const mkNavBtn = (pathD: string, title: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cm-agent-hunk-nav-btn";
      btn.title = title;
      btn.append(this.mkSvg(pathD, 13));
      this.wireClick(btn, onClick);
      return btn;
    };

    this.floatPrevBtn = mkNavBtn("m18 15-6-6-6 6", "Previous change", this.goPrev);
    this.floatNextBtn = mkNavBtn("m6 9 6 6 6-6", "Next change", this.goNext);
    this.floatCountEl = document.createElement("span");
    this.floatCountEl.className = "cm-agent-hunk-nav-count";
    this.floatCountEl.textContent = "1 of 1";
    nav.append(this.floatPrevBtn, this.floatCountEl, this.floatNextBtn);

    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "cm-agent-hunk-btn cm-agent-hunk-undo";
    undo.title = mac ? "Undo this change (⌘N)" : "Undo this change (Ctrl+N)";
    undo.append("Undo", this.mkKbd("N"));
    this.wireClick(undo, this.onUndo);

    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "cm-agent-hunk-btn cm-agent-hunk-keep";
    keep.title = mac ? "Keep this change (⌘Y)" : "Keep this change (Ctrl+Y)";
    keep.append("Keep", this.mkKbd("Y"));
    this.wireClick(keep, this.onKeep);

    row.append(nav, undo, keep);
    return row;
  }
}

export const agentHunkActionsPlugin = ViewPlugin.fromClass(
  class {
    layer: AgentHunkActionsLayer;
    constructor(view: EditorView) {
      this.layer = new AgentHunkActionsLayer(view);
      queueMicrotask(() => alignDeletedLines(view));
    }
    update(update: import("@codemirror/view").ViewUpdate) {
      this.layer.update(update);
      if (update.docChanged || update.geometryChanged || update.viewportChanged) {
        alignDeletedLines(update.view);
      }
    }
    destroy() {
      this.layer.destroy();
    }
  },
);

type FieldValue = {
  baseline: string;
  hunks: AgentEditHunk[];
  deco: DecorationSet;
  gutter: RangeSet<GutterMarker>;
  fold: RangeSet<GutterMarker>;
};

const emptyField = (): FieldValue => ({
  baseline: "",
  hunks: [],
  deco: Decoration.none,
  gutter: RangeSet.empty,
  fold: RangeSet.empty,
});

function marksFromHunks(hunks: AgentEditHunk[]): AgentEditMark[] {
  const marks: AgentEditMark[] = [];
  for (const hunk of hunks) {
    for (const d of hunk.dels) {
      marks.push({ type: "del", line: d.insertBeforeLine, text: d.text });
    }
    for (const line of hunk.addLines) {
      marks.push({ type: "add", line });
    }
  }
  return marks;
}

function buildSets(
  state: import("@codemirror/state").EditorState,
  hunks: AgentEditHunk[],
): Pick<FieldValue, "deco" | "gutter" | "fold"> {
  if (!hunks.length) {
    return { deco: Decoration.none, gutter: RangeSet.empty, fold: RangeSet.empty };
  }
  const doc = state.doc;
  const marks = marksFromHunks(hunks);

  const normalized = marks
    .map((m) => {
      if (m.type === "add") {
        return { ...m, line: Math.max(1, Math.min(doc.lines, m.line)) };
      }
      return { ...m, line: Math.max(1, Math.min(doc.lines + 1, m.line)) };
    })
    .sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      if (a.type !== b.type) return a.type === "del" ? -1 : 1;
      return 0;
    });

  type PendingDeco = { from: number; to: number; side: number; deco: Decoration };
  const pending: PendingDeco[] = [];
  const gutterBuilder = new RangeSetBuilder<GutterMarker>();
  const foldBuilder = new RangeSetBuilder<GutterMarker>();
  // Stack multiple del widgets before the same line with increasing side so order is stable.
  let delSide = -1000;

  for (const mark of normalized) {
    if (mark.type === "del") {
      const pos =
        mark.line > doc.lines ? doc.line(doc.lines).to : doc.line(mark.line).from;
      const widget = new DeletedLineWidget(mark.text);
      pending.push({
        from: pos,
        to: pos,
        side: delSide,
        deco: Decoration.widget({
          widget,
          // Negative side → before the line; unique side keeps multi-del order.
          side: delSide,
          block: true,
        }),
      });
      delSide += 1;
    } else {
      const line = doc.line(mark.line);
      pending.push({ from: line.from, to: line.from, side: 0, deco: addLineDeco });
      gutterBuilder.add(line.from, line.from, agentAddBar);
      foldBuilder.add(line.from, line.from, foldAddWash);
    }
  }

  // Accept/Reject live in agentHunkActionsPlugin (viewport-fixed layer), not as line widgets.

  pending.sort((a, b) => a.from - b.from || a.side - b.side || a.to - b.to);
  const decoBuilder = new RangeSetBuilder<Decoration>();
  for (const item of pending) {
    decoBuilder.add(item.from, item.to, item.deco);
  }

  return { deco: decoBuilder.finish(), gutter: gutterBuilder.finish(), fold: foldBuilder.finish() };
}

export const agentEditField = StateField.define<FieldValue>({
  create() {
    return emptyField();
  },
  update(value, tr) {
    let baseline = value.baseline;
    let hunks = value.hunks;
    let sessionFromEffect = false;

    for (const effect of tr.effects) {
      if (effect.is(setAgentEditSession)) {
        sessionFromEffect = true;
        if (!effect.value) {
          return emptyField();
        }
        baseline = effect.value.baseline;
        hunks = effect.value.hunks;
      } else if (effect.is(setAgentEditMarks)) {
        sessionFromEffect = true;
        // Legacy: marks only — keep baseline if any.
        if (!effect.value?.length) {
          return emptyField();
        }
        hunks = hunksFromMarks(effect.value);
      }
    }

    // User (or other non-remote) edits while reviewing: keep the session and
    // recompute green/red against the original baseline instead of wiping UI.
    const isRemote = tr.annotation(agentEditRemoteAnnotation) === true;
    if (
      tr.docChanged
      && !sessionFromEffect
      && !isRemote
      && value.hunks.length > 0
    ) {
      const after = tr.state.doc.toString();
      if (after === baseline) {
        return emptyField();
      }
      const nextHunks = computeAgentEditHunks(baseline, after);
      if (!nextHunks.length) {
        return emptyField();
      }
      return { baseline, hunks: nextHunks, ...buildSets(tr.state, nextHunks) };
    }

    if (
      baseline !== value.baseline
      || hunks !== value.hunks
      || (tr.docChanged && hunks.length)
    ) {
      return { baseline, hunks, ...buildSets(tr.state, hunks) };
    }
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.deco),
    // Wash the existing number cell. A separate column shoved the digits
    // and clipped the indent guides.
    lineNumberMarkers.from(field, (value) => value.gutter),
    lineNumberWidgetMarker.of((_view, widget) =>
      widget instanceof DeletedLineWidget ? new DeletedNumberMarker(widget) : null,
    ),
    gutterLineClass.from(field, (value) => value.fold),
    gutterWidgetClass.of((_view, widget) =>
      widget instanceof DeletedLineWidget ? foldDelWash : null,
    ),
  ],
});

/** @deprecated use agentEditField — kept as alias for imports */
export const agentEditDecorations = agentEditField;

function marksAdjacent(prev: AgentEditMark, next: AgentEditMark): boolean {
  if (prev.type === "add" && next.type === "add") return next.line === prev.line + 1;
  if (prev.type === "del" && next.type === "del") {
    // Multiple deleted lines stack before the same after-line.
    return next.line === prev.line;
  }
  if (prev.type === "del" && next.type === "add") return next.line === prev.line;
  if (prev.type === "add" && next.type === "del") return next.line === prev.line + 1;
  return false;
}

/**
 * ArrowUp/ArrowDown ask CodeMirror to scroll the caret into view. On a short
 * file the review card and deleted-line widgets make that rect look clipped,
 * so scrollTop grows and the document slides up. Swallow the scroll when the
 * caret line is already inside the scroller; a line that is actually off
 * screen still scrolls.
 */
export const agentReviewScrollGuard = EditorView.scrollHandler.of((view, range) => {
  const scroller = view.scrollDOM;
  if (scroller.scrollHeight <= scroller.clientHeight + 1) return true;
  let block: { top: number; bottom: number };
  try {
    block = view.lineBlockAt(range.head);
  } catch {
    return false;
  }
  const top = scroller.scrollTop;
  const bottom = top + scroller.clientHeight;
  return block.top >= top - 1 && block.bottom <= bottom + 1;
});

/**
 * Yellow only for a real in-place edit: one removed line, one added line,
 * and they still share text. A deleted line sitting above a new line (or a
 * new line the user then clears) stays green — equal counts alone are not
 * a modification.
 */
export function addedLineChangeKind(hunk: AgentEditHunk): "add" | "mod" {
  if (hunk.dels.length !== 1 || hunk.addLines.length !== 1) return "add";
  const removed = hunk.dels[0]!.text;
  const added = hunk.addedTexts?.[0] ?? "";
  if (!removed.length || !added.length || removed === added) return "add";
  return sharesLineText(removed, added) ? "mod" : "add";
}

function sharesLineText(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (left.length < 4 || right.length < 4) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const cap = Math.min(left.length, right.length, 24);
  for (let n = cap; n >= 8; n -= 1) {
    if (right.startsWith(left.slice(0, n)) || left.startsWith(right.slice(0, n))) return true;
  }
  return false;
}

export function isAgentDeletedLineWidget(widget: unknown): boolean {
  return widget instanceof DeletedLineWidget;
}

export function hunksFromMarks(marks: AgentEditMark[], after?: string): AgentEditHunk[] {
  if (!marks.length) return [];
  const sorted = [...marks].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.type !== b.type) return a.type === "del" ? -1 : 1;
    return 0;
  });

  const hunks: AgentEditHunk[] = [];
  let bucket: AgentEditMark[] = [];
  let nextId = 1;

  const flush = () => {
    if (!bucket.length) return;
    const addLines = bucket.filter((m): m is Extract<AgentEditMark, { type: "add" }> => m.type === "add").map((m) => m.line);
    const afterLines = after?.split("\n");
    const addedTexts = afterLines
      ? addLines.map((line) => afterLines[line - 1] ?? "")
      : undefined;
    const dels = bucket
      .filter((m): m is Extract<AgentEditMark, { type: "del" }> => m.type === "del")
      .map((m) => ({ text: m.text, insertBeforeLine: m.line }));
    const startLine = Math.min(
      ...addLines,
      ...dels.map((d) => d.insertBeforeLine),
    );
    const endLine = addLines.length
      ? Math.max(...addLines)
      : Math.max(1, startLine);
    hunks.push({
      id: nextId,
      startLine,
      endLine,
      addLines,
      addedTexts,
      dels,
    });
    nextId += 1;
    bucket = [];
  };

  for (const mark of sorted) {
    if (!bucket.length) {
      bucket.push(mark);
      continue;
    }
    const prev = bucket[bucket.length - 1]!;
    if (marksAdjacent(prev, mark)) bucket.push(mark);
    else {
      flush();
      bucket.push(mark);
    }
  }
  flush();
  return hunks;
}

/**
 * Line LCS → add/del marks with correct positions in the *after* document.
 *
 * Important: naïvely backtracking LCS can emit dels with insertBeforeLine past
 * the adds (red ghosts appear *below* green lines). We only recover LCS match
 * pairs, then walk both arrays forward so dels always anchor before the next
 * after-line.
 */
export function computeAgentEditMarks(before: string, after: string): AgentEditMark[] {
  if (before === after) return [];
  const a = before.split("\n");
  const b = after.split("\n");

  // Trim unchanged edges before LCS. For a very large changed region, keep
  // both sides of a coarse replacement so Undo can never erase the original.
  if (a.length * b.length > 400_000) {
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    let endA = a.length, endB = b.length;
    while (endA > prefix && endB > prefix && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    const oldLines = a.slice(prefix, endA), newLines = b.slice(prefix, endB);
    if (oldLines.length && newLines.length && oldLines.length * newLines.length <= 400_000) {
      return computeAgentEditMarks(oldLines.join("\n"), newLines.join("\n"))
        .map(mark => ({ ...mark, line: mark.line + prefix }));
    }
    return [
      ...oldLines.map(text => ({ type: "del" as const, line: prefix + 1, text })),
      ...newLines.map((_, i) => ({ type: "add" as const, line: prefix + i + 1 })),
    ];
  }

  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i += 1) {
    const row = dp[i]!;
    const prev = dp[i - 1]!;
    for (let j = 1; j <= m; j += 1) {
      row[j] =
        a[i - 1] === b[j - 1] ? ((prev[j - 1]! + 1) as number) : Math.max(prev[j]!, row[j - 1]!);
    }
  }

  // Recover LCS match pairs (0-based indices into a/b).
  const matchedA = new Array<boolean>(n).fill(false);
  const matchedB = new Array<boolean>(m).fill(false);
  {
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        matchedA[i - 1] = true;
        matchedB[j - 1] = true;
        i -= 1;
        j -= 1;
      } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
        i -= 1;
      } else {
        j -= 1;
      }
    }
  }

  // Forward walk: dels anchor at the next after-line (1-based), then adds.
  const marks: AgentEditMark[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && matchedA[i] && matchedB[j]) {
      i += 1;
      j += 1;
      continue;
    }
    // Delete unmatched before-lines; they sit before after-line (j+1).
    while (i < n && !matchedA[i]) {
      marks.push({
        type: "del",
        line: j < m ? j + 1 : m + 1,
        text: a[i]!,
      });
      i += 1;
    }
    // Add unmatched after-lines.
    while (j < m && !matchedB[j]) {
      marks.push({ type: "add", line: j + 1 });
      j += 1;
    }
  }
  return marks;
}

export function computeAgentEditHunks(before: string, after: string): AgentEditHunk[] {
  return hunksFromMarks(computeAgentEditMarks(before, after), after);
}

export function applyAgentEditMarks(view: EditorView, before: string, after: string) {
  const hunks = computeAgentEditHunks(before, after);
  view.dispatch({
    effects: setAgentEditSession.of(hunks.length ? { baseline: before, hunks } : null),
  });
}

function withCurrentAddedTexts(hunks: AgentEditHunk[], doc: string): AgentEditHunk[] {
  const lines = doc.split("\n");
  return hunks.map((hunk) => ({
    ...hunk,
    addedTexts: hunk.addLines.map((line) => lines[line - 1] ?? ""),
  }));
}

function shiftHunk(hunk: AgentEditHunk, delta: number): AgentEditHunk {
  if (!delta) return hunk;
  return {
    ...hunk,
    startLine: Math.max(1, hunk.startLine + delta),
    endLine: Math.max(1, hunk.endLine + delta),
    addLines: hunk.addLines.map((l) => Math.max(1, l + delta)),
    addedTexts: hunk.addedTexts,
    dels: hunk.dels.map((d) => ({
      ...d,
      insertBeforeLine: Math.max(1, d.insertBeforeLine + delta),
    })),
  };
}

/** Undo one hunk inside `doc`. Returns the restored text. */
export function applyHunkRejectToDoc(doc: string, hunk: AgentEditHunk): string {
  const lines = doc.split("\n");
  const adds = [...hunk.addLines].sort((a, b) => b - a);
  for (const ln of adds) {
    if (ln >= 1 && ln <= lines.length) lines.splice(ln - 1, 1);
  }
  const addCountBefore = (line: number) => hunk.addLines.filter((a) => a < line).length;
  const delsSorted = [...hunk.dels].sort((a, b) => a.insertBeforeLine - b.insertBeforeLine);
  let inserted = 0;
  for (const d of delsSorted) {
    const pos = d.insertBeforeLine - addCountBefore(d.insertBeforeLine) + inserted;
    const idx = Math.max(0, Math.min(lines.length, pos - 1));
    lines.splice(idx, 0, d.text);
    inserted += 1;
  }
  return lines.join("\n");
}

export type AgentEditHunkResult = {
  remaining: number;
  content: string;
  baseline: string;
  changed: boolean;
};

function notifyHunkListeners(view: EditorView, result: AgentEditHunkResult) {
  const listeners = hunkResultListeners.get(view);
  if (!listeners) return;
  for (const fn of listeners) fn(result);
}

const hunkResultListeners = new WeakMap<EditorView, Set<(r: AgentEditHunkResult) => void>>();

export function subscribeAgentEditHunkResults(
  view: EditorView,
  listener: (r: AgentEditHunkResult) => void,
): () => void {
  let set = hunkResultListeners.get(view);
  if (!set) {
    set = new Set();
    hunkResultListeners.set(view, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

export function acceptAgentEditHunk(view: EditorView, hunkId: number): AgentEditHunkResult {
  const field = view.state.field(agentEditField);
  const content = view.state.doc.toString();
  const nextHunks = withCurrentAddedTexts(
    field.hunks.filter((h) => h.id !== hunkId),
    content,
  );
  const baseline = [...nextHunks].reverse().reduce(applyHunkRejectToDoc, content);
  view.dispatch({
    effects: setAgentEditSession.of(
      nextHunks.length ? { baseline, hunks: nextHunks } : null,
    ),
  });
  const result: AgentEditHunkResult = {
    remaining: nextHunks.length,
    content,
    baseline,
    changed: false,
  };
  notifyHunkListeners(view, result);
  return result;
}

export function rejectAgentEditHunk(view: EditorView, hunkId: number): AgentEditHunkResult {
  const field = view.state.field(agentEditField);
  const hunk = field.hunks.find((h) => h.id === hunkId);
  if (!hunk) {
    return {
      remaining: field.hunks.length,
      content: view.state.doc.toString(),
      baseline: field.baseline,
      changed: false,
    };
  }

  const beforeDoc = view.state.doc.toString();
  const nextContent = applyHunkRejectToDoc(beforeDoc, hunk);
  const delta = hunk.dels.length - hunk.addLines.length;
  const endCut = hunk.endLine;
  const nextHunks = withCurrentAddedTexts(
    field.hunks
      .filter((h) => h.id !== hunkId)
      .map((h) => (h.startLine > endCut ? shiftHunk(h, delta) : h)),
    nextContent,
  );

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: nextContent },
    effects: setAgentEditSession.of(
      nextHunks.length ? { baseline: field.baseline, hunks: nextHunks } : null,
    ),
    annotations: agentEditRemoteAnnotation.of(true),
  });

  const result: AgentEditHunkResult = {
    remaining: nextHunks.length,
    content: nextContent,
    baseline: field.baseline,
    changed: nextContent !== beforeDoc,
  };
  notifyHunkListeners(view, result);
  return result;
}

export function acceptAllAgentEditHunks(view: EditorView): AgentEditHunkResult {
  const field = view.state.field(agentEditField);
  const content = view.state.doc.toString();
  view.dispatch({ effects: setAgentEditSession.of(null) });
  const result: AgentEditHunkResult = {
    remaining: 0,
    content,
    baseline: field.baseline,
    changed: false,
  };
  notifyHunkListeners(view, result);
  return result;
}

export function rejectAllAgentEditHunks(view: EditorView): AgentEditHunkResult {
  const field = view.state.field(agentEditField);
  const baseline = field.baseline;
  const beforeDoc = view.state.doc.toString();
  if (!baseline && !field.hunks.length) {
    return { remaining: 0, content: beforeDoc, baseline: "", changed: false };
  }
  const content = [...field.hunks].reverse().reduce(applyHunkRejectToDoc, beforeDoc);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    effects: setAgentEditSession.of(null),
    annotations: agentEditRemoteAnnotation.of(true),
  });
  const result: AgentEditHunkResult = {
    remaining: 0,
    content,
    baseline,
    changed: content !== beforeDoc,
  };
  notifyHunkListeners(view, result);
  return result;
}

export function getAgentEditFieldState(view: EditorView): FieldValue {
  return view.state.field(agentEditField);
}
