from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class Finding:
    kind: str
    severity: str
    confidence: str
    url: str
    evidence: dict[str, Any] = field(default_factory=dict)
    source: str = "deterministic"
    root_cause_id: str = ""

    # 탐지 결과를 JSON 보고서에 저장할 수 있는 사전으로 변환한다.
    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ActionCandidate:
    action_id: str
    selector: str
    kind: str
    label: str = ""
    href: str | None = None
    risk: str = "safe"
    reason: str = ""


@dataclass(slots=True)
class ActionResult:
    action_id: str
    kind: str
    label: str
    status: str
    before_url: str
    after_url: str
    before_fingerprint: str
    after_fingerprint: str
    url_changed: bool = False
    dom_changed: bool = False
    text_changed: bool = False
    network_activity: list[dict[str, Any]] = field(default_factory=list)
    network_errors: list[dict[str, Any]] = field(default_factory=list)
    blocked_requests: list[dict[str, Any]] = field(default_factory=list)
    console_errors: list[str] = field(default_factory=list)
    page_errors: list[str] = field(default_factory=list)
    discovered_links: list[str] = field(default_factory=list)
    error: str | None = None

    # 실행은 됐지만 DOM·URL·통신·오류 변화가 전혀 없는 모호한 동작인지 판별한다.
    @property
    def ambiguous(self) -> bool:
        return self.status == "executed" and not any(
            (
                self.url_changed,
                self.dom_changed,
                self.text_changed,
                self.network_activity,
                self.network_errors,
                self.blocked_requests,
                self.console_errors,
                self.page_errors,
            )
        )


@dataclass(slots=True)
class PageObservation:
    url: str
    normalized_url: str
    depth: int
    title: str = ""
    status_code: int | None = None
    state_fingerprint: str = ""
    text_excerpt: str = ""
    semantic: dict[str, Any] = field(default_factory=dict)
    links: list[str] = field(default_factory=list)
    actions: list[ActionCandidate] = field(default_factory=list)
    response_errors: list[dict[str, Any]] = field(default_factory=list)
    failed_requests: list[dict[str, Any]] = field(default_factory=list)
    console_errors: list[str] = field(default_factory=list)
    page_errors: list[str] = field(default_factory=list)
    broken_images: list[str] = field(default_factory=list)
    scroll_width: int = 0
    client_width: int = 0
    # 민감한 value를 제외한 쿠키 메타데이터만 보관한다.
    cookies: list[dict[str, Any]] = field(default_factory=list)
    static_signal_count: int = 0
    dynamic_signal_count: int = 0
    route: str = "crawler"
    route_reason: str = ""
    findings: list[Finding] = field(default_factory=list)
    action_results: list[ActionResult] = field(default_factory=list)
    error: str | None = None

    # 페이지 관찰 결과를 JSON 보고서용 사전으로 변환한다.
    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class CrawlTask:
    url: str
    depth: int
    parent_state: str | None = None
    discovered_by: str = "seed"
    novelty: float = 1.0
    category: str = "/"


@dataclass(slots=True)
class GraphEdge:
    source: str | None
    target: str
    action: str
    label: str = ""


@dataclass(slots=True)
class AIReviewCandidate:
    candidate_id: str
    kind: str
    url: str
    priority: float
    reason: str
    estimated_tokens: int
    payload: dict[str, Any]
    dedupe_key: str = ""

    # AI 검토 후보를 JSONL에 기록할 수 있는 사전으로 변환한다.
    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
