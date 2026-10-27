# Third-party notices

Coloride includes or is built with these projects. Their licenses travel with their source or with the packaged application.

| Project | License |
| --- | --- |
| Electron | MIT |
| React | MIT |
| CodeMirror | MIT |
| xterm.js | MIT |
| FastAPI | MIT |
| Uvicorn | BSD-3-Clause |
| Pydantic | MIT |
| httpx | BSD-3-Clause |
| asyncssh | EPL-2.0 |

## Packaged notices

The packaging hook runs `tooling/build/collect-licenses.cjs` to collect the
installed production JavaScript dependencies, available Python distribution
license and notice files, and Electron/Chromium notices. The generated document
and Coloride's MIT license are copied into the application's resources.
**Help → View Dependency Licenses** opens the generated document in an installed app.

Build with the Python environment used for the sidecar. The collector defaults
to `core/ide-host/.venv`, then `python`; set `COLORIDE_LICENSE_PYTHON` to override it.
The Python inventory can also include development tools installed in that environment.
Packages that supply no separate license file are identified with their declared
license and source link; this inventory does not replace reviewing upstream
redistribution requirements. Optional runtimes added by distributors need their
own accompanying notices.
