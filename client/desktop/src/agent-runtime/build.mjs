/** Bundle the Coloride turn scheduler for Electron embedded Node. */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = fileURLToPath(new URL("./cline-runtime.mjs", import.meta.url));
const outfile = fileURLToPath(
	new URL("../../resources/agent-runtime/cline-runtime.mjs", import.meta.url),
);

export default async function buildAgentRuntime() {
	fs.mkdirSync(path.dirname(outfile), { recursive: true });
	// Retired generated bundles must not be included by extraResources.
	for (const name of ["cline-runtime.mjs.LEGAL.txt", "coloride-runtime.mjs", "coloride-runtime.mjs.LEGAL.txt"]) {
		fs.rmSync(path.join(path.dirname(outfile), name), { force: true });
	}
	await build({
		entryPoints: [entry],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		legalComments: "linked",
	});
}

function launchedAsCli() {
	if (!process.argv[1]) return false;
	try {
		return pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase()
			=== pathToFileURL(fileURLToPath(import.meta.url)).href.toLowerCase();
	} catch {
		return false;
	}
}

if (launchedAsCli()) {
	await buildAgentRuntime();
}
