"""Select compact, evidence-based candidates for later Playwright and AI review.

This module only reads crawler JSON. It does not visit URLs or perform actions.
Scores estimate the value of *additional verification*, not the chance of a bug.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

# Allow direct script execution as well as python -m from the project root.
if __package__ in {None, ""}:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from typing import Any
from urllib.parse import parse_qsl, urlsplit

from src.preprocessing.crawler import parameterized_path


STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
RISK_TERMS = (
    "delete", "remove", "withdraw", "payment", "purchase", "refund", "logout",
    "삭제", "탈퇴", "결제", "구매", "환불", "로그아웃", "제출", "신고",
)
LOW_VALUE_LABELS = ("닫기", "접기", "펼치기", "메뉴", "close", "toggle", "menu")
FRAMEWORK_NAMES = {
    "__viewstate", "__viewstategenerator", "__eventvalidation", "__eventtarget",
    "__eventargument", "__requestverificationtoken",
}


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme and parts.netloc else ""


def _path_and_queries(url_or_pattern: str) -> tuple[str, frozenset[str]]:
    parts = urlsplit(url_or_pattern)
    return parts.path or "/", frozenset(name for name, _ in parse_qsl(parts.query, keep_blank_values=True))


def _form_key(form: dict[str, Any]) -> tuple[str, str, str, frozenset[str]]:
    action = form.get("action", "")
    method = form.get("method", "GET").upper()
    path, names = _path_and_queries(action)
    path, _, _ = parameterized_path(path)
    if method == "GET":
        names = names | frozenset(field.get("name", "") for field in form.get("fields", []) if field.get("name"))
    return method, _origin(action), path, names


def _function_hint(text: str) -> str:
    words = re.sub(r"([a-z])([A-Z])", r"\1 \2", text).lower()
    terms = set(re.findall(r"[a-z]+", words))
    if terms & {"login", "signin", "auth", "account"} or "로그인" in text:
        return "authentication"
    if terms & {"search", "find", "query"} or any(word in text for word in ("검색", "조회")):
        return "search"
    if terms & {"upload", "attach"} or any(word in text for word in ("업로드", "첨부")):
        return "upload"
    if terms & {"apply", "register", "request", "submit"} or any(word in text for word in ("신청", "접수", "제출", "신고")):
        return "submission"
    if terms & {"cart", "basket", "checkout", "order"}:
        return "commerce"
    return "unknown"


def _user_fields(forms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    fields: dict[tuple[str, str], dict[str, Any]] = {}
    for form in forms:
        for field in form.get("fields", []):
            name = field.get("name", "")
            field_type = field.get("type", "text").lower()
            editable = field.get("user_editable")
            if editable is None:  # Older crawler output.
                editable = field_type not in {"hidden", "submit", "button", "reset", "image"} and not field.get("disabled") and not field.get("readonly")
            if not editable or field.get("framework_field") or name.lower() in FRAMEWORK_NAMES:
                continue
            key = (name, field_type)
            if key not in fields:
                fields[key] = {
                    "name": name.rsplit("$", 1)[-1],
                    "type": field_type,
                    "label": field.get("label", "")[:80],
                    "required": bool(field.get("required")),
                    "constraints": {k: v for k, v in field.get("constraints", {}).items() if k in {"min", "max", "minlength", "maxlength", "pattern", "accept", "multiple"}},
                }
    return list(fields.values())


def _identity(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()[:16]


def _endpoint_candidate(endpoint: dict[str, Any], forms: list[dict[str, Any]]) -> dict[str, Any]:
    method = endpoint.get("method", "GET").upper()
    pattern = endpoint.get("url_pattern", "")
    origin = endpoint.get("origin", "")
    discoveries = set(endpoint.get("discovery_methods", []))
    fields = _user_fields(forms)
    score = 0
    reasons: list[str] = []
    if fields:
        score += 4
        reasons.append("user_input_form:+4")
        if len(fields) >= 3:
            score += 1
            reasons.append("multiple_inputs:+1")
        if any(field["type"] == "file" for field in fields):
            score += 3
            reasons.append("file_upload:+3")
        if any(field["required"] or field["constraints"] for field in fields):
            score += 1
            reasons.append("input_validation:+1")
    elif forms:
        score -= 3
        reasons.append("form_without_user_input:-3")
    if "javascript_network" in discoveries:
        score += 2
        reasons.append("javascript_network_candidate:+2")
    elif "browser_network" in discoveries:
        score += 1
        reasons.append("observed_browser_network:+1")
    hint_text = pattern + " " + " ".join(field["label"] for field in fields)
    hint = _function_hint(hint_text)
    if hint != "unknown":
        score += 2
        reasons.append(f"functional_hint_{hint}:+2")
    parameter_names = [
        name for name in endpoint.get("parameter_schema", {})
        if name.lower() not in FRAMEWORK_NAMES and not name.lower().endswith("$hdpageseq")
    ]
    if parameter_names and not fields:
        score += 1
        reasons.append("request_parameters:+1")
    score = max(0, score)
    risk_text = pattern.lower()
    risk_flags = ["state_change_possible"] if method in STATE_CHANGING_METHODS else []
    if any(term in risk_text for term in RISK_TERMS):
        risk_flags.append("dangerous_keyword")
    if any(form.get("dangerous") for form in forms):
        risk_flags.append("dangerous_form")
    source_pages = endpoint.get("source_pages", [])
    return {
        "id": _identity("endpoint", origin, method, pattern),
        "kind": "endpoint",
        "origin": origin,
        "method": method,
        "url_pattern": pattern,
        "function_hint": hint,
        "priority_score": score,
        "priority_reasons": reasons,
        "execution_policy": "review_required" if risk_flags else "read_only_candidate",
        "risk_flags": risk_flags,
        "user_input_count": len(fields),
        "input_fields": fields[:8],
        "input_fields_omitted": max(0, len(fields) - 8),
        "parameter_names": parameter_names[:8],
        "source_pages": source_pages[:3],
        "source_page_count": len(source_pages),
        "discovery_methods": sorted(discoveries),
        "origin_known": bool(origin),
    }


def _interaction_candidate(group: dict[str, Any]) -> dict[str, Any]:
    action = group["action"]
    label = action.get("label", "").strip()[:160]
    hint = action.get("action_hint", "interaction_candidate")
    ui_hint = action.get("ui_state_hint", "").lower()
    score = 0
    reasons: list[str] = []
    if hint == "user_input":
        score += 4
        reasons.append("user_editable_rendered_input:+4")
        if action.get("required") or action.get("constraints"):
            score += 1
            reasons.append("input_validation:+1")
        if action.get("input_type") == "file":
            score += 3
            reasons.append("file_upload:+3")
    if ui_hint in {"modal", "dialog", "tab", "popup"}:
        score += 3
        reasons.append("ui_state_change_hint:+3")
    elif ui_hint:
        score += 2
        reasons.append("ui_toggle_hint:+2")
    if hint == "javascript_navigation" and action.get("target_url"):
        score += 2
        reasons.append("javascript_navigation:+2")
    elif action.get("has_click_handler"):
        score += 1
        reasons.append("click_handler:+1")
    if label:
        score += 1
        reasons.append("named_control:+1")
    else:
        score -= 2
        reasons.append("unlabeled_control:-2")
    function_hint = _function_hint(label)
    if function_hint != "unknown":
        score += 2
        reasons.append(f"functional_hint_{function_hint}:+2")
    stateful_action = bool(re.search(r"\b(add to (?:basket|cart)|checkout|place order)\b", label.lower()))
    if stateful_action:
        score += 2
        reasons.append("stateful_ui_action:+2")
    if action.get("static_href") and not action.get("has_click_handler") and not ui_hint:
        score -= 2
        reasons.append("ordinary_link:-2")
    if label.lower().startswith(("close", "dismiss")) or (
        function_hint == "unknown" and any(term in label.lower() for term in LOW_VALUE_LABELS)
    ):
        score -= 2
        reasons.append("generic_ui_control:-2")
    score = max(0, score)
    target = action.get("target_url") or action.get("target", "")
    risk_flags = ["unknown_input_effect" if hint == "user_input" else "unknown_click_effect"]
    if stateful_action:
        risk_flags.append("state_change_possible")
    if any(term in (label + " " + target).lower() for term in RISK_TERMS):
        risk_flags.append("dangerous_keyword")
    pages = group["pages"]
    return {
        "id": _identity("interaction", label.lower(), action.get("selector", ""), hint, target),
        "kind": "interaction",
        "label": label,
        "selector": action.get("selector", ""),
        "form_selector": action.get("form_selector", ""),
        "action_hint": hint,
        "ui_state_hint": action.get("ui_state_hint", ""),
        "aria_controls": action.get("aria_controls", ""),
        "target_url": target,
        "static_href": action.get("static_href", ""),
        "function_hint": function_hint,
        "priority_score": score,
        "priority_reasons": reasons,
        "execution_policy": "review_required",
        "risk_flags": risk_flags,
        "source_pages": pages[:3],
        "source_page_count": len(pages),
        "occurrences": group["occurrences"],
    }


def rank(
    data: dict[str, Any], *, max_candidates: int = 50, min_score: int = 3,
    max_per_family: int = 2, include_external: bool = False,
) -> dict[str, Any]:
    """Rank crawler evidence, ignoring any legacy priority_score values."""
    if not isinstance(data.get("endpoints"), list) or not isinstance(data.get("forms"), list):
        raise ValueError("Expected crawler JSON with 'endpoints' and 'forms' arrays")
    allowed_origin = _origin(data.get("start_url", ""))
    form_index: dict[tuple[str, str, str, frozenset[str]], list[dict[str, Any]]] = defaultdict(list)
    for form in data["forms"]:
        form_index[_form_key(form)].append(form)

    candidates: list[dict[str, Any]] = []
    skipped_external = 0
    for endpoint in data["endpoints"]:
        origin = endpoint.get("origin", "")
        if origin and origin != allowed_origin and not include_external:
            skipped_external += 1
            continue
        path, query_names = _path_and_queries(endpoint.get("url_pattern", ""))
        key = (endpoint.get("method", "GET").upper(), origin, path, query_names)
        related_forms = form_index.get(key, [])
        if not origin:  # Crawler output created before origin was added.
            related_forms = [
                form for (method, _, form_path, names), matches in form_index.items()
                if (method, form_path, names) == (key[0], path, query_names)
                for form in matches
            ]
        candidates.append(_endpoint_candidate(endpoint, related_forms))

    grouped_actions: dict[tuple[str, ...], dict[str, Any]] = {}
    skipped_controls = 0
    for action in data.get("dynamic_candidates", []):
        if action.get("reason") == "network_request_candidate" or action.get("action_hint") == "form_submit":
            skipped_controls += 1  # Already represented by an endpoint or form.
            continue
        if action.get("disabled") or action.get("hidden_markup"):
            skipped_controls += 1
            continue
        page = action.get("source_page", "")
        if not include_external and _origin(page) != allowed_origin:
            skipped_controls += 1
            continue
        if action.get("static_href") and not action.get("has_click_handler") and not action.get("ui_state_hint"):
            skipped_controls += 1
            continue
        key = (
            action.get("label", "").strip().lower(), action.get("selector", ""),
            action.get("form_selector", ""), action.get("action_hint", ""),
            action.get("ui_state_hint", ""), action.get("target_url") or action.get("target", ""),
        )
        if key not in grouped_actions:
            grouped_actions[key] = {"action": action, "pages": [], "occurrences": 0}
        group = grouped_actions[key]
        group["occurrences"] += 1
        if page and page not in group["pages"]:
            group["pages"].append(page)
    candidates.extend(_interaction_candidate(group) for group in grouped_actions.values())

    eligible = [candidate for candidate in candidates if candidate["priority_score"] >= min_score]
    eligible.sort(
        key=lambda candidate: (
            -candidate["priority_score"], candidate["kind"],
            candidate.get("origin", ""), candidate.get("url_pattern", ""),
            candidate.get("label", ""), candidate.get("selector", ""),
        )
    )
    selected: list[dict[str, Any]] = []
    family_counts: Counter[tuple[str, ...]] = Counter()
    diversity_skipped = 0
    for candidate in eligible:
        if candidate["kind"] == "endpoint":
            family = (
                "endpoint", candidate.get("origin", ""), candidate["method"],
                urlsplit(candidate["url_pattern"]).path, candidate["function_hint"],
            )
        else:
            family = (
                "interaction", candidate["action_hint"], candidate["ui_state_hint"],
                candidate["label"].lower(),
            )
        if family_counts[family] >= max_per_family:
            diversity_skipped += 1
            continue
        family_counts[family] += 1
        selected.append(candidate)
        if len(selected) == max_candidates:
            break
    return {
        "schema_version": 1,
        "start_url": data.get("start_url", ""),
        "scoring_goal": "value_of_additional_playwright_ai_verification",
        "config": {
            "max_candidates": max_candidates,
            "min_score": min_score,
            "max_per_family": max_per_family,
            "include_external": include_external,
        },
        "metrics": {
            "endpoint_candidates": sum(item["kind"] == "endpoint" for item in candidates),
            "interaction_candidates": sum(item["kind"] == "interaction" for item in candidates),
            "eligible_candidates": len(eligible),
            "selected_candidates": len(selected),
            "selected_by_kind": dict(Counter(item["kind"] for item in selected)),
            "skipped_external_endpoints": skipped_external,
            "skipped_redundant_or_inactive_controls": skipped_controls,
            "skipped_by_family_limit": diversity_skipped,
            "legacy_origin_unknown": sum(item["kind"] == "endpoint" and not item["origin_known"] for item in candidates),
        },
        "candidates": selected,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Rank crawler evidence for Playwright and AI verification")
    parser.add_argument("result", help="crawler JSON, e.g. result.json or legacy rank.json")
    parser.add_argument("-o", "--output", default="ranked_candidates.json")
    parser.add_argument("--top", type=int, default=50, help="maximum candidates to keep")
    parser.add_argument("--min-score", type=int, default=3)
    parser.add_argument("--max-per-family", type=int, default=2, help="maximum selected variants of one function family")
    parser.add_argument("--include-external", action="store_true", help="also rank other origins")
    parser.add_argument("--compact", action="store_true", help="write JSON without indentation")
    args = parser.parse_args()
    if args.top < 1 or args.min_score < 0 or args.max_per_family < 1:
        parser.error("--top and --max-per-family must be positive; --min-score must be nonnegative")
    input_path = Path(args.result)
    output_path = Path(args.output)
    if input_path.resolve() == output_path.resolve():
        parser.error("input and output paths must differ")
    with input_path.open(encoding="utf-8") as file:
        ranked = rank(
            json.load(file), max_candidates=args.top, min_score=args.min_score,
            max_per_family=args.max_per_family, include_external=args.include_external,
        )
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(ranked, file, ensure_ascii=False, indent=None if args.compact else 2, separators=(",", ":") if args.compact else None)
        file.write("\n")
    print(f"Selected {ranked['metrics']['selected_candidates']} candidates from {ranked['metrics']['eligible_candidates']} eligible; wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
