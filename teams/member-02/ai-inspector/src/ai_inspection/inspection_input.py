"""Adapter for the ranked preprocessor JSON contract (schema version 1)."""

from __future__ import annotations

import math
from urllib.parse import urljoin, urlsplit


def _origin(url: str) -> tuple:
    if not isinstance(url, str):
        raise ValueError("URL must be a string")
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Expected an absolute HTTP(S) URL without credentials")
    return parsed.scheme.lower(), parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == "https" else 80)


def select_candidates(data: dict, top: int = 1, candidate_id: str | None = None) -> list[dict]:
    if not isinstance(data, dict) or data.get("schema_version") != 1 or not isinstance(data.get("candidates"), list):
        raise ValueError("Expected ranked schema_version 1 with a candidates array")
    _origin(data.get("start_url", ""))
    if top < 1:
        raise ValueError("--top must be positive")
    seen = set()
    for candidate in data["candidates"]:
        if not isinstance(candidate, dict) or candidate.get("kind") not in {"endpoint", "interaction"}:
            raise ValueError("Each candidate must have kind endpoint or interaction")
        identifier, score = candidate.get("id"), candidate.get("priority_score")
        if not isinstance(identifier, str) or not identifier or identifier in seen:
            raise ValueError("Candidate IDs must be unique nonempty strings")
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score):
            raise ValueError("Each candidate must have a finite numeric priority_score")
        seen.add(identifier)
    if candidate_id is not None:
        selected = [c for c in data["candidates"] if c["id"] == candidate_id]
        if not selected:
            raise ValueError("Requested candidate ID was not found")
        return selected
    return sorted(data["candidates"], key=lambda c: c["priority_score"], reverse=True)[:top]


def entry_url(candidate: dict, start_url: str) -> str:
    """Inspect the source UI, never issue a candidate's POST/API request."""
    scope = _origin(start_url)
    sources = candidate.get("source_pages", [])
    if not isinstance(sources, list) or not all(isinstance(url, str) for url in sources):
        raise ValueError("source_pages must be an array of URL strings")
    sources = [url for url in sources if _origin(url) == scope]
    if not sources:
        raise ValueError("No same-origin source page is available for this candidate")
    if candidate["kind"] == "endpoint" and candidate.get("method", "").upper() == "GET":
        pattern = candidate.get("url_pattern", "")
        if isinstance(pattern, str) and not any(marker in pattern for marker in ("{", "}", "*")):
            target = urljoin(candidate.get("origin") or start_url, pattern)
            if _origin(target) == scope and target in sources:
                return target
    return sources[0]


def compact_candidate(candidate: dict) -> dict:
    """Bound metadata passed to the model; do not forward the entire file."""
    result = {}
    for key in ("id", "kind", "method", "url_pattern", "label", "function_hint", "action_hint", "execution_policy"):
        value = candidate.get(key)
        if isinstance(value, str):
            result[key] = value[:500]
    result["priority_score"] = candidate["priority_score"]
    for key in ("priority_reasons", "risk_flags"):
        values = candidate.get(key, [])
        result[key] = [value[:200] for value in values[:10] if isinstance(value, str)] if isinstance(values, list) else []
    fields = candidate.get("input_fields", [])
    if isinstance(fields, list):
        result["input_fields"] = []
        for field in fields[:8]:
            if isinstance(field, dict):
                result["input_fields"].append({key: field[key][:120] for key in ("name", "type", "label") if isinstance(field.get(key), str)})
    return result
