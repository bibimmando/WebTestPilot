import json

from webtestpilot_crawler.evaluation import evaluate_reports, score_report


def test_evaluator_reports_precision_recall_and_f1(tmp_path):
    truth = [
        {"id": "B1", "kind": "broken_image", "url_contains": "/products/"},
        {"id": "B2", "kind": "javascript_exception", "url_contains": "/checkout"},
    ]
    report = {
        "metadata": {"pages_observed": 5, "elapsed_seconds": 1.2, "ai_candidates": 1},
        "root_causes": [
            {"root_cause_id": "R1", "kind": "broken_image", "urls": ["https://x/products/1"]},
            {"root_cause_id": "R2", "kind": "console_error", "urls": ["https://x/"]},
        ],
    }
    score = score_report(truth, report)
    assert score["precision"] == 0.5
    assert score["recall"] == 0.5
    assert score["f1"] == 0.5

    truth_path = tmp_path / "truth.json"
    report_dir = tmp_path / "prototype-a"
    report_dir.mkdir()
    report_path = report_dir / "crawl_report.json"
    truth_path.write_text(json.dumps({"bugs": truth}), encoding="utf-8")
    report_path.write_text(json.dumps(report), encoding="utf-8")
    paths = evaluate_reports(truth_path, [report_path], tmp_path / "out")
    assert all(path.exists() for path in paths.values())
