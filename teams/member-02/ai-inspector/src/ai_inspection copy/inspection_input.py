"""Validate team crawler hybrid JSONL inputs."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlsplit

HYBRID_SCHEMA = "webtestpilot.hybrid-ai-input.v1"
HYBRID_KINDS = {"navigation_failure", "interaction_execution_error", "semantic_test_planning"}


# 전체 JSONL을 검증하고 원래 순서와 물리적 줄 번호를 보존한다.
def load_hybrid_input(path: Path) -> list[dict]:
    records, seen = [], set()
    with Path(path).open(encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                if len(line) > 100_000:
                    raise ValueError("record exceeds the 100000-character input limit")
                record = json.loads(line, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"Invalid JSON constant: {value}")))
                if not isinstance(record, dict) or record.get("schema") != HYBRID_SCHEMA:
                    raise ValueError(f"Expected schema {HYBRID_SCHEMA}")
                identifier = record.get("input_id")
                if not isinstance(identifier, str) or not identifier.strip() or identifier in seen:
                    raise ValueError("input_id must be a unique nonempty string")
                if record.get("kind") not in HYBRID_KINDS:
                    raise ValueError("Unsupported kind")
                _origin(record.get("url"))
                if not isinstance(record.get("payload"), dict):
                    raise ValueError("payload must be an object")
                for key in ("reason", "task"):
                    if key in record and not isinstance(record[key], str):
                        raise ValueError(f"{key} must be a string")
                seen.add(identifier)
                records.append({"line_number": line_number, "record": record})
            except (ValueError, TypeError) as exc:
                raise ValueError(f"Line {line_number}: {exc}") from exc
    return records


# URL을 검증하고 동일 출처 비교에 사용할 정규화 값을 반환한다.
def _origin(url: str) -> tuple:
    if not isinstance(url, str):
        raise ValueError("URL must be a string")
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Expected an absolute HTTP(S) URL without credentials")
    return parsed.scheme.lower(), parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == "https" else 80)
