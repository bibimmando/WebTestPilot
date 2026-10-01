from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


# 보고서가 근본 원인을 지원하면 병합 결과를, 아니면 개별 탐지를 예측값으로 읽는다.
def _predictions(report: dict[str, Any]) -> list[dict[str, Any]]:
    roots = report.get("root_causes")
    if isinstance(roots, list):
        return [
            {
                "id": item.get("root_cause_id", ""),
                "kind": item.get("kind", ""),
                "urls": item.get("urls", []),
            }
            for item in roots
        ]
    return [
        {
            "id": f"finding-{index}",
            "kind": item.get("kind", ""),
            "urls": [item.get("url", "")],
        }
        for index, item in enumerate(report.get("findings", []), start=1)
    ]


# 종류와 URL 조건을 모두 만족하는지 비교해 평가 기준을 명시적으로 유지한다.
def _matches(expected: dict[str, Any], predicted: dict[str, Any]) -> bool:
    if expected.get("kind") != predicted.get("kind"):
        return False
    fragment = str(expected.get("url_contains", ""))
    return not fragment or any(fragment in str(url) for url in predicted.get("urls", []))


# 하나의 예측이 여러 정답에 중복 집계되지 않도록 일대일로 매칭한다.
def score_report(ground_truth: list[dict[str, Any]], report: dict[str, Any]) -> dict[str, Any]:
    predicted = _predictions(report)
    unused = set(range(len(predicted)))
    matches: list[dict[str, str]] = []
    missed: list[str] = []
    for expected in ground_truth:
        match_index = next(
            (index for index in sorted(unused) if _matches(expected, predicted[index])), None
        )
        expected_id = str(expected.get("id", expected.get("kind", "unknown")))
        if match_index is None:
            missed.append(expected_id)
            continue
        unused.remove(match_index)
        matches.append({"expected": expected_id, "predicted": predicted[match_index]["id"]})

    tp = len(matches)
    fp = len(unused)
    fn = len(missed)
    precision = tp / (tp + fp) if tp + fp else (1.0 if not ground_truth else 0.0)
    recall = tp / (tp + fn) if tp + fn else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    metadata = report.get("metadata", {})
    return {
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "matched": matches,
        "missed_ground_truth_ids": missed,
        "unmatched_prediction_ids": [predicted[index]["id"] for index in sorted(unused)],
        "pages_observed": metadata.get("pages_observed"),
        "elapsed_seconds": metadata.get("elapsed_seconds"),
        "ai_candidates": metadata.get("ai_candidates"),
    }


# JSONL 입력 크기를 API 없이 문자/4 휴리스틱 토큰으로 비교한다.
def _handoff_metrics(report_path: Path) -> dict[str, int | None]:
    path = report_path.with_name("hybrid_ai_input.jsonl")
    if not path.exists():
        return {"ai_input_records": None, "estimated_ai_input_tokens": None}
    text = path.read_text(encoding="utf-8")
    records = sum(bool(line.strip()) for line in text.splitlines())
    return {
        "ai_input_records": records,
        "estimated_ai_input_tokens": math.ceil(len(text) / 4) if text else 0,
    }


# 여러 프로토타입 보고서를 동일 정답으로 평가해 JSON과 Markdown 표를 만든다.
def evaluate_reports(
    ground_truth_path: Path, report_paths: list[Path], output_dir: Path
) -> dict[str, Path]:
    manifest = json.loads(ground_truth_path.read_text(encoding="utf-8"))
    ground_truth = manifest if isinstance(manifest, list) else manifest.get(
        "bugs", manifest.get("targets", [])
    )
    if not isinstance(ground_truth, list):
        raise ValueError("ground truth must contain a 'bugs' or 'targets' list")

    results = []
    for path in report_paths:
        report = json.loads(path.read_text(encoding="utf-8"))
        score = score_report(ground_truth, report)
        score.update(_handoff_metrics(path))
        score["name"] = path.parent.name or path.stem
        score["report"] = str(path.resolve())
        results.append(score)
    results.sort(key=lambda item: (-item["f1"], -item["recall"], -item["precision"], item["name"]))

    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "ground_truth": str(ground_truth_path.resolve()),
        "ground_truth_count": len(ground_truth),
        "ranking_policy": "f1, recall, precision; AI input cost is reported separately",
        "results": results,
    }
    json_path = output_dir / "evaluation.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# Crawler Prototype Evaluation",
        "",
        f"- 정답 버그: {len(ground_truth)}",
        "- 순위: F1 → Recall → Precision (비용은 별도 지표)",
        "",
        "| 순위 | 프로토타입 | Precision | Recall | F1 | TP/FP/FN | 페이지 | AI 입력 토큰(추정) |",
        "|---:|---|---:|---:|---:|---:|---:|---:|",
    ]
    for rank, item in enumerate(results, start=1):
        lines.append(
            f"| {rank} | {item['name']} | {item['precision']:.4f} | {item['recall']:.4f} | "
            f"{item['f1']:.4f} | {item['true_positives']}/{item['false_positives']}/{item['false_negatives']} | "
            f"{item['pages_observed'] if item['pages_observed'] is not None else 'N/A'} | "
            f"{item['estimated_ai_input_tokens'] if item['estimated_ai_input_tokens'] is not None else 'N/A'} |"
        )
    markdown_path = output_dir / "evaluation.md"
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"evaluation_json": json_path, "evaluation_markdown": markdown_path}


# 평가 전용 CLI 인자를 정의한다.
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Compare crawler reports against one ground truth.")
    parser.add_argument("ground_truth", type=Path)
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=Path("evaluation-results"))
    return parser


# 평가 파일 경로를 출력해 팀 비교 결과를 바로 열 수 있게 한다.
def main() -> None:
    args = build_parser().parse_args()
    paths = evaluate_reports(args.ground_truth, args.reports, args.output.resolve())
    print(f"Evaluation JSON: {paths['evaluation_json']}")
    print(f"Evaluation table: {paths['evaluation_markdown']}")


if __name__ == "__main__":
    main()
