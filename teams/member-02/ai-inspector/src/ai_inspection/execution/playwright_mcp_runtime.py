"""Trusted local config -> real stdio MCP session -> existing Chromium CDP tab.

Model/page/JSONL data cannot supply JavaScript, tools, endpoints or selectors.
"""

import asyncio
from concurrent.futures import Future
from datetime import timedelta
import json
import os
from pathlib import Path
import shutil
from threading import Thread
from urllib.parse import urlsplit
from uuid import uuid4

from src.ai_inspection.execution.browser_runner import SharedPageObserver, validate_steps
from src.ai_inspection.analysis.inspection_input import _origin
from src.ai_inspection.execution.inspection_runtime import RuntimeBinding
from src.ai_inspection.execution.mcp_executor import MCPExecutor


class StdioMCPClient:
    """Keep SDK async resources on one worker; expose bounded sync calls."""

    def __init__(self, command, args, *, timeout=30):
        self.timeout = timeout
        self.ready = Future()
        self.thread = Thread(target=self._run, args=(command, args), daemon=True)
        self.thread.start()
        try:
            self.ready.result(timeout=timeout)
        except Exception:
            self.close()
            raise RuntimeError("MCP initialization failed") from None

    def _run(self, command, args):
        try:
            asyncio.run(self._serve(command, args))
        except BaseException:
            if not self.ready.done():
                self.ready.set_exception(RuntimeError("MCP initialization failed"))

    async def _serve(self, command, args):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        self.loop = asyncio.get_running_loop()
        self.stop = asyncio.Event()
        # SDK defaults already restrict inherited variables; explicitly omit API secrets.
        environment = {key: value for key, value in os.environ.items()
                       if key.upper() in {"PATH", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PATHEXT"}}
        with open(os.devnull, "w") as errors:
            async with stdio_client(StdioServerParameters(command=command, args=args, env=environment), errlog=errors) as streams:
                async with ClientSession(*streams, read_timeout_seconds=timedelta(seconds=self.timeout)) as session:
                    self.session = session
                    await session.initialize()
                    self.tool_names = {tool.name for tool in (await session.list_tools()).tools}
                    self.ready.set_result(True)
                    await self.stop.wait()

    def call_tool(self, name, arguments):
        if name not in self.tool_names or not self.thread.is_alive():
            raise RuntimeError("MCP tool unavailable")
        future = asyncio.run_coroutine_threadsafe(self.session.call_tool(name, arguments), self.loop)
        try:
            return future.result(timeout=self.timeout).model_dump(mode="json")
        except Exception:
            future.cancel()
            raise RuntimeError("MCP call failed") from None

    def close(self):
        loop = getattr(self, "loop", None)
        if loop and loop.is_running():
            loop.call_soon_threadsafe(self.stop.set)
        if hasattr(self, "thread"):
            self.thread.join(timeout=self.timeout + 5)


def load_config(path):
    config = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    required = {"cdp_endpoint", "controls", "checks", "allowed_origins", "permissions"}
    if not isinstance(config, dict) or set(config) != required:
        raise ValueError("MCP config requires cdp_endpoint, controls, checks, allowed_origins, permissions")
    endpoint = urlsplit(config["cdp_endpoint"])
    if (endpoint.scheme != "http" or endpoint.hostname not in {"127.0.0.1", "localhost", "::1"}
            or not endpoint.port or endpoint.username or endpoint.password or endpoint.path not in {"", "/"}
            or endpoint.query or endpoint.fragment):
        raise ValueError("CDP endpoint must be a loopback HTTP address with an explicit port")
    validate_steps(config["controls"], [])
    if not isinstance(config["checks"], dict) or not config["checks"]:
        raise ValueError("Registered checks are required")
    from src.ai_inspection.analysis.evidence_inspector import judge_observation
    for check in config["checks"].values():
        judge_observation(check, {"text": "", "url": "http://localhost/"})
    if not isinstance(config["allowed_origins"], list) or not config["allowed_origins"]:
        raise ValueError("Allowed origins are required")
    for origin in config["allowed_origins"]:
        _origin(origin)
    permissions = config["permissions"]
    if not isinstance(permissions, dict) or set(permissions) - set(config["controls"]):
        raise ValueError("Permissions must reference registered control IDs")
    for actions in permissions.values():
        if not isinstance(actions, list) or any(action not in {"click", "fill", "press"} for action in actions):
            raise ValueError("Permissions must list approved actions")
    return config


def action_arguments(selector, step):
    """Map approved actions to the pinned server's structured tool contract."""
    action = step["action"]
    if action not in {"click", "fill", "press"}:
        raise ValueError("Unsupported action")
    validate_steps({step["control_id"]: selector}, [step])
    if action == "click":
        return {"target": selector, "element": step["control_id"]}
    if action == "fill":
        return {"target": selector, "element": step["control_id"], "text": step["value"], "submit": False}
    return {"key": step["value"]}


class PlaywrightMCPExecutor(MCPExecutor):
    def __init__(self, config, output_dir, *, command=None, server_args=None):
        from playwright.sync_api import sync_playwright
        self.client = None
        self.playwright = sync_playwright().start()
        try:
            # Attach only: the browser owner remains responsible for launch/reset/close.
            self.browser = self.playwright.chromium.connect_over_cdp(config["cdp_endpoint"], timeout=10000)
            pages = [page for context in self.browser.contexts for page in context.pages]
            if len(pages) != 1:
                raise ValueError("This connector requires exactly one existing tab")
            self.page = pages[0]
            self.page.set_default_timeout(5000)
            origins = {_origin(origin) for origin in config["allowed_origins"]}
            if _origin(self.page.url) not in origins:
                raise ValueError("Shared tab is outside approved origins")

            def permission(step):
                return (_origin(self.page.url) in origins and
                        step.get("action") in config["permissions"].get(step.get("control_id"), []))

            endpoint_args = ["--cdp-endpoint", config["cdp_endpoint"], "--timeout-action", "5000",
                             "--timeout-navigation", "10000", "--no-webmcp", "--codegen", "none",
                             "--output-dir", str(Path(output_dir).resolve() / "mcp_artifacts")]
            self.client = StdioMCPClient(command or shutil.which("npx.cmd" if os.name == "nt" else "npx") or "npx",
                                         (server_args or ["-y", "@playwright/mcp@0.0.83"]) + endpoint_args)
            if not {"browser_click", "browser_type", "browser_press_key", "browser_evaluate"} <= self.client.tool_names:
                raise RuntimeError("Required MCP tools are missing")
            # Prove same JS window, not just matching URLs. Remove the probe immediately.
            self._verify_shared_tab()
            observer = SharedPageObserver(self.page, Path(output_dir))

            def arguments(step):
                self._verify_shared_tab()
                selector = config["controls"][step["control_id"]]
                target = self.page.locator(selector)
                if target.count() != 1 or not target.is_visible():
                    raise ValueError("Control is missing, hidden or ambiguous")
                # Keyboard tool is global: refuse instead of silently clicking/focusing.
                if step["action"] == "press" and not target.evaluate("el => el === document.activeElement"):
                    raise ValueError("Key target must already have focus")
                return action_arguments(selector, step)

            super().__init__(call_tool=self.client.call_tool, observe=observer,
                             permission=permission, action_bindings={
                                 "click": ("browser_click", arguments), "fill": ("browser_type", arguments),
                                 "press": ("browser_press_key", arguments)})
        except BaseException:
            self.close()
            raise

    def _verify_shared_tab(self):
        probe = "__wtp_probe_" + uuid4().hex
        self.page.evaluate("key => { window[key] = true; }", probe)
        try:
            result = self.client.call_tool("browser_evaluate", {"function":
                "() => { if (window[" + json.dumps(probe) +
                "] !== true) throw new Error('Shared tab mismatch'); return true; }"})
            if result.get("isError") is not False:
                raise RuntimeError("MCP and observer are not on the same tab")
        finally:
            self.page.evaluate("key => { delete window[key]; }", probe)

    def close(self):
        try:
            if self.client:
                self.client.close()
        finally:
            # stop disconnects this client; never browser.close() on the shared owner.
            self.playwright.stop()


def create_runtime(*, context, planner, output_dir, config_path):
    config = load_config(config_path)
    executor = PlaywrightMCPExecutor(config, output_dir)
    return RuntimeBinding(planner, executor, config["controls"], config["checks"],
                          tuple(config["allowed_origins"]), executor._permission)
