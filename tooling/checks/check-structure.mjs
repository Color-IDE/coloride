import { inspectRenderer } from "./renderer-structure.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const src = path.join(root, "client/ide/src");
const problems = [];
for (const name of ["backend", "frontend", "desktop", "shared", "apps", "services", "ops"]) {
  if (fs.existsSync(path.join(root, name))) problems.push(`Old root directory: ${name}`);
}
for (const name of ["client/ide/package.json", "client/desktop/package.json", "packages/contracts/package.json", "core/ide-host/pyproject.toml"]) {
  if (!fs.existsSync(path.join(root, name))) problems.push(`Missing component: ${name}`);
}
const allowed = new Set(["app", "features", "shared", "main.tsx", "vite-env.d.ts"]);
for (const entry of fs.readdirSync(src)) {
  if (!allowed.has(entry)) problems.push(`Put src/${entry} in app/, features/ or shared/`);
}
const publicApi = JSON.parse(fs.readFileSync(path.join(root, "client/ide/public-api.json"), "utf8"));
problems.push(...inspectRenderer(src, publicApi));
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Structure OK: client / core / packages; renderer app / features / shared boundaries.");
}
