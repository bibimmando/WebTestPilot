"""Versioned report boundary. This is not an inspection-loop message format."""
from collections import Counter
from copy import deepcopy
import re
from urllib.parse import urlsplit, urlunsplit

from jsonschema import Draft202012Validator


def obj(properties, required=None):
    return {"type": "object", "properties": properties,
            "required": list(properties) if required is None else required,
            "additionalProperties": False}


TEXT = {"type": ["string", "null"], "minLength": 1}
ID = {"type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$"}
IDS = {"type": "array", "items": ID, "uniqueItems": True}


def choice(*values):
    return {"enum": list(values)}


def rows(item):
    return {"type": "array", "items": item}


SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:webtestpilot:report-input:0.1",
    **obj({
        "schema_version": {"const": "wtp.report_input/0.1"},
        "synthetic": {"type": "boolean"},
        "run": obj({"run_id": ID, "site_url": TEXT, "started_at": TEXT,
                    "ended_at": TEXT, "termination_reason": TEXT}),
        "environment": obj({"browser": TEXT, "viewport": TEXT}),
        "checks": rows(obj({"check_id": ID, "page_url": TEXT, "item": TEXT,
                            "status": choice("completed", "incomplete", "not_run", "unknown"),
                            "reason": TEXT, "action_ids": IDS})),
        "actions": rows(obj({"action_id": ID, "description": TEXT,
                             "execution": choice("executed", "not_executed", "unknown"),
                             "inputs": rows(obj({"name": {"type": "string", "minLength": 1},
                                                 "value": TEXT, "sensitive": {"type": "boolean"}}))})),
        "findings": rows(obj({
            "finding_id": ID, "page_url": TEXT, "title": TEXT,
            "category": choice("functional", "validation", "routing", "ui", "unknown"),
            "status": choice("confirmed", "candidate", "review_required", "incomplete", "false_positive", "unknown"),
            "reason": TEXT,
            "expected": obj({"statement": TEXT, "source": TEXT, "source_ref": TEXT}),
            "actual": TEXT, "preconditions": TEXT, "action_ids": IDS,
            "reproduction": obj({"status": choice("reproduced", "not_reproduced", "failed", "not_run", "unknown"),
                                 "reason": TEXT, "action_ids": IDS}),
        })),
        "evidence": rows(obj({"evidence_id": ID, "kind": choice("screenshot", "log"),
                              "path": TEXT, "finding_ids": IDS, "action_ids": IDS,
                              "phase": choice("initial", "reproduction", "unknown"),
                              "share_safe": {"type": "boolean"}, "reason": TEXT})),
        "unknown_reasons": {"type": "object", "additionalProperties": {"type": "string", "minLength": 1}},
    })}


class InputError(ValueError):
    pass


def validate(data):
    errors = sorted(Draft202012Validator(SCHEMA).iter_errors(data), key=lambda e: str(list(e.path)))
    if errors:
        # Do not echo rejected values: they can contain credentials.
        e = errors[0]
        raise InputError(f"Invalid report input at /{'/'.join(map(str, e.path))} ({e.validator})")
    indexes = {}
    for group, key in (("checks", "check_id"), ("actions", "action_id"),
                       ("findings", "finding_id"), ("evidence", "evidence_id")):
        values = [x[key] for x in data[group]]
        if len(values) != len(set(values)):
            raise InputError(f"Duplicate IDs in {group}")
        indexes[group] = set(values)
    for group in ("checks", "findings", "evidence"):
        for row in data[group]:
            if set(row["action_ids"]) - indexes["actions"]:
                raise InputError(f"Unknown action reference in {group}")
    for finding in data["findings"]:
        replay = finding["reproduction"]["action_ids"]
        if set(replay) - indexes["actions"]:
            raise InputError("Unknown reproduction action reference")
        if set(replay) & set(finding["action_ids"]):
            raise InputError("Reproduction requires separate action records")
        if finding["reproduction"]["status"] == "not_run" and replay:
            raise InputError("Not-run reproduction cannot contain attempted actions")
        if finding["reproduction"]["status"] == "reproduced" and not replay:
            raise InputError("Reproduced requires actual reproduction actions")
        if finding["status"] == "confirmed" and not (
                finding["expected"]["statement"] and finding["expected"]["source"]
                and finding["actual"] and finding["reproduction"]["status"] == "reproduced"):
            raise InputError("Confirmed requires expectation, source, observation and reproduction")
    action_index = {a["action_id"]: a for a in data["actions"]}
    for finding in data["findings"]:
        if finding["status"] == "confirmed" and (
                not finding["preconditions"] or not finding["preconditions"].strip()
                or not finding["action_ids"] or any(
                    not action_index[x]["description"] or not action_index[x]["description"].strip()
                    or action_index[x]["execution"] != "executed" for x in finding["action_ids"])):
            raise InputError("Confirmed requires recorded reproduction method and executed initial actions")
        if finding["reproduction"]["status"] == "reproduced" and any(
                action_index[x]["execution"] != "executed" for x in finding["reproduction"]["action_ids"]):
            raise InputError("Reproduced actions must have executed")
    for evidence in data["evidence"]:
        if set(evidence["finding_ids"]) - indexes["findings"]:
            raise InputError("Unknown finding reference in evidence")
    return data


SECRET_NAME = re.compile(r"password|passwd|secret|token|api[ _-]?key|authorization|cookie|session|비밀번호|비밀", re.I)
ASSIGNMENT = re.compile(
    r"(?i)\b(password|passwd|secret|[\w-]*token|api[_-]?key|authorization|cookie|set-cookie|session[\w-]*)"
    r"\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)")


def sanitize(data):
    """Defence in depth; producers must already supply shareable text/images."""
    safe = deepcopy(data)
    secrets = [item["value"] for action in safe["actions"] for item in action["inputs"]
               if item["value"] and (item["sensitive"] or SECRET_NAME.search(item["name"]))]

    def scrub(value):
        if not isinstance(value, str):
            return value
        for secret in sorted(secrets, key=len, reverse=True):
            value = value.replace(secret, "[비밀값 제외]")
        value = re.sub(r"(?i)\bBearer\s+[^\s,;]+", "Bearer [비밀값 제외]", value)
        value = re.sub(r"\bsk-[A-Za-z0-9_-]+", "[비밀값 제외]", value)
        value = re.sub(r"(?im)^(\s*(?:cookie|set-cookie|authorization)\s*:).*$", r"\1 [비밀값 제외]", value)
        value = ASSIGNMENT.sub(lambda m: m[1] + "=[비밀값 제외]", value)

        def clean_url(match):
            try:
                url = urlsplit(match[0])
                return urlunsplit((url.scheme, url.netloc.rsplit('@', 1)[-1], url.path,
                                   "REDACTED" if url.query else "", ""))
            except ValueError:
                return "[URL 비밀값 확인 필요]"
        return re.sub(r"https?://[^\s<>\"]+", clean_url, value)

    structural = {"schema_version", "run_id", "check_id", "action_id", "finding_id", "evidence_id",
                  "action_ids", "finding_ids", "status", "category", "execution", "kind", "phase"}

    def walk(value):
        if isinstance(value, dict):
            return {k: v if k in structural else walk(v) for k, v in value.items()}
        if isinstance(value, list):
            return [walk(v) for v in value]
        return scrub(value)
    safe = walk(safe)
    for action in safe["actions"]:
        for item in action["inputs"]:
            if item["sensitive"] or SECRET_NAME.search(item["name"]):
                item["value"] = "[비밀값 제외]"
    return safe, scrub


def counts(data):
    """Counts refer to unique records, never actions, screenshots or AI prose."""
    statuses = Counter(x["status"] for x in data["findings"])
    return {"pages": len({x["page_url"] for x in data["checks"] if x["page_url"]}),
            "checks": len(data["checks"]),
            "completed": sum(x["status"] == "completed" for x in data["checks"]),
            "incomplete": sum(x["status"] != "completed" for x in data["checks"]),
            "findings": len(data["findings"]), "confirmed": statuses["confirmed"],
            "candidates": statuses["candidate"] + statuses["review_required"] + statuses["unknown"]}
