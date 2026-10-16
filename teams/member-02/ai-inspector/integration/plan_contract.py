"""Pure JSON data contract for QA scenario proposals and executable test plans.

No execution or network access happens here. Every input object field and
every observed ID is treated as plain data.
"""
import copy
from urllib.parse import urljoin

import jsonschema

from .preprocessor.crawl import normalize_url, same_origin

SCHEMA_VERSION = "test_plan/2"
PRESS_KEYS = ("Enter", "Tab", "Escape", "ArrowUp", "ArrowDown")
FORBIDDEN_CONTROL_TYPES = ("password", "file")
FAMILIES = ("functional", "input_validation", "routing", "ui")
OPERATIONS = ("click", "fill", "press", "navigate")
REQUIRED_FIELDS = {
    "click": {"element_key"},
    "fill": {"element_key", "value"},
    "press": {"element_key", "value"},
    "navigate": {"url"},
}

PROPOSAL_TOOL = {
    "name": "scenario_proposals",
    "description": "Summarize the observed page and propose QA checks.",
    "input_schema": {
        "type": "object",
        "properties": {
            "page_summary": {"type": "string"},
            "proposed_checks": {"type": "array", "maxItems": 10, "items": {"type": "string"}},
            "open_questions": {"type": "array", "maxItems": 10, "items": {"type": "string"}},
        },
        "required": ["page_summary", "proposed_checks", "open_questions"],
        "additionalProperties": False,
    },
}

_STEP_FIELDS = {
    "element_key": {"type": "string", "minLength": 1, "maxLength": 200},
    "target_description": {"type": "string", "minLength": 1, "maxLength": 1000},
    "url": {"type": "string", "minLength": 1, "maxLength": 4000},
    "value": {"type": "string", "maxLength": 4000},
    "wait_ms": {"type": "integer", "minimum": 0, "maximum": 3000},
}

_STEP_SCHEMA = {
    "oneOf": [
        {
            "type": "object",
            "properties": {
                "operation": {"const": operation},
                **{field: _STEP_FIELDS[field] for field in sorted(fields)},
                **({"target_description": _STEP_FIELDS["target_description"]} if operation != "navigate" else {}),
                "wait_ms": _STEP_FIELDS["wait_ms"],
            },
            "required": ["operation", *sorted(fields - {"element_key"})],
            **({"anyOf": [{"required": ["element_key"]}, {"required": ["target_description"]}]}
               if operation != "navigate" else {}),
            "additionalProperties": False,
        }
        for operation, fields in REQUIRED_FIELDS.items()
    ]
}

_SCENARIO_SCHEMA = {
    "type": "object",
    "properties": {
        "scenario_id": {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,64}$"},
        "proposal_index": {"type": "integer", "minimum": 0},
        "title": {"type": "string"},
        "family": {"type": "string", "enum": list(FAMILIES)},
        "expected": {"type": "string"},
        "expected_source": {"type": "string"},
        "steps": {"type": "array", "maxItems": 20, "items": _STEP_SCHEMA},
    },
    "required": ["scenario_id", "proposal_index", "title", "family",
                 "expected", "expected_source", "steps"],
    "additionalProperties": False,
}

_UNPLANNED_SCHEMA = {
    "type": "object",
    "properties": {
        "proposal_index": {"type": "integer", "minimum": 0},
        "reason": {"type": "string"},
    },
    "required": ["proposal_index", "reason"],
    "additionalProperties": False,
}

PLAN_TOOL = {
    "name": "executable_test_plan",
    "description": "Turn proposed checks into executable scenarios or mark them unplanned.",
    "input_schema": {
        "type": "object",
        "properties": {
            "scenarios": {"type": "array", "maxItems": 10, "items": _SCENARIO_SCHEMA},
            "unplanned": {"type": "array", "maxItems": 10, "items": _UNPLANNED_SCHEMA},
        },
        "required": ["scenarios", "unplanned"],
        "additionalProperties": False,
    },
}


PLANNING_TOOL = {
    "name": "qa_test_plan",
    "description": "Propose QA checks and freeze their intended operations and expectations; describe later targets when not yet observed.",
    "input_schema": {
        "type": "object",
        "properties": {**PROPOSAL_TOOL["input_schema"]["properties"], **PLAN_TOOL["input_schema"]["properties"]},
        "required": PROPOSAL_TOOL["input_schema"]["required"] + PLAN_TOOL["input_schema"]["required"],
        "additionalProperties": False,
    },
}


def _nonblank(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a nonblank string")


def _allowed_keys(controls):
    items = controls.items() if isinstance(controls, dict) else (
        (c.get("element_key", c.get("key")) if isinstance(c, dict) else None, c)
        for c in (controls or []))
    keys = set()
    for key, control in items:
        ctype = control.get("type") if isinstance(control, dict) else None
        if isinstance(key, str) and str(ctype or "").lower() not in FORBIDDEN_CONTROL_TYPES:
            keys.add(key)
    return keys


def _allowed_urls(links, page_url):
    urls = set()
    for link in links or []:
        url = (link.get("url") or link.get("href")) if isinstance(link, dict) else None
        if isinstance(url, str) and url:
            url = urljoin(page_url, url)
            if same_origin(url, page_url):
                urls.add(normalize_url(url))
    return urls


def observed_urls(initial):
    observation = (initial or {}).get('observation') or {}
    page_url = (observation.get('page') or {}).get('url', '')
    context = ((initial or {}).get('supplement') or {}).get('action_context') or {}
    return _allowed_urls([*(observation.get('links') or []),
                          *(observation.get('controls') or []), *(context.get('controls') or []),
                          *((initial.get('supplement') or {}).get('target_controls') or [])], page_url)


def _check_step(step, label, keys, urls):
    op = step["operation"]
    present = set(step) - {"operation", "wait_ms", "target_description"}
    required = REQUIRED_FIELDS[op] - {"element_key"}
    if not required <= present or present - REQUIRED_FIELDS[op]:
        raise ValueError(f"{label}: invalid fields for {op}")
    if op != "navigate" and not (step.get("element_key") or step.get("target_description")):
        raise ValueError(f"{label}: an observed key or target_description is required")
    if "target_description" in step:
        _nonblank(step["target_description"], f"{label}.target_description")
    if "element_key" in step and step["element_key"] not in keys:
        raise ValueError(f"{label}: element_key is not an allowed observed control")
    if op == "press" and step["value"] not in PRESS_KEYS:
        raise ValueError(f"{label}: press value must be one of {list(PRESS_KEYS)}")
    if op == "navigate":
        url = step["url"]
        _nonblank(url, f"{label}.url")
        if normalize_url(url) not in urls:
            raise ValueError(f"{label}: url is not an observed same-origin link")


def validate_plan(plan, proposals, initial, max_actions):
    """Validate a plan against proposals and the initial observation; return a copy."""
    if isinstance(max_actions, bool) or not isinstance(max_actions, int) or max_actions < 0:
        raise ValueError("max_actions must be a non-negative integer")
    if isinstance(proposals, dict):
        jsonschema.validate(proposals, PROPOSAL_TOOL["input_schema"])
        proposals = proposals["proposed_checks"]
    if not isinstance(proposals, list) or len(proposals) > 10 or not all(isinstance(p, str) for p in proposals):
        raise ValueError("proposals must be a list or a scenario_proposals object")
    jsonschema.validate(plan, PLAN_TOOL["input_schema"])
    observation = (initial or {}).get("observation") or {}
    page = observation.get("page") or {}
    snapshot_id, page_url = page.get("snapshot_id"), page.get("url")
    _nonblank(snapshot_id, "initial.observation.page.snapshot_id")
    _nonblank(page_url, "initial.observation.page.url")
    keys = _allowed_keys(observation.get('controls'))
    keys.update(_allowed_keys((initial.get('supplement') or {}).get('target_controls')))
    urls = observed_urls(initial)
    count = len(proposals)

    planned, ids, total = set(), set(), 0
    for i, sc in enumerate(plan["scenarios"]):
        label = f"scenarios[{i}]"
        for field in ("scenario_id", "title", "expected", "expected_source"):
            _nonblank(sc[field], f"{label}.{field}")
        if sc["scenario_id"] in ids:
            raise ValueError(f"{label}: duplicate scenario_id")
        ids.add(sc["scenario_id"])
        if sc["proposal_index"] >= count:
            raise ValueError(f"{label}: proposal_index out of range")
        planned.add(sc["proposal_index"])
        if sc["family"] != "ui" and not sc["steps"]:
            raise ValueError(f"{label}: non-ui scenarios need at least one step")
        for j, step in enumerate(sc["steps"]):
            _check_step(step, f"{label}.steps[{j}]", keys, urls)
        total += len(sc["steps"])
    if total > max_actions:
        raise ValueError(f"total steps {total} exceed max_actions {max_actions}")

    unplanned = set()
    for i, item in enumerate(plan["unplanned"]):
        idx = item["proposal_index"]
        _nonblank(item["reason"], f"unplanned[{i}].reason")
        if idx >= count:
            raise ValueError(f"unplanned[{i}]: proposal_index out of range")
        if idx in unplanned or idx in planned:
            raise ValueError(f"unplanned[{i}]: proposal {idx} already accounted for")
        unplanned.add(idx)
    missing = set(range(count)) - planned - unplanned
    if missing:
        raise ValueError(f"proposals not accounted for: {sorted(missing)}")

    result = copy.deepcopy(plan)
    result["schema_version"] = SCHEMA_VERSION
    result["initial_snapshot_id"] = snapshot_id
    return result
