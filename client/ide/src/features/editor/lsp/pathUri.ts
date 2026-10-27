/** Remote POSIX path ↔ LSP file:// URI. */

export function pathToUri(path: string): string {
  if (!path) return "file:///";
  if (path.startsWith("file://")) return path;
  const absolute = path.startsWith("/") ? path : `/${path}`;
  const encoded = absolute
    .split("/")
    .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment).replace(/%2F/gi, "/")))
    .join("/");
  return `file://${encoded}`;
}

export function uriToPath(uri: string): string | null {
  if (!uri) return null;
  if (uri.startsWith("file://")) {
    let rest = uri.slice("file://".length);
    if (rest.startsWith("localhost")) rest = rest.slice("localhost".length);
    try {
      return decodeURIComponent(rest);
    } catch {
      return rest;
    }
  }
  if (uri.startsWith("/")) return uri;
  return null;
}

export function lspDocumentLanguageId(path: string): string | null {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  if (lower.endsWith(".tsx")) return "typescriptreact";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript";
  if (lower.endsWith(".jsx")) return "javascriptreact";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".py") || lower.endsWith(".pyi")) return "python";
  if (lower.endsWith(".jsonc")) return "jsonc";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".scss") || lower.endsWith(".sass")) return "scss";
  if (lower.endsWith(".less")) return "less";
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xhtml")) return "html";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (base === "dockerfile" || lower.endsWith(".dockerfile")) return "dockerfile";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh") || lower.endsWith(".ksh")) {
    return "shell";
  }
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rs")) return "rust";
  // `.h` next to C++ sources is C++. Treating it as C makes clangd
  // reject `std::vector` and templates in headers that compile fine.
  if (lower.endsWith(".h") || lower.endsWith(".hh") || lower.endsWith(".hpp") || lower.endsWith(".hxx")) {
    return "cpp";
  }
  if (lower.endsWith(".c")) return "c";
  if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx")) return "cpp";
  if (lower.endsWith(".php")) return "php";
  if (lower.endsWith(".rb")) return "ruby";
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".md") || lower.endsWith(".mdx") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".toml")) return "toml";
  if (lower.endsWith(".xml") || lower.endsWith(".xsd") || lower.endsWith(".xsl")) return "xml";
  if (lower.endsWith(".lua")) return "lua";
  if (lower.endsWith(".kt") || lower.endsWith(".kts")) return "kotlin";
  if (lower.endsWith(".cs")) return "csharp";
  return null;
}

const LANGUAGE_TO_SERVER: Record<string, string> = {
  typescript: "typescript",
  javascript: "typescript",
  typescriptreact: "typescript",
  javascriptreact: "typescript",
  python: "python",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "css",
  less: "css",
  html: "html",
  yaml: "yaml",
  dockerfile: "dockerfile",
  shell: "shell",
  go: "go",
  rust: "rust",
  c: "cpp",
  cpp: "cpp",
  php: "php",
  ruby: "ruby",
  java: "java",
  toml: "toml",
  xml: "xml",
  lua: "lua",
  kotlin: "kotlin",
  csharp: "csharp",
};

export function lspServerId(languageId: string): string | null {
  return LANGUAGE_TO_SERVER[languageId] ?? null;
}

export function lspServerIdForPath(path: string): string | null {
  const languageId = lspDocumentLanguageId(path);
  return languageId ? lspServerId(languageId) : null;
}
