from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from webtestpilot_crawler.config import CrawlConfig, CrawlLimits
from webtestpilot_crawler.crawler import WebTestPilotCrawler


class FixtureHandler(BaseHTTPRequestHandler):
    mutation_count = 0

    def log_message(self, format, *args):  # noqa: A003
        return

    def do_GET(self):  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/broken.png":
            self.send_response(404)
            self.end_headers()
            return
        if path == "/error":
            body = "<h1>Error page</h1><img src='/broken.png'><script>throw new Error('fixture boom')</script>"
        elif path.startswith("/calendar/"):
            year = int(path.rsplit("/", 1)[-1])
            body = f"<h1>Calendar {year}</h1><a href='/calendar/{year + 1}'>Next year</a>"
        elif path == "/revealed":
            body = "<h1>Revealed by hover</h1>"
        else:
            body = """
            <style>.menu a {display:none}.menu:hover a {display:block}</style>
            <h1>Home</h1>
            <a href='/error?utm_source=one'>Error one</a>
            <a href='/error?utm_source=two'>Error duplicate</a>
            <a href='/calendar/2026'>Calendar</a>
            <div class='menu' title='Products'>Products<a href='/revealed'>Hidden destination</a></div>
            <button type='button' onclick='window.noop = true'>No visible change</button>
            <button type='button' onclick="fetch('/mutate', {method: 'POST'})">Enable feature</button>
            """
        payload = f"<!doctype html><html><body>{body}</body></html>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Set-Cookie", "session=SECRET_TOKEN; HttpOnly; SameSite=Lax")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):  # noqa: N802
        type(self).mutation_count += 1
        self.send_response(204)
        self.end_headers()


@pytest.fixture(scope="module")
def fixture_url():
    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def _chromium_available() -> bool:
    async def check():
        try:
            from playwright.async_api import async_playwright

            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(headless=True)
                await browser.close()
            return True
        except Exception:
            return False

    return asyncio.run(check())


def test_browser_crawl_detects_errors_reveals_hover_and_stops_calendar(fixture_url, tmp_path: Path):
    if not _chromium_available():
        pytest.skip("Playwright Chromium is not installed")
    config = CrawlConfig(
        start_url=fixture_url,
        output_dir=tmp_path / "result",
        benchmark_mode=True,
        benchmark_tokenizer="heuristic",
        benchmark_max_content_chars=100_000,
        limits=CrawlLimits(
            max_pages=12,
            max_depth=5,
            max_actions_per_page=4,
            max_runtime_seconds=30,
            max_variants_per_path_family=2,
            settle_time_ms=50,
        ),
    )
    FixtureHandler.mutation_count = 0
    paths = asyncio.run(WebTestPilotCrawler(config).run())
    report = json.loads(paths["report"].read_text(encoding="utf-8"))
    serialized_report = paths["report"].read_text(encoding="utf-8")
    normalized_urls = {page["normalized_url"] for page in report["pages"]}
    kinds = {item["kind"] for item in report["findings"]}

    assert f"{fixture_url}/revealed" in normalized_urls
    assert "broken_image" in kinds
    assert "javascript_exception" in kinds
    assert len([url for url in normalized_urls if "/error" in url]) == 1
    assert len([url for url in normalized_urls if "/calendar/" in url]) <= 2
    assert report["metadata"]["ai_candidates"] >= 1
    assert "root_causes" in report
    assert "preprocessing" in report
    assert FixtureHandler.mutation_count == 0
    assert "SECRET_TOKEN" not in serialized_report
    assert all("value" not in cookie for page in report["pages"] for cookie in page["cookies"])
    assert any(
        result["blocked_requests"]
        for page in report["pages"]
        for result in page["action_results"]
    )
    benchmark = json.loads(paths["token_comparison"].read_text(encoding="utf-8"))
    assert paths["raw_ai_input"].exists()
    assert paths["standard_crawler_input"].exists()
    assert paths["hybrid_ai_input"].exists()
    assert paths["comparison_report"].exists()
    assert benchmark["inputs"]["raw_ai_first"]["records"] == report["metadata"]["pages_observed"]
