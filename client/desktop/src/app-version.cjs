const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

function isElectronOwnVersion(version) {
  const normalized = String(version || "").trim().replace(/^v/i, "");
  return /^43\./.test(normalized);
}

/** Product version from Coloride package.json — not Electron 43.x in `electron .` dev. */
function getColorideVersion() {
  const files = [
    path.resolve(__dirname, "..", "package.json"),
    path.resolve(__dirname, "..", "..", "..", "package.json"),
  ];
  try {
    files.push(path.join(app.getAppPath(), "package.json"));
  } catch {
    // ignore
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const version = typeof parsed.version === "string" ? parsed.version.trim() : "";
      if (version && !isElectronOwnVersion(version)) return version.replace(/^v/i, "");
    } catch {
      // try next
    }
  }
  const fallback = String(app.getVersion() || "").trim();
  return isElectronOwnVersion(fallback) ? "0.1.28" : fallback.replace(/^v/i, "");
}

module.exports = { getColorideVersion, isElectronOwnVersion };
