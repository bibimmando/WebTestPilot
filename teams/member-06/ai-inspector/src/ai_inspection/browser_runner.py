"""Explicitly authorized additional verification; no crawler or AI planning."""

import json
import os
from pathlib import Path
from uuid import uuid4

from src.ai_inspection.inspection_input import _origin


class SharedPageObserver:
    """Capture the preprocessor-owned synchronous Playwright page without opening a browser.

    A CDP/MCP integration may instead supply its own observer with the same output
    shape. The integration must ensure this page is the MCP-controlled tab.
    """

    def __init__(self, page, output_dir: Path, *, max_text_characters: int = 10_000):
        if type(max_text_characters) is not int or max_text_characters < 1:
            raise ValueError("Positive observation text limit is required")
        self.page = page
        self.output_dir = Path(output_dir)
        self.max_text_characters = max_text_characters

    def __call__(self):
        self.output_dir.mkdir(parents=True, exist_ok=True)
        text = self.page.locator("body").inner_text()
        observation = {"url": self.page.url, "title": self.page.title(),
                       "text": text[:self.max_text_characters],
                       "text_truncated": len(text) > self.max_text_characters,
                       "viewport": self.page.evaluate("({width: innerWidth, height: innerHeight, scroll_x: scrollX, scroll_y: scrollY})"),
                       "evidence": [], "evidence_status": "available"}
        screenshot = self.output_dir / f"evidence_{uuid4().hex}.png"
        try:
            self.page.screenshot(path=str(screenshot), full_page=False)
            observation["evidence"].append({"kind": "viewport_screenshot", "path": str(screenshot.resolve())})
        except Exception as exc:
            observation.update(evidence_status="missing", evidence_error_type=type(exc).__name__)
        return observation


# 기존 크롤러에 의존하지 않고 설치 브라우저를 찾는다.
def _installed_browser():
    for variable, relative in (("PROGRAMFILES", "Google/Chrome/Application/chrome.exe"),
                               ("PROGRAMFILES(X86)", "Microsoft/Edge/Application/msedge.exe")):
        base = os.environ.get(variable)
        if base and (candidate := Path(base) / relative).is_file():
            return str(candidate)
    return None


# 검토된 요소 ID·선택자와 제한된 실행 단계만 허용한다.
def validate_steps(controls: dict, steps: list) -> None:
    if not isinstance(controls, dict) or not all(isinstance(key, str) and key and
            isinstance(value, str) and value for key, value in controls.items()):
        raise ValueError("controls must map nonempty control IDs to reviewed selectors")
    if not isinstance(steps, list) or len(steps) > 10:
        raise ValueError("Expected at most ten steps")
    for step in steps:
        if not isinstance(step, dict) or set(step) - {"action", "control_id", "value"}:
            raise ValueError("Invalid step fields")
        if step.get("action") not in {"click", "fill", "press"} or step.get("control_id") not in controls:
            raise ValueError("Unknown action or control ID")
        if step["action"] == "fill" and (not isinstance(step.get("value"), str) or len(step["value"]) > 1000):
            raise ValueError("fill requires a string of at most 1000 characters")
        if step["action"] == "press" and step.get("value") not in {"Enter", "Tab", "Escape"}:
            raise ValueError("Unsupported key")


# 명시적으로 허용된 추가 검증만 실행하며 입력값과 인증정보는 기록하지 않는다.
def verify_steps(url: str, output_dir: Path, *, input_id: str, controls: dict,
                 steps: list, allow_actions: bool = False, timeout: float = 10,
                 browser_executable: str | None = None) -> dict:
    if not allow_actions:
        raise ValueError("Explicit authorization is required for additional verification")
    scope = _origin(url)
    if timeout <= 0 or not isinstance(input_id, str) or not input_id:
        raise ValueError("Positive timeout and input_id are required")
    validate_steps(controls, steps)
    from playwright.sync_api import sync_playwright

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    result = {"schema_version": 1, "input_id": input_id, "execution_status": "completed",
              "steps": [], "blocked_requests": [], "console_error_count": 0,
              "request_failure_count": 0}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=browser_executable or _installed_browser())
        try:
            context = browser.new_context(service_workers="block")
            page = context.new_page()
            page.set_default_timeout(timeout * 1000)

            # 새 창·외부 출처 이동과 상태 변경 요청을 기본 차단한다.
            def guard(route):
                request = route.request
                try:
                    foreign_navigation = request.is_navigation_request() and _origin(request.url) != scope
                except ValueError:
                    foreign_navigation = True
                if request.method not in {"GET", "HEAD", "OPTIONS"} or foreign_navigation:
                    result["blocked_requests"].append({"method": request.method, "reason": "safety_policy"})
                    route.abort()
                else:
                    route.continue_()

            # 오류 메시지에 비밀값이 섞일 수 있어 현재는 건수만 저장한다.
            def console_event(message):
                if message.type == "error":
                    result["console_error_count"] += 1

            # 실패 메시지와 요청 본문은 저장하지 않는다.
            def request_failed(request):
                result["request_failure_count"] += 1

            context.route("**/*", guard)
            context.on("page", lambda popup: popup.close() if popup != page else None)
            page.on("console", console_event)
            page.on("requestfailed", request_failed)
            try:
                page.goto(url, wait_until="domcontentloaded")
                page.screenshot(path=str(output_dir / "before.png"), full_page=True)
                for step in steps:
                    target = page.locator(controls[step["control_id"]])
                    if target.count() != 1 or not target.is_visible():
                        raise ValueError("Reviewed selector is missing, hidden, or ambiguous")
                    if step["action"] == "fill":
                        target.fill(step["value"])
                    elif step["action"] == "click":
                        target.click()
                    else:
                        target.press(step["value"])
                    result["steps"].append({"action": step["action"], "control_id": step["control_id"]})
                page.wait_for_timeout(300)
                screenshot = output_dir / "after.png"
                page.screenshot(path=str(screenshot), full_page=True)
                result["observation"] = {"url": page.url, "title": page.title(),
                                         "text_excerpt": page.locator("body").inner_text()[:2000],
                                         "screenshot": str(screenshot.resolve())}
            except Exception as exc:
                result.update(execution_status="error", error_type=type(exc).__name__)
        finally:
            browser.close()
    (output_dir / "verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result
