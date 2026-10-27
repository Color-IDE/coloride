const PREFIX = "agent-log:";

export function agentLogTabKey(fileName: string): string {
  const name = fileName.replace(/^.*[/\\]/, "").trim() || "agent-log.json";
  return `${PREFIX}${name}`;
}

export function isAgentLogTabKey(path: string | null | undefined): boolean {
  return Boolean(path?.startsWith(PREFIX));
}

export function agentLogTabLabel(path: string): string {
  return path.startsWith(PREFIX) ? path.slice(PREFIX.length) || "agent-log.json" : path;
}
