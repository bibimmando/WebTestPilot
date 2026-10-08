"""Print a compact summary of crawler or ranker JSON output."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


DISCOVERY_LABELS = {
    "static_link": "정적 링크",
    "form": "폼",
    "javascript_candidate": "JavaScript 이동 후보",
    "javascript_network": "JavaScript 네트워크 후보",
    "iframe": "iframe",
    "sitemap": "sitemap",
    "seed": "시작 URL",
}
FUNCTION_LABELS = {
    "authentication": "인증",
    "search": "검색",
    "upload": "업로드",
    "submission": "제출·신청",
    "unknown": "미분류",
}


def summarize(data: dict[str, Any]) -> str:
    if "candidates" in data and "endpoints" not in data:
        return summarize_ranked(data)
    endpoints = data.get("endpoints", [])
    method_counts = Counter(endpoint.get("method", "UNKNOWN") for endpoint in endpoints)
    discovery_counts = Counter(
        method
        for endpoint in endpoints
        for method in endpoint.get("discovery_methods", [])
    )
    metrics = data.get("metrics", {})
    lines = [
        "WebTestPilot 크롤링 결과 요약",
        "=" * 32,
        f"시작 URL       : {data.get('start_url', '-')}",
        f"HTTP 요청      : {metrics.get('http_requests', 0):,}회",
        f"발견 URL       : {metrics.get('discovered_urls', 0):,}개",
        f"방문 페이지    : {metrics.get('visited_pages', 0):,}개",
        f"엔드포인트     : {len(endpoints):,}개",
        "",
        "HTTP 메서드별",
    ]
    for method, count in sorted(method_counts.items()):
        lines.append(f"  {method:<16} {count:>6,}개")
    lines.extend(("", "발견 방식별"))
    for method, count in discovery_counts.most_common():
        label = DISCOVERY_LABELS.get(method, method)
        lines.append(f"  {label:<16} {count:>6,}개")
    lines.extend(
        (
            "",
            "기타",
            f"  폼               {len(data.get('forms', [])):>6,}개",
            f"  동적 후보         {len(data.get('dynamic_candidates', [])):>6,}개",
            f"  외부 URL          {len(data.get('external_urls', [])):>6,}개",
            f"  차단 URL          {len(data.get('blocked', [])):>6,}개",
            f"  중복 페이지       {metrics.get('duplicate_pages', 0):>6,}개",
            f"  실패 페이지       {metrics.get('failed_pages', sum(bool(page.get('error')) for page in data.get('pages', []))):>6,}개",
        )
    )
    return "\n".join(lines)


def summarize_ranked(data: dict[str, Any]) -> str:
    candidates = data.get("candidates", [])
    metrics = data.get("metrics", {})
    scores = Counter(candidate.get("priority_score", 0) for candidate in candidates)
    kinds = Counter(candidate.get("kind", "unknown") for candidate in candidates)
    policies = Counter(candidate.get("execution_policy", "unknown") for candidate in candidates)
    lines = [
        "WebTestPilot 검증 후보 요약",
        "=" * 32,
        f"시작 URL       : {data.get('start_url', '-')}",
        f"우선순위 통과  : {metrics.get('eligible_candidates', 0):,}개",
        f"최종 선택      : {len(candidates):,}개",
        f"  엔드포인트    : {kinds.get('endpoint', 0):,}개",
        f"  화면 동작     : {kinds.get('interaction', 0):,}개",
        f"  실행 검토 필요: {policies.get('review_required', 0):,}개",
        "",
        "선택 후보 점수 분포",
    ]
    for score, count in sorted(scores.items(), reverse=True):
        lines.append(f"  {score:>2}점             {count:>6,}개")
    lines.extend(("", "상위 후보"))
    for index, candidate in enumerate(candidates[:10], 1):
        function = FUNCTION_LABELS.get(candidate.get("function_hint", "unknown"), candidate.get("function_hint", "미분류"))
        kind = "엔드포인트" if candidate.get("kind") == "endpoint" else "화면 동작"
        lines.append(f"  {index:>2}. [{candidate.get('priority_score', 0)}점] {kind} · {function}")
        if candidate.get("kind") == "endpoint":
            origin = candidate.get("origin", "")
            endpoint = origin + candidate.get("url_pattern", "")
            suffix = " (호스트 미기록)" if not origin else ""
            lines.append(f"      요청: {candidate.get('method', '?')} {endpoint}{suffix}")
            fields = candidate.get("input_fields", [])
            if fields:
                field_text = ", ".join(f"{field.get('label') or field.get('name') or '?'}:{field.get('type', '?')}" for field in fields[:5])
                omitted = candidate.get("input_fields_omitted", 0) + max(0, len(fields) - 5)
                lines.append(f"      입력: {field_text}" + (f" 외 {omitted}개" if omitted else ""))
            elif candidate.get("parameter_names"):
                lines.append(f"      파라미터: {', '.join(candidate['parameter_names'])}")
        else:
            lines.append(f"      버튼: {candidate.get('label') or '(이름 없음)'}")
            if candidate.get("target_url"):
                lines.append(f"      JS 이동 후보: GET {candidate['target_url']}")
            if candidate.get("static_href"):
                lines.append(f"      정적 링크 후보: GET {candidate['static_href']}")
            if not candidate.get("target_url") and not candidate.get("static_href"):
                lines.append("      연결 엔드포인트: 정적 분석에서 확인되지 않음")
            if candidate.get("selector"):
                lines.append(f"      선택자: {candidate['selector']}")
        source_pages = candidate.get("source_pages", [])
        if source_pages:
            lines.append(f"      발견 페이지: {source_pages[0]}")
        lines.append(f"      근거: {', '.join(candidate.get('priority_reasons', [])) or '-'}")
    return "\n".join(lines)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Show a compact crawler or ranker result summary")
    parser.add_argument("result", nargs="?", default="result.json")
    args = parser.parse_args()
    path = Path(args.result)
    with path.open(encoding="utf-8") as file:
        data = json.load(file)
    print(summarize(data))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
