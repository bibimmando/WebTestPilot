from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from typing import Any
from urllib.parse import urlsplit

from .fingerprint import compact_text
from .models import ActionCandidate, Finding, PageObservation
from .url_normalizer import path_family

_SPACE = re.compile(r"\s+")
_VOLATILE = re.compile(
    r"(?i)(?:https?://\S+|\b[0-9a-f]{8,}\b|\b\d{3,}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b)"
)


# 공통 UI 비교에 사용할 짧고 안정적인 라벨로 정규화한다.
def normalize_ui_label(value: str) -> str:
    return compact_text(_SPACE.sub(" ", value or "").strip().casefold(), 120)


# 동작 후보를 여러 페이지에서 비교할 수 있는 의미 시그니처로 바꾼다.
def action_signature(action: ActionCandidate) -> str:
    return "|".join((action.kind, normalize_ui_label(action.label), action.risk))


# 입력 요소를 여러 페이지에서 비교할 수 있는 의미 시그니처로 바꾼다.
def input_signature(item: dict[str, Any]) -> str:
    return "|".join(
        (
            str(item.get("type", "")).casefold(),
            normalize_ui_label(str(item.get("label", ""))),
            normalize_ui_label(str(item.get("placeholder", ""))),
        )
    )


# 여러 페이지에 반복되는 동작과 입력을 공통 레이아웃 UI로 식별한다.
def find_common_ui(
    observations: list[PageObservation], *, minimum_pages: int = 3, ratio: float = 0.6
) -> tuple[set[str], set[str]]:
    eligible = [item for item in observations if not item.error]
    threshold = max(minimum_pages, math.ceil(len(eligible) * ratio))
    action_counts: Counter[str] = Counter()
    input_counts: Counter[str] = Counter()
    for observation in eligible:
        action_counts.update({action_signature(item) for item in observation.actions})
        input_counts.update(
            {input_signature(item) for item in observation.semantic.get("inputs", [])}
        )
    return (
        {signature for signature, count in action_counts.items() if count >= threshold},
        {signature for signature, count in input_counts.items() if count >= threshold},
    )


# 공통 UI를 제외한 페이지별 동적 신호를 다시 계산하고 전처리 근거를 저장한다.
def apply_common_ui_filter(observations: list[PageObservation]) -> dict[str, Any]:
    common_actions, common_inputs = find_common_ui(observations)
    suppressed_actions = 0
    suppressed_inputs = 0
    for observation in observations:
        raw_dynamic = observation.dynamic_signal_count
        page_common_actions = [
            action_signature(item)
            for item in observation.actions
            if action_signature(item) in common_actions
        ]
        common_action_ids = [
            item.action_id
            for item in observation.actions
            if action_signature(item) in common_actions
        ]
        page_common_inputs = [
            input_signature(item)
            for item in observation.semantic.get("inputs", [])
            if input_signature(item) in common_inputs
        ]
        suppressed_actions += len(page_common_actions)
        suppressed_inputs += len(page_common_inputs)
        observation.dynamic_signal_count = max(
            0, raw_dynamic - len(page_common_actions) - len(page_common_inputs)
        )
        observation.semantic["preprocessing"] = {
            "raw_dynamic_signal_count": raw_dynamic,
            "effective_dynamic_signal_count": observation.dynamic_signal_count,
            "common_action_signatures": page_common_actions,
            "common_action_ids": common_action_ids,
            "common_input_signatures": page_common_inputs,
        }
    return {
        "common_action_signatures": sorted(common_actions),
        "common_input_signatures": sorted(common_inputs),
        "suppressed_action_occurrences": suppressed_actions,
        "suppressed_input_occurrences": suppressed_inputs,
    }


# 반복 오류 메시지에서 URL·ID·시간처럼 실행마다 달라지는 값을 제거한다.
def normalize_error_text(value: str) -> str:
    return _SPACE.sub(" ", _VOLATILE.sub("{volatile}", value or "")).strip().casefold()[:300]


# 탐지 결과를 사이트 전체에서 동일 원인으로 묶을 안정적인 시그니처로 만든다.
def finding_signature(finding: Finding) -> str:
    evidence = finding.evidence
    if finding.kind in {"javascript_exception", "console_error", "interaction_javascript_exception"}:
        messages = evidence.get("messages", [])
        detail = normalize_error_text(str(messages[0] if messages else ""))
    elif finding.kind in {"network_failure", "interaction_network_error", "failed_http_resources"}:
        samples = evidence.get("samples", [])
        sample = samples[0] if samples else {}
        detail = "|".join(
            (
                str(sample.get("error", sample.get("status", ""))).casefold(),
                str(sample.get("resource_type", "")).casefold(),
                urlsplit(str(sample.get("url", ""))).netloc.casefold(),
            )
        )
    elif finding.kind == "http_error":
        detail = f"{evidence.get('status', '')}|{path_family(finding.url)}"
    elif finding.kind == "broken_image":
        urls = evidence.get("urls", [])
        detail = path_family(str(urls[0])) if urls else path_family(finding.url)
    else:
        detail = path_family(finding.url)
    return f"{finding.kind}|{detail}"


# 페이지별 탐지를 원인 단위 이슈로 병합하고 각 탐지에 root_cause_id를 연결한다.
def cluster_findings(observations: list[PageObservation]) -> list[dict[str, Any]]:
    grouped: dict[str, list[Finding]] = defaultdict(list)
    for observation in observations:
        for finding in observation.findings:
            grouped[finding_signature(finding)].append(finding)

    root_causes: list[dict[str, Any]] = []
    for signature, findings in grouped.items():
        digest = hashlib.sha256(signature.encode("utf-8")).hexdigest()[:12]
        issue_id = f"ROOT-{digest}"
        for finding in findings:
            finding.root_cause_id = issue_id
        root_causes.append(
            {
                "root_cause_id": issue_id,
                "signature": signature,
                "kind": findings[0].kind,
                "severity": max((item.severity for item in findings), key=("low", "medium", "high").index),
                "confidence": "confirmed"
                if any(item.confidence == "confirmed" for item in findings)
                else "candidate",
                "occurrences": len(findings),
                "urls": list(dict.fromkeys(item.url for item in findings))[:50],
                "evidence_samples": [item.evidence for item in findings[:3]],
            }
        )
    return sorted(root_causes, key=lambda item: (-item["occurrences"], item["kind"]))


# 경로의 앞부분을 사용해 제한된 탐색 예산을 분산할 기능 카테고리를 만든다.
def url_category(url: str) -> str:
    parts = [part.casefold() for part in urlsplit(url).path.split("/") if part]
    if not parts:
        return "/"
    return "/" + parts[0]


# 전처리 통계를 안정적인 JSON으로 직렬화해 테스트와 보고서 비교에 사용한다.
def preprocessing_digest(value: dict[str, Any]) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
