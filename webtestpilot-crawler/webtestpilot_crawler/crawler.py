from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any

from .benchmark import write_benchmark_reports, write_hybrid_input
from .config import CrawlConfig
from .detectors import classify_route, detect_action_issues, detect_page_issues, page_signal_counts
from .fingerprint import collect_semantic_snapshot, semantic_fingerprint
from .interactions import EventRecorder, discover_actions, execute_action
from .models import ActionResult, AIReviewCandidate, CrawlTask, GraphEdge, PageObservation
from .priority import AIReviewQueue, PriorityFrontier
from .preprocessing import (
    action_signature,
    apply_common_ui_filter,
    cluster_findings,
    input_signature,
    normalize_error_text,
    normalize_ui_label,
    url_category,
)
from .reporter import write_reports
from .scope import ScopeGuard
from .url_normalizer import normalize_url, path_family


_COOKIE_METADATA_FIELDS = ("name", "domain", "path", "expires", "httpOnly", "secure", "sameSite")


# 인증값은 버리고 진단에 필요한 쿠키 속성만 보고서용으로 남긴다.
def _cookie_metadata(cookies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {key: cookie[key] for key in _COOKIE_METADATA_FIELDS if key in cookie}
        for cookie in cookies
    ]


class WebTestPilotCrawler:
    # 설정을 검증하고 범위·우선순위·결과 저장소를 초기화한다.
    def __init__(self, config: CrawlConfig) -> None:
        config.validate()
        normalized_start = normalize_url(config.start_url, policy=config.query_policy)
        if not normalized_start:
            raise ValueError("start_url could not be normalized")
        config.start_url = normalized_start
        self.config = config
        self.scope = ScopeGuard(config)
        self.frontier = PriorityFrontier(config.limits.max_queue_size)
        self.ai_queue = AIReviewQueue(config.limits.max_ai_candidates)
        self.observations: list[PageObservation] = []
        self.edges: list[GraphEdge] = []
        self._benchmark_pages: dict[int, dict[str, Any]] = {}
        self._preprocessing_stats: dict[str, Any] = {}
        self._root_causes: list[dict[str, Any]] = []

    # 크롤 전체에서 동일한 쿼리 정책으로 URL을 정규화한다.
    def _normalize(self, url: str, base_url: str | None = None) -> str | None:
        return normalize_url(url, base_url=base_url, policy=self.config.query_policy)

    # 브라우저를 열고 우선순위 큐가 빌 때까지 페이지를 순회한 뒤 보고서를 쓴다.
    async def run(self) -> dict[str, Path]:
        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise RuntimeError(
                "Playwright is required. Run: pip install -e . && playwright install chromium"
            ) from exc

        started = time.monotonic()
        self.frontier.push(
            CrawlTask(
                url=self.config.start_url,
                depth=0,
                category=url_category(self.config.start_url),
            ),
            information_value=100.0,
        )

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=self.config.headless)
            context = await browser.new_context(user_agent=self.config.user_agent)
            try:
                while (
                    self.frontier
                    and len(self.observations) < self.config.limits.max_pages
                    and not self.scope.runtime_exceeded()
                ):
                    task = self.frontier.pop()
                    allowed, _ = self.scope.allow_url(task.url, task.depth)
                    if not allowed:
                        continue
                    self.scope.register_visit(task.url)
                    page = await context.new_page()
                    page.set_default_navigation_timeout(self.config.limits.navigation_timeout_ms)
                    recorder = EventRecorder()
                    recorder.attach(page)
                    try:
                        observation = await self._observe_page(page, recorder, task)
                        await self._process_observation(page, recorder, task, observation)
                    finally:
                        await page.close()
            finally:
                await context.close()
                await browser.close()

        elapsed = time.monotonic() - started
        self._finalize_preprocessing()
        ai_candidates = self.ai_queue.ordered()
        paths = write_reports(
            self.config.output_dir,
            config=self.config,
            observations=self.observations,
            edges=self.edges,
            ai_candidates=ai_candidates,
            root_causes=self._root_causes,
            preprocessing_stats=self._preprocessing_stats,
            skip_reasons=dict(self.scope.skip_reasons),
            elapsed_seconds=elapsed,
        )
        paths["hybrid_ai_input"] = write_hybrid_input(self.config.output_dir, ai_candidates)
        if self.config.benchmark_mode:
            paths.update(
                write_benchmark_reports(
                    self.config.output_dir,
                    observations=self.observations,
                    captured_pages=self._benchmark_pages,
                    ai_candidates=ai_candidates,
                    tokenizer=self.config.benchmark_tokenizer,
                )
            )
        return paths

    # 한 페이지의 시맨틱 구조·링크·오류·쿠키 메타데이터를 수집한다.
    async def _observe_page(
        self, page: Any, recorder: EventRecorder, task: CrawlTask
    ) -> PageObservation:
        recorder.reset()
        observation = PageObservation(url=task.url, normalized_url=task.url, depth=task.depth)
        try:
            response = await page.goto(
                task.url,
                wait_until="domcontentloaded",
                timeout=self.config.limits.navigation_timeout_ms,
            )
            await page.wait_for_timeout(self.config.limits.settle_time_ms)
            semantic = await collect_semantic_snapshot(page, self.config.limits.max_text_chars)
            final_url = self._normalize(page.url) or task.url
            actions = discover_actions(semantic, self.config.safe_interactions_only)
            links = [
                normalized
                for item in semantic.get("links", [])
                if (normalized := self._normalize(str(item.get("href", "")), final_url))
            ]
            observation.url = page.url
            observation.normalized_url = final_url
            observation.title = str(semantic.get("title", ""))
            observation.status_code = response.status if response else None
            observation.semantic = semantic
            observation.text_excerpt = str(semantic.get("text", ""))
            observation.links = list(dict.fromkeys(links))
            observation.actions = actions
            observation.response_errors = list(recorder.response_errors)
            observation.failed_requests = list(recorder.failed_requests)
            observation.console_errors = list(recorder.console_errors)
            observation.page_errors = list(recorder.page_errors)
            observation.broken_images = list(semantic.get("brokenImages", []))
            observation.scroll_width = int(semantic.get("scrollWidth", 0))
            observation.client_width = int(semantic.get("clientWidth", 0))
            observation.cookies = _cookie_metadata(await page.context.cookies([page.url]))
            observation.state_fingerprint = semantic_fingerprint(final_url, semantic)
            observation.static_signal_count, observation.dynamic_signal_count = page_signal_counts(
                semantic, len(actions)
            )
            observation.findings = detect_page_issues(observation)
            if self.config.benchmark_mode:
                await self._capture_benchmark_page(page, recorder, observation)
        except Exception as exc:
            observation.error = f"{type(exc).__name__}: {exc}"
            observation.response_errors = list(recorder.response_errors)
            observation.failed_requests = list(recorder.failed_requests)
            observation.console_errors = list(recorder.console_errors)
            observation.page_errors = list(recorder.page_errors)
        return observation

    # 벤치마크 기준선에만 사용할 원본 HTML과 전체 가시 텍스트를 제한된 크기로 보관한다.
    async def _capture_benchmark_page(
        self, page: Any, recorder: EventRecorder, observation: PageObservation
    ) -> None:
        try:
            html = await page.content()
            visible_text = await page.evaluate("document.body?.innerText || ''")
        except Exception:
            return
        limit = self.config.benchmark_max_content_chars
        self._benchmark_pages[id(observation)] = {
            "html": html[:limit],
            "html_truncated": len(html) > limit,
            "visible_text": str(visible_text)[:limit],
            "text_truncated": len(str(visible_text)) > limit,
            "network_activity": list(recorder.responses),
        }

    # 관찰 결과를 그래프에 등록하고 링크·동작·AI 검토 후보로 확장한다.
    async def _process_observation(
        self,
        page: Any,
        recorder: EventRecorder,
        task: CrawlTask,
        observation: PageObservation,
    ) -> None:
        if observation.state_fingerprint:
            if not self.scope.register_state(observation.normalized_url, observation.state_fingerprint):
                return
            self.edges.append(
                GraphEdge(
                    source=task.parent_state,
                    target=observation.state_fingerprint,
                    action=task.discovered_by,
                )
            )

        self.observations.append(observation)
        if observation.error:
            self._enqueue_navigation_failure(observation)
            observation.route = "ai"
            observation.route_reason = "navigation failed and needs classification"
            return

        for link in observation.links:
            self._queue_link(
                link,
                depth=task.depth + 1,
                parent_state=observation.state_fingerprint,
                discovered_by="link",
                information_value=2.0,
            )

        for action in observation.actions[: self.config.limits.max_actions_per_page]:
            if self.scope.runtime_exceeded():
                break
            result = await execute_action(
                page,
                recorder,
                observation.normalized_url,
                action,
                self.config,
                self._normalize,
            )
            observation.action_results.append(result)
            observation.findings.extend(detect_action_issues(result))
            if result.status == "error":
                self._enqueue_action_error(observation, result)

            if (
                result.status == "executed"
                and result.after_fingerprint
                and result.after_fingerprint != result.before_fingerprint
                and self.scope.register_state(result.after_url, result.after_fingerprint)
            ):
                self.edges.append(
                    GraphEdge(
                        source=observation.state_fingerprint,
                        target=result.after_fingerprint,
                        action=action.kind,
                        label=action.label,
                    )
                )

            if result.url_changed:
                self._queue_link(
                    result.after_url,
                    depth=task.depth + 1,
                    parent_state=result.after_fingerprint or observation.state_fingerprint,
                    discovered_by=f"{action.kind}:{action.label[:60]}",
                    information_value=12.0,
                )
            for link in result.discovered_links:
                normalized = self._normalize(link, result.after_url)
                if normalized:
                    self._queue_link(
                        normalized,
                        depth=task.depth + 1,
                        parent_state=result.after_fingerprint or observation.state_fingerprint,
                        discovered_by=f"revealed-by-{action.kind}",
                        information_value=10.0,
                    )
        # 사이트 전체 공통 UI를 제거한 뒤 최종 라우팅하므로 여기서는 임시 판정만 남긴다.
        observation.route, observation.route_reason = classify_route(observation)

    # 전체 사이트 문맥으로 공통 UI를 제거하고 오류를 병합한 뒤 AI 후보를 최종 생성한다.
    def _finalize_preprocessing(self) -> None:
        self._preprocessing_stats = apply_common_ui_filter(self.observations)
        for observation in self.observations:
            if observation.error:
                continue
            common_action_ids = set(
                observation.semantic.get("preprocessing", {}).get("common_action_ids", [])
            )
            for result in observation.action_results:
                if result.ambiguous and result.action_id not in common_action_ids:
                    self._enqueue_ambiguous_action(observation, result)
            observation.route, observation.route_reason = classify_route(observation)
            if observation.route == "hybrid":
                self._enqueue_semantic_planning(observation)
        self._root_causes = cluster_findings(self.observations)
        self._preprocessing_stats.update(
            {
                "root_causes": len(self._root_causes),
                "finding_occurrences": sum(len(item.findings) for item in self.observations),
                "duplicate_ai_candidates_suppressed": self.ai_queue.duplicates_suppressed,
            }
        )

    # 범위 제한을 통과한 링크를 깊이·정보가치·신규성 기준으로 탐색 큐에 넣는다.
    def _queue_link(
        self,
        url: str,
        *,
        depth: int,
        parent_state: str,
        discovered_by: str,
        information_value: float,
    ) -> None:
        allowed, _ = self.scope.allow_url(url, depth)
        if not allowed:
            return
        family_seen = len(self.scope.family_variants.get(path_family(url), set()))
        novelty = 1.0 / (1.0 + family_seen)
        self.frontier.push(
            CrawlTask(
                url=url,
                depth=depth,
                parent_state=parent_state,
                discovered_by=discovered_by,
                novelty=novelty,
                category=url_category(url),
            ),
            information_value=information_value,
        )

    # 눈에 보이는 결과가 없는 동작을 고우선 AI 판정 후보로 등록한다.
    def _enqueue_ambiguous_action(self, observation: PageObservation, result: ActionResult) -> None:
        payload = {
            "page": {
                "url": observation.normalized_url,
                "title": observation.title,
                "headings": observation.semantic.get("headings", [])[:12],
            },
            "action": {"kind": result.kind, "label": result.label},
            "before": {"url": result.before_url, "state": result.before_fingerprint},
            "after": {"url": result.after_url, "state": result.after_fingerprint},
            "question": "Did this control fail, or is no visible change an expected behavior?",
        }
        estimated_tokens = self._estimate_tokens(payload)
        self.ai_queue.push(
            AIReviewCandidate(
                candidate_id=f"action-{observation.state_fingerprint}-{result.action_id}",
                kind="ambiguous_interaction",
                url=observation.normalized_url,
                priority=90.0,
                reason="safe interaction produced no URL, DOM, text, network, or error change",
                estimated_tokens=estimated_tokens,
                payload=payload,
                dedupe_key=(
                    f"ambiguous:{result.kind}:{normalize_ui_label(result.label)}"
                    if result.label
                    else ""
                ),
            )
        )

    # 동적 컨트롤의 문맥 기반 기능 테스트 설계를 AI 후보로 등록한다.
    def _enqueue_semantic_planning(self, observation: PageObservation) -> None:
        preprocessing = observation.semantic.get("preprocessing", {})
        common_actions = set(preprocessing.get("common_action_signatures", []))
        common_inputs = set(preprocessing.get("common_input_signatures", []))
        effective_actions = [
            item for item in observation.actions if action_signature(item) not in common_actions
        ]
        effective_inputs = [
            item
            for item in observation.semantic.get("inputs", [])
            if input_signature(item) not in common_inputs
        ]
        payload = {
            "page": {
                "url": observation.normalized_url,
                "title": observation.title,
                "headings": observation.semantic.get("headings", [])[:12],
                "text_excerpt": observation.text_excerpt[:800],
            },
            "controls": [
                {"kind": item.kind, "label": item.label, "risk": item.risk}
                for item in effective_actions[:20]
            ],
            "inputs": effective_inputs[:20],
            "suppressed_common_ui": {
                "actions": len(common_actions),
                "inputs": len(common_inputs),
            },
            "deterministic_findings": [item.kind for item in observation.findings],
            "question": "Which high-value functional tests cannot be decided by deterministic rules?",
        }
        estimated_tokens = self._estimate_tokens(payload)
        dynamic_ratio = observation.dynamic_signal_count / max(
            observation.dynamic_signal_count + observation.static_signal_count, 1
        )
        priority = 45.0 + 35.0 * dynamic_ratio + min(len(payload["inputs"]), 10)
        self.ai_queue.push(
            AIReviewCandidate(
                candidate_id=f"planning-{observation.state_fingerprint}",
                kind="semantic_test_planning",
                url=observation.normalized_url,
                priority=priority,
                reason="dynamic control semantics require context-aware test selection",
                estimated_tokens=estimated_tokens,
                payload=payload,
            )
        )

    # 탐색 자체가 실패한 페이지를 원인 분류용 AI 후보로 등록한다.
    def _enqueue_navigation_failure(self, observation: PageObservation) -> None:
        payload = {
            "url": observation.normalized_url,
            "error": observation.error,
            "network": observation.failed_requests[:5],
            "console": observation.console_errors[:5],
        }
        self.ai_queue.push(
            AIReviewCandidate(
                candidate_id=f"navigation-{len(self.observations):04d}",
                kind="navigation_failure",
                url=observation.normalized_url,
                priority=60.0,
                reason="navigation failed without enough deterministic context",
                estimated_tokens=self._estimate_tokens(payload),
                payload=payload,
                dedupe_key=f"navigation:{normalize_error_text(observation.error or '')}",
            )
        )

    # Playwright 동작 실패를 오류 문맥과 함께 AI 재검토 큐에 넣는다.
    def _enqueue_action_error(self, observation: PageObservation, result: ActionResult) -> None:
        payload = {
            "page": {"url": observation.normalized_url, "title": observation.title},
            "action": {"kind": result.kind, "label": result.label},
            "error": result.error,
            "network": result.network_errors[:5],
            "console": result.console_errors[:5],
        }
        self.ai_queue.push(
            AIReviewCandidate(
                candidate_id=f"action-error-{observation.state_fingerprint}-{result.action_id}",
                kind="interaction_execution_error",
                url=observation.normalized_url,
                priority=80.0,
                reason="interaction could not be executed or observed reliably",
                estimated_tokens=self._estimate_tokens(payload),
                payload=payload,
                dedupe_key=(
                    f"action-error:{result.kind}:{normalize_ui_label(result.label)}:"
                    f"{normalize_error_text(result.error or '')}"
                ),
            )
        )

    # JSON 문자 수를 이용해 AI 후보 처리 비용의 대략적인 토큰 수를 계산한다.
    @staticmethod
    def _estimate_tokens(payload: dict[str, Any]) -> int:
        characters = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        return max(1, math.ceil(characters / 4))
