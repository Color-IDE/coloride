/**
 * Far-left change ticks vs the last saved / loaded buffer.
 * Green = added line, yellow = edited line.
 * Click a tick to expand the hunk (old/new, like Zed / agent review).
 */

import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutter,
  keymap,
} from "@codemirror/view";
import {
  addedLineChangeKind,
  applyHunkRejectToDoc,
  computeAgentEditHunks,
  getAgentEditFieldState,
  isAgentDeletedLineWidget,
  type AgentEditHunk,
} from "./agentEditDecorations";

export const resetChangeBaseline = StateEffect.define<string>();
const toggleChangeHunk = StateEffect.define<number | null>();

const addMarker = new (class extends GutterMarker {
  elementClass = "coloride-change-add";
})();

const modMarker = new (class extends GutterMarker {
  elementClass = "coloride-change-mod";
})();

const delMarker = new (class extends GutterMarker {
  elementClass = "coloride-change-del";
})();

const addLineDeco = Decoration.line({ class: "cm-agent-line-add" });
const addGutterWash = new (class extends GutterMarker {
  elementClass = "coloride-hunk-gutter-add";
})();
const delGutterWash = new (class extends GutterMarker {
  elementClass = "coloride-hunk-gutter-del";
})();

class DeletedLineWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: DeletedLineWidget) {
    return other.text === this.text;
  }
  get estimatedHeight() {
    return -1;
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-agent-line-del-wrap";
    const el = document.createElement("div");
    el.className = "cm-agent-line-del";
    if (this.text.length) el.textContent = this.text;
    wrap.append(el);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

function hunkKind(hunk: AgentEditHunk): "add" | "mod" {
  return addedLineChangeKind(hunk);
}

function hunkAtLine(hunks: AgentEditHunk[], line: number): AgentEditHunk | null {
  return hunks.find((hunk) => hunk.addLines.includes(line) || (line >= hunk.startLine && line <= hunk.endLine)) ?? null;
}

function buildMarks(hunks: AgentEditHunk[], current: string) {
  const builder = new RangeSetBuilder<GutterMarker>();
  const lines = current.split("\n");
  const byLine = new Map<number, "add" | "mod">();
  for (const hunk of hunks) {
    const kind = hunkKind(hunk);
    for (const line of hunk.addLines) byLine.set(line, kind);
  }
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const kind = byLine.get(i + 1);
    if (kind === "add") builder.add(offset, offset, addMarker);
    else if (kind === "mod") builder.add(offset, offset, modMarker);
    offset += lines[i]!.length + (i < lines.length - 1 ? 1 : 0);
  }
  return builder.finish();
}

function buildHunkDeco(state: { doc: { line: (n: number) => { from: number; to: number }; lines: number } }, hunk: AgentEditHunk | null): DecorationSet {
  if (!hunk) return Decoration.none;
  const doc = state.doc;
  const pending: Array<{ from: number; to: number; side: number; deco: Decoration }> = [];
  let delSide = -1000;
  for (const del of hunk.dels) {
    const line = Math.max(1, Math.min(doc.lines + 1, del.insertBeforeLine));
    const pos = line > doc.lines ? doc.line(doc.lines).to : doc.line(line).from;
    pending.push({
      from: pos,
      to: pos,
      side: delSide,
      deco: Decoration.widget({
        widget: new DeletedLineWidget(del.text),
        side: delSide,
        block: true,
      }),
    });
    delSide += 1;
  }
  for (const lineNo of hunk.addLines) {
    const line = doc.line(Math.max(1, Math.min(doc.lines, lineNo)));
    pending.push({ from: line.from, to: line.from, side: 0, deco: addLineDeco });
  }
  pending.sort((a, b) => a.from - b.from || a.side - b.side);
  const builder = new RangeSetBuilder<Decoration>();
  for (const item of pending) builder.add(item.from, item.to, item.deco);
  return builder.finish();
}

type ChangeField = {
  baseline: string;
  hunks: AgentEditHunk[];
  marks: ReturnType<typeof buildMarks>;
  expandedId: number | null;
  deco: DecorationSet;
};

function snapshot(baseline: string, current: string, expandedId: number | null, state: { doc: { line: (n: number) => { from: number; to: number }; lines: number } }): ChangeField {
  const hunks = baseline === current ? [] : computeAgentEditHunks(baseline, current);
  const expanded = expandedId != null ? hunks.find((hunk) => hunk.id === expandedId) ?? null : null;
  return {
    baseline,
    hunks,
    marks: buildMarks(hunks, current),
    expandedId: expanded ? expanded.id : null,
    deco: buildHunkDeco(state, expanded),
  };
}

const changeGutterField = StateField.define<ChangeField>({
  create(state) {
    const baseline = state.doc.toString();
    return snapshot(baseline, baseline, null, state);
  },
  update(value, tr) {
    let baseline = value.baseline;
    let expandedId = value.expandedId;
    for (const effect of tr.effects) {
      if (effect.is(resetChangeBaseline)) {
        baseline = effect.value;
        expandedId = null;
      } else if (effect.is(toggleChangeHunk)) {
        expandedId = effect.value != null && effect.value === value.expandedId ? null : effect.value;
      }
    }
    if (!tr.docChanged && baseline === value.baseline && expandedId === value.expandedId) {
      return value;
    }
    return snapshot(baseline, tr.state.doc.toString(), expandedId, tr.state);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
});

export function markChangeBaseline(view: EditorView) {
  view.dispatch({ effects: resetChangeBaseline.of(view.state.doc.toString()) });
}

/** Unsaved hunks for the overlay scrollbar (Zed-style git/change ticks). */
export function unsavedChangeRanges(state: EditorState): Array<{ fromLine: number; toLine: number; kind: "add" | "mod" }> {
  const field = state.field(changeGutterField, false);
  if (!field?.hunks.length) return [];
  return field.hunks.map((hunk) => {
    const lines = hunk.addLines.length ? hunk.addLines : [hunk.startLine];
    return {
      fromLine: Math.min(...lines),
      toLine: Math.max(...lines),
      kind: hunkKind(hunk),
    };
  });
}

function restoreHunkById(view: EditorView, hunkId: number): boolean {
  const field = view.state.field(changeGutterField);
  const hunk = field.hunks.find((item) => item.id === hunkId);
  if (!hunk) return false;
  const next = applyHunkRejectToDoc(view.state.doc.toString(), hunk);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next },
    effects: toggleChangeHunk.of(null),
  });
  return true;
}

function expandedHunk(view: EditorView): AgentEditHunk | null {
  const field = view.state.field(changeGutterField, false);
  if (!field?.expandedId) return null;
  return field.hunks.find((item) => item.id === field.expandedId) ?? null;
}

class ChangeHunkActions {
  readonly dom: HTMLElement;
  private bar: HTMLElement | null = null;
  private raf = 0;

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-agent-hunk-actions-layer";
    Object.assign(this.dom.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "40",
    });
    if (getComputedStyle(view.dom).position === "static") {
      view.dom.style.position = "relative";
    }
    view.dom.appendChild(this.dom);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    this.sync();
  }

  update() {
    this.sync();
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.dom.remove();
  }

  private mkSvg(pathD: string, size: number) {
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
    svg.classList.add("cm-agent-hunk-key-icon");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  private mkKbd(mac: boolean, keyLetter: string) {
    const k = document.createElement("span");
    k.className = "cm-agent-hunk-kbd";
    if (mac) {
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

  private onScroll = () => this.schedule();

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.sync();
    });
  }

  private ensureBar() {
    if (this.bar) return this.bar;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const row = document.createElement("div");
    row.className = "cm-agent-hunk-actions cm-agent-hunk-float";
    Object.assign(row.style, {
      position: "absolute",
      zIndex: "42",
      display: "none",
      margin: "0",
    });

    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "cm-agent-hunk-btn cm-agent-hunk-undo";
    undo.title = mac ? "Undo this change (⌘N)" : "Undo this change (Ctrl+N)";
    undo.append("Undo", this.mkKbd(mac, "N"));
    undo.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const hunk = expandedHunk(this.view);
      if (hunk) restoreHunkById(this.view, hunk.id);
    });

    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "cm-agent-hunk-btn cm-agent-hunk-keep";
    keep.title = mac ? "Keep this change (⌘Y)" : "Keep this change (Ctrl+Y)";
    keep.append("Keep", this.mkKbd(mac, "Y"));
    keep.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.view.dispatch({ effects: toggleChangeHunk.of(null) });
    });

    row.append(undo, keep);
    this.dom.appendChild(row);
    this.bar = row;
    return row;
  }

  private sync() {
    const hunk = expandedHunk(this.view);
    const bar = this.ensureBar();
    if (!hunk) {
      bar.classList.remove("is-visible");
      bar.style.display = "none";
      return;
    }

    const view = this.view;
    const doc = view.state.doc;
    const anchor = Math.max(1, Math.min(doc.lines, hunk.endLine || hunk.startLine || 1));
    let block: { bottom: number };
    try {
      block = view.lineBlockAt(doc.line(anchor).from);
    } catch {
      bar.style.display = "none";
      return;
    }

    const scroller = view.scrollDOM;
    const root = view.dom.getBoundingClientRect();
    const scroll = scroller.getBoundingClientRect();
    const top = block.bottom - scroller.scrollTop + (scroll.top - root.top) + 4;
    const maps = view.dom.querySelectorAll<HTMLElement>(
      ".cm-gutters-after, .cm-minimap-gutter, .coloride-minimap, .cm-minimap",
    );
    let mapW = 0;
    for (const el of maps) {
      const w = el.getBoundingClientRect().width;
      if (w > mapW) mapW = w;
    }
    const right = Math.round(mapW + 18);

    bar.classList.add("is-visible");
    bar.style.display = "inline-flex";
    bar.style.top = `${Math.round(top)}px`;
    bar.style.right = `${right}px`;
    bar.style.left = "auto";
  }
}

export function changeGutter(): Extension {
  return [
    changeGutterField,
    gutter({
      class: "cm-gutter-coloride-hunk-wash",
      renderEmptyElements: false,
      lineMarker(view, line) {
        const hunk = expandedHunk(view);
        if (!hunk) return null;
        const lineNo = view.state.doc.lineAt(line.from).number;
        return hunk.addLines.includes(lineNo) ? addGutterWash : null;
      },
      widgetMarker(_view, widget) {
        return widget instanceof DeletedLineWidget ? delGutterWash : null;
      },
    }),
    ViewPlugin.fromClass(
      class {
        layer: ChangeHunkActions;
        constructor(view: EditorView) {
          this.layer = new ChangeHunkActions(view);
        }
        update() {
          this.layer.update();
        }
        destroy() {
          this.layer.destroy();
        }
      },
    ),
    gutter({
      class: "cm-gutter-coloride-change",
      renderEmptyElements: false,
      markers: (view) => {
        const own = view.state.field(changeGutterField).marks;
        const agent = getAgentEditFieldState(view);
        // Typing during review also dirties the saved-buffer gutter. That
        // set must not hide the agent ticks — the green/red bars the user
        // is looking at belong to the review, not the unsaved snapshot.
        if (agent.hunks.length) return buildMarks(agent.hunks, view.state.doc.toString());
        return own;
      },
      widgetMarker(_view, widget) {
        if (widget instanceof DeletedLineWidget || isAgentDeletedLineWidget(widget)) return delMarker;
        return null;
      },
      domEventHandlers: {
        mousedown(view, block, event) {
          event.preventDefault();
          const agent = getAgentEditFieldState(view);
          if (agent.hunks.length) return true;
          const lineNo = view.state.doc.lineAt(block.from).number;
          const hunk = hunkAtLine(view.state.field(changeGutterField).hunks, lineNo);
          if (!hunk) return true;
          view.dispatch({ effects: toggleChangeHunk.of(hunk.id) });
          return true;
        },
      },
    }),
    keymap.of([
      {
        key: "Escape",
        run: (view) => {
          if (view.state.field(changeGutterField).expandedId == null) return false;
          view.dispatch({ effects: toggleChangeHunk.of(null) });
          return true;
        },
      },
      {
        key: "Mod-n",
        run: (view) => {
          const hunk = expandedHunk(view);
          if (!hunk) return false;
          return restoreHunkById(view, hunk.id);
        },
      },
      {
        key: "Mod-y",
        run: (view) => {
          if (view.state.field(changeGutterField).expandedId == null) return false;
          view.dispatch({ effects: toggleChangeHunk.of(null) });
          return true;
        },
      },
    ]),
  ];
}
