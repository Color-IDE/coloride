/** Bundle the Coloride turn scheduler for Electron embedded Node. */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = fileURLToPath(new URL("./coloride-runtime.mjs", import.meta.url));
const outfile = fileURLToPath(
	new URL("../../resources/agent-runtime/coloride-runtime.mjs", import.meta.url),
);

export default async function buildAgentRuntime() {
	fs.mkdirSync(path.dirname(outfile), { recursive: true });
	const retired = path.join(path.dirname(outfile), "coloride-runtime.mjs.LEGAL.txt");
	fs.rmSync(retired, { force: true });
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
