# Test suites

Tests are grouped by subsystem within the component that owns them. Backend folders contain both unit and integration tests; the folder name describes the area, not a promise that every dependency is mocked.

| Location | Coverage |
| --- | --- |
| `core/ide-host/tests/agents/` | Agent sessions, runtime, context, memory, policy, completion and checkpoints |
| `core/ide-host/tests/providers/` | Provider adapters, model capabilities and reasoning |
| `core/ide-host/tests/terminal/` | Local PTYs, shell integration, protocol, sessions and remote terminal channels |
| `core/ide-host/tests/files/` | Files, search index and semantic search |
| `core/ide-host/tests/lsp/` | Language servers, sockets and framing |
| `core/ide-host/tests/ssh/` | Connections, host keys, restricted access and production boundaries |
| `core/ide-host/tests/auth/` | Cloud tokens and integration OAuth |
| `core/ide-host/tests/profiles/` | Profile API and persistence |
| `core/ide-host/tests/reports/` | Bug report storage and API |
| `core/ide-host/tests/runner/` | Experimental remote runner persistence |
| `core/ide-host/tests/packaging/` | Platform startup regressions |
| `core/ide-host/tests/manual/` | Legacy manual SSH/profile/terminal checks; explicit execution only |
| `core/ide-host/tests/benchmarks/` | Local agent-memory/context benchmark |
| `client/ide/tests/unit/` | Node unit tests for agents, auth, editor, workspace reload races and structural boundaries |
| `client/ide/tests/` | HTML/React harnesses mounted by the Electron suites |
| `tests/electron/editor/` | Editor read-only behavior, selection, minimap and preference changes |
| `tests/electron/branding/` | Native/HTML/React startup artwork, original color reveal and reduced motion |
| `tests/electron/agents/` | Chat state, completion, cancellation and review behavior |
| `tests/electron/auth/` | Cached-account boot, revoked sessions, bounded cloud restore and immediate local access |
| `tests/electron/markdown/` | Markdown/LaTeX rendering and link safety |
| `tests/electron/notifications/` | Shared notifications, queue, actions, expiry, themes and keyboard focus |
| `tests/electron/terminal/` | Real PTYs, reconnect, job control, rendering and load |
| `tests/electron/support/` | Shared isolated Electron main/preload harness |
| `tests/electron/smoke/` | Full-IDE checkout and packaged-app smoke |

## Run from the repository root

```sh
corepack pnpm test:unit
corepack pnpm check:unused
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
# Select one backend area:
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests/files -q

# All Electron scenarios, or only terminals:
corepack pnpm test:electron
corepack pnpm test:terminal
# Select another Electron area:
corepack pnpm test:electron agents/
# Focused sidecar discovery/health startup regressions:
node --test tests/electron/unit/sidecar-*.test.cjs

# Full IDE with the production frontend build:
corepack pnpm build:web
node tests/electron/smoke/packaged-smoke.mjs --source
# Sidebar prompt stability during submit, streamed output and completion (no model calls):
node tests/electron/smoke/sidebar-submit-stability.mjs --source dark
node tests/electron/smoke/sidebar-submit-stability.mjs --source light
# Continuous native SVG and editor crossfade: light, dark and reduced motion:
node tests/electron/smoke/startup-appearance.mjs --source
# Independent Settings window, live preferences and workspace preservation:
node tests/electron/smoke/settings-window.mjs
# Active screen, header terminal recovery and confirmed closes across app restarts:
node tests/electron/smoke/session-restore.mjs
# Fresh host, stopped discovery and persistent host/shell reuse (run alone):
node tests/electron/smoke/host-startup.mjs
# Same startup regression against an already running pnpm dev:web:
node tests/electron/smoke/host-startup.mjs --dev
# Pending Python changes and legacy disabled-cloud metadata preserve a live shell:
node tests/electron/smoke/host-startup.mjs --dev --source-change
```

`test:electron` includes chat, Markdown and terminal scenarios; `test:terminal` selects only the terminal folder. CI runs the complete Electron suite in its zsh/bash matrix. Discovery uses nested `*.spec.ts` files.

`corepack pnpm test:unit` discovers all renderer TypeScript/TSX unit suites and runs them with `tsx` and `node:test`, isolated by file. Test-only resource loading does not reproduce browser rendering. The frontend CI job executes this command. Use isolated projects and profiles for running-app checks; unit tests do not certify browser layout or packaged behavior.

`settings-window.mjs` checks a separate reusable native Settings window, cross-category search, independent LLM provider blocks with mocked keys, automatic validation/save, discovery and preserved credentials, preferences and model readiness applied live in both windows, editor and terminal preservation, light/dark themes, narrow layout and keyboard shortcuts. It uses an isolated profile and temporary workspace; screenshots are written to `artifacts/settings-window/`.

`host-startup.mjs` opens and edits a local file and runs a real PTY command in each startup scenario. It checks that a stopped host adds less than two seconds versus a fresh host, and that healthy reuse preserves both host and shell PIDs. A fourth reused-host scenario holds saved-profile and SSH-state requests until a restored local file has been edited and saved, proving local restore does not wait for those probes. Timings, logs and screenshots are saved under `artifacts/host-startup/`; these checkout measurements include Playwright overhead and do not certify cold boot or packaged performance.

`startup-appearance.mjs` keeps the renderer gated while checking that the same native SVG stays animated, then verifies a monotonic crossfade and a saved editor edit in light, dark and reduced-motion profiles. Samples and screenshots are saved under `artifacts/terminal-smoke/startup-appearance/`; this verifies continuity and state changes, not a display frame-rate target.

## Manual checks and benchmarks

The former `core/ide-host/scripts` checks are grouped under `core/ide-host/tests/manual/`. They retain legacy remote workflows and are not part of the automated suite. Review their endpoint assumptions and configure an explicit test host before using them; relocation does not validate those older workflows.

The benchmark uses temporary local data and has its own CLI:

```sh
core/ide-host/.venv/bin/python core/ide-host/tests/benchmarks/agent_memory.py --help
```

Manual scripts and the benchmark deliberately do not use `test_*.py` filenames, so normal pytest discovery does not execute them.

### Live agent quality checks (paid, explicit execution)

`agent_quality.py` exercises the production provider adapters, Coloride turn scheduler and local tools with disposable projects and separate session stores. It checks read-only answers, repair, multiple files, a failed check followed by repair, a second user turn and shell-only edits. Independent assertions verify the resulting code, while original tests and a Unicode sentinel must remain unchanged. It uses the configured account or provider credentials without changing the user's model settings. The report distinguishes `passed`, `failed` and provider/credential `blocked` results; blocked runs exit nonzero.

```sh
node client/desktop/src/agent-runtime/build.mjs
core/ide-host/.venv/bin/python core/ide-host/tests/manual/agent_quality.py \
  --model xai:grok-4.7 --model xai:grok-4.5 --repeat 2 \
  --output artifacts/agent-quality/run-1
```

Use a new output directory for each run. `--case` selects scenarios, `--timeout` bounds each turn (default 240 seconds), and `--reasoning-effort` selects low, medium (default) or high reasoning. Reports, synthetic conversations and fixture files remain under the output directory for inspection. This runs billable requests against the configured providers; it is deliberately excluded from ordinary pytest/CI. Passing a sample does not establish reliability for all production tasks. `tests/agents/test_quality_workflows.py` within the ide-host service validates the evaluator with deterministic decisions and real local tools, separately from live model quality.

## Agent scheduler unit checks

`node --test tests/electron/unit/agent-turn-loop.test.mjs` exercises the host-driven scheduler without provider credentials: cancellation, streamed-text deduplication, rejected tools, empty-response recovery, completion evidence and argument validation. Backend runtime and quality-workflow tests exercise the bundled stdio integration and real local tools with deterministic model decisions.

## Isolated terminal and IDE verification


All integration fixtures create temporary HOME, user data, session storage and projects. They do not attach to installed Coloride sessions. The Electron harness mounts the production terminal component; a separate packaged smoke test opens a real local project through the production app.

```sh
corepack pnpm install --frozen-lockfile
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
corepack pnpm typecheck
corepack pnpm build:web
COLORIDE_TEST_SHELL=/bin/zsh corepack pnpm test:terminal
COLORIDE_TEST_SHELL=/bin/bash corepack pnpm test:terminal
# Optional: exercise a freshly frozen host instead of source Python:
COLORIDE_TEST_SIDECAR_BINARY=/absolute/path/to/coloride-sidecar COLORIDE_TEST_SHELL=/bin/bash corepack pnpm test:terminal
# Exercise the real IDE using the production frontend build and source host:
node tests/electron/smoke/packaged-smoke.mjs --source
# Verify proxy blocking and BYOK mode with cloud disabled:
COLORIDE_CLOUD_ENABLED=0 node tests/electron/smoke/packaged-smoke.mjs --source
node --test tests/electron/unit/cloud-config.test.cjs
# Supply an existing packaged app executable:
node tests/electron/smoke/packaged-smoke.mjs /absolute/path/to/Coloride.app/Contents/MacOS/Coloride
```

Electron coverage includes Unicode and long wrapped output, paths with spaces, Tab, history, repeated and multiline clipboard paste, foreground signals and job control, `less`, normal/error exits, a real Vite process, split panes, resize/zoom, hide/show, clear, selection, GPU recovery, reconnect, UI reload and Electron reopen with an unchanged shell PID. A real `npm run dev` fixture checks scrolling while Vite runs. Pixel checks capture the Electron window without selecting text, including ANSI clear, panel reveal and zoom; injecting a blank GPU glyph atlas reproduced invisible text before the DOM default was applied. Load coverage verifies all 50,000 numbered lines with a deliberately slow xterm consumer. Backend regressions separately verify byte-offset replay, flow-control bounds, invalid acknowledgements, deliberate history truncation, concurrent shell creation, and batched persistence.

The `terminal-local` CI job runs the Electron suite on macOS for both shells and retains failure screenshots. Local runs and a packaged offline command smoke are separate from remote CI results. The smoke artifact is an internal unsigned build; it does not validate notarization or publication.

## Performance benchmarks

The short version, including the checks that are not measured yet, is in [docs/performance.md](../docs/performance.md).

Run `corepack pnpm build:web` followed by `corepack pnpm bench:startup`. Run it alone, without other UI tests or interacting with its windows. The macOS benchmark creates a disposable project with 10,000 JavaScript files, opens a real editor in a fresh profile, then measures 20 warm restarts with the same persistent fixture host. Timing starts before Electron launches and ends after a real edit appears and two animation frames complete. The p95 budget is 2,000 ms; a breach exits nonzero. Initialization errors are reported separately from budget failures.

Results, environment details, individual samples and a screenshot are saved under `artifacts/performance/`. Voice-model prewarming is disabled to measure the IDE without a loaded local model. Playwright overhead is included; the checkout uses a production renderer and source Python, so this does not certify packaged performance, cold boot or another machine. The warmup is excluded, and the host PID must stay unchanged. No installed user profile or terminal session is used. `--runs` accepts at least 20 samples; `--output` selects a report path.

The performance targets are introduced one at a time. Warm startup and ordinary file opening currently have automated performance gates:

| Target | Budget | Coverage |
| --- | --- | --- |
| Warm startup until a restored file accepts an edit | p95 ≤ 2,000 ms | `bench:startup` |
| Startup after restarting the computer | ≤ 4,000 ms | Pending; requires a controlled reboot, not an application relaunch |
| Open an ordinary local file | p95 ≤ 100 ms | `bench:file-open` (16 KiB plain-text baseline) |
| Switch between open tabs | p95 ≤ 50 ms | Pending |
| Key input to visible text | p95 ≤ 50 ms | Pending |
| First search results | p95 ≤ 300 ms | Pending |
| Local terminal ready, controlled shell | p95 ≤ 500 ms | Pending |
| Cancellation reflected in the UI | p95 ≤ 100 ms | Pending |

Smooth scrolling, idle CPU, total IDE memory and long-session memory growth need separate workloads and measurements. Model-provider response latency is separate from local UI response time.

`corepack pnpm bench:file-open` uses the same isolated desktop fixture with 10,000 JavaScript files and measures 20 distinct, previously unopened 16 KiB text files. It starts the renderer clock on a trusted pointer-down in the explorer and stops after the expected editable content appears and another animation frame completes. Each sample must make a real `/api/files/read` request, so switching cached editor buffers cannot pass as file opening. Loopback stat/read resource timings are included. Reports are written to `artifacts/performance/file-open.json`; the p95 budget is 100 ms. Syntax parsing, LSP, large files and cold disk access require separate workloads.

Both commands use `tests/electron/benchmarks/desktop.mjs`. Use `--profile` with the file-open command to save a renderer CPU profile next to the JSON report; profiling adds overhead and is diagnostic, not an acceptance measurement. Reports distinguish budget failures from setup errors.

### Cross-editor comparison protocol

The internal renderer benchmark is a ColorIDE regression check, not evidence that it is faster than another editor. Prepare the separate macOS experiment with `corepack pnpm bench:compare:prepare`. This writes the shared files, configuration snapshots, installed versions, screen metadata and execution schedule to `artifacts/performance/comparison/plan.json`; it does not execute or rank editors.

The protocol uses ColorIDE, VS Code and Zed on the same machine and display. Six independent rounds use all six editor-order permutations, with 20 identical 16 KiB files per editor per round: **120 first opens per editor, 360 total**. File order rotates between rounds but stays identical across editors in each round. Every execution needs a new process/profile, an unopened measured-file set, and a separate warmup file. OS caches remain warm and this is documented. Verify profiles and built-in services in the running editors before accepting an execution. No installed user sessions or preferences may be reused.

The common measurement is native mouse-down to the first frame containing the correct file marker, using `native-capture.swift` for all three applications. ScreenCaptureKit records only the fixture window's editor crop; Vision OCR and PNG encoding run after recording. The requested capture rate is 120 FPS, but actual timestamps and observed frame gaps determine precision. A calibration step must establish that input and frame clocks agree. DOM-ready timings and accessibility-value updates cannot substitute for visible pixels in this comparison.

`protocol.mjs` defines the balanced schedule, nearest-rank p50/p95/p99, native-frame sample validation and a common macOS process-tree sampler. Include every editor child process and ColorIDE's detached Python host, while excluding automation/recording processes. Record a two-second idle baseline and the active opening block, with RSS and CPU-time snapshots every 250 ms. CPU uses 100% for one core; summed RSS may double-count shared memory, and sampling can miss very short-lived children. Retain pooled statistics, per-run distributions, every raw sample, OCR/frame evidence and failed attempts. Missing evidence invalidates an execution rather than removing an outlier. A p99 from 120 observations is coarse.

The generated profiles propose plain text, Menlo 16, no wrapping/minimap, no third-party extensions, no active AI/LSP and disabled update/telemetry services. The editor adapters and applied configuration still require running-app verification. Zed settings are based on its [official settings reference](https://zed.dev/docs/reference/all-settings); installed-version behavior is the authority. ColorIDE currently uses a production renderer with source Python, so this is not a release-to-release claim.

The native helper compiles during preparation. `artifacts/performance/tools/native-capture --check` checks Screen Recording and Accessibility without prompting or recording. Capture refuses to run if either permission is missing. Run `corepack pnpm test:benchmarks` to validate scheduling, statistics, resource sampling and rejection of missing/stale visual evidence. The prepared protocol still needs verified editor adapters and capture calibration before comparative results can be published.

Missing native capture permissions or a Zed CLI response of `zed is already running` are setup prerequisites, not benchmark failures or performance results. Record the observed preflight state in the generated plan and verify a separate Zed process/profile. Do not stop the user's existing editor automatically. `summarizeComparison` rejects missing executions, incompatible timing methods, unverified configurations, changed file hashes and missing CPU/RAM evidence.

`node tests/electron/benchmarks/compare-run.mjs --probe --editor=coloride` checks one isolated adapter; replace `coloride` with `vscode` or `zed` to inspect the others. The runner and `native-driver.swift` are experimental: VS Code focus handling remains unresolved. Full execution requires `--experimental`, retains unverified raw captures, and cannot produce an accepted ranking because configuration/calibration verification remains false. This is not a completed cross-editor benchmark. The driver activates only its fixture PID and checks window geometry and focus before input. Run it only while the desktop is free for testing.

Preparation places profiles under a short temporary path to respect macOS IPC socket limits, and puts the shared workload outside the repository to avoid ancestor Git discovery. The plan records their actual paths; reports remain under `artifacts/performance/comparison/`. Zed's custom data directory uses `user-data/config/settings.json`. The recorder requires `--window-id` when the fixture process has multiple visible windows, and preserves timestamps while sharing unchanged frame pixels in memory.
