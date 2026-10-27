import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

const keywords: Record<string, string> = {
  c: "if else for while do switch case break continue return int float double char void const struct enum typedef sizeof static unsigned signed long short include define",
  cpp: "if else for while do switch case break continue return int float double char void const auto bool true false nullptr class struct namespace using public private protected template typename virtual override static new delete try catch throw include constexpr size_t",
  javascript: "if else for while do switch case break continue return const let var function class new this typeof instanceof import export from default async await try catch throw true false null undefined",
  python: "if elif else for while break continue return def class import from as pass with try except finally raise True False None and or not in is lambda yield async await",
  go: "if else for range switch case break continue return func type struct interface package import var const defer go chan map select",
};
keywords.typescript = `${keywords.javascript} interface type enum implements readonly public private protected number string boolean`;

export function localKeywordCompletion(context: CompletionContext, language: string): CompletionResult | null {
  if (context.state.readOnly) return null;
  const id = language.replace(/react$/, "");
  const words = keywords[id];
  if (!words) return null;
  const word = context.matchBefore(/[A-Za-z_][\w]*/);
  if (!word || word.to !== context.pos) return null;
  // A keyword menu is useful in code, never inside a string or comment.
  for (let node = syntaxTree(context.state).resolveInner(context.pos, -1); node; ) {
    if (/comment|string/i.test(node.name)) return null;
    if (!node.parent) break;
    node = node.parent;
  }
  if (/[.>:]$/.test(context.state.sliceDoc(Math.max(0, word.from - 1), word.from))) return null;
  return {
    from: word.from,
    options: words.split(" ").map((label) => ({ label, type: "keyword", boost: -10 })),
    validFor: /^\w*$/,
  };
}
