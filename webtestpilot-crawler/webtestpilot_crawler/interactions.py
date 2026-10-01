from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable

from .config import CrawlConfig
from .fingerprint import collect_semantic_snapshot, semantic_fingerprint
from .models import ActionCandidate, ActionResult

_DANGEROUS_LABEL = re.compile(
    r"(?i)(?:\b(?:delete|remove|destroy|erase|purchase|buy\s+now|pay|checkout|place\s+order|"
    r"submit|sign\s*out|log\s*out|unsubscribe)\b|탈퇴|삭제|제거|구매|결제|주문|제출|로그아웃)"
)
_READ_ONLY_LABEL = re.compile(
    r"(?i)(?:\b(?:load|show|view|see)\s+more\b|\bnext\b|\bexpand\b|더\s*보기|다음|펼치기)"
)


@dataclass
class EventRecorder:
    responses: list[dict[str, Any]] = field(default_factory=list)
    response_errors: list[dict[str, Any]] = field(default_factory=list)
    failed_requests: list[dict[str, Any]] = field(default_factory=list)
    console_errors: list[str] = field(default_factory=list)
    page_errors: list[str] = field(default_factory=list)

    # Playwright 페이지 이벤트를 수집기에 연결한다.
    def attach(self, page: Any) -> None:
        page.on("response", self._on_response)
        page.on("requestfailed", self._on_request_failed)
        page.on("console", self._on_console)
        page.on("pageerror", self._on_page_error)

    # 다음 페이지나 동작의 이벤트가 섞이지 않도록 수집값을 비운다.
    def reset(self) -> None:
        self.responses.clear()
        self.response_errors.clear()
        self.failed_requests.clear()
        self.console_errors.clear()
        self.page_errors.clear()

    # 성공 응답을 포함한 모든 HTTP 응답을 기록하고 오류 응답을 따로 분류한다.
    def _on_response(self, response: Any) -> None:
        event = {
            "url": response.url,
            "status": response.status,
            "method": response.request.method,
            "resource_type": response.request.resource_type,
        }
        self.responses.append(event)
        if response.status >= 400:
            self.response_errors.append(event)

    # 응답을 받기 전에 실패한 요청의 원인과 종류를 기록한다.
    def _on_request_failed(self, request: Any) -> None:
        self.failed_requests.append(
            {"url": request.url, "error": request.failure or "unknown", "resource_type": request.resource_type}
        )

    # 브라우저 콘솔의 error 메시지만 오류 증거로 보관한다.
    def _on_console(self, message: Any) -> None:
        if message.type == "error":
            self.console_errors.append(message.text)

    # 처리되지 않은 페이지 자바스크립트 예외를 기록한다.
    def _on_page_error(self, error: Any) -> None:
        self.page_errors.append(str(error))


# 시맨틱 스냅샷에서 클릭·호버 후보를 만들고 위험한 동작을 선제 차단한다.
def discover_actions(semantic: dict[str, Any], safe_only: bool = True) -> list[ActionCandidate]:
    actions: list[ActionCandidate] = []
    seen: set[tuple[str, str]] = set()

    for item in semantic.get("controls", []):
        selector = str(item.get("selector", ""))
        label = str(item.get("label", ""))
        if not selector or item.get("disabled"):
            continue
        read_only = bool(_READ_ONLY_LABEL.search(label)) and not _DANGEROUS_LABEL.search(label)
        risky = (bool(item.get("formSubmit")) and not read_only) or bool(
            _DANGEROUS_LABEL.search(label)
        )
        risk = "blocked" if risky and safe_only else ("risky" if risky else "safe")
        key = (selector, "click")
        if key not in seen:
            seen.add(key)
            actions.append(
                ActionCandidate(
                    action_id=f"click-{len(actions) + 1}",
                    selector=selector,
                    kind="click",
                    label=label,
                    risk=risk,
                    reason="form submit or destructive wording" if risky else "visible interactive control",
                )
            )

    for item in semantic.get("hoverControls", []):
        selector = str(item.get("selector", ""))
        if not selector:
            continue
        # 클릭 후보인 일반 title 요소는 중복 실행하지 않고 popup 의미가 있는 경우만 hover한다.
        if (selector, "click") in seen and not item.get("hasPopup"):
            continue
        key = (selector, "hover")
        if key in seen:
            continue
        seen.add(key)
        actions.append(
            ActionCandidate(
                action_id=f"hover-{len(actions) + 1}",
                selector=selector,
                kind="hover",
                label=str(item.get("label", "")),
                risk="safe",
                reason="popup, tooltip, or title-bearing hover candidate",
            )
        )
    return actions


# 한 동작을 격리 실행하고 URL·DOM·텍스트·통신 변화를 비교한다.
async def execute_action(
    page: Any,
    recorder: EventRecorder,
    page_url: str,
    action: ActionCandidate,
    config: CrawlConfig,
    normalize: Callable[[str, str | None], str | None],
) -> ActionResult:
    empty_fingerprint = ""
    if action.risk == "blocked":
        return ActionResult(
            action_id=action.action_id,
            kind=action.kind,
            label=action.label,
            status="blocked",
            before_url=page_url,
            after_url=page_url,
            before_fingerprint=empty_fingerprint,
            after_fingerprint=empty_fingerprint,
            error=action.reason,
        )

    blocked_requests: list[dict[str, Any]] = []
    mutation_guard: Any | None = None
    try:
        recorder.reset()
        await page.goto(page_url, wait_until="domcontentloaded", timeout=config.limits.navigation_timeout_ms)
        await page.wait_for_timeout(config.limits.settle_time_ms)
        before = await collect_semantic_snapshot(page, config.limits.max_text_chars)
        before_url = normalize(page.url, None) or page.url
        before_fingerprint = semantic_fingerprint(before_url, before)
        recorder.reset()  # Navigation noise is not attributed to the action.

        if config.safe_interactions_only:
            # 라벨만으로 위험성을 놓치더라도 상태 변경 HTTP 요청은 브라우저 밖으로 나가지 못하게 한다.
            async def block_mutating_request(route: Any, request: Any) -> None:
                blocked_path = any(
                    re.search(pattern, request.url) for pattern in config.blocked_path_patterns
                )
                if request.method.upper() not in {"GET", "HEAD", "OPTIONS"} or blocked_path:
                    blocked_requests.append(
                        {
                            "url": request.url,
                            "method": request.method,
                            "resource_type": request.resource_type,
                            "reason": "blocked path" if blocked_path else "state-changing method",
                        }
                    )
                    await route.abort("blockedbyclient")
                    return
                await route.continue_()

            mutation_guard = block_mutating_request
            await page.route("**/*", mutation_guard)

        locator = page.locator(action.selector).first
        if action.kind == "hover":
            await locator.hover(timeout=config.limits.action_timeout_ms)
        else:
            await locator.click(timeout=config.limits.action_timeout_ms)
        await page.wait_for_timeout(config.limits.settle_time_ms)

        after = await collect_semantic_snapshot(page, config.limits.max_text_chars)
        after_url = normalize(page.url, None) or page.url
        after_fingerprint = semantic_fingerprint(after_url, after)
        before_links = {str(item.get("href", "")) for item in before.get("links", [])}
        after_links = [
            str(item.get("href", ""))
            for item in after.get("links", [])
            if str(item.get("href", "")) not in before_links
        ]
        blocked_urls = {item["url"] for item in blocked_requests}
        failed_requests = [
            item for item in recorder.failed_requests if item.get("url") not in blocked_urls
        ]
        return ActionResult(
            action_id=action.action_id,
            kind=action.kind,
            label=action.label,
            status="blocked" if blocked_requests else "executed",
            before_url=before_url,
            after_url=after_url,
            before_fingerprint=before_fingerprint,
            after_fingerprint=after_fingerprint,
            url_changed=before_url != after_url,
            dom_changed=before_fingerprint != after_fingerprint,
            text_changed=before.get("text", "") != after.get("text", ""),
            network_activity=list(recorder.responses),
            network_errors=[*recorder.response_errors, *failed_requests],
            blocked_requests=list(blocked_requests),
            console_errors=list(recorder.console_errors),
            page_errors=list(recorder.page_errors),
            discovered_links=after_links,
            error="state-changing network request blocked by safe mode" if blocked_requests else None,
        )
    except Exception as exc:  # Playwright errors are serialized as crawl evidence.
        current_url = normalize(page.url, None) or page.url
        return ActionResult(
            action_id=action.action_id,
            kind=action.kind,
            label=action.label,
            status="error",
            before_url=page_url,
            after_url=current_url,
            before_fingerprint=empty_fingerprint,
            after_fingerprint=empty_fingerprint,
            network_activity=list(recorder.responses),
            network_errors=[*recorder.response_errors, *recorder.failed_requests],
            blocked_requests=list(blocked_requests),
            console_errors=list(recorder.console_errors),
            page_errors=list(recorder.page_errors),
            error=f"{type(exc).__name__}: {exc}",
        )
    finally:
        if mutation_guard is not None:
            try:
                await page.unroute("**/*", mutation_guard)
            except Exception:
                pass
