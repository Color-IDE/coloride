#!/usr/bin/env python3
"""Coloride remote browser driver — runs on the VPS with Playwright.

One-shot CLI. Chromium stays alive via remote debugging between calls.
Stdout is always a single JSON object.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

RUNTIME_VERSION = "3"
MAX_SNAPSHOT_CHARS = 24_000
MAX_SCREENSHOT_BYTES = 900_000
MAX_STREAM_BYTES = 350_000
DEFAULT_VIEWPORT = {"width": 1280, "height": 800}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="coloride-browser-driver")
    parser.add_argument("--root", required=True, help="Session root on the VPS")
    sub = parser.add_subparsers(dest="command", required=True)

    open_p = sub.add_parser("open")
    open_p.add_argument("--url", required=True)
    open_p.add_argument("--browser-id", required=True)

    for name in ("snapshot", "screenshot", "frame", "close", "status"):
        p = sub.add_parser(name)
        p.add_argument("--browser-id", required=True)
        if name == "frame":
            p.add_argument("--quality", type=int, default=52)

    click_p = sub.add_parser("click")
    click_p.add_argument("--browser-id", required=True)
    click_p.add_argument("--ref", required=True)

    click_xy_p = sub.add_parser("click_xy")
    click_xy_p.add_argument("--browser-id", required=True)
    click_xy_p.add_argument("--x", type=float, required=True)
    click_xy_p.add_argument("--y", type=float, required=True)
    click_xy_p.add_argument("--button", default="left")
    click_xy_p.add_argument("--click-count", type=int, default=1)

    wheel_p = sub.add_parser("wheel")
    wheel_p.add_argument("--browser-id", required=True)
    wheel_p.add_argument("--x", type=float, default=0)
    wheel_p.add_argument("--y", type=float, default=0)
    wheel_p.add_argument("--delta-x", type=float, default=0)
    wheel_p.add_argument("--delta-y", type=float, default=0)

    type_p = sub.add_parser("type")
    type_p.add_argument("--browser-id", required=True)
    type_p.add_argument("--ref", required=True)
    type_p.add_argument("--text", required=True)
    type_p.add_argument("--submit", action="store_true")
    type_p.add_argument("--slowly", action="store_true")

    type_raw_p = sub.add_parser("type_raw")
    type_raw_p.add_argument("--browser-id", required=True)
    type_raw_p.add_argument("--text", required=True)

    press_p = sub.add_parser("press")
    press_p.add_argument("--browser-id", required=True)
    press_p.add_argument("--key", required=True)
    press_p.add_argument("--ref", default="")

    args = parser.parse_args(argv)
    root = Path(args.root).expanduser()
    root.mkdir(parents=True, exist_ok=True)

    try:
        if args.command == "open":
            result = cmd_open(root, args.browser_id, args.url)
        elif args.command == "snapshot":
            result = cmd_snapshot(root, args.browser_id)
        elif args.command == "screenshot":
            result = cmd_screenshot(root, args.browser_id)
        elif args.command == "frame":
            result = cmd_frame(root, args.browser_id, quality=int(args.quality))
        elif args.command == "click":
            result = cmd_click(root, args.browser_id, args.ref)
        elif args.command == "click_xy":
            result = cmd_click_xy(
                root,
                args.browser_id,
                float(args.x),
                float(args.y),
                button=str(args.button or "left"),
                click_count=int(args.click_count or 1),
            )
        elif args.command == "wheel":
            result = cmd_wheel(
                root,
                args.browser_id,
                float(args.x),
                float(args.y),
                float(args.delta_x),
                float(args.delta_y),
            )
        elif args.command == "type":
            result = cmd_type(
                root,
                args.browser_id,
                args.ref,
                args.text,
                submit=args.submit,
                slowly=args.slowly,
            )
        elif args.command == "type_raw":
            result = cmd_type_raw(root, args.browser_id, args.text)
        elif args.command == "press":
            result = cmd_press(root, args.browser_id, args.key, args.ref or None)
        elif args.command == "close":
            result = cmd_close(root, args.browser_id)
        elif args.command == "status":
            result = cmd_status(root, args.browser_id)
        else:
            result = {"ok": False, "error": f"Unknown command: {args.command}"}
    except Exception as exc:  # noqa: BLE001 — always emit JSON for the desktop client
        result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0 if result.get("ok") else 1


def cmd_open(root: Path, browser_id: str, url: str) -> dict[str, Any]:
    _validate_browser_id(browser_id)
    _validate_url(url)
    session_dir = _session_dir(root, browser_id)
    session_dir.mkdir(parents=True, exist_ok=True)
    state = _load_state(session_dir)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser, context, page, state = _ensure_browser(playwright, session_dir, state)
        page.goto(url, wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_timeout(250)
        info = _page_info(page)
        refs = _build_snapshot(page)
        _save_refs(session_dir, refs["map"])
        _save_state(session_dir, state)
        return {
            "ok": True,
            "browserId": browser_id,
            "url": info["url"],
            "title": info["title"],
            "snapshot": refs["text"],
            "refCount": len(refs["map"]),
        }


def cmd_snapshot(root: Path, browser_id: str) -> dict[str, Any]:
    _validate_browser_id(browser_id)
    session_dir = _session_dir(root, browser_id)
    state = _require_state(session_dir)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser, context, page, state = _ensure_browser(playwright, session_dir, state)
        info = _page_info(page)
        refs = _build_snapshot(page)
        _save_refs(session_dir, refs["map"])
        _save_state(session_dir, state)
        return {
            "ok": True,
            "browserId": browser_id,
            "url": info["url"],
            "title": info["title"],
            "snapshot": refs["text"],
            "refCount": len(refs["map"]),
        }


def cmd_screenshot(root: Path, browser_id: str) -> dict[str, Any]:
    _validate_browser_id(browser_id)
    session_dir = _session_dir(root, browser_id)
    state = _require_state(session_dir)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser, context, page, state = _ensure_browser(playwright, session_dir, state)
        info = _page_info(page)
        png_path = session_dir / "last.png"
        page.screenshot(path=str(png_path), full_page=False, type="png")
        raw = png_path.read_bytes()
        if len(raw) > MAX_SCREENSHOT_BYTES:
            # Retry as JPEG-ish by scaling via quality path — Playwright png only; truncate note.
            page.screenshot(path=str(png_path), full_page=False, type="jpeg", quality=62)
            raw = png_path.read_bytes()
        encoded = base64.b64encode(raw[:MAX_SCREENSHOT_BYTES]).decode("ascii")
        viewport = page.viewport_size or DEFAULT_VIEWPORT
        _save_state(session_dir, state)
        return {
            "ok": True,
            "browserId": browser_id,
            "url": info["url"],
            "title": info["title"],
            "mimeType": "image/png" if raw[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg",
            "imageBase64": encoded,
            "byteLength": len(raw),
            "width": int(viewport.get("width") or DEFAULT_VIEWPORT["width"]),
            "height": int(viewport.get("height") or DEFAULT_VIEWPORT["height"]),
        }


def cmd_frame(root: Path, browser_id: str, *, quality: int = 52) -> dict[str, Any]:
    """Fast JPEG frame for the live embedded browser stream."""
    _validate_browser_id(browser_id)
    session_dir = _session_dir(root, browser_id)
    state = _require_state(session_dir)
    quality = max(30, min(80, int(quality or 52)))

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser, context, page, state = _ensure_browser(playwright, session_dir, state)
        info = _page_info(page)
        frame_path = session_dir / "frame.jpg"
        page.screenshot(path=str(frame_path), full_page=False, type="jpeg", quality=quality)
        raw = frame_path.read_bytes()
        if len(raw) > MAX_STREAM_BYTES:
            page.screenshot(path=str(frame_path), full_page=False, type="jpeg", quality=max(28, quality - 18))
            raw = frame_path.read_bytes()
        encoded = base64.b64encode(raw[:MAX_STREAM_BYTES]).decode("ascii")
        viewport = page.viewport_size or DEFAULT_VIEWPORT
        _save_state(session_dir, state)
        return {
            "ok": True,
            "browserId": browser_id,
            "url": info["url"],
            "title": info["title"],
            "mimeType": "image/jpeg",
            "imageBase64": encoded,
            "byteLength": len(raw),
            "width": int(viewport.get("width") or DEFAULT_VIEWPORT["width"]),
            "height": int(viewport.get("height") or DEFAULT_VIEWPORT["height"]),
        }


def cmd_click(root: Path, browser_id: str, ref: str) -> dict[str, Any]:
    _validate_browser_id(browser_id)
    session_dir = _session_dir(root, browser_id)
    state = _require_state(session_dir)
    selector = _resolve_ref(session_dir, ref)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser, context, page, state = _ensure_browser(playwright, session_dir, state)
        locator = page.locator(selector).first
        locator.click(timeout=15_000)
        page.wait_for_timeout(200)
        info = _page_info(page)
        refs = _build_snapshot(page)
        _save_refs(session_dir, refs["map"])
        _save_state(session_dir, state)
        return {
            "ok": True,
            "browserId": browser_id,
            "ref": ref,
            "url": info["url"],
            "title": info["title"],
            "snapshot": refs["text"],
        }


def cmd_type(
    root: Path,
    browser_id: str,
    ref: str,
    text: str,
    *,
    submit: bool,
    slowly: bool,
) -> dict[str, Any]:
    _validate_browser_id(browser_id)
    if len(text) > 20_000:
        raise ValueError("Text is too long")
    session_dir = _session_dir(root, browser_id)
    state = _require_state(session_dir)
    selector = _resolve_ref(session_dir, ref)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser, context, page, state = _ensure_browser(playwright, session_dir, state)
        locator = page.locator(selector).first
        locator.click(timeout=15_000)
        locator.fill("")
        if slowly:
            locator.type(text, delay=20)
        else:
            locator.fill(text)
        if submit:
            locator.press("Enter")
        page.wait_for_timeout(200)
        info = _page_info(page)
        refs = _build_snapshot(page)
        _save_refs(session_dir, refs["map"])
        _save_state(session_dir, state)
        return {
            "ok": True,
            "browserId": browser_id,
            "ref": ref,
            "url": info["url"],
            "title": info["title"],
            "snapshot": refs["text"],
            "submitted": submit,
        }


def cmd_press(root: Path, browser_id: str, key: str, ref: str | None) -> dict[str, Any]:
    _validate_browser_id(browser_id)
    key = (key or "").strip()
    if not key or len(key) > 40:
        raise ValueError("Invalid key")
    # Normalize common aliases the model may send (e.g. "end" → "End").
    key_aliases = {
        "return": "Enter",
        "esc": "Escape",
        "arrowup": "ArrowUp",
        "arrowdown": "ArrowDown",
        "arrowleft": "ArrowLeft",
        "arrowright": "ArrowRight",
        "pageup": "PageUp",
        "pagedown": "PageDown",
        "backspace": "Backspace",
        "delete": "Delete",
        "tab": "Tab",
        "enter": "Enter",
        "escape": "Escape",
        "end": "End",
        "home": "Home",
        "space": " ",
    }
    key = key_aliases.get(key.lower(), key)
    session_dir = _session_dir(root, browser_id)
    state = _require_state(session_dir)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser, context, page, state = _ensure_browser(playwright, session_dir, state)
        try:
            if ref:
                selector = _resolve_ref(session_dir, ref)
                page.locator(selector).first.press(key, timeout=15_000)
            else:
                page.keyboard.press(key)
        except Exception as exc:  # noqa: BLE001
            where = f" on ref {ref}" if ref else " (page-level)"
            raise RuntimeError(f"Key press failed for {key!r}{where}: {exc}") from exc
        page.wait_for_timeout(150)
        info = _page_info(page)
        refs = _build_snapshot(page)
        _save_refs(session_dir, refs["map"])
        _save_state(session_dir, state)
        return {
            "ok": True,
            "browserId": browser_id,
            "key": key,
            "url": info["url"],
            "title": info["title"],
            "snapshot": refs["text"],
        }


def cmd_click_xy(
    root: Path,
    browser_id: str,
    x: float,
    y: float,
    *,
    button: str = "left",
    click_count: int = 1,
) -> dict[str, Any]:
    """Click at viewport coordinates (for the embedded live browser UI)."""
    _validate_browser_id(browser_id)
    session_dir = _session_dir(root, browser_id)
    state = _require_state(session_dir)
    button = (button or "left").lower()
    if button not in {"left", "right", "middle"}:
        button = "left"
    click_count = max(1, min(3, int(click_count or 1)))
    x = max(0.0, float(x))
    y = max(0.0, float(y))

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser, context, page, state = _ensure_browser(playwright, session_dir, state)
        page.mouse.click(x, y, button=button, click_count=click_count)
        page.wait_for_timeout(120)
        info = _page_info(page)
        _save_state(session_dir, state)
        return {
            "ok": True,
            "browserId": browser_id,
            "x": x,
            "y": y,
            "button": button,
            "url": info["url"],
            "title": info["title"],
        }


def cmd_wheel(
    root: Path,
    browser_id: str,
    x: float,
    y: float,
    delta_x: float,
    delta_y: float,
) -> dict[str, Any]:
    _validate_browser_id(browser_id)
    session_dir = _session_dir(root, browser_id)
    state = _require_state(session_dir)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser, context, page, state = _ensure_browser(playwright, session_dir, state)
        if x or y:
            page.mouse.move(max(0.0, x), max(0.0, y))
        page.mouse.wheel(float(delta_x), float(delta_y))
        page.wait_for_timeout(80)
        info = _page_info(page)
        _save_state(session_dir, state)
        return {
            "ok": True,
            "browserId": browser_id,
            "url": info["url"],
            "title": info["title"],
        }


def cmd_type_raw(root: Path, browser_id: str, text: str) -> dict[str, Any]:
    """Type into the focused element (live UI keyboard path)."""
    _validate_browser_id(browser_id)
    if len(text) > 8_000:
        raise ValueError("Text is too long")
    session_dir = _session_dir(root, browser_id)
    state = _require_state(session_dir)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser, context, page, state = _ensure_browser(playwright, session_dir, state)
        page.keyboard.type(text, delay=0)
        page.wait_for_timeout(60)
        info = _page_info(page)
        _save_state(session_dir, state)
        return {
            "ok": True,
            "browserId": browser_id,
            "url": info["url"],
            "title": info["title"],
        }


def cmd_close(root: Path, browser_id: str) -> dict[str, Any]:
    _validate_browser_id(browser_id)
    session_dir = _session_dir(root, browser_id)
    state = _load_state(session_dir)
    pid = int(state.get("pid") or 0)
    if pid > 0:
        _kill_pid(pid)
    # Best-effort cleanup of leftover chromium for this profile.
    profile = session_dir / "profile"
    for path in (
        session_dir / "state.json",
        session_dir / "refs.json",
        session_dir / "last.png",
        session_dir / "chromium.log",
    ):
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    return {"ok": True, "browserId": browser_id, "closed": True, "profile": str(profile)}


def cmd_status(root: Path, browser_id: str) -> dict[str, Any]:
    _validate_browser_id(browser_id)
    session_dir = _session_dir(root, browser_id)
    state = _load_state(session_dir)
    pid = int(state.get("pid") or 0)
    alive = pid > 0 and _pid_alive(pid)
    return {
        "ok": True,
        "browserId": browser_id,
        "alive": alive,
        "url": state.get("url") or "",
        "cdpPort": state.get("cdpPort") or 0,
    }


def _ensure_browser(playwright: Any, session_dir: Path, state: dict[str, Any]) -> tuple[Any, Any, Any, dict[str, Any]]:
    """Attach to a long-lived Chromium, or start one.

    VPS notes:
    - Running as root requires --no-sandbox
    - Missing host libs make Chromium exit immediately; we capture stderr
    - If detached CDP launch fails, fall back to Playwright-managed launch
      for this CLI invocation (still uses the same user-data-dir).
    """
    cdp_port = int(state.get("cdpPort") or 0)
    pid = int(state.get("pid") or 0)
    browser = None
    managed = False  # True when Playwright owns the process (closes with this CLI)

    if cdp_port and pid and _pid_alive(pid):
        try:
            browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
        except Exception:
            browser = None

    if browser is None:
        browser, state, managed = _start_chromium(playwright, session_dir, state)

    context = browser.contexts[0] if browser.contexts else browser.new_context(
        viewport=DEFAULT_VIEWPORT
    )
    page = context.pages[0] if context.pages else context.new_page()
    try:
        page.set_viewport_size(DEFAULT_VIEWPORT)
    except Exception:
        pass
    state["url"] = page.url
    state["managed"] = managed
    return browser, context, page, state


def _chromium_launch_args(cdp_port: int | None = None) -> list[str]:
    """Flags that work on minimal Ubuntu VPS images (often as root)."""
    args = [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",  # avoid /dev/shm tiny tmpfs OOM on small VPS
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--disable-background-networking",
        "--mute-audio",
        "--no-sandbox",  # required when Chromium runs as root
        "--disable-setuid-sandbox",
        "--window-size=1280,800",
    ]
    if cdp_port is not None:
        args.insert(0, f"--remote-debugging-port={cdp_port}")
        args.append("--headless=new")
        args.append("about:blank")
    return args


def _chromium_executables(playwright: Any) -> list[str]:
    """Prefer full Chromium, then headless shell if present."""
    paths: list[str] = []
    try:
        paths.append(str(playwright.chromium.executable_path))
    except Exception:
        pass
    # Playwright also ships chromium-headless-shell next to the browser cache.
    home = Path.home()
    cache = home / ".cache" / "ms-playwright"
    if cache.is_dir():
        for match in sorted(cache.glob("chromium_headless_shell-*/chrome-linux/headless_shell")):
            paths.append(str(match))
        for match in sorted(cache.glob("chromium-*/chrome-linux/chrome")):
            paths.append(str(match))
    # de-dupe preserving order
    seen: set[str] = set()
    out: list[str] = []
    for path in paths:
        if path and path not in seen and Path(path).exists():
            seen.add(path)
            out.append(path)
    return out


def _start_chromium(
    playwright: Any,
    session_dir: Path,
    state: dict[str, Any],
) -> tuple[Any, dict[str, Any], bool]:
    profile = session_dir / "profile"
    profile.mkdir(parents=True, exist_ok=True)
    log_path = session_dir / "chromium.log"
    errors: list[str] = []

    # --- Attempt 1: detached Chromium + CDP reconnect (survives CLI exits) ---
    for executable in _chromium_executables(playwright):
        cdp_port = _pick_port()
        chrome_args = [
            f"--user-data-dir={profile}",
            *_chromium_launch_args(cdp_port),
        ]
        # Kill stale profile locks if a previous chromium died hard.
        for lock_name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
            lock = profile / lock_name
            try:
                if lock.exists() or lock.is_symlink():
                    lock.unlink()
            except OSError:
                pass

        try:
            with log_path.open("ab") as log_file:
                log_file.write(f"\n--- launch {executable} port={cdp_port} ---\n".encode())
                log_file.flush()
                proc = subprocess.Popen(  # noqa: S603 — controlled args
                    [executable, *chrome_args],
                    stdout=log_file,
                    stderr=log_file,
                    start_new_session=True,
                    env={
                        **os.environ,
                        "HOME": str(Path.home()),
                        "PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS": "1",
                    },
                )
        except OSError as exc:
            errors.append(f"{executable}: spawn failed: {exc}")
            continue

        endpoint = f"http://127.0.0.1:{cdp_port}"
        deadline = time.time() + 25
        last_error: Exception | None = None
        browser = None
        while time.time() < deadline:
            if proc.poll() is not None:
                # Process died — stop waiting for CDP.
                tail = _read_log_tail(log_path)
                errors.append(
                    f"{executable}: exited early code={proc.returncode}. log: {tail}"
                )
                break
            try:
                browser = playwright.chromium.connect_over_cdp(endpoint)
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                time.sleep(0.25)
        if browser is not None:
            new_state = {
                "pid": proc.pid,
                "cdpPort": cdp_port,
                "executable": executable,
                "runtimeVersion": RUNTIME_VERSION,
                "mode": "cdp",
            }
            return browser, new_state, False
        # Ensure zombie launch is cleaned up before next try.
        _kill_pid(proc.pid)
        if last_error is not None and not any("exited early" in e for e in errors[-1:]):
            tail = _read_log_tail(log_path)
            errors.append(f"{executable}: CDP connect failed: {last_error}. log: {tail}")

    # --- Attempt 2: Playwright-managed launch (this CLI only) ---
    try:
        browser = playwright.chromium.launch(
            headless=True,
            args=_chromium_launch_args(cdp_port=None),
            chromium_sandbox=False,
            handle_sigint=False,
            handle_sigterm=False,
            handle_sighup=False,
        )
        new_state = {
            "pid": 0,
            "cdpPort": 0,
            "executable": str(getattr(playwright.chromium, "executable_path", "") or ""),
            "runtimeVersion": RUNTIME_VERSION,
            "mode": "managed",
        }
        return browser, new_state, True
    except Exception as exc:  # noqa: BLE001
        errors.append(f"playwright.launch: {exc}")

    # --- Attempt 3: persistent context (still managed) ---
    try:
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(profile),
            headless=True,
            args=_chromium_launch_args(cdp_port=None),
            chromium_sandbox=False,
            viewport=DEFAULT_VIEWPORT,
            handle_sigint=False,
            handle_sigterm=False,
            handle_sighup=False,
        )
        # Wrap so callers can still use browser.contexts[0]
        class _ContextBrowser:
            def __init__(self, ctx: Any) -> None:
                self.contexts = [ctx]
                self._ctx = ctx

            def close(self) -> None:
                self._ctx.close()

        new_state = {
            "pid": 0,
            "cdpPort": 0,
            "executable": "persistent",
            "runtimeVersion": RUNTIME_VERSION,
            "mode": "persistent",
        }
        return _ContextBrowser(context), new_state, True
    except Exception as exc:  # noqa: BLE001
        errors.append(f"playwright.launch_persistent_context: {exc}")

    detail = " | ".join(errors[-4:]) if errors else "unknown error"
    hint = (
        "Chromium could not start on this VPS. "
        "Usually missing system libraries (libgbm, nss, atk…) or sandbox restrictions. "
        "As root, try: apt-get install -y libgbm1 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 "
        "libcups2t64 libxcomposite1 libxdamage1 libxrandr2 libasound2t64 libxkbcommon0 fonts-liberation"
    )
    raise RuntimeError(f"{hint} Details: {detail}")


def _read_log_tail(path: Path, limit: int = 1200) -> str:
    try:
        data = path.read_bytes()
    except OSError:
        return "(no log)"
    text = data[-limit:].decode("utf-8", errors="replace").strip()
    return text.replace("\n", " \\n ") if text else "(empty log)"


def _kill_pid(pid: int) -> None:
    if pid <= 0:
        return
    try:
        os.kill(pid, signal.SIGTERM)
        time.sleep(0.15)
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except PermissionError:
        pass


def _build_snapshot(page: Any) -> dict[str, Any]:
    """Build a compact a11y-inspired list with stable refs for click/type."""
    payload = page.evaluate(
        """() => {
          const interesting = new Set([
            'a', 'button', 'input', 'textarea', 'select', 'option',
            'summary', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
          ]);
          const out = [];
          const all = Array.from(document.querySelectorAll('body *'));
          let count = 0;
          for (const el of all) {
            if (count >= 120) break;
            const tag = (el.tagName || '').toLowerCase();
            const role = (el.getAttribute('role') || '').toLowerCase();
            const type = (el.getAttribute('type') || '').toLowerCase();
            if (type === 'hidden') continue;
            const style = window.getComputedStyle(el);
            if (style && (style.visibility === 'hidden' || style.display === 'none')) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) continue;
            const isInteresting =
              interesting.has(tag) ||
              role === 'button' || role === 'link' || role === 'textbox' ||
              role === 'checkbox' || role === 'radio' || role === 'menuitem' ||
              el.isContentEditable ||
              (typeof el.onclick === 'function');
            if (!isInteresting) continue;
            const text = (
              el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') ||
              el.getAttribute('name') ||
              el.getAttribute('alt') ||
              el.innerText ||
              el.textContent ||
              ''
            ).replace(/\\s+/g, ' ').trim().slice(0, 80);
            const kind =
              role ||
              (tag === 'a' ? 'link' :
               tag === 'button' ? 'button' :
               tag === 'input' ? (type || 'textbox') :
               tag === 'textarea' ? 'textbox' :
               tag === 'select' ? 'combobox' :
               tag.startsWith('h') ? 'heading' : tag);
            // Prefer stable selectors.
            let selector = '';
            if (el.id) selector = `#${CSS.escape(el.id)}`;
            else if (el.getAttribute('data-testid'))
              selector = `[data-testid="${el.getAttribute('data-testid').replace(/"/g, '\\\\"')}"]`;
            else if (el.getAttribute('name') && (tag === 'input' || tag === 'textarea' || tag === 'select'))
              selector = `${tag}[name="${el.getAttribute('name').replace(/"/g, '\\\\"')}"]`;
            else {
              // nth-of-path fallback
              const path = [];
              let node = el;
              while (node && node.nodeType === 1 && path.length < 6 && node.tagName.toLowerCase() !== 'html') {
                const t = node.tagName.toLowerCase();
                const parent = node.parentElement;
                if (!parent) { path.unshift(t); break; }
                const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
                const idx = siblings.indexOf(node) + 1;
                path.unshift(siblings.length > 1 ? `${t}:nth-of-type(${idx})` : t);
                node = parent;
              }
              selector = path.join(' > ');
            }
            count += 1;
            const ref = `e${count}`;
            out.push({ ref, kind, text, selector });
          }
          return out;
        }"""
    )
    lines = [f'Page: {page.title() or "(untitled)"} — {page.url}']
    ref_map: dict[str, str] = {}
    for item in payload or []:
        ref = str(item.get("ref") or "")
        kind = str(item.get("kind") or "element")
        text = str(item.get("text") or "").replace("\n", " ")
        selector = str(item.get("selector") or "")
        if not ref or not selector:
            continue
        ref_map[ref] = selector
        label = f' "{text}"' if text else ""
        lines.append(f"- {kind}{label} [{ref}]")
    text = "\n".join(lines)
    if len(text) > MAX_SNAPSHOT_CHARS:
        text = text[: MAX_SNAPSHOT_CHARS - 20].rstrip() + "\n… (truncated)"
    return {"text": text, "map": ref_map}


def _page_info(page: Any) -> dict[str, str]:
    try:
        title = page.title() or ""
    except Exception:
        title = ""
    try:
        url = page.url or ""
    except Exception:
        url = ""
    return {"title": title, "url": url}


def _session_dir(root: Path, browser_id: str) -> Path:
    return root / browser_id


def _state_path(session_dir: Path) -> Path:
    return session_dir / "state.json"


def _refs_path(session_dir: Path) -> Path:
    return session_dir / "refs.json"


def _load_state(session_dir: Path) -> dict[str, Any]:
    path = _state_path(session_dir)
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _require_state(session_dir: Path) -> dict[str, Any]:
    state = _load_state(session_dir)
    # CDP mode stores cdpPort; managed/persistent modes may only set mode/executable.
    if not state:
        raise RuntimeError("Browser is not open. Call browser_open first.")
    if not (
        state.get("cdpPort")
        or state.get("mode") in {"managed", "persistent", "cdp"}
        or state.get("executable")
        or state.get("pid")
    ):
        raise RuntimeError("Browser is not open. Call browser_open first.")
    return state


def _save_state(session_dir: Path, state: dict[str, Any]) -> None:
    path = _state_path(session_dir)
    path.write_text(json.dumps(state, ensure_ascii=True, indent=2), encoding="utf-8")
    os.chmod(path, 0o600)


def _save_refs(session_dir: Path, ref_map: dict[str, str]) -> None:
    path = _refs_path(session_dir)
    path.write_text(json.dumps(ref_map, ensure_ascii=True, indent=2), encoding="utf-8")
    os.chmod(path, 0o600)


def _resolve_ref(session_dir: Path, ref: str) -> str:
    ref = (ref or "").strip()
    if not ref or len(ref) > 32:
        raise ValueError("Invalid element ref")
    path = _refs_path(session_dir)
    if not path.exists():
        raise RuntimeError("No snapshot refs. Call browser_snapshot or browser_open first.")
    try:
        mapping = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("Corrupt snapshot refs") from exc
    if not isinstance(mapping, dict) or ref not in mapping:
        raise KeyError(f"Unknown ref {ref!r}. Take a fresh browser_snapshot.")
    selector = str(mapping[ref])
    if not selector:
        raise KeyError(f"Empty selector for ref {ref!r}")
    return selector


def _validate_browser_id(browser_id: str) -> None:
    if not browser_id or len(browser_id) > 80:
        raise ValueError("Invalid browser id")
    if "/" in browser_id or ".." in browser_id or browser_id.startswith("."):
        raise ValueError("Invalid browser id")


def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only http and https URLs are allowed")
    if not parsed.netloc:
        raise ValueError("URL must include a host")


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _pick_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


if __name__ == "__main__":
    raise SystemExit(main())
