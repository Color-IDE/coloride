import {
  findNext,
  getSearchQuery,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import type { EditorFindOptions, EditorFindStatus } from "../../../core/types";
import { setFindScopeEffect } from "../findScope";

export function emptyFindStatus(): EditorFindStatus {
  return { current: 0, total: 0 };
}

export function computeFindStatus(view: EditorView): EditorFindStatus {
  const query = getSearchQuery(view.state);
  if (!query.valid || !query.search) return emptyFindStatus();
  const sel = view.state.selection.main;
  let total = 0;
  let current = 0;
  const cursor = query.getCursor(view.state);
  // SearchCursor / RegExpCursor: next() returns iterator; value is the match.
  for (;;) {
    const step = cursor.next();
    if (step.done) break;
    const match = step.value;
    total += 1;
    if (match.from === sel.from && match.to === sel.to) {
      current = total;
    } else if (
      current === 0 &&
      match.from <= sel.from &&
      match.to >= sel.from
    ) {
      current = total;
    }
  }
  return { current, total };
}

export function applyFindQuery(
  view: EditorView,
  options: EditorFindOptions,
  jump: "next" | "none" = "none",
): EditorFindStatus {
  const range = options.range;
  const hasRange =
    range != null &&
    Number.isFinite(range.from) &&
    Number.isFinite(range.to) &&
    range.to > range.from;
  const scope = hasRange ? { from: range!.from, to: range!.to } : null;
  const query = new SearchQuery({
    search: options.query ?? "",
    caseSensitive: Boolean(options.caseSensitive),
    wholeWord: Boolean(options.wholeWord),
    regexp: Boolean(options.regexp),
    literal: true,
    replace: options.replace ?? "",
    // Restrict matches to the captured selection when "find in selection" is on.
    test: hasRange
      ? (_match, _state, from, to) => from >= range!.from && to <= range!.to
      : undefined,
  });
  const sel = view.state.selection.main;
  // If the native selection is still the scoped range, collapse it so only
  // our persistent cm-findScope highlight remains (until toggle off).
  const collapseNative =
    hasRange && !sel.empty && sel.from === range!.from && sel.to === range!.to;
  view.dispatch({
    ...(collapseNative ? { selection: { anchor: range!.to } } : {}),
    effects: [setSearchQuery.of(query), setFindScopeEffect.of(scope)],
  });
  if (jump === "next" && query.valid && query.search) {
    findNext(view);
  }
  return computeFindStatus(view);
}
