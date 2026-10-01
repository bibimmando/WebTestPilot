from __future__ import annotations

from collections import Counter
from typing import Any

from .models import ActionResult, Finding, PageObservation


# 원래 순서를 보존하면서 빈 값과 중복 문자열을 제거한다.
def _unique(items: list[str]) -> list[str]:
    return list(dict.fromkeys(item for item in items if item))


# 페이지 관찰값만으로 확정하거나 후보화할 수 있는 오류를 찾는다.
def detect_page_issues(observation: PageObservation) -> list[Finding]:
    """Run only checks whose evidence is directly observable in the browser."""

    findings: list[Finding] = []
    if observation.status_code and observation.status_code >= 400:
        findings.append(
            Finding(
                kind="http_error",
                severity="high" if observation.status_code >= 500 else "medium",
                confidence="confirmed",
                url=observation.url,
                evidence={"status": observation.status_code},
            )
        )

    # 최상위 문서 상태는 위의 http_error로 이미 보고했으므로 리소스 오류에서 제외한다.
    page_urls = {observation.url, observation.normalized_url}
    resource_errors = [
        item
        for item in observation.response_errors
        if not (item.get("resource_type") == "document" and item.get("url") in page_urls)
    ]
    if resource_errors:
        status_counts = Counter(item.get("status") for item in resource_errors)
        findings.append(
            Finding(
                kind="failed_http_resources",
                severity="medium",
                confidence="confirmed",
                url=observation.url,
                evidence={
                    "status_counts": dict(status_counts),
                    "samples": resource_errors[:10],
                },
            )
        )

    if observation.failed_requests:
        findings.append(
            Finding(
                kind="network_failure",
                severity="medium",
                confidence="confirmed",
                url=observation.url,
                evidence={"samples": observation.failed_requests[:10]},
            )
        )

    if observation.page_errors:
        findings.append(
            Finding(
                kind="javascript_exception",
                severity="high",
                confidence="confirmed",
                url=observation.url,
                evidence={"messages": _unique(observation.page_errors)[:10]},
            )
        )

    if observation.console_errors:
        findings.append(
            Finding(
                kind="console_error",
                severity="low",
                confidence="candidate",
                url=observation.url,
                evidence={"messages": _unique(observation.console_errors)[:10]},
            )
        )

    if observation.broken_images:
        findings.append(
            Finding(
                kind="broken_image",
                severity="medium",
                confidence="confirmed",
                url=observation.url,
                evidence={"urls": _unique(observation.broken_images)[:20]},
            )
        )

    if observation.client_width and observation.scroll_width > observation.client_width + 1:
        findings.append(
            Finding(
                kind="horizontal_overflow",
                severity="medium",
                confidence="confirmed",
                url=observation.url,
                evidence={
                    "scroll_width": observation.scroll_width,
                    "client_width": observation.client_width,
                    "overflow_px": observation.scroll_width - observation.client_width,
                },
            )
        )

    return findings


# 상호작용 실행 결과에서 실행 실패·자바스크립트·네트워크 오류를 추출한다.
def detect_action_issues(result: ActionResult) -> list[Finding]:
    findings: list[Finding] = []
    if result.status == "blocked":
        return findings
    if result.status == "error":
        findings.append(
            Finding(
                kind="interaction_execution_error",
                severity="medium",
                confidence="candidate",
                url=result.after_url or result.before_url,
                evidence={"action": result.label, "error": result.error},
            )
        )
    if result.page_errors:
        findings.append(
            Finding(
                kind="interaction_javascript_exception",
                severity="high",
                confidence="confirmed",
                url=result.after_url or result.before_url,
                evidence={"action": result.label, "messages": _unique(result.page_errors)[:10]},
            )
        )
    if result.network_errors:
        findings.append(
            Finding(
                kind="interaction_network_error",
                severity="high",
                confidence="confirmed",
                url=result.after_url or result.before_url,
                evidence={"action": result.label, "samples": result.network_errors[:10]},
            )
        )
    return findings


# 페이지의 정적 콘텐츠 신호와 동적 상호작용 신호 수를 계산한다.
def page_signal_counts(semantic: dict[str, Any], action_count: int) -> tuple[int, int]:
    static_count = (
        len(semantic.get("links", []))
        + int(semantic.get("images", 0))
        + int(semantic.get("scripts", 0))
        + int(semantic.get("forms", 0))
        + len(semantic.get("headings", []))
    )
    dynamic_count = action_count + len(semantic.get("inputs", [])) + len(semantic.get("dialogs", []))
    return static_count, dynamic_count


# 미해결 동적 신호의 유무에 따라 크롤러·AI·혼합 처리 경로를 결정한다.
def classify_route(observation: PageObservation) -> tuple[str, str]:
    common_action_ids = set(
        observation.semantic.get("preprocessing", {}).get("common_action_ids", [])
    )
    ambiguous_actions = sum(
        result.ambiguous and result.action_id not in common_action_ids
        for result in observation.action_results
    )
    execution_errors = sum(result.status == "error" for result in observation.action_results)
    confirmed = sum(finding.confidence == "confirmed" for finding in observation.findings)
    if ambiguous_actions:
        return "ai", f"{ambiguous_actions} interaction(s) produced no observable outcome"
    if execution_errors:
        return "ai", f"{execution_errors} interaction(s) failed before their outcome was observed"
    if observation.dynamic_signal_count:
        if confirmed:
            return "hybrid", f"{confirmed} deterministic issue(s) found; dynamic controls still need review"
        return "hybrid", "dynamic controls need semantic test planning after crawler preprocessing"
    if confirmed:
        return "crawler", f"{confirmed} issue(s) were decided by deterministic checks"
    return "crawler", "no unresolved dynamic evidence"
