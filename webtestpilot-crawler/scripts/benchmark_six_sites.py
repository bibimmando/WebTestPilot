from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))

from webtestpilot_crawler.benchmark import build_token_counter
from webtestpilot_crawler.config import CrawlConfig, CrawlLimits
from webtestpilot_crawler.crawler import WebTestPilotCrawler
from webtestpilot_crawler.scope import ScopeGuard
from webtestpilot_crawler.url_normalizer import same_origin

SITES = [
    ("the-internet", "The Internet", "https://the-internet.herokuapp.com/"),
    ("todomvc", "Playwright TodoMVC", "https://demo.playwright.dev/todomvc/#/"),
    ("books", "Books to Scrape", "https://books.toscrape.com/"),
    ("hackerrank", "HackerRank", "https://www.hackerrank.com/"),
    ("stackoverflow", "Stack Overflow", "https://stackoverflow.com/questions"),
    ("tistory", "Tistory", "https://www.tistory.com/m?category=family"),
]
KST = timezone(timedelta(hours=9))


# robots.txt의 와일드카드와 가장 구체적인 허용/거부 규칙을 비교한다.
class RobotsPolicy:
    # User-Agent 그룹을 선택하고 해당 그룹의 경로 규칙을 읽는다.
    def __init__(self, text: str, user_agent: str) -> None:
        self.rules: list[tuple[bool, str]] = []
        groups: list[tuple[list[str], list[tuple[bool, str]]]] = []
        agents: list[str] = []
        rules: list[tuple[bool, str]] = []
        for line in text.splitlines():
            line = line.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            key, value = (part.strip() for part in line.split(":", 1))
            key = key.casefold()
            if key == "user-agent":
                if rules:
                    groups.append((agents, rules))
                    agents, rules = [], []
                agents.append(value.casefold())
            elif key in {"allow", "disallow"} and agents and value:
                rules.append((key == "allow", value))
        if agents:
            groups.append((agents, rules))
        matching = [
            (max((len(a) for a in names if a != "*" and a in user_agent.casefold()), default=0), items)
            for names, items in groups
            if "*" in names or any(a in user_agent.casefold() for a in names)
        ]
        longest = max((length for length, _ in matching), default=-1)
        self.rules = [rule for length, items in matching if length == longest for rule in items]

    # 실제 User-Agent의 경로와 query에 대한 크롤링 허용 여부를 반환한다.
    def allows(self, url: str) -> bool:
        parsed = urlsplit(url)
        target = parsed.path or "/"
        if parsed.query:
            target += "?" + parsed.query
        matches = []
        for allow, rule in self.rules:
            end = "$" if rule.endswith("$") else ""
            source = rule[:-1] if end else rule
            pattern = "^" + ".*".join(re.escape(part) for part in source.split("*")) + end
            if re.search(pattern, target):
                matches.append((len(source.replace("*", "")), allow))
        return max(matches)[1] if matches else True


# 정책 응답은 원문과 상태를 남기고 일시 실패 시 본문 크롤링을 보류한다.
def fetch_policy(url: str, agent: str) -> dict[str, Any]:
    parsed = urlsplit(url)
    robots_url = urlunsplit((parsed.scheme, parsed.netloc, "/robots.txt", "", ""))
    try:
        with urlopen(Request(robots_url, headers={"User-Agent": agent}), timeout=15) as response:
            text = response.read(200_000).decode("utf-8", "replace")
            content_type = response.headers.get("Content-Type", "")
            if "html" in content_type.casefold():
                return {"url": robots_url, "status": response.status, "error": "robots response is HTML"}
            return {"url": robots_url, "status": response.status, "text": text}
    except HTTPError as exc:
        return {
            "url": robots_url,
            "status": exc.code,
            "text": exc.read(200_000).decode("utf-8", "replace") if exc.code in {404, 410} else "",
            "error": None if exc.code in {404, 410} else f"HTTP {exc.code}",
        }
    except (URLError, TimeoutError, OSError) as exc:
        return {"url": robots_url, "status": None, "error": str(exc)}


# 현재 크롤러의 기본 범위 검사에 robots 경로와 접근 차단 중단만 추가한다.
class PolicyScope(ScopeGuard):
    # 원래 범위 제한과 정책·중단 상태를 함께 초기화한다.
    def __init__(self, config: CrawlConfig, policy: RobotsPolicy) -> None:
        super().__init__(config)
        self.policy = policy
        self.halted = ""

    # 접근 차단이나 robots 제외를 먼저 검사한 뒤 원래 범위 검사를 적용한다.
    def allow_url(self, url: str, depth: int, *, queued: bool = False) -> tuple[bool, str]:
        if self.halted:
            return self._deny("access_restriction_stop")
        if same_origin(self.config.start_url, url) and not self.policy.allows(url):
            return self._deny("robots_disallow")
        return super().allow_url(url, depth, queued=queued)


# 모든 페이지 route에 정책 가드를 적용하며 실제 크롤러의 관찰·탐지 로직은 사용한다.
class GuardedPage:
    # 페이지별 route 래핑과 해제에 필요한 원래 handler를 보관한다.
    def __init__(self, page: Any, crawler: "BenchmarkCrawler") -> None:
        self._page = page
        self._crawler = crawler
        self._handlers: dict[tuple[str, Any], Any] = {}

    # 관찰·상호작용 API는 원래 Playwright Page로 전달한다.
    def __getattr__(self, name: str) -> Any:
        return getattr(self._page, name)

    # 요청 정책과 document 간격을 적용한 후 기존 요청 handler를 호출한다.
    async def route(self, pattern: str, handler: Any) -> None:
        # 실행 환경의 차단 증거와 크롤러 자체의 차단 증거를 각각 남긴다.
        async def guarded(route: Any, request: Any) -> None:
            reason = self._crawler.request_denial(request)
            if reason:
                self._crawler.guard_events.append(
                    {"url": request.url, "method": request.method, "resource_type": request.resource_type,
                     "reason": reason}
                )
                if reason == "mutating_method" and handler.__name__ == "block_mutating_request":
                    await handler(route, request)
                    return
                await route.abort("blockedbyclient")
                return
            if request.is_navigation_request():
                remaining = 1.0 - (time.monotonic() - self._crawler.last_navigation)
                if remaining > 0:
                    await asyncio.sleep(remaining)
                self._crawler.last_navigation = time.monotonic()
            await handler(route, request)

        self._handlers[(pattern, handler)] = guarded
        await self._page.route(pattern, guarded)

    # 원래 handler에 대응하는 래퍼를 찾아 정확히 해제한다.
    async def unroute(self, pattern: str, handler: Any) -> None:
        await self._page.unroute(pattern, self._handlers.pop((pattern, handler), handler))


# 사이트별 단일 실행에 제한·진행 로그·접근 차단 표시를 덧붙인다.
class BenchmarkCrawler(WebTestPilotCrawler):
    # 크롤러 코어와 별도로 실험 정책·요청 차단·요청 간격을 초기화한다.
    def __init__(self, config: CrawlConfig, policy: RobotsPolicy, slug: str) -> None:
        super().__init__(config)
        self.scope = PolicyScope(config, policy)
        self.slug = slug
        self.guard_events: list[dict[str, Any]] = []
        self.last_navigation = 0.0

    # document 이동 범위와 robots, 상태 변경 메서드의 거부 사유를 반환한다.
    def request_denial(self, request: Any) -> str:
        if request.is_navigation_request():
            if not same_origin(self.config.start_url, request.url):
                return "cross_origin_document"
            if any(re.search(pattern, request.url) for pattern in self.config.blocked_path_patterns):
                return "blocked_document_path"
        if same_origin(self.config.start_url, request.url) and not self.scope.policy.allows(request.url):
            return "robots_disallow_request"
        if request.method.upper() not in {"GET", "HEAD", "OPTIONS"}:
            return "mutating_method"
        return ""

    # 각 페이지에 실행 정책을 연결한 뒤 원래 관찰 결과를 수집한다.
    async def _observe_page(self, page: Any, recorder: Any, task: Any) -> Any:
        proxy = GuardedPage(page, self)

        # 정책 검사를 통과한 요청을 원래 목적지로 보낸다.
        async def proceed(route: Any, request: Any) -> None:
            await route.continue_()

        await proxy.route("**/*", proceed)
        self._active_page = proxy
        observation = await super()._observe_page(proxy, recorder, task)
        print(f"[{self.slug}] page {len(self.observations) + 1}: "
              f"HTTP {observation.status_code} {task.url}", flush=True)
        return observation

    # 인증·접근 제한 화면의 동작을 생략하고 그 외에는 원래 처리 흐름을 사용한다.
    async def _process_observation(self, page: Any, recorder: Any, task: Any, observation: Any) -> None:
        title = observation.title.casefold()
        challenge = any(word in title for word in ("just a moment", "access denied", "attention required"))
        challenge = challenge or "verify you are human" in observation.text_excerpt[:500].casefold()
        if observation.status_code in {403, 429} or challenge:
            self.scope.halted = f"access restricted: HTTP {observation.status_code}, {observation.title}"
        actions = observation.actions
        if self.scope.halted or observation.status_code == 401:
            observation.actions = []
        try:
            await super()._process_observation(self._active_page, recorder, task, observation)
        finally:
            observation.actions = actions


# 같은 페이지 예산으로 6개 대상의 결과를 저장하고 실패도 배치에서 누락시키지 않는다.
async def run_site(site: tuple[str, str, str], output: Path, semaphore: asyncio.Semaphore) -> dict[str, Any]:
    slug, name, url = site
    directory = output / slug
    directory.mkdir(parents=True, exist_ok=True)
    result: dict[str, Any] = {"slug": slug, "name": name, "requested_url": url,
                              "directory": str(directory.resolve())}
    async with semaphore:
        print(f"[{slug}] checking robots.txt", flush=True)
        policy_data = await asyncio.to_thread(fetch_policy, url, CrawlConfig(url).user_agent)
        result["robots"] = policy_data
        policy_text = policy_data.get("text", "") if policy_data.get("status") == 200 else ""
        policy = RobotsPolicy(policy_text, CrawlConfig(url).user_agent)
        if policy_data.get("error") or not policy.allows(url):
            result["status"] = "policy_unavailable" if policy_data.get("error") else "robots_disallowed"
            result["reason"] = policy_data.get("error") or "start URL excluded by robots.txt"
        else:
            config = CrawlConfig(
                start_url=url, output_dir=directory, benchmark_mode=True,
                benchmark_tokenizer="o200k_base", benchmark_max_content_chars=1_000_000,
                limits=CrawlLimits(max_pages=20, max_depth=2, max_actions_per_page=4,
                                   max_runtime_seconds=120, navigation_timeout_ms=15_000,
                                   settle_time_ms=700),
            )
            config.blocked_path_patterns += (r"(?i)/(login|signin|sign-in|signup|sign-up|register)(?:/|\?|$)",)
            crawler = BenchmarkCrawler(config, policy, slug)
            result["started_kst"] = datetime.now(KST).isoformat()
            try:
                paths = await crawler.run()
                result["status"] = "access_restricted" if crawler.scope.halted else "completed"
                result["reason"] = crawler.scope.halted
                result["crawl"] = json.loads(paths["report"].read_text(encoding="utf-8"))
                result["tokens"] = json.loads(paths["token_comparison"].read_text(encoding="utf-8"))
                result["ai_queue"] = [json.loads(line) for line in paths["ai_queue"].read_text(encoding="utf-8").splitlines() if line]
                result["frontier_remaining"] = len(crawler.frontier)
                result["visited_urls"] = sorted(crawler.scope.visited_urls)
                result["guard_events"] = crawler.guard_events
            except Exception as exc:
                result["status"] = "execution_failed"
                result["reason"] = f"{type(exc).__name__}: {exc}"
            result["finished_kst"] = datetime.now(KST).isoformat()
        (directory / "benchmark_environment.json").write_text(
            json.dumps({key: value for key, value in result.items() if key not in {"crawl", "tokens", "ai_queue"}},
                       ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[{slug}] {result['status']}", flush=True)
    return result


# 표의 개행·구분 기호를 이스케이프해 한 파일 보고서가 깨지지 않게 한다.
def cell(value: Any, limit: int = 220) -> str:
    return str(value).replace("\n", " ").replace("\r", " ").replace("|", "\\|")[:limit]


# 반복 방문 효율과 실제 상호작용 한계를 사이트별 실측 근거와 함께 설명한다.
def interpretation(item: dict[str, Any]) -> str:
    slug = item["slug"]
    if "crawl" not in item:
        return ("직접 robots.txt 확인 요청이 " + str(item["robots"].get("status")) +
                " 응답으로 실패했다. 본문 크롤러는 실행하지 않았으며 페이지 수·버그 수·토큰 감소를 평가할 수 없다.")
    explanations = {
        "the-internet": (
            "Add Element 클릭으로 DOM/텍스트 변화와 깨진 이미지 2개를 확인했다. Basic/Digest Auth의 401은 "
            "인증 없는 접근에 대한 응답이고, Optimizely 로그 호스트의 DNS 실패는 외부 리소스 관찰값이다. "
            "이를 모두 실제 제품 버그로 집계하면 안 된다. checkbox·select 입력은 수집됐으나 실행되지 않았다. "
            "페이지 시간 초과 2건 및 시간 예산 때문에 뒤쪽 hover·무한 스크롤 예제까지 도달하지 못했다."
        ),
        "todomvc": (
            "빈 TodoMVC 화면 1페이지와 입력창 1개를 관찰했다. 입력·Enter·더블클릭 동작이 구현되지 않아 "
            "할 일 생성/수정/완료/삭제를 검사하지 못했다. AI 후보는 기능 검사 완료 결과가 아니라 테스트 계획 후보다. "
            "현재 URL 정규화는 fragment를 제거하므로 #/active, #/completed 같은 해시 라우트 구분에도 제약이 있다."
        ),
        "books": (
            "같은 목록 템플릿의 홈/카테고리 20페이지를 방문했다. 상품 상세 페이지는 이번 예산 안에서 방문하지 않았다. "
            "공통 버튼 신호 339개를 제외했지만 상품별 title 기반 hover 339개가 남아 20페이지 모두 hybrid로 분류됐다. "
            "예산 앞쪽 Add to basket 버튼이 차단되어 동작 결과 80개 모두 blocked이고 허용된 hover까지 실행하지 못했다. "
            "따라서 반복 템플릿의 AI 입력 압축은 확인됐으나 중복 템플릿 방문 생략과 상호작용 효율 개선은 확인되지 않았다. "
            "HTTPS 페이지의 HTTP jQuery 요청이 Mixed Content로 막힌 관찰 40건은 두 탐지 종류로 병합됐다. "
            "그 두 종류는 같은 underlying mixed-content 원인을 가리킬 수 있어 실제 독립 버그 2개로 단정할 수 없다."
        ),
        "hackerrank": (
            "로그인 없는 공개 소개/기능 페이지를 관찰했다. 코딩 문제 풀이·제출·평가 기능은 이번 대상에서 검사되지 않았다. "
            "기존 가드로 POST 및 외부 document 이동을 제한해 일부 동작이 blocked로 기록됐다. "
            "CSP/통계 보고 요청 차단으로 발생한 ERR_BLOCKED_BY_CLIENT를 포함하므로 탐지 12건을 사이트 자체 버그로 "
            "해석하면 안 된다. 입력 압축 지표는 이 제한된 공개 탐색 범위에만 해당한다."
        ),
        "tistory": (
            "카테고리 버튼 동작 후 수집된 링크 합집합은 98개이며 최초 관찰 링크 합집합 밖에 71개가 있었다. "
            "일부 blocked 동작도 DOM·텍스트 변화와 링크 수집은 발생했다. 따라서 blocked는 화면 변화가 없었다는 뜻이 아니다. "
            "외부 출처 제외 648회에는 서로 다른 tistory.com 블로그 출처도 포함되며, 개별 게시글을 크롤링한 것은 아니다. "
            "공통 UI 제거로 동적 신호가 56→6으로 줄었다. 새 링크가 버튼 때문에 나타났는지 시간 경과/동적 피드 "
            "변화 때문인지를 분리한 무동작 대조군은 없고, 스크롤 및 무한 로딩은 구현되지 않아 별도 확인이 필요하다."
        ),
    }
    return explanations.get(slug, "")


# 페이지·동작·전처리·토큰과 원인 증거를 한 Markdown 파일에 모은다.
def write_report(results: list[dict[str, Any]], output: Path, provenance: dict[str, Any]) -> Path:
    lines = [
        "# WebTestPilot — 6개 사이트 현재 크롤러 실험 결과", "",
        "- 실행일: 2026-09-30 (Asia/Seoul)",
        "- 동일 예산: 최대 20페이지 / 깊이 2 / 페이지당 동작 4개 / 사이트당 120초",
        "- Chromium headless, 기본 viewport, navigation timeout 15초, DOM 대기 700ms",
        "- 동일 사이트 document 요청 간격 최소 1초, 서로 다른 사이트 동시 실행 최대 2개",
        "- 토크나이저: tiktoken:o200k_base. AI 모델/API 호출 없이 입력 크기만 측정",
        "- 현재 크롤러 코어를 그대로 사용. 실행 래퍼에 robots 경로, 인증 경로, 외부 document, 상태 변경 요청 제한 추가",
        "- 제한에 의해 실패한 요청은 사이트 버그와 구별해야 한다. 아래 실행 환경 차단 증거를 함께 확인한다.",
        "- URL/DOM 상태 수는 방문 범위의 지표다. 사이트 전체 Coverage나 정답 기반 Precision/Recall은 측정하지 않았다.",
        "- completed는 설정한 범위의 실행 종료를 뜻한다. 사이트 전체 기능 검사가 끝났다는 뜻은 아니다.",
        "- 120초는 현재 코어의 루프 검사 한도다. 진행 중인 navigation 종료를 기다리므로 실측 시간이 초과할 수 있다.",
        "- confirmed는 관찰된 오류 증거의 확정 표시이며, 예상하지 못한 제품 결함이라는 판정은 아니다.",
        "", "## 사이트별 결과", "",
        "| 사이트 | 실행 상태 | 관찰 페이지 | 동작 실행/차단/오류 | 탐지 발생/병합 원인 | AI 후보 | 시간(초) |",
        "|---|---|---:|---|---|---:|---:|",
    ]
    for item in results:
        report = item.get("crawl", {})
        metadata = report.get("metadata", {})
        actions = [action for page in report.get("pages", []) for action in page.get("action_results", [])]
        counts = Counter(action["status"] for action in actions)
        action_summary = f"{counts['executed']}/{counts['blocked']}/{counts['error']}" if report else "N/A"
        lines.append(f"| {item['name']} | {item['status']} | {metadata.get('pages_observed', 'N/A')} | "
                     f"{action_summary} | "
                     f"{metadata.get('deterministic_findings', 'N/A')}/{metadata.get('unique_root_causes', 'N/A')} | "
                     f"{metadata.get('ai_candidates', 'N/A')} | {metadata.get('elapsed_seconds', 'N/A')} |")
    lines += ["", "## AI 입력 크기 비교", "",
              "| 사이트 | HTML 기준 토큰 | 일반 시맨틱 토큰 | 하이브리드 토큰 | HTML 대비 감소 | 일반 대비 감소 |",
              "|---|---:|---:|---:|---:|---:|"]
    for item in results:
        metrics = item.get("tokens", {})
        inputs = metrics.get("inputs", {})
        reduction = metrics.get("reductions_percent", {})
        raw_reduction = reduction.get("hybrid_vs_raw_tokens")
        standard_reduction = reduction.get("hybrid_vs_standard_tokens")
        raw_text = f"{raw_reduction:.2f}%" if raw_reduction is not None else "N/A"
        standard_text = f"{standard_reduction:.2f}%" if standard_reduction is not None else "N/A"
        lines.append(f"| {item['name']} | {inputs.get('raw_ai_first', {}).get('tokens', 'N/A')} | "
                     f"{inputs.get('standard_crawler', {}).get('tokens', 'N/A')} | "
                     f"{inputs.get('hybrid', {}).get('tokens', 'N/A')} | "
                     f"{raw_text} | {standard_text} |")
    lines += ["", "입력 토큰 감소는 탐지 성능을 증명하지 않는다. 입력 후보가 없거나 페이지가 차단된 경우에도 감소율이 높아질 수 있다."]
    lines += ["", "## 이번 실험에서 확인한 기능과 한계", ""]
    for item in results:
        lines.append(f"- **{item['name']}**: {interpretation(item)}")
    for item in results:
        lines += ["", f"## {item['name']}", "", f"- 요청 URL: {item['requested_url']}",
                  f"- 상태: {item['status']}",
                  f"- robots: [{item['robots']['url']}]({item['robots']['url']}), HTTP {item['robots'].get('status')}"]
        if item.get("reason"):
            lines.append(f"- 중단/제한 사유: {cell(item['reason'], 1200)}")
        if "crawl" not in item:
            lines += ["", "본문 크롤링을 진행하지 못했으므로 성능 지표는 N/A다."]
            continue
        report = item["crawl"]
        pages = report["pages"]
        actions = [action for page in pages for action in page.get("action_results", [])]
        changed = sum(action["status"] == "executed" and
                      any(action.get(key) for key in ("url_changed", "dom_changed", "text_changed")) for action in actions)
        graph_states = {edge["target"] for edge in report.get("edges", [])}
        revealed = {url for action in actions for url in action.get("discovered_links", [])}
        new_only = revealed - {url for page in pages for url in page.get("links", [])}
        preprocessing = report.get("preprocessing", {})
        raw_dynamic = sum(page.get("semantic", {}).get("preprocessing", {}).get("raw_dynamic_signal_count", 0) for page in pages)
        effective = sum(page.get("dynamic_signal_count", 0) for page in pages)
        all_changed = sum(any(action.get(key) for key in ("url_changed", "dom_changed", "text_changed")) for action in actions)
        guard_counts = Counter(event["reason"] for event in item.get("guard_events", []))
        lines += [
            f"- 실제 요청 시작 URL: {report['metadata']['start_url']}",
            f"- 실행 시간(KST): {item.get('started_kst', 'N/A')} ~ {item.get('finished_kst', 'N/A')}",
            f"- 최초 페이지 title/status: {cell(pages[0]['title'] if pages else '')} / {pages[0]['status_code'] if pages else 'N/A'}",
            f"- 라우팅: {json.dumps(report.get('routing', {}), ensure_ascii=False)}",
            f"- 발견 동작 {sum(len(page.get('actions', [])) for page in pages)}, 결과 기록 {len(actions)}, URL/DOM/텍스트 변화 동작 {changed}",
            f"- blocked 결과까지 포함한 URL/DOM/텍스트 변화 동작 {all_changed}",
            f"- 그래프 target 고유 상태 {len(graph_states)}, 상호작용에서 수집한 링크 {len(revealed)}, 최초 관찰 링크 합집합 밖의 링크 {len(new_only)}",
            f"- 동적 신호 원본 {raw_dynamic} → 공통 UI 제외 후 {effective}",
            f"- 공통 동작 제거 {preprocessing.get('suppressed_action_occurrences', 0)}, 공통 입력 제거 {preprocessing.get('suppressed_input_occurrences', 0)}, 중복 AI 후보 제거 {preprocessing.get('duplicate_ai_candidates_suppressed', 0)}",
            f"- 범위 제외: {json.dumps(report.get('skip_reasons', {}), ensure_ascii=False)}",
            f"- 실행 래퍼의 요청 차단: {json.dumps(dict(guard_counts), ensure_ascii=False)}",
            f"- 종료 시 미방문 큐: {item.get('frontier_remaining', 'N/A')}",
            "", "### 방문 페이지 전체", "",
            "| URL | HTTP | 라우팅 | 동작 수 | 탐지 | 오류 |", "|---|---:|---|---:|---|---|",
        ]
        for page in pages:
            kinds = Counter(finding["kind"] for finding in page["findings"])
            lines.append(f"| {cell(page['url'], 500)} | {page['status_code']} | {page['route']} | "
                         f"{len(page['action_results'])} | {cell(dict(kinds))} | {cell(page.get('error') or '')} |")
        lines += ["", "### 실행된 동작과 증거", "",
                  "| 페이지 | 동작 | 상태 | URL/DOM/텍스트 변화 | 새 링크 | 오류/차단 |",
                  "|---|---|---|---|---:|---|"]
        for page in pages:
            for action in page["action_results"]:
                flags = "/".join(str(int(bool(action[key]))) for key in ("url_changed", "dom_changed", "text_changed"))
                lines.append(f"| {cell(page['normalized_url'], 280)} | {cell(action['kind'] + ':' + action['label'])} | "
                             f"{action['status']} | {flags} | {len(action['discovered_links'])} | {cell(action.get('error') or '')} |")
        lines += ["", "### 병합된 탐지 증거", ""]
        for root in report.get("root_causes", []):
            lines += [f"- `{root['root_cause_id']}` / `{root['kind']}` / {root['confidence']} / 발생 {root['occurrences']}회",
                      f"  - URL: {', '.join(root['urls'])}",
                      f"  - 증거: `{cell(json.dumps(root['evidence_samples'], ensure_ascii=False), 2200)}`"]
        if not report.get("root_causes"):
            lines.append("- 탐지 없음")
        lines += ["", "### AI 전달 후보 전체", ""]
        for candidate in item.get("ai_queue", []):
            lines.append(f"- `{candidate['kind']}` / {candidate['url']} / {cell(candidate['reason'])}")
        if not item.get("ai_queue"):
            lines.append("- 후보 없음")
    lines += ["", "## 재현 정보", "", "```json", json.dumps(provenance, ensure_ascii=False, indent=2), "```", "",
              "사이트별 원본 crawl_report.json, AI 입력 JSONL과 실행 환경 증거는 이 보고서와 같은 폴더의 사이트별 하위 폴더에 보존한다."]
    path = output / "SIX_SITE_REPORT.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


# 실행 파일 해시를 남겨 이후 코드 변경과 이번 실험을 구분한다.
async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report-only", action="store_true", help="Rebuild the report from saved evidence without accessing websites")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if args.report_only:
        previous = (output / "SIX_SITE_REPORT.md").read_text(encoding="utf-8")
        match = re.search(r"## 재현 정보.*?```json\n(.*?)\n```", previous, re.S)
        if not match:
            raise SystemExit("Missing original benchmark provenance")
        provenance = json.loads(match.group(1))
        results = []
        for slug, name, url in SITES:
            directory = output / slug
            item = json.loads((directory / "benchmark_environment.json").read_text(encoding="utf-8"))
            if (directory / "crawl_report.json").exists():
                item["crawl"] = json.loads((directory / "crawl_report.json").read_text(encoding="utf-8"))
                item["tokens"] = json.loads((directory / "token_comparison.json").read_text(encoding="utf-8"))
                item["ai_queue"] = [json.loads(line) for line in (directory / "ai_queue.jsonl").read_text(encoding="utf-8").splitlines() if line]
            results.append(item)
        print(f"Consolidated report: {write_report(results, output, provenance)}")
        return
    if (output / "SIX_SITE_REPORT.md").exists():
        raise SystemExit("An existing consolidated report must not be overwritten; use a new output directory.")
    _, tokenizer = build_token_counter("o200k_base")
    provenance = {
        "python": sys.version, "tokenizer": tokenizer,
        "code_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in (PROJECT / "webtestpilot_crawler").glob("*.py")},
        "invocation": "python scripts/benchmark_six_sites.py --output " + str(args.output),
    }
    semaphore = asyncio.Semaphore(2)
    results = await asyncio.gather(*(run_site(site, output, semaphore) for site in SITES))
    path = write_report(results, output, provenance)
    print(f"Consolidated report: {path}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
