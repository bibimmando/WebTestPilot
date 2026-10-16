"""Pinned judge_input/2 validation; page evidence never supplies instructions."""
from copy import deepcopy
import json
from pathlib import Path
from jsonschema import Draft202012Validator

CONTRACT_COMMIT = "ab5d8f07d7274e3feaf268c6ebe3ef50e6f617d5"
ROOT = Path(__file__).resolve().parent


def schema(name):
    return json.loads((ROOT / "schemas" / name).read_text(encoding="utf-8-sig"))


def validate_input(payload):
    if next(Draft202012Validator(schema("judge_input.v2.schema.json")).iter_errors(payload), None):
        raise ValueError("Input does not match judge_input/2")
    seen = set()
    observations = payload["observations"]
    for scenario in payload["scenarios"]:
        identifier = scenario["scenario_id"]
        if not identifier.strip() or identifier in seen:
            raise ValueError("Scenario IDs must be nonblank and unique")
        seen.add(identifier)
        for field in ("expected", "expected_source"):
            if not scenario[field].strip():
                raise ValueError("Expected behavior and source must be nonblank")
        snapshots = scenario["snapshot_ids"]
        actions = scenario["action_ids"]
        if not snapshots or len(snapshots) != len(set(snapshots)) or len(actions) != len(set(actions)):
            raise ValueError("Scenario evidence IDs must be unique; snapshots are required")
        if any(identifier not in observations for identifier in snapshots):
            raise ValueError("Referenced observation is missing")
        for field in ("start_snapshot_id", "end_snapshot_id"):
            if scenario.get(field) is not None and scenario[field] not in snapshots:
                raise ValueError("Start/end observation is outside scenario")
        step_ids = set()
        for step in scenario["steps"]:
            if step["action_id"] not in actions or step["action_id"] in step_ids:
                raise ValueError("Step action references are invalid")
            step_ids.add(step["action_id"])
            for field in ("before_snapshot_id", "after_snapshot_id"):
                if step.get(field) is not None and step[field] not in snapshots:
                    raise ValueError("Step observation is outside scenario")
        image = scenario.get("image")
        if image and image["snapshot_id"] not in snapshots:
            raise ValueError("Image observation is outside scenario")
    return deepcopy(payload)


def read_input(path):
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, UnicodeError):
        raise ValueError("Cannot decode judgment input JSON") from None
    return validate_input(payload)


def observation_pair(payload, step):
    """Return missing snapshots as None, never as fabricated empty evidence."""
    return tuple(payload["observations"].get(step.get(key))
                 for key in ("before_snapshot_id", "after_snapshot_id"))
