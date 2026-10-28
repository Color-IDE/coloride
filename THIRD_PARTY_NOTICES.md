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
installed production JavaScript dependencies, Python runtime dependency
license and notice files, and Electron/Chromium notices. The generated document
and Coloride's MIT license are copied into the application's resources.
**Help → View Dependency Licenses** opens the generated document in an installed app.

Build with the Python environment used for the sidecar. The collector defaults
to `core/ide-host/.venv`, then `python`; set `COLORIDE_LICENSE_PYTHON` to override it.
The Python inventory follows the host runtime dependency closure and excludes unrelated development tools.
Missing package license files use versioned upstream notices under
`tooling/build/licenses`. MIT packages without a separate notice include the
standard MIT grant and the attribution metadata supplied by the package. Other
missing license texts fail packaging. This inventory does not replace reviewing
upstream redistribution requirements. Optional runtimes added by distributors need their
own accompanying notices.
