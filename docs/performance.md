# Performance

Two local checks have a budget today: warm startup, and opening a 16 KiB file
that was not already open. Search latency, memory, and a start after reboot are
listed below and are not measured. A report from this checkout is a regression
check for that machine. It is not a packaged-app result and not a comparison
with another editor.

## Run

macOS only. Close other Coloride windows first; the benchmark takes focus.

```sh
corepack pnpm build:web
corepack pnpm bench:startup
corepack pnpm bench:file-open
```

Each command needs at least 20 samples. Add `--runs 20` to raise that, or
`--output path.json` to choose the report. `bench:file-open --profile` writes a
renderer CPU profile next to the report. That profile is for diagnosis. It is
not an acceptance measurement.

Run the commands alone. Another UI test, or clicking the fixture window, changes
the sample.

## What is measured

`bench:startup` creates a disposable project, opens it once, then times 20
restarts against the same project and the same local Python host. The clock
starts before Electron launches and stops after the restored file accepts an
edit and two animation frames complete. The p95 budget is 2,000 ms. A breach
exits nonzero. A failed launch is reported separately from a budget miss.

`bench:file-open` uses that same project and times 20 distinct files that were
not already open. The clock starts on a real pointer-down in the file tree and
stops when the file text is editable. Each sample must hit `/api/files/read`,
so switching a tab that is already in memory cannot pass. The p95 budget is
100 ms.

The project is 10,000 generated JavaScript files in 100 directories, plus one
`README.md`. It has no dependencies and is not committed. The script writes it
under a temporary directory and deletes it when the run finishes. Repeating the
command is the reproduction step.

## What a report contains

Reports land in `artifacts/performance/startup.json` and
`artifacts/performance/file-open.json`, which Git ignores. Each file records:

- CPU model, logical CPU count, total memory, OS release and architecture
- Node and Electron versions
- git commit, and whether the worktree was dirty
- SHA-256 of the built renderer
- every sample, the budget, and a screenshot

The report also states the limits of the run: Playwright launch time is
included, the OS file cache is not flushed, and the binary is a checkout
(production renderer, source Python), not a signed disk image.

## Not measured yet

| Check | Budget | State |
| --- | --- | --- |
| Warm start until a restored file accepts an edit | p95 ≤ 2,000 ms | `bench:startup` |
| Open a 16 KiB local file that was not already open | p95 ≤ 100 ms | `bench:file-open` |
| Start after a reboot | ≤ 4,000 ms | Needs a controlled reboot. Relaunching the app is not that test. |
| First search results | p95 ≤ 300 ms | No command yet |
| IDE memory, idle and after the open | — | No command yet |
| Switch between open tabs | p95 ≤ 50 ms | No command yet |
| Keypress to visible text | p95 ≤ 50 ms | No command yet |
| Local terminal ready | p95 ≤ 500 ms | No command yet |

Do not fill the empty rows with a hand timing. Add a command that writes the
same report shape, then publish the JSON.

Model-provider latency is a separate measurement. It depends on the provider
and the network, and it does not belong in these files.
