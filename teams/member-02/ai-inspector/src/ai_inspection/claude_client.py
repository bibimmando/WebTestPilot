"""A single-call Claude Messages API adapter for inspection plans."""

from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


MODELS = {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-5-5",
    "opus": "claude-opus-5-5",
}


def analysis_schema(control_ids: list[str]) -> dict:
    step = {
        "type": "object", "additionalProperties": False,
        "properties": {
            "action": {"type": "string", "enum": ["click", "fill", "press"]},
            "control_id": {"type": "string", "enum": control_ids} if control_ids else {"type": "string"},
            "value": {"type": ["string", "null"]},
        },
        "required": ["action", "control_id", "value"],
    }
    check = {
        "type": "object", "additionalProperties": False,
        "properties": {
            "check_id": {"type": "string"},
            "category": {"type": "string", "enum": ["functional", "input_validation", "navigation", "ui"]},
            "objective": {"type": "string"},
            "steps": {"type": "array", "items": step},
        },
        "required": ["check_id", "category", "objective", "steps"],
    }
    return {
        "type": "object", "additionalProperties": False,
        "properties": {
            "page_summary": {"type": "string"},
            "proposed_checks": {"type": "array", "items": check},
            "open_questions": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["page_summary", "proposed_checks", "open_questions"],
    }


class ClaudeAnalyzer:
    def __init__(self, *, tier: str = "haiku", model: str | None = None, max_tokens: int = 1600, timeout: float = 60.0):
        self._api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not self._api_key:
            raise ValueError("ANTHROPIC_API_KEY is not set; set it locally or use --observe-only")
        self.model = model or MODELS[tier]
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.last_usage: dict = {}

    def __call__(self, request: dict) -> dict:
        self.last_usage = {}
        content = {"task": request["task"], "page": request["page"]}
        if "candidate" in request:
            content["candidate"] = request["candidate"]
        payload = {
            "model": self.model, "max_tokens": self.max_tokens,
            "system": request["system"],
            "messages": [{"role": "user", "content": json.dumps(content, ensure_ascii=False)}],
            "output_config": {"format": {
                "type": "json_schema",
                "schema": analysis_schema([c["control_id"] for c in request["page"]["controls"]]),
            }},
        }
        api_request = Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-api-key": self._api_key, "anthropic-version": "2023-06-01"},
            method="POST",
        )
        try:
            with urlopen(api_request, timeout=self.timeout) as response:
                data = json.load(response)
        except HTTPError as exc:
            raise RuntimeError(f"Claude API HTTP {exc.code}; check the API key, model availability, and account limits") from None
        except URLError:
            raise RuntimeError("Claude API connection failed") from None
        self.last_usage = {
            "provider": "anthropic", "requested_model": self.model,
            "returned_model": data.get("model"), "message_id": data.get("id"),
            "stop_reason": data.get("stop_reason"), "tokens": data.get("usage", {}),
        }
        if data.get("stop_reason") != "end_turn":
            raise ValueError(f"Claude did not complete a plan: {data.get('stop_reason')}")
        text = "".join(block["text"] for block in data.get("content", []) if block.get("type") == "text")
        return json.loads(text)
