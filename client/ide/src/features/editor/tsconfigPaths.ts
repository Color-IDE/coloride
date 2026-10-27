/**
 * Resolve TS/JS path aliases (@/…, ~/…, tsconfig "paths") for go-to-definition.
 */

import { api, decodeBase64ToText } from "../../shared/api/client";

export type PathAliasConfig = {
  /** Absolute directory used as baseUrl */
  baseUrl: string;
  /** Compiled path mappings, longest pattern first */
  mappings: Array<{ prefix: string; suffix: string; targets: string[] }>;
  source: string;
};

function dirname(path: string): string {
  if (path === "/") return "/";
  const clean = path.replace(/\/+$/, "");
  const index = clean.lastIndexOf("/");
  return index <= 0 ? "/" : clean.slice(0, index);
}

function joinPath(base: string, rel: string): string {
  if (!rel || rel === ".") return base.replace(/\/+$/, "") || "/";
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

/** Strip line and block comments enough to JSON.parse tsconfig. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  let inStr = false;
  let quote = "";
  let escape = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (inStr) {
      out += ch;
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === quote) inStr = false;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    // trailing commas before } or ]
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /[\s\r\n]/.test(text[j]!)) j += 1;
      if (text[j] === "}" || text[j] === "]") {
        i += 1;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return JSON.parse(out);
}

function compileMappings(
  paths: Record<string, string[] | undefined> | undefined,
): PathAliasConfig["mappings"] {
  const mappings: PathAliasConfig["mappings"] = [];
  if (!paths) return mappings;
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!targets?.length) continue;
    const star = pattern.indexOf("*");
    const prefix = star >= 0 ? pattern.slice(0, star) : pattern;
    const suffix = star >= 0 ? pattern.slice(star + 1) : "";
    const resolvedTargets = targets.map((t) => {
      const tStar = t.indexOf("*");
      if (tStar >= 0) {
        return {
          before: t.slice(0, tStar),
          after: t.slice(tStar + 1),
        };
      }
      return { before: t, after: "" };
    });
    mappings.push({
      prefix,
      suffix,
      targets: resolvedTargets.map((t) => {
        // Store as "before*after" joined against base later via apply
        return `${t.before}\0${t.after}`;
      }),
    });
  }
  // Longest prefix first for specificity (@/components/* before @/*)
  mappings.sort((a, b) => b.prefix.length - a.prefix.length);
  return mappings;
}

function applyMapping(
  baseUrlAbs: string,
  mapping: PathAliasConfig["mappings"][number],
  specifier: string,
): string[] {
  if (!specifier.startsWith(mapping.prefix)) return [];
  if (mapping.suffix && !specifier.endsWith(mapping.suffix)) return [];
  const mid = specifier.slice(
    mapping.prefix.length,
    mapping.suffix ? specifier.length - mapping.suffix.length : undefined,
  );
  const out: string[] = [];
  for (const packed of mapping.targets) {
    const [before, after] = packed.split("\0");
    const rel = `${before ?? ""}${mid}${after ?? ""}`.replace(/\\/g, "/");
    out.push(joinPath(baseUrlAbs, rel));
  }
  return out;
}

const configCache = new Map<string, PathAliasConfig | null>();
const configInflight = new Map<string, Promise<PathAliasConfig | null>>();

async function readRemoteText(path: string): Promise<string | null> {
  try {
    const response = await api.readFile(path);
    if (!response?.content) return null;
    return decodeBase64ToText(response.content);
  } catch {
    return null;
  }
}

function configFromTsconfig(tsconfigPath: string, raw: unknown): PathAliasConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const compilerOptions = (raw as { compilerOptions?: Record<string, unknown> }).compilerOptions;
  if (!compilerOptions) {
    // Still useful as marker with default baseUrl = tsconfig dir
    const dir = dirname(tsconfigPath);
    return { baseUrl: dir, mappings: [], source: tsconfigPath };
  }
  const dir = dirname(tsconfigPath);
  const baseUrlRel = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : ".";
  const baseUrl = joinPath(dir, baseUrlRel);
  const paths = compilerOptions.paths as Record<string, string[]> | undefined;
  return {
    baseUrl,
    mappings: compileMappings(paths),
    source: tsconfigPath,
  };
}

/**
 * Load path aliases for a workspace, walking up from `fromFile` toward `workspaceRoot`.
 * Cached per workspace root.
 */
export async function loadPathAliasConfig(
  workspaceRoot: string | null | undefined,
  fromFile: string,
): Promise<PathAliasConfig | null> {
  const root = (workspaceRoot || "").replace(/\/+$/, "") || null;
  const cacheKey = root || dirname(fromFile);
  if (configCache.has(cacheKey)) return configCache.get(cacheKey) ?? null;
  const inflight = configInflight.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const candidates: string[] = [];
    // Prefer project-local configs near the file, then workspace root.
    let dir = dirname(fromFile);
    const stop = root || "/";
    for (let depth = 0; depth < 12; depth += 1) {
      for (const name of [
        "tsconfig.json",
        "tsconfig.app.json",
        "tsconfig.web.json",
        "jsconfig.json",
      ]) {
        candidates.push(joinPath(dir, name));
      }
      if (dir === stop || dir === "/") break;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (root) {
      for (const name of ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"]) {
        const p = joinPath(root, name);
        if (!candidates.includes(p)) candidates.push(p);
      }
    }

    for (const path of candidates) {
      const text = await readRemoteText(path);
      if (!text) continue;
      try {
        const json = parseJsonc(text);
        const cfg = configFromTsconfig(path, json);
        if (cfg) {
          // Merge extends lightly: if extends present and no paths, try parent later via other candidates
          configCache.set(cacheKey, cfg);
          return cfg;
        }
      } catch {
        // ignore bad json
      }
    }

    // Heuristic default: @/* → src/*, app/*, .
    if (root) {
      const heuristic: PathAliasConfig = {
        baseUrl: root,
        mappings: [
          {
            prefix: "@/",
            suffix: "",
            targets: ["src/\0", "app/\0", "apps/web/src/\0", "\0"],
          },
          {
            prefix: "~/",
            suffix: "",
            targets: ["src/\0", "app/\0", "\0"],
          },
        ],
        source: "heuristic",
      };
      configCache.set(cacheKey, heuristic);
      return heuristic;
    }

    configCache.set(cacheKey, null);
    return null;
  })();

  configInflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    configInflight.delete(cacheKey);
  }
}

export function clearPathAliasCache() {
  configCache.clear();
}

/** Sync read of cache only — never blocks on network. */
export function getCachedPathAliasConfig(
  workspaceRoot: string | null | undefined,
  fromFile: string,
): PathAliasConfig | null {
  const root = (workspaceRoot || "").replace(/\/+$/, "") || null;
  const cacheKey = root || dirname(fromFile);
  if (!configCache.has(cacheKey)) return null;
  return configCache.get(cacheKey) ?? null;
}

/** Map an import specifier to absolute filesystem path prefixes (no extensions yet). */
export function resolveSpecifierBases(
  specifier: string,
  currentFile: string,
  config: PathAliasConfig | null,
  workspaceRoot?: string | null,
): string[] {
  const out: string[] = [];
  const push = (p: string) => {
    const n = p.replace(/\/+$/, "") || "/";
    if (!out.includes(n)) out.push(n);
  };

  if (specifier.startsWith(".")) {
    push(joinPath(dirname(currentFile), specifier));
    return out;
  }

  if (config) {
    for (const mapping of config.mappings) {
      for (const base of applyMapping(config.baseUrl, mapping, specifier)) {
        push(base);
      }
    }
    // bare path under baseUrl (rare)
    if (!specifier.includes(":") && !specifier.startsWith("@") || specifier.startsWith("@/")) {
      // already handled via mappings
    }
  }

  const root = (workspaceRoot || config?.baseUrl || "").replace(/\/+$/, "");
  if (specifier.startsWith("@/") || specifier.startsWith("~/") || specifier.startsWith("#/")) {
    const rest = specifier.replace(/^[@~#]\//, "");
    if (root) {
      // Common Next/Vite/ monorepo layouts
      push(joinPath(root, "src/" + rest));
      push(joinPath(root, "app/" + rest));
      push(joinPath(root, rest));
      push(joinPath(root, "apps/web/src/" + rest));
      push(joinPath(root, "apps/web/app/" + rest));
      push(joinPath(root, "packages/ui/src/" + rest));
    }
    // Also resolve relative to nearest src/ or app/ ancestor of the current file.
    let dir = dirname(currentFile);
    for (let i = 0; i < 10; i += 1) {
      const base = dir.split("/").filter(Boolean).at(-1);
      if (base === "src" || base === "app") {
        push(joinPath(dir, rest));
        // parent project root variants
        const parent = dirname(dir);
        push(joinPath(parent, "src/" + rest));
        push(joinPath(parent, "app/" + rest));
        break;
      }
      if (dir === "/" || (root && dir === root)) break;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return out;
}

/** Expand bases with typical TS/JS extensions and index files. */
export function expandPathCandidates(bases: string[], currentFileExt = ".ts"): string[] {
  const exts = Array.from(
    new Set(
      [
        currentFileExt,
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ".mts",
        ".cts",
        ".mjs",
        ".cjs",
        ".json",
        // Python / Go / Rust local modules
        ".py",
        ".pyi",
        ".go",
        ".rs",
      ].filter(Boolean),
    ),
  );
  const out: string[] = [];
  const push = (p: string) => {
    if (!out.includes(p)) out.push(p);
  };
  for (const base of bases) {
    if (/\.[a-zA-Z0-9]+$/.test(base)) {
      push(base);
      continue;
    }
    for (const e of exts) push(base + e);
    push(base);
    for (const e of [".tsx", ".ts", ".jsx", ".js", currentFileExt].filter(Boolean)) {
      push(base + "/index" + e);
    }
  }
  return out;
}
