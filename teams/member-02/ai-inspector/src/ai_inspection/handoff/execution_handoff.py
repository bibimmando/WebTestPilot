"""Offline handoff drafts from analysis; reviewed actions are supplied explicitly.

No model, browser or MCP calls. A handoff is not execution authorization.
"""

import argparse
import hashlib
import json
from pathlib import Path

if __package__ in {None, ""}:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from src.ai_inspection.analysis.evidence_inspector import validate_evidence_response
from src.ai_inspection.analysis.inspection_input import load_hybrid_input

EVIDENCE = ["before_screenshot", "after_screenshot", "before_dom", "after_dom",
            "before_url", "after_url", "action_completion", "execution_errors"]


def read_jsonl(path):
    rows = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            raise ValueError(f"Invalid JSONL at line {number}") from None
        if not isinstance(row, dict):
            raise ValueError(f"Expected an object at line {number}")
        rows.append(row)
    return rows


def validate_review(review):
    if set(review) != {"plan_id", "preconditions", "steps", "collect_evidence", "execution_kind"}:
        raise ValueError("Reviewed plan fields do not match the handoff contract")
    if not isinstance(review["plan_id"], str) or not review["plan_id"]:
        raise ValueError("Reviewed plan requires plan_id")
    for field in ("preconditions", "collect_evidence"):
        values = review[field]
        if not isinstance(values, list) or not values or not all(isinstance(value, str) and value.strip() for value in values):
            raise ValueError(f"Reviewed plan requires nonempty {field}")
    if set(review["collect_evidence"]) - set(EVIDENCE):
        raise ValueError("Unsupported evidence request")
    if review["execution_kind"] not in {"additional_check", "reproduction"}:
        raise ValueError("Invalid execution_kind")
    steps = review["steps"]
    if not isinstance(steps, list) or not 1 <= len(steps) <= 10:
        raise ValueError("Reviewed plan requires 1-10 steps")
    from src.ai_inspection.execution.browser_runner import validate_steps
    controls = {}
    for step in steps:
        if (not isinstance(step, dict) or set(step) != {"action", "control_id", "value"}
                or not isinstance(step["control_id"], str) or not step["control_id"].strip()
                or not isinstance(step["value"], str)
                or (step["action"] == "click" and step["value"] != "")):
            raise ValueError("Invalid reviewed action")
        controls[step["control_id"]] = "reviewed-control-id"  # No selector discovery/permission grant.
    validate_steps(controls, steps)


def export_execution_plans(hybrid_input, ai_results, output_dir, *, reviewed_plans=None):
    records = {item["record"]["input_id"]: item["record"] for item in load_hybrid_input(Path(hybrid_input))}
    results = read_jsonl(ai_results)
    plans, skipped, seen = [], [], set()
    for result in results:
        identifier = result.get("input_id")
        if not isinstance(identifier, str) or identifier not in records or identifier in seen:
            raise ValueError("Analysis input_id is missing, duplicated or not in hybrid input")
        seen.add(identifier)
        record = records[identifier]
        if result.get("kind") != record["kind"]:
            raise ValueError("Analysis kind does not match hybrid input")
        work_type = "test_planning" if record["kind"] == "semantic_test_planning" else "evidence_review"
        if result.get("work_type") != work_type:
            raise ValueError("Analysis work_type does not match hybrid input")
        if result.get("analysis_status") != "completed":
            skipped.append({"input_id": identifier, "reason": "analysis_not_completed"})
            continue
        analysis = validate_evidence_response(result.get("analysis"), work_type)
        field = "proposed_checks" if work_type == "test_planning" else "suggested_checks"
        for index, proposal in enumerate(analysis[field]):
            if not proposal.strip():
                raise ValueError("Empty proposal cannot be handed off")
            key = json.dumps([identifier, field, index, proposal], ensure_ascii=False)
            plan_id = "plan-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
            plans.append({"schema": "webtestpilot.execution-plan.v1", "plan_id": plan_id,
                "source_input_id": identifier, "source_kind": record["kind"],
                "source_proposal": {"field": field, "index": index, "text": proposal},
                "url": record["url"], "handoff_status": "needs_information",
                "execution_kind": "additional_check", "preconditions": [], "steps": [],
                "collect_evidence": list(EVIDENCE),
                "missing_information": ["preconditions", "steps", "execution_kind_confirmation"]})
    by_id = {plan["plan_id"]: plan for plan in plans}
    reviewed_ids = set()
    if reviewed_plans is not None:
        for review in read_jsonl(reviewed_plans):
            validate_review(review)
            identifier = review["plan_id"]
            if identifier not in by_id or identifier in reviewed_ids:
                raise ValueError("Reviewed plan_id is unknown or duplicated")
            reviewed_ids.add(identifier)
            by_id[identifier].update({key: value for key, value in review.items() if key != "plan_id"})
            by_id[identifier].update(handoff_status="ready_for_handoff", missing_information=[])
    output_dir = Path(output_dir)
    targets = [output_dir / "execution_plans.jsonl", output_dir / "execution_handoff.json"]
    sources = {Path(path).resolve() for path in (hybrid_input, ai_results, reviewed_plans) if path is not None}
    if any(target.resolve() in sources for target in targets):
        raise ValueError("Handoff output would overwrite an input file")
    summary = {"schema": "webtestpilot.execution-handoff.v1", "mode": "offline_export",
               "plan_count": len(plans), "ready_count": len(reviewed_ids),
               "needs_information_count": len(plans) - len(reviewed_ids), "skipped": skipped,
               "execution_performed": False, "expected_behavior_included": False}
    output_dir.mkdir(parents=True, exist_ok=True)
    targets[0].write_text("".join(json.dumps(plan, ensure_ascii=False) + "\n" for plan in plans), encoding="utf-8")
    targets[1].write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description="Export offline preprocessing-team execution handoff")
    parser.add_argument("--hybrid-input", required=True)
    parser.add_argument("--ai-results", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reviewed-plans", help="trusted human-reviewed JSONL additions keyed by plan_id")
    args = parser.parse_args(argv)
    try:
        summary = export_execution_plans(args.hybrid_input, args.ai_results, args.output_dir,
                                         reviewed_plans=args.reviewed_plans)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(f"Plans: {summary['plan_count']}; ready: {summary['ready_count']}; needs information: {summary['needs_information_count']}; no execution performed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
