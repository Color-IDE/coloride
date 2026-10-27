const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");

function venvPython() {
  return path.join(
    root,
    "core/ide-host/.venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
}

function existingInterpreter(command) {
  if (!command) return null;
  if (command.includes("/") || command.includes("\\")) return fs.existsSync(command) ? command : null;
  const found = spawnSync(command, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  const executable = found.status === 0 ? found.stdout.trim() : "";
  return executable && (fs.existsSync(executable) || !path.isAbsolute(executable)) ? executable : null;
}

/** CI installs the host into the runner interpreter and sets COLORIDE_TEST_PYTHON. */
function resolveTestPython() {
  return existingInterpreter(process.env.COLORIDE_TEST_PYTHON)
    || existingInterpreter(process.env.COLORIDE_PYTHON)
    || existingInterpreter(venvPython())
    || existingInterpreter(process.platform === "win32" ? "python" : "python3")
    || venvPython();
}

module.exports = { resolveTestPython, venvPython };
