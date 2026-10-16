"""Schema plus scenario ownership and evidence sufficiency checks."""
from copy import deepcopy
from jsonschema import Draft202012Validator
from .input_contract import schema


def validate_response(response, payload, image_records):
    if next(Draft202012Validator(schema("scenario_judgments.schema.json")).iter_errors(response), None):
        raise ValueError("Response does not match scenario_judgments")
    by_id = {scenario["scenario_id"]: scenario for scenario in payload["scenarios"]}
    seen = set()
    for item in response["judgments"]:
        identifier = item["scenario_id"]
        if identifier not in by_id or identifier in seen:
            raise ValueError("Unknown or duplicate judgment scenario")
        seen.add(identifier)
        scenario = by_id[identifier]
        if not item["actual"].strip() or not item["snapshot_ids"]:
            raise ValueError("Judgment requires an explanation and snapshot evidence")
        if not set(item["snapshot_ids"]) <= set(scenario["snapshot_ids"]) or not set(item["action_ids"]) <= set(scenario["action_ids"]):
            raise ValueError("Judgment evidence belongs to another scenario")
        if item["verdict"] == "inconclusive":
            continue
        if scenario["execution_status"] != "completed" or scenario["policy_blocked"]:
            raise ValueError("Incomplete or blocked scenario must be inconclusive")
        image = image_records.get(identifier, {})
        if scenario["family"] == "ui" and (image.get("status") != "available" or image.get("snapshot_id") not in item["snapshot_ids"]):
            raise ValueError("Visual judgment requires an attached scenario image")
        steps = {step["action_id"]: step for step in scenario["steps"]}
        if not item["action_ids"] and scenario["family"] != "ui":
            raise ValueError("Functional judgment requires actual action evidence")
        for action in item["action_ids"]:
            step = steps.get(action)
            if (not step or step["execution"] != "executed" or step["observation_status"] != "available"
                    or step.get("policy_blocked") or not step.get("before_snapshot_id") or not step.get("after_snapshot_id")):
                raise ValueError("Referenced action lacks complete execution evidence")
            if not {step["before_snapshot_id"], step["after_snapshot_id"]} <= set(item["snapshot_ids"]):
                raise ValueError("Judgment must cite the action's before and after snapshots")
    if seen != set(by_id):
        raise ValueError("Judgment response omitted scenarios")
    return deepcopy(response)
