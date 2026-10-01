from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import AIReviewCandidate, GraphEdge, PageObservation


# Path와 set처럼 기본 JSON 인코더가 모르는 타입을 변환한다.
def _json_default(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, set):
        return sorted(value)
    raise TypeError(f"Cannot serialize {type(value).__name__}")


# 전체 관찰 결과, AI 큐, 사람이 읽는 요약을 각각 파일로 저장한다.
def write_reports(
    output_dir: Path,
    *,
    config: Any,
    observations: list[PageObservation],
    edges: list[GraphEdge],
    ai_candidates: list[AIReviewCandidate],
    root_causes: list[dict[str, Any]],
    preprocessing_stats: dict[str, Any],
    skip_reasons: dict[str, int],
    elapsed_seconds: float,
) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    findings = [finding for observation in observations for finding in observation.findings]
    report = {
        "metadata": {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "start_url": config.start_url,
            "elapsed_seconds": round(elapsed_seconds, 3),
            "pages_observed": len(observations),
            "unique_states": len({item.state_fingerprint for item in observations if item.state_fingerprint}),
            "deterministic_findings": len(findings),
            "unique_root_causes": len(root_causes),
            "ai_candidates": len(ai_candidates),
        },
        "config": asdict(config),
        "routing": dict(Counter(item.route for item in observations)),
        "skip_reasons": skip_reasons,
        "pages": [item.to_dict() for item in observations],
        "edges": [asdict(item) for item in edges],
        "findings": [item.to_dict() for item in findings],
        "root_causes": root_causes,
        "preprocessing": preprocessing_stats,
    }
    report_path = output_dir / "crawl_report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, default=_json_default), encoding="utf-8"
    )

    ai_path = output_dir / "ai_queue.jsonl"
    ai_path.write_text(
        "".join(
            json.dumps(item.to_dict(), ensure_ascii=False, default=_json_default) + "\n"
            for item in ai_candidates
        ),
        encoding="utf-8",
    )

    issue_counts = Counter(item.kind for item in findings)
    lines = [
        "# WebTestPilot Crawl Summary",
        "",
        f"- 시작 URL: `{config.start_url}`",
        f"- 실행 시간: {elapsed_seconds:.2f}초",
        f"- 관찰 페이지: {len(observations)}",
        f"- 결정적 탐지: {len(findings)}",
        f"- 병합된 근본 원인: {len(root_causes)}",
        f"- AI 검토 후보: {len(ai_candidates)}",
        f"- 정적 신호 합계: {sum(item.static_signal_count for item in observations)}",
        f"- 동적 신호 합계: {sum(item.dynamic_signal_count for item in observations)}",
        f"- 제거된 공통 UI 신호: {preprocessing_stats.get('suppressed_action_occurrences', 0) + preprocessing_stats.get('suppressed_input_occurrences', 0)}",
        f"- 제거된 중복 AI 후보: {preprocessing_stats.get('duplicate_ai_candidates_suppressed', 0)}",
        "",
        "## 탐지 유형",
        "",
    ]
    lines.extend(f"- `{kind}`: {count}" for kind, count in issue_counts.most_common())
    if not issue_counts:
        lines.append("- 탐지 없음")
    lines.extend(["", "## 범위 제한/중복 제거", ""])
    lines.extend(f"- `{reason}`: {count}" for reason, count in sorted(skip_reasons.items()))
    if not skip_reasons:
        lines.append("- 제한 발생 없음")
    summary_path = output_dir / "summary.md"
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"report": report_path, "ai_queue": ai_path, "summary": summary_path}
