"""App-wide remote browser (VPS Chromium via Playwright)."""
from .service import BrowserService, BrowserSession
__all__ = ["BrowserService", "BrowserSession"]
