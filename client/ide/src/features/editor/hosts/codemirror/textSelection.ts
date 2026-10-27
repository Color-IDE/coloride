/**
 * Draw selection only over actual characters, not the empty space
 * to the right of a line (CM's default stretches to the content edge).
 */

import type { Extension } from "@codemirror/state";
import { EditorView, type LayerMarker, layer } from "@codemirror/view";

type RawRect = { left: number; top: number; right: number; bottom: number };
type Point = { x: number; y: number };

const SELECTION_CORNER_RADIUS = 3;

function layerBase(view: EditorView) {
  const rect = view.scrollDOM.getBoundingClientRect();
  return {
    left: rect.left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  };
}

function maxCharWidth(view: EditorView): number {
  return view.defaultCharacterWidth * Math.max(2, view.state.tabSize) + 2;
}

function saneWidth(view: EditorView, width: number): boolean {
  return width > 0 && width <= maxCharWidth(view);
}

/** Glyph box for one document position. Ignores CM's "open" stretch on spaces. */
function boxAt(view: EditorView, pos: number): { left: number; right: number; top: number; bottom: number } | null {
  const here = view.coordsAtPos(pos, 1);
  if (!here) return null;
  const line = view.state.doc.lineAt(pos);
  let right = here.left + view.defaultCharacterWidth;
  if (pos < line.to) {
    const next = view.coordsAtPos(pos + 1, 1);
    if (next && Math.abs(next.top - here.top) <= 2 && saneWidth(view, next.left - here.left)) {
      right = next.left;
    } else if (saneWidth(view, here.right - here.left)) {
      right = here.right;
    }
  } else if (saneWidth(view, here.right - here.left)) {
    right = here.right;
  }
  return { left: here.left, right, top: here.top, bottom: here.bottom };
}

function rowVertical(
  view: EditorView,
  pos: number,
  glyphTop: number,
  glyphBottom: number,
): { top: number; bottom: number } {
  const block = view.lineBlockAt(pos);
  const top = view.documentTop + block.top;
  const bottom = top + block.height;
  const mid = (glyphTop + glyphBottom) / 2;
  // Unwrapped line: tile to the line box so stacked rows share an edge (no gap, no double paint).
  if (
    block.height <= view.defaultLineHeight * 1.45
    && Math.abs(mid - (top + bottom) / 2) < view.defaultLineHeight
  ) {
    return { top, bottom };
  }
  const h = Math.max(1, view.defaultLineHeight);
  return { top: mid - h / 2, bottom: mid + h / 2 };
}

/** Cover [from, to) with one rect per visual row — never the empty right margin. */
function piecesForSegment(view: EditorView, from: number, to: number): RawRect[] {
  const out: RawRect[] = [];
  let pos = from;
  let guard = 0;
  while (pos < to && guard < 2000) {
    guard += 1;
    const start = boxAt(view, pos);
    if (!start) {
      pos += 1;
      continue;
    }

    const y = (start.top + start.bottom) / 2;
    const contentRight = view.contentDOM.getBoundingClientRect().right - 1;
    const atRight = view.posAtCoords({ x: contentRight, y });
    let rowTo = to;
    if (atRight != null && atRight > pos && atRight < to) {
      rowTo = atRight;
    }

    const end = boxAt(view, Math.max(pos, rowTo - 1));
    if (!end) {
      pos = rowTo > pos ? rowTo : pos + 1;
      continue;
    }

    if (Math.abs(start.top - end.top) > 2) {
      const v = rowVertical(view, pos, start.top, start.bottom);
      out.push({ left: start.left, right: start.right, top: v.top, bottom: v.bottom });
      pos += 1;
      continue;
    }

    const v = rowVertical(
      view,
      pos,
      Math.min(start.top, end.top),
      Math.max(start.bottom, end.bottom),
    );
    out.push({
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
      top: v.top,
      bottom: v.bottom,
    });
    pos = rowTo > pos ? rowTo : pos + 1;
  }
  return out;
}

function emptyLineIncluded(from: number, to: number, lineFrom: number, lineTo: number, docLen: number): boolean {
  if (lineTo > lineFrom) return false;
  if (from <= lineFrom && to > lineFrom) return true;
  return lineTo === docLen && from < lineFrom && to >= lineFrom;
}

function emptyLineNotch(view: EditorView, lineFrom: number): RawRect | null {
  const start = view.coordsAtPos(lineFrom, 1);
  if (!start) return null;
  const v = rowVertical(view, lineFrom, start.top, start.bottom);
  const width = Math.max(4, view.defaultCharacterWidth * 0.55);
  return { left: start.left, right: start.left + width, top: v.top, bottom: v.bottom };
}

function piecesForTextRange(view: EditorView, from: number, to: number): RawRect[] {
  if (from >= to) return [];
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);
  const docLen = view.state.doc.length;
  const out: RawRect[] = [];

  for (let n = startLine.number; n <= endLine.number; n += 1) {
    const line = view.state.doc.line(n);
    const segFrom = Math.max(from, line.from);
    const segTo = Math.min(to, line.to);
    if (segTo > segFrom) {
      out.push(...piecesForSegment(view, segFrom, segTo));
      continue;
    }
    if (emptyLineIncluded(from, to, line.from, line.to, docLen)) {
      const notch = emptyLineNotch(view, line.from);
      if (notch) out.push(notch);
    }
  }
  return out;
}

function mergeSameRow(rects: RawRect[]): RawRect[] {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const out: RawRect[] = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.top - r.top) <= 2 && r.left <= prev.right + 2) {
      prev.left = Math.min(prev.left, r.left);
      prev.right = Math.max(prev.right, r.right);
      prev.top = Math.min(prev.top, r.top);
      prev.bottom = Math.max(prev.bottom, r.bottom);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** Abut stacked rows on a shared edge — no overlap (overlap paints darker). */
function stitchVertical(rects: RawRect[]) {
  const sorted = [...rects].sort((a, b) => a.top - b.top);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (b.top <= a.bottom + 4 && b.top >= a.bottom - 4) {
      const mid = (a.bottom + b.top) / 2;
      a.bottom = mid;
      b.top = mid;
    }
  }
  return sorted;
}

function rowsConnect(a: RawRect, b: RawRect): boolean {
  const verticallyAdjacent = b.top <= a.bottom + 1 && b.top >= a.bottom - 1;
  const horizontalOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0;
  return verticallyAdjacent && horizontalOverlap;
}

/** Split a selection only where its visual rows are genuinely disconnected. */
function connectedRows(rows: RawRect[]): RawRect[][] {
  const groups: RawRect[][] = [];
  for (const row of rows) {
    const group = groups[groups.length - 1];
    if (group && rowsConnect(group[group.length - 1]!, row)) group.push(row);
    else groups.push([row]);
  }
  return groups;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

function compactPolygon(points: Point[]): Point[] {
  const deduped = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]!));
  if (deduped.length > 1 && samePoint(deduped[0]!, deduped[deduped.length - 1]!)) deduped.pop();

  return deduped.filter((point, index, all) => {
    const previous = all[(index + all.length - 1) % all.length]!;
    const next = all[(index + 1) % all.length]!;
    const cross = (point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x);
    return Math.abs(cross) > 0.01;
  });
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toward(from: Point, to: Point, amount: number): Point {
  const length = distance(from, to);
  if (length < 0.01) return from;
  return { x: from.x + ((to.x - from.x) * amount) / length, y: from.y + ((to.y - from.y) * amount) / length };
}

/**
 * Produce one rounded outline for all connected rows. Unlike independent DOM
 * rectangles, the corners at an indent step are part of the same silhouette.
 */
function roundedSelectionPath(rows: RawRect[], width: number, height: number): string {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const points: Point[] = [
    { x: first.left, y: first.top },
    { x: first.right, y: first.top },
  ];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    points.push({ x: row.right, y: row.bottom });
    if (index < rows.length - 1) points.push({ x: rows[index + 1]!.right, y: row.bottom });
  }

  points.push({ x: last.left, y: last.bottom });
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    points.push({ x: row.left, y: row.top });
    if (index > 0) points.push({ x: rows[index - 1]!.left, y: row.top });
  }

  const polygon = compactPolygon(points).map((point) => ({ x: point.x, y: point.y }));
  if (polygon.length < 3) return `M 0 0 H ${width} V ${height} H 0 Z`;

  const corners = polygon.map((point, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
    const next = polygon[(index + 1) % polygon.length]!;
    const radius = Math.min(SELECTION_CORNER_RADIUS, distance(previous, point) / 2, distance(point, next) / 2);
    return { point, before: toward(point, previous, radius), after: toward(point, next, radius) };
  });

  const firstCorner = corners[0]!;
  let path = `M ${firstCorner.after.x} ${firstCorner.after.y}`;
  for (let index = 1; index < corners.length; index += 1) {
    const corner = corners[index]!;
    path += ` L ${corner.before.x} ${corner.before.y} Q ${corner.point.x} ${corner.point.y} ${corner.after.x} ${corner.after.y}`;
  }
  path += ` L ${firstCorner.before.x} ${firstCorner.before.y} Q ${firstCorner.point.x} ${firstCorner.point.y} ${firstCorner.after.x} ${firstCorner.after.y} Z`;
  return path;
}

class SelectionPathMarker implements LayerMarker {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number,
    readonly pathData: string,
  ) {}

  eq(other: LayerMarker): boolean {
    return other instanceof SelectionPathMarker
      && other.left === this.left
      && other.top === this.top
      && other.width === this.width
      && other.height === this.height
      && other.pathData === this.pathData;
  }

  draw(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-selectionPath";
    wrapper.setAttribute("aria-hidden", "true");
    wrapper.style.cssText = `position:absolute;left:${this.left}px;top:${this.top}px;width:${this.width}px;height:${this.height}px;overflow:visible;pointer-events:none`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    svg.setAttribute("width", `${this.width}`);
    svg.setAttribute("height", `${this.height}`);
    svg.style.cssText = "display:block;overflow:visible";
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("cm-selectionPath-fill");
    path.setAttribute("d", this.pathData);
    svg.append(path);
    wrapper.append(svg);
    return wrapper;
  }
}

function markersForRange(view: EditorView, from: number, to: number): SelectionPathMarker[] {
  const base = layerBase(view);
  const rects = stitchVertical(mergeSameRow(piecesForTextRange(view, from, to)))
    .filter((r) => r.right - r.left >= 0.5 && r.bottom - r.top >= 0.5);

  return connectedRows(rects).map((rows) => {
    const left = Math.min(...rows.map((row) => row.left));
    const top = Math.min(...rows.map((row) => row.top));
    const right = Math.max(...rows.map((row) => row.right));
    const bottom = Math.max(...rows.map((row) => row.bottom));
    const localRows = rows.map((row) => ({
      left: row.left - left,
      top: row.top - top,
      right: row.right - left,
      bottom: row.bottom - top,
    }));
    return new SelectionPathMarker(
      left - base.left,
      top - base.top,
      right - left,
      bottom - top,
      roundedSelectionPath(localRows, right - left, bottom - top),
    );
  });
}

export function textOnlySelection(): Extension {
  return [
    layer({
      above: false,
      class: "cm-textSelectionLayer",
      markers(view) {
        const markers: SelectionPathMarker[] = [];
        for (const range of view.state.selection.ranges) {
          if (range.empty) continue;
          markers.push(...markersForRange(view, range.from, range.to));
        }
        return markers;
      },
      update(update) {
        return (
          update.docChanged
          || update.selectionSet
          || update.viewportChanged
          || update.geometryChanged
        );
      },
    }),
    EditorView.theme({
      ".cm-selectionLayer .cm-selectionBackground": {
        display: "none !important",
        width: "0 !important",
        opacity: "0 !important",
      },
    }),
  ];
}
