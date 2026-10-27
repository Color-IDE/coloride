import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export type FindScopeRange = { from: number; to: number };

/** Set or clear the persistent “find in selection” highlight. */
export const setFindScopeEffect = StateEffect.define<FindScopeRange | null>();

const scopeMark = Decoration.mark({ class: "cm-findScope" });

function scopeDeco(range: FindScopeRange | null, docLength: number): DecorationSet {
  if (!range) return Decoration.none;
  const from = Math.max(0, Math.min(range.from, docLength));
  const to = Math.max(from, Math.min(range.to, docLength));
  if (to <= from) return Decoration.none;
  return Decoration.set([scopeMark.range(from, to)]);
}

/**
 * Keeps a soft highlight on the selection range used for “find in selection”
 * until the effect is cleared — survives caret moves / focus on the find bar.
 */
export const findScopeExtension = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    let next = deco;
    for (const effect of tr.effects) {
      if (effect.is(setFindScopeEffect)) {
        next = scopeDeco(effect.value, tr.state.doc.length);
      }
    }
    if (next.size && tr.docChanged) {
      next = next.map(tr.changes);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
