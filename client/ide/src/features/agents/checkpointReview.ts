/** Restore newest first; record each success before attempting the next write. */
export async function restoreCheckpointBatch<T extends { id: string }>(
  checkpoints: readonly T[],
  restore: (checkpoint: T) => Promise<void>,
  settled: (checkpoint: T) => void,
): Promise<void> {
  const seen = new Set<string>();
  for (const checkpoint of [...checkpoints].reverse()) {
    if (seen.has(checkpoint.id)) continue;
    seen.add(checkpoint.id);
    await restore(checkpoint);
    settled(checkpoint);
  }
}

/** A file resolution belongs to existing checkpoints, never to future edits. */
export function resolveCheckpointPaths(
  checkpoints: readonly { id: string; paths: readonly string[] }[],
  paths: readonly string[],
  resolved: Map<string, Set<string>>,
): string[] {
  const settled: string[] = [];
  const incoming = new Set(paths);
  for (const checkpoint of checkpoints) {
    const known = resolved.get(checkpoint.id) ?? new Set<string>();
    for (const path of checkpoint.paths) {
      if (incoming.has(path)) known.add(path);
    }
    if (known.size) resolved.set(checkpoint.id, known);
    if (checkpoint.paths.length && checkpoint.paths.every((path) => known.has(path))) {
      settled.push(checkpoint.id);
    }
  }
  return settled;
}

/** Older cards must not clear or overwrite reviews belonging to later edits. */
export function checkpointPathsWithLaterEdits(
  checkpoints: readonly { id: string; paths: readonly string[] }[],
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const later = new Set<string>();
  const conflicts = new Set<string>();
  for (const checkpoint of [...checkpoints].reverse()) {
    if (selectedIds.has(checkpoint.id)) {
      for (const path of checkpoint.paths) if (later.has(path)) conflicts.add(path);
    } else {
      for (const path of checkpoint.paths) later.add(path);
    }
  }
  return conflicts;
}
