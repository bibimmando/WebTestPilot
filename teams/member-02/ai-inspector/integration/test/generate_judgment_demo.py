"""Persist two localhost MCP flows with scripted models; no API keys required."""
import argparse
import asyncio
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading

from playwright.async_api import async_playwright
from integration.mcp import LocalMCPClient, MCPBridge
from integration.preprocessor import crawl
from integration.runtime import Runtime
from integration.test_integration import Handler
from integration.test_staged import FixtureModel

MEMBER = Path(__file__).resolve().parents[2]


async def generate(output):
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        with tempfile.TemporaryDirectory(dir=MEMBER / ".tools", prefix="judgment-demo-profile-") as temporary:
            async with async_playwright() as playwright:
                profile = Path(temporary)
                context = await playwright.chromium.launch_persistent_context(str(profile), headless=True,
                    args=["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"], service_workers="block")
                client = None
                try:
                    port = (profile / "DevToolsActivePort").read_text(encoding="utf-8").splitlines()[0]
                    client = await asyncio.to_thread(LocalMCPClient, "node", [
                        str(MEMBER / ".tools/playwright-mcp/node_modules/@playwright/mcp/cli.js"),
                        "--cdp-endpoint", "http://127.0.0.1:" + port, "--snapshot-mode", "none"], timeout=20)
                    for mode in ("normal", "broken"):
                        Handler.broken = mode == "broken"
                        model = FixtureModel(mode)
                        runtime = Runtime(model, MCPBridge(client), output / mode,
                            browser_state_reset=mode == "broken", max_calls=12, max_rounds=12, max_actions=6)
                        summary = await crawl(f"http://127.0.0.1:{server.server_port}/", output / mode,
                            max_pages=1, max_runtime=60, shared_page=context.pages[0], page_callback=runtime.inspect_page,
                            before_page=runtime.prepare_page, allowed_methods=("GET", "HEAD", "OPTIONS"))
                        if summary["callback_errors"] or runtime.termination_error:
                            raise RuntimeError("Local demo pipeline did not complete")
                        report = json.loads((output / mode / "report.json").read_text(encoding="utf-8"))
                        print(f"{mode}: test_status={runtime.flows[0]['test_status']}; report saved; run_id={report['run_id']}")
                finally:
                    if client:
                        await asyncio.to_thread(client.close)
                    await context.close()
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create real localhost MCP evidence with fake planning/execution/judgment models")
    parser.add_argument("--output", default="output/judgment-connected-demo")
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        parser.error("Choose a new or empty output folder")
    (MEMBER / ".tools").mkdir(exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    asyncio.run(generate(output))
