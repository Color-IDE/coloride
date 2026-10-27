const STORAGE_KEY = "coloride.breakpoints.v1";

function readAll(): Record<string, number[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, number[]> = {};
    for (const [path, lines] of Object.entries(raw)) {
      if (!Array.isArray(lines)) continue;
      out[path] = lines.filter((line): line is number => typeof line === "number" && line >= 1);
    }
    return out;
  } catch {
    return {};
  }
}

export function loadBreakpoints(path: string): number[] {
  return readAll()[path] ?? [];
}

export function saveBreakpoints(path: string, lines: number[]) {
  if (typeof window === "undefined") return;
  const all = readAll();
  const unique = [...new Set(lines)].filter((line) => line >= 1).sort((a, b) => a - b);
  if (unique.length) all[path] = unique;
  else delete all[path];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore quota / private mode.
  }
}
