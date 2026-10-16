"""Internal criterion review; preserve the team's five-field judgment contract."""
from copy import deepcopy

from jsonschema import Draft202012Validator

from .input_contract import schema


def assessment_schema():
    result = deepcopy(schema("scenario_judgments.schema.json"))
    item = result["properties"]["judgments"]["items"]
    text = {"type": "string", "minLength": 1, "maxLength": 1500}
    refs = {"type": "array", "items": {"type": "string"}, "uniqueItems": True, "maxItems": 100}
    item["properties"]["assessment"] = {
        "type": "object", "additionalProperties": False,
        "properties": {
            "expectation_supported": {"type": "boolean"},
            "purpose_covered": {"type": "boolean"},
            "reason": text,
            "criteria": {"type": "array", "minItems": 1, "maxItems": 12, "items": {
                "type": "object", "additionalProperties": False,
                "properties": {"criterion": text, "status": {"enum": ["met", "unmet", "unknown"]},
                               "evidence": text, "snapshot_ids": refs, "action_ids": refs},
                "required": ["criterion", "status", "evidence", "snapshot_ids", "action_ids"]}},
        },
        "required": ["expectation_supported", "purpose_covered", "reason", "criteria"],
    }
    item["required"].append("assessment")
    return result


def review_response(response, payload):
    """Reject malformed references; downgrade unsupported conclusions, never promote."""
    if next(Draft202012Validator(assessment_schema()).iter_errors(response), None):
        raise ValueError("Judgment requires a structured criterion assessment")
    scenarios = {s["scenario_id"]: s for s in payload["scenarios"]}
    result, audit = deepcopy(response), []
    for item in result["judgments"]:
        scenario = scenarios.get(item["scenario_id"])
        if scenario is None:
            raise ValueError("Unknown judgment scenario")
        assessment = item.pop("assessment")
        for criterion in assessment["criteria"]:
            if (not set(criterion["snapshot_ids"]) <= set(item["snapshot_ids"])
                    or not set(criterion["action_ids"]) <= set(item["action_ids"])):
                raise ValueError("Criterion evidence must be cited in its judgment")
            if criterion["status"] != "unknown" and not criterion["snapshot_ids"]:
                raise ValueError("A met/unmet criterion requires snapshot evidence")
        states = [c["status"] for c in assessment["criteria"]]
        supported = assessment["expectation_supported"] and assessment["purpose_covered"]
        reason = None
        if item["verdict"] == "passed" and (not supported or any(s != "met" for s in states)):
            reason = "기대 조건의 근거·검사 목적·전체 조건 충족이 확인되지 않아 통과를 보류했습니다."
        elif item["verdict"] == "candidate" and (not supported or "unmet" not in states):
            reason = "근거 있는 기대 조건 위반이 확인되지 않아 문제 후보 판정을 보류했습니다."
        original = item["verdict"]
        if reason:
            item["verdict"] = "inconclusive"
            item["actual"] = ("[프로그램 검토] " + reason + " AI 검토: " + assessment["reason"]
                              + " / 원문: " + item["actual"])[:4000]
        audit.append({"scenario_id": item["scenario_id"], "model_verdict": original,
                      "accepted_verdict": item["verdict"], "downgrade_reason": reason,
                      "assessment": assessment})
    return result, {"schema_version": "judgment_assessment/1", "scenarios": audit}
