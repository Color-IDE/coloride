/**
 * Cmd/Ctrl + hover/click on URLs and file paths in the editor.
 *
 * Works in code AND markdown (unlike go-to-definition, which is code-only).
 * Does not underline plain English words — only URL / path-shaped spans.
 */

import {
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";

import {
  expandPathCandidates,
  getCachedPathAliasConfig,
  loadPathAliasConfig,
  resolveSpecifierBases,
} from "../../tsconfigPaths";

export type PathLinkHandlers = {
  currentPath: string;
  workspaceRoot?: string | null;
  onOpenPath: (absolutePath: string) => void;
  onOpenUrl: (url: string) => void;
};

type LinkHit = {
  from: number;
  to: number;
  kind: "url" | "path";
  raw: string;
};

const setLink = StateEffect.define<{ from: number; to: number } | null>();
const linkMark = Decoration.mark({ class: "cm-path-url-link" });

const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (!e.is(setLink)) continue;
      const r = e.value;
      if (!r || r.from >= r.to || r.to - r.from > 512) return Decoration.none;
      try {
        if (tr.state.doc.lineAt(r.from).number !== tr.state.doc.lineAt(r.to - 1).number) {
          return Decoration.none;
        }
      } catch {
        return Decoration.none;
      }
      return Decoration.set([linkMark.range(r.from, r.to)]);
    }
    if (tr.docChanged) {
      const mapped = value.map(tr.changes);
      let empty = true;
      mapped.between(0, tr.state.doc.length, () => {
        empty = false;
      });
      return empty ? Decoration.none : mapped;
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function modHeld(e: MouseEvent | KeyboardEvent) {
  return (e.metaKey || e.ctrlKey) && !e.altKey;
}

function dirname(path: string): string {
  if (path === "/") return "/";
  const clean = path.replace(/\/+$/, "");
  const i = clean.lastIndexOf("/");
  return i <= 0 ? "/" : clean.slice(0, i);
}

function joinPath(base: string, rel: string): string {
  if (rel.startsWith("/")) return rel.replace(/\/+$/, "") || "/";
  const parts = (base === "/" ? [] : base.replace(/\/+$/, "").split("/").filter(Boolean));
  for (const segment of rel.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return "/" + parts.join("/");
}

/** True if string looks like a project/file path (not a sentence). */
function looksLikePath(raw: string): boolean {
  const s = raw.trim();
  if (!s || s.length > 400) return false;
  if (/\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return false;
  // relative / alias / absolute with extension or known prefix
  if (s.startsWith("./") || s.startsWith("../") || s.startsWith("@/") || s.startsWith("~/")) {
    return true;
  }
  if (s.startsWith("/") && /\.[a-zA-Z0-9]{1,12}$/.test(s)) return true;
  // bare path with slash + extension: components/foo.tsx
  if (/^[\w@.-]+(?:\/[\w@.-]+)+\/?$/.test(s) && /\.[a-zA-Z0-9]{1,12}$/.test(s)) return true;
  // extension-less relative module often in imports: ./foo or @/foo/bar
  if (/^[\w@./-]+$/.test(s) && (s.includes("/") || s.startsWith("."))) return true;
  return false;
}

/**
 * Find URL or path span on the line that contains `pos`.
 */
export function linkAtPos(state: EditorState, pos: number): LinkHit | null {
  if (pos < 0 || pos > state.doc.length) return null;
  let line;
  try {
    line = state.doc.lineAt(pos);
  } catch {
    return null;
  }
  const text = line.text;
  const hits: LinkHit[] = [];

  // 1) URLs
  const urlRe = /https?:\/\/[^\s<>"'`)\]}]+/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text))) {
    let value = m[0];
    // trim trailing punctuation
    value = value.replace(/[.,;:!?]+$/g, "");
    const from = line.from + m.index;
    const to = from + value.length;
    hits.push({ from, to, kind: "url", raw: value });
  }

  // 2) Markdown links: [label](target)
  const mdRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
  while ((m = mdRe.exec(text))) {
    const target = (m[1] ?? "").trim();
    if (!target) continue;
    const innerStart = m.index + m[0].indexOf("(") + 1;
    const from = line.from + innerStart;
    const to = from + target.length;
    if (/^https?:\/\//i.test(target) || /^mailto:/i.test(target)) {
      hits.push({ from, to, kind: "url", raw: target });
    } else if (looksLikePath(target) || target.startsWith("#")) {
      // #anchors stay as path-like open of same file later
      hits.push({ from, to, kind: "path", raw: target });
    }
  }

  // 3) Quoted strings that look like paths (imports, require, config)
  const qRe = /(['"`])([^'"`\n]+)\1/g;
  while ((m = qRe.exec(text))) {
    const inner = m[2] ?? "";
    if (!looksLikePath(inner) && !/^https?:\/\//i.test(inner)) continue;
    const from = line.from + m.index + 1; // inside quotes
    const to = from + inner.length;
    if (/^https?:\/\//i.test(inner)) {
      hits.push({ from, to, kind: "url", raw: inner });
    } else {
      hits.push({ from, to, kind: "path", raw: inner });
    }
  }

  // 4) Bare paths with extension (not inside a longer hit)
  const bareRe = /(?:^|[\s([{=,:])((?:\.\.?\/|@\/|~\/|\/)[^\s"'`)\]}>]+)/g;
  while ((m = bareRe.exec(text))) {
    let value = m[1] ?? "";
    value = value.replace(/[.,;:]+$/g, "");
    if (!looksLikePath(value)) continue;
    const startInLine = m.index + m[0].length - value.length;
    const from = line.from + startInLine;
    const to = from + value.length;
    hits.push({ from, to, kind: "path", raw: value });
  }

  // Prefer the tightest hit containing the cursor
  // fix: compare using absolute from/to
  const coveringAbs = hits
    .filter((h) => pos >= h.from && pos <= h.to)
    .sort((a, b) => (a.to - a.from) - (b.to - b.from));

  return coveringAbs[0] ?? null;
}

function resolveFilePath(
  raw: string,
  currentPath: string,
  workspaceRoot: string | null | undefined,
): string | null {
  let spec = raw.trim();
  // strip optional query/hash for files
  const hashIdx = spec.indexOf("#");
  if (hashIdx === 0) return currentPath; // same-file anchor
  if (hashIdx > 0) spec = spec.slice(0, hashIdx);
  const qIdx = spec.indexOf("?");
  if (qIdx >= 0) spec = spec.slice(0, qIdx);

  if (!spec) return null;

  if (spec.startsWith("file://")) {
    try {
      return decodeURIComponent(spec.replace(/^file:\/\//, ""));
    } catch {
      return spec.replace(/^file:\/\//, "");
    }
  }

  if (spec.startsWith("/") && !spec.startsWith("//")) {
    return spec;
  }

  if (spec.startsWith("./") || spec.startsWith("../")) {
    return joinPath(dirname(currentPath), spec);
  }

  if (spec.startsWith("@/") || spec.startsWith("~/")) {
    const cfg = getCachedPathAliasConfig(workspaceRoot, currentPath);
    void loadPathAliasConfig(workspaceRoot, currentPath);
    const bases = resolveSpecifierBases(spec, currentPath, cfg, workspaceRoot);
    const ext = (() => {
      const base = currentPath.split("/").pop() ?? "";
      const dot = base.lastIndexOf(".");
      return dot > 0 ? base.slice(dot) : ".ts";
    })();
    const candidates = expandPathCandidates(bases, ext);
    return candidates[0] ?? joinPath(workspaceRoot || dirname(currentPath), spec.replace(/^[@~]\//, ""));
  }

  // bare "foo/bar.tsx" relative to current file dir or workspace
  if (spec.includes("/") || /\.[a-zA-Z0-9]+$/.test(spec)) {
    const fromFile = joinPath(dirname(currentPath), spec);
    if (workspaceRoot && !spec.startsWith(".")) {
      // also try workspace-root relative
      return fromFile;
    }
    return fromFile;
  }

  return null;
}

function pathLinkPlugin(): Extension {
  return ViewPlugin.fromClass(
    class implements PluginValue {
      view: EditorView;
      mod = false;
      hasMouse = false;
      mx = 0;
      my = 0;
      raf = 0;
      linkRaf = 0;
      destroyed = false;
      shown: { from: number; to: number } | null = null;
      sticky: LinkHit | null = null;

      constructor(view: EditorView) {
        this.view = view;
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onWinBlur = this.onWinBlur.bind(this);
        window.addEventListener("keydown", this.onKeyDown, true);
        window.addEventListener("keyup", this.onKeyUp, true);
        window.addEventListener("blur", this.onWinBlur);
      }

      update(u: ViewUpdate) {
        if (u.docChanged) this.clear();
      }

      destroy() {
        this.destroyed = true;
        window.removeEventListener("keydown", this.onKeyDown, true);
        window.removeEventListener("keyup", this.onKeyUp, true);
        window.removeEventListener("blur", this.onWinBlur);
        if (this.raf) cancelAnimationFrame(this.raf);
        if (this.linkRaf) cancelAnimationFrame(this.linkRaf);
        this.shown = null;
        this.sticky = null;
      }

      onKeyDown(e: KeyboardEvent) {
        if (e.key !== "Meta" && e.key !== "Control") return;
        const was = this.mod;
        this.mod = true;
        if (!was && this.hasMouse) this.schedule(false);
      }

      onKeyUp(e: KeyboardEvent) {
        if (e.key === "Meta" || e.key === "Control" || (!e.metaKey && !e.ctrlKey)) {
          this.mod = false;
          this.clear();
        }
      }

      onWinBlur() {
        this.mod = false;
        this.clear();
      }

      schedule(immediate = false) {
        if (immediate) {
          if (this.raf) {
            cancelAnimationFrame(this.raf);
            this.raf = 0;
          }
          this.resolve();
          return;
        }
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => {
          this.raf = 0;
          this.resolve();
        });
      }

      resolve() {
        if (!this.mod || !this.hasMouse) {
          this.clear();
          return;
        }
        const pos = this.view.posAtCoords({ x: this.mx, y: this.my }, false);
        if (pos == null) {
          this.clear();
          return;
        }
        let hit = linkAtPos(this.view.state, pos);
        if (
          !hit
          && this.sticky
          && pos >= this.sticky.from
          && pos <= this.sticky.to
        ) {
          hit = this.sticky;
        }
        if (!hit) {
          this.clear();
          return;
        }
        this.sticky = hit;
        this.paint(hit.from, hit.to);
      }

      queueLink(link: { from: number; to: number } | null) {
        if (this.destroyed) return;
        if (this.linkRaf) cancelAnimationFrame(this.linkRaf);
        this.linkRaf = requestAnimationFrame(() => {
          this.linkRaf = 0;
          if (this.destroyed) return;
          this.view.dispatch({ effects: setLink.of(link) });
        });
      }

      paint(from: number, to: number) {
        if (this.shown && this.shown.from === from && this.shown.to === to) return;
        this.shown = { from, to };
        this.queueLink({ from, to });
      }

      clear() {
        this.sticky = null;
        if (!this.shown) return;
        this.shown = null;
        this.queueLink(null);
      }
    },
    {
      eventHandlers: {
        mousemove(event) {
          this.hasMouse = true;
          this.mx = event.clientX;
          this.my = event.clientY;
          if (modHeld(event)) {
            this.mod = true;
            this.schedule(false);
          } else if (this.mod) {
            this.mod = false;
            this.clear();
          }
        },
        mouseleave() {
          this.hasMouse = false;
          this.clear();
        },
      },
    },
  );
}

function activateLink(hit: LinkHit, handlers: PathLinkHandlers) {
  if (hit.kind === "url") {
    handlers.onOpenUrl(hit.raw);
    return;
  }
  const abs = resolveFilePath(hit.raw, handlers.currentPath, handlers.workspaceRoot ?? null);
  if (!abs) return;
  handlers.onOpenPath(abs);
}

/**
 * Enable Cmd/Ctrl+click on URLs and file paths for any file type.
 */
export function pathAndUrlLinksExtension(handlers: PathLinkHandlers): Extension {
  let lastAt = 0;

  const click = Prec.highest(
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!modHeld(event) || event.button !== 0) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
        if (pos == null) return false;
        const hit = linkAtPos(view.state, pos);
        if (!hit) return false;
        const now = performance.now();
        if (now - lastAt < 280) return true;
        lastAt = now;
        event.preventDefault();
        event.stopPropagation();
        activateLink(hit, handlers);
        return true;
      },
    }),
  );

  return [linkField, pathLinkPlugin(), click];
}
