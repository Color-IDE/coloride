/**
 * Unified language id for highlighting + editor routing.
 */

export function languageFromPath(
  filePath?: string | null,
  content: string = "",
): string {
  if (!filePath) return "plaintext";
  // Browser tab keys are not code files.
  if (filePath.startsWith("browser:")) return "plaintext";
  const lower = filePath.toLowerCase().trim();

  const firstLine = content.split("\n")[0] || "";
  if (firstLine.startsWith("#!")) {
    if (firstLine.includes("python") || firstLine.includes("python3")) return "python";
    if (firstLine.includes("node") || firstLine.includes("deno")) return "javascript";
    if (firstLine.includes("ruby")) return "ruby";
    if (firstLine.includes("perl")) return "perl";
    if (firstLine.includes("php")) return "php";
    if (firstLine.includes("bash") || firstLine.includes("sh") || firstLine.includes("zsh")) {
      return "shell";
    }
    if (firstLine.includes("lua")) return "lua";
  }

  if (lower.endsWith(".tsx")) return "typescriptreact";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript";
  if (lower.endsWith(".jsx")) return "javascriptreact";
  if (lower.endsWith(".js") || lower.endsWith(".cjs") || lower.endsWith(".mjs")) return "javascript";
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".scss") || lower.endsWith(".sass") || lower.endsWith(".less")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xhtml")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".mdx") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".py") || lower.endsWith(".pyi")) return "python";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".kt") || lower.endsWith(".kts")) return "kotlin";
  if (lower.endsWith(".swift")) return "swift";
  if (lower.endsWith(".h") || lower.endsWith(".hh") || lower.endsWith(".hpp") || lower.endsWith(".hxx")) {
    return "cpp";
  }
  if (lower.endsWith(".c")) return "c";
  if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx") || lower.endsWith(".hpp")) {
    return "cpp";
  }
  if (lower.endsWith(".cs")) return "csharp";
  if (lower.endsWith(".rb")) return "ruby";
  if (lower.endsWith(".php")) return "php";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return "shell";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".toml")) return "toml";
  if (lower.endsWith(".xml") || lower.endsWith(".svg")) return "xml";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".dockerfile") || lower.endsWith("dockerfile")) return "dockerfile";
  return "plaintext";
}
