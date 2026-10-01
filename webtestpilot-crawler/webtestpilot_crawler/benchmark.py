from __future__ import annotations

import json
import math
from collections import Counter
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable

from .models import AIReviewCandidate, PageObservation


# JSONL 한 줄과 실제 API 메시지 크기가 가깝도록 공백 없는 JSON으로 직렬화한다.
def _serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


# 설치된 로컬 토크나이저를 우선 사용하고 없으면 문자 수 기반 추정기로 대체한다.
def build_token_counter(requested: str) -> tuple[Callable[[str], int], str]:
    if requested == "heuristic":
        return lambda text: max(1, math.ceil(len(text) / 4)), "heuristic_chars_div_4"

    try:
        import tiktoken
    except ImportError:
        if requested != "auto":
            raise RuntimeError(
                "The requested tokenizer requires tiktoken. Install with: pip install -e '.[benchmark]'"
            ) from None
        return lambda text: max(1, math.ceil(len(text) / 4)), "heuristic_chars_div_4"

    encoding_name = "o200k_base" if requested == "auto" else requested
    try:
        encoding = tiktoken.get_encoding(encoding_name)
    except Exception as exc:
        if requested == "auto":
            return lambda text: max(1, math.ceil(len(text) / 4)), "heuristic_chars_div_4"
        raise RuntimeError(
            f"Could not load tokenizer encoding {encoding_name!r}; use --benchmark-tokenizer heuristic "
            "for a fully offline run"
        ) from exc
    return lambda text: len(encoding.encode(text)), f"tiktoken:{encoding_name}"


# 페이지의 공통 브라우저 오류와 동작 결과를 기준선 입력용 구조로 만든다.
def _browser_evidence(
    observation: PageObservation, captured: dict[str, Any]
) -> dict[str, Any]:
    return {
        "network_activity": captured.get("network_activity", []),
        "http_errors": observation.response_errors,
        "failed_requests": observation.failed_requests,
        "console_errors": observation.console_errors,
        "page_errors": observation.page_errors,
        "broken_images": observation.broken_images,
        "actions": [asdict(item) for item in observation.action_results],
    }


# 전체 HTML을 AI에 전달하는 AI-first 기준선 레코드를 만든다.
def _raw_record(observation: PageObservation, captured: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": "webtestpilot.raw-ai-input.v1",
        "input_id": observation.state_fingerprint or observation.normalized_url,
        "task": "Find website bugs from the raw browser evidence.",
        "page": {
            "url": observation.normalized_url,
            "title": observation.title,
            "status": observation.status_code,
            "depth": observation.depth,
        },
        "html": captured.get("html", ""),
        "html_truncated": bool(captured.get("html_truncated")),
        "browser_evidence": _browser_evidence(observation, captured),
    }


# 모든 페이지의 추출 정보를 AI에 전달하는 일반 시맨틱 크롤러 기준선을 만든다.
def _standard_record(observation: PageObservation, captured: dict[str, Any]) -> dict[str, Any]:
    semantic = observation.semantic
    return {
        "schema": "webtestpilot.standard-crawler-input.v1",
        "input_id": observation.state_fingerprint or observation.normalized_url,
        "task": "Find website bugs from the extracted page and browser evidence.",
        "page": {
            "url": observation.normalized_url,
            "title": observation.title,
            "status": observation.status_code,
            "depth": observation.depth,
        },
        "visible_text": captured.get("visible_text", observation.text_excerpt),
        "text_truncated": bool(captured.get("text_truncated")),
        "structure": {
            "headings": semantic.get("headings", []),
            "links": semantic.get("links", []),
            "controls": semantic.get("controls", []),
            "inputs": semantic.get("inputs", []),
            "dialogs": semantic.get("dialogs", []),
            "forms": semantic.get("forms", 0),
            "images": semantic.get("images", 0),
            "scripts": semantic.get("scripts", 0),
        },
        "browser_evidence": _browser_evidence(observation, captured),
    }


# AI 큐 후보에서 실제 모델 판단에 필요한 필드만 남긴 하이브리드 입력을 만든다.
def _hybrid_record(candidate: AIReviewCandidate) -> dict[str, Any]:
    return {
        "schema": "webtestpilot.hybrid-ai-input.v1",
        "input_id": candidate.candidate_id,
        "task": "Review this unresolved crawler evidence and decide whether it indicates a bug.",
        "kind": candidate.kind,
        "url": candidate.url,
        "reason": candidate.reason,
        "payload": candidate.payload,
    }


# 실제 API/CLI가 바로 소비할 수 있는 최소 AI 입력 JSONL을 항상 생성한다.
def write_hybrid_input(
    output_dir: Path, ai_candidates: list[AIReviewCandidate]
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "hybrid_ai_input.jsonl"
    path.write_text(
        "".join(f"{_serialize(_hybrid_record(item))}\n" for item in ai_candidates),
        encoding="utf-8",
    )
    return path


# 직렬화된 레코드 묶음의 문자·바이트·토큰 크기를 계산한다.
def _measure(records: list[dict[str, Any]], count_tokens: Callable[[str], int]) -> dict[str, int]:
    lines = [_serialize(record) for record in records]
    return {
        "records": len(lines),
        "characters": sum(len(line) for line in lines),
        "utf8_bytes": sum(len(line.encode("utf-8")) for line in lines),
        "tokens": sum(count_tokens(line) for line in lines),
    }


# 0으로 나누는 상황을 피하면서 기준선 대비 감소율을 계산한다.
def _reduction(baseline: int, optimized: int) -> float | None:
    if baseline == 0:
        return None
    return round((1.0 - optimized / baseline) * 100.0, 2)


# 세 AI 입력 전략의 로컬 산출물과 비교 지표를 파일로 기록한다.
def write_benchmark_reports(
    output_dir: Path,
    *,
    observations: list[PageObservation],
    captured_pages: dict[int, dict[str, Any]],
    ai_candidates: list[AIReviewCandidate],
    tokenizer: str,
) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    count_tokens, tokenizer_used = build_token_counter(tokenizer)

    raw_records = [
        _raw_record(item, captured_pages.get(id(item), {})) for item in observations
    ]
    standard_records = [
        _standard_record(item, captured_pages.get(id(item), {})) for item in observations
    ]
    hybrid_records = [_hybrid_record(item) for item in ai_candidates]

    raw_metrics = _measure(raw_records, count_tokens)
    standard_metrics = _measure(standard_records, count_tokens)
    hybrid_metrics = _measure(hybrid_records, count_tokens)
    unresolved = [item for item in observations if item.route in {"ai", "hybrid"}]
    forwarded_urls = {item.url for item in ai_candidates}
    forwarded_unresolved = sum(item.normalized_url in forwarded_urls for item in unresolved)
    crawler_findings = sum(len(item.findings) for item in observations)
    confirmed_findings = sum(
        finding.confidence == "confirmed"
        for item in observations
        for finding in item.findings
    )

    comparison = {
        "tokenizer": tokenizer_used,
        "scope": {
            "pages": len(observations),
            "unresolved_pages": len(unresolved),
            "forwarded_unresolved_pages": forwarded_unresolved,
            "routing_coverage_percent": round(forwarded_unresolved / len(unresolved) * 100, 2)
            if unresolved
            else 100.0,
            "crawler_findings": crawler_findings,
            "confirmed_findings": confirmed_findings,
            "routes": dict(Counter(item.route for item in observations)),
        },
        "inputs": {
            "raw_ai_first": raw_metrics,
            "standard_crawler": standard_metrics,
            "hybrid": hybrid_metrics,
        },
        "reductions_percent": {
            "hybrid_vs_raw_tokens": _reduction(raw_metrics["tokens"], hybrid_metrics["tokens"]),
            "hybrid_vs_standard_tokens": _reduction(
                standard_metrics["tokens"], hybrid_metrics["tokens"]
            ),
        },
        "notes": [
            "Token counts cover exported content only; future API system prompts and responses are excluded.",
            "Routing coverage is not bug recall. Ground-truth labels are required to measure missed bugs.",
            "Raw benchmark files may contain sensitive page content and must remain local.",
        ],
    }

    raw_path = output_dir / "raw_ai_input.jsonl"
    standard_path = output_dir / "standard_crawler_input.jsonl"
    hybrid_path = output_dir / "hybrid_ai_input.jsonl"
    comparison_path = output_dir / "token_comparison.json"
    report_path = output_dir / "comparison_report.md"
    raw_path.write_text("".join(f"{_serialize(item)}\n" for item in raw_records), encoding="utf-8")
    standard_path.write_text(
        "".join(f"{_serialize(item)}\n" for item in standard_records), encoding="utf-8"
    )
    write_hybrid_input(output_dir, ai_candidates)
    comparison_path.write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    reduction_raw = comparison["reductions_percent"]["hybrid_vs_raw_tokens"]
    reduction_standard = comparison["reductions_percent"]["hybrid_vs_standard_tokens"]
    lines = [
        "# AI Input Benchmark",
        "",
        f"- 토크나이저: `{tokenizer_used}`",
        f"- 관찰 페이지: {len(observations)}",
        f"- 크롤러 규칙 탐지: {crawler_findings}",
        f"- 그중 확정 탐지: {confirmed_findings}",
        f"- 미해결 페이지 전달률: {comparison['scope']['routing_coverage_percent']:.2f}%",
        "",
        "## 입력 크기",
        "",
        "| 방식 | 레코드 | 문자 | UTF-8 바이트 | 토큰 |",
        "|---|---:|---:|---:|---:|",
        f"| 전체 HTML AI-first | {raw_metrics['records']} | {raw_metrics['characters']} | {raw_metrics['utf8_bytes']} | {raw_metrics['tokens']} |",
        f"| 일반 시맨틱 크롤러 | {standard_metrics['records']} | {standard_metrics['characters']} | {standard_metrics['utf8_bytes']} | {standard_metrics['tokens']} |",
        f"| WebTestPilot 하이브리드 | {hybrid_metrics['records']} | {hybrid_metrics['characters']} | {hybrid_metrics['utf8_bytes']} | {hybrid_metrics['tokens']} |",
        "",
        "## 감소율",
        "",
        f"- 전체 HTML 대비 하이브리드 토큰 감소: {reduction_raw if reduction_raw is not None else 'N/A'}%",
        f"- 일반 크롤러 대비 하이브리드 토큰 감소: {reduction_standard if reduction_standard is not None else 'N/A'}%",
        "",
        "> 이 수치는 입력 압축률이다. 실제 버그 재현율은 정답 라벨과 동일 모델 A/B 평가로 별도 측정해야 한다.",
    ]
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {
        "raw_ai_input": raw_path,
        "standard_crawler_input": standard_path,
        "hybrid_ai_input": hybrid_path,
        "token_comparison": comparison_path,
        "comparison_report": report_path,
    }
