import { css } from "@codemirror/lang-css";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import type { Extension } from "@codemirror/state";

/** Map Coloride language ids → CodeMirror language extensions. */
export function languageExtension(language: string): Extension {
  const id = language.toLowerCase();
  switch (id) {
    case "c":
    case "cpp":
      return cpp();
    case "typescript":
      return javascript({ typescript: true, jsx: false });
    case "typescriptreact":
      return javascript({ typescript: true, jsx: true });
    case "javascript":
      return javascript({ typescript: false, jsx: false });
    case "javascriptreact":
      return javascript({ typescript: false, jsx: true });
    case "json":
      return json();
    case "html":
      return html();
    case "css":
    case "scss":
    case "sass":
    case "less":
      return css();
    case "markdown":
    case "mdx":
      return markdown();
    case "python":
      return python();
    case "go":
      return go();
    default:
      return [];
  }
}
