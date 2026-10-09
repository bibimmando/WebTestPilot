"""Trusted local configuration binds MCP actions to a single CDP tab."""

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import urlsplit
from uuid import uuid4

from src.ai_inspection.browser_runner import SharedPageObserver, validate_steps
from src.ai_inspection.evidence_inspector import judge_observation
from src.ai_inspection.inspection_input import _origin
from src.ai_inspection.inspection_runtime import RuntimeBinding
from src.ai_inspection.mcp_client import LocalMCPClient
from src.ai_inspection.mcp_executor import MCPExecutor


# 저장된 분석 제안은 입력 ID와 등록된 제안 문자열이 일치할 때만 연결한다.
def select_checks(config, context, analysis_path=None):
    catalog = deepcopy(config.get("checks", {}))
    for check in catalog.values():
        judge_observation(check, {})
    if analysis_path is None:
        return catalog
    rows = [json.loads(line) for line in Path(analysis_path).read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    matches = [row for row in rows if row.get("input_id") == context["input_id"]]
    if len(matches) != 1 or matches[0].get("analysis_status") != "completed":
        raise ValueError("Exactly one completed analysis for input_id is required")
    suggestions = matches[0].get("analysis", {}).get("suggested_checks", [])
    if not isinstance(suggestions, list) or not all(isinstance(value, str) for value in suggestions):
        raise ValueError("Invalid suggested_checks")
    mapping = config.get("suggestion_bindings", {})
    selected = {}
    for suggestion in suggestions:
        identifier = mapping.get(suggestion)
        if identifier in catalog:
            selected[identifier] = catalog[identifier]
    return selected


class ScriptedPlanner:
    # 모의 계획도 실제 실행 관리자에서 동일하게 검증한다.
    def __init__(self, plans):
        self._plans = iter(deepcopy(plans))
        self.last_usage = {}

    # 계획이 끝나면 추가 도구 실행 없이 종료한다.
    def __call__(self, request):
        return next(self._plans, {"decision": "finish", "check_id": "", "steps": []})


class PlaywrightMCPExecutor(MCPExecutor):
    # 서버 스키마·탭 동일성·안전 정책을 확인한 뒤 실행 어댑터를 구성한다.
    def __init__(self, config, context, output_dir):
        self.config, self.output_dir = config, Path(output_dir)
        self.client = self.driver = self.process = None
        self.page = None
        self._closed = False
        self.timeout = config.get("timeout", 15)
        if not isinstance(self.timeout, (int, float)) or not 0 < self.timeout <= 120:
            raise ValueError("Invalid MCP timeout")
        self.url = context["page_observation"]["url"]
        self.scope = _origin(self.url)
        self.controls = config.get("controls", {})
        validate_steps(self.controls, [])
        self.permissions = config.get("permissions", {})
        if not self.controls or set(self.permissions) != set(self.controls):
            raise ValueError("Every control needs an explicit permission entry")
        for entry in self.permissions.values():
            if (not isinstance(entry, dict) or set(entry) != {"actions", "values"} or
                    not isinstance(entry["actions"], list) or not entry["actions"] or
                    not set(entry["actions"]) <= {"click", "fill", "press"} or
                    not isinstance(entry["values"], list) or
                    not all(isinstance(value, str) and len(value) <= 1000 for value in entry["values"])):
                raise ValueError("Permissions need approved actions and non-sensitive test values")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        try:
            from playwright.sync_api import sync_playwright
            self.driver = sync_playwright().start()
            endpoint = config.get("cdp_endpoint")
            if endpoint is None:
                profile = self.output_dir / f"browser-profile-{uuid4().hex}"
                executable = config.get("browser_executable") or self.driver.chromium.executable_path
                args = [executable, "--headless=new", "--remote-debugging-address=127.0.0.1",
                        "--remote-debugging-port=0", f"--user-data-dir={profile}",
                        "--disable-extensions", "--disable-component-extensions-with-background-pages",
                        "--disable-background-networking",
                        "--no-first-run", "--no-default-browser-check", "about:blank"]
                self.process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                port_file = profile / "DevToolsActivePort"
                deadline = time.monotonic() + self.timeout
                while not port_file.exists():
                    if self.process.poll() is not None or time.monotonic() > deadline:
                        raise TimeoutError("Isolated Chromium did not start")
                    time.sleep(0.05)
                endpoint = "http://127.0.0.1:" + port_file.read_text().splitlines()[0]
            parsed = urlsplit(endpoint)
            if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or parsed.username or parsed.password:
                raise ValueError("CDP endpoint must be a local HTTP address without credentials")
            self.browser = self.driver.chromium.connect_over_cdp(endpoint, timeout=self.timeout * 1000)
            if len(self.browser.contexts) != 1 or len(self.browser.contexts[0].pages) != 1:
                raise ValueError("Exactly one isolated browser tab is required")
            self.page = self.browser.contexts[0].pages[0]
            self.page.set_default_timeout(self.timeout * 1000)
            command, server_args = config["mcp_command"], config["mcp_args"]
            if not isinstance(command, str) or not isinstance(server_args, list) or not all(isinstance(arg, str) for arg in server_args):
                raise ValueError("Trusted MCP executable and argument list are required")
            if any(arg.startswith("--cdp") or arg in {"--extension", "--endpoint"} for arg in server_args):
                raise ValueError("Runtime manages the shared CDP endpoint")
            self.client = LocalMCPClient(command, [*server_args, "--cdp-endpoint", endpoint,
                                                   "--output-dir", str(self.output_dir.resolve())], timeout=self.timeout)
            self.client.install_guard(endpoint, self.scope)
            if self.process:
                self.page.goto(self.url, wait_until="domcontentloaded")
            if self.page.url != self.url:
                raise ValueError("Shared tab must match the original input URL")
            self._prove_shared_tab()
            self.action_tools = self._discover_actions()
            observer = SharedPageObserver(self.page, self.output_dir / "evidence")
            super().__init__(call_tool=self._safe_call, observe=observer, permission=self.permission,
                             action_bindings={action: (name, self._builder(action, name))
                                              for action, name in self.action_tools.items()})
            (self.output_dir / "mcp_tools.json").write_text(json.dumps(self.client.tools, indent=2) + "\n", encoding="utf-8")
        except BaseException:
            self.close()
            raise

    # 관찰기에서 만든 임시 표식을 MCP 스냅샷에서 확인해 같은 탭임을 증명한다.
    def _prove_shared_tab(self):
        self.client.call_tool("browser_tabs", {"action": "select", "index": 0})
        original = self.page.title()
        marker = "WebTestPilot-session-" + uuid4().hex
        try:
            self.page.evaluate("title => document.title = title", marker)
            result = self.client.call_tool("browser_snapshot", {})
            if result["isError"] or marker not in json.dumps(result["content"]):
                raise ValueError("MCP and observer are not on the same tab")
        finally:
            self.page.evaluate("title => document.title = title", original)

    # 실제 목록·필드·설명에 맞는 지원 버전만 바인딩하고 알 수 없는 규격은 거절한다.
    def _discover_actions(self):
        tools = self.client.tools
        expected = {"click": ("browser_click", {"target"}),
                    "fill": ("browser_type", {"target", "text"}),
                    "press": ("browser_press_key", {"key"})}
        selected = {}
        for action, (name, required) in expected.items():
            schema = tools.get(name, {}).get("inputSchema", {})
            properties = schema.get("properties", {})
            if not required <= set(properties) or not set(schema.get("required", [])) <= required | {"element"}:
                raise ValueError("Unsupported MCP action schema; update the reviewed adapter")
            if "target" in required and "selector" not in properties["target"].get("description", "").lower():
                raise ValueError("This MCP server does not advertise unique selector targets")
            selected[action] = name
        return selected

    # 서버가 광고한 필드만 사용해 승인된 컨트롤의 인자를 생성한다.
    def _builder(self, action, name):
        def build(step):
            self._validate_target(step)
            if action == "press":
                self.page.locator(self.controls[step["control_id"]]).focus()
                return {"key": step["value"]}
            args = {"target": self.controls[step["control_id"]]}
            properties = self.client.tools[name]["inputSchema"]["properties"]
            if "element" in properties:
                args["element"] = step["control_id"]
            if action == "fill":
                args["text"] = step["value"]
                if "submit" in properties:
                    args["submit"] = False
                if "slowly" in properties:
                    args["slowly"] = False
            return args
        return build

    # DOM을 다시 확인하고 자격증명 입력·숨김·중복·외부 출처 컨트롤을 차단한다.
    def _validate_target(self, step):
        if self.page.url != self.url or _origin(self.page.url) != self.scope:
            raise PermissionError("Shared page changed; stale controls are not executable")
        if len(self.browser.contexts[0].pages) != 1:
            raise PermissionError("Unexpected browser tab")
        target = self.page.locator(self.controls[step["control_id"]])
        if target.count() != 1 or not target.is_visible() or not target.is_enabled():
            raise ValueError("Reviewed selector is missing, ambiguous, hidden or disabled")
        details = target.evaluate("el => ({type: el.type, autocomplete: el.autocomplete})")
        if details.get("type") == "password" or any(word in (details.get("autocomplete") or "")
                for word in ("password", "username", "one-time-code", "cc-")):
            raise PermissionError("Credential and payment controls are outside this runtime")

    # 모델이 선택한 동작과 값은 로컬 설정의 명시적 허용 목록을 따라야 한다.
    def permission(self, step):
        entry = self.permissions.get(step.get("control_id"), {})
        return (step.get("action") in entry.get("actions", []) and
                (step["action"] == "click" and step.get("value") == "" or
                 step.get("value") in entry.get("values", [])))

    # 등록된 세 가지 동작 외의 MCP 호출은 실행기에서 허용하지 않는다.
    def _safe_call(self, name, arguments):
        if name not in self.action_tools.values():
            raise PermissionError("Tool is outside the approved action catalog")
        return self.client.call_tool(name, arguments)

    # 실행 후 선택 도구와 차단 요약을 기존 receipt 규격에 추가한다.
    def execute(self, step):
        receipt = super().execute(step)
        receipt["blocked_requests"] = deepcopy(self.client.blocked_requests)
        return receipt

    # 모든 종료 경로에서 세션을 정리하고 자신이 시작한 브라우저만 종료한다.
    def close(self):
        if self._closed:
            return
        self._closed = True
        if self.client:
            self.client.close()
        if self.driver:
            self.driver.stop()
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)


# 신뢰하는 로컬 설정과 기존 Planner를 연결하고 실패 시 자원을 반환한다.
def create(*, context, planner, output_dir, config_path, analysis_path=None):
    config = json.loads(Path(config_path).read_text(encoding="utf-8-sig"))
    checks = select_checks(config, context, analysis_path)
    if not checks:
        raise ValueError("No suggested checks can be mapped to the approved catalog")
    executor = PlaywrightMCPExecutor(config, context, Path(output_dir) / ("session-" + uuid4().hex))
    return RuntimeBinding(planner, executor, executor.controls, checks, (executor.url,), executor.permission)
