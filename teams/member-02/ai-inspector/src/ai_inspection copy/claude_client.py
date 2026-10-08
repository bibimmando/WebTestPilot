"""A single-call Claude Messages API adapter for hybrid evidence requests."""

from __future__ import annotations

import json
import math
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from src.ai_inspection.env_config import get_anthropic_api_key


MODELS = {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-5-5",
    "opus": "claude-opus-5-5",
}


class ClaudeAPIError(RuntimeError):
    """A safe API failure description, without raw server bodies or credentials."""

    # 결과에 남길 안전한 분류와 HTTP 상태만 보관한다.
    def __init__(self, code: str, message: str, status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


# JSONL의 작업별 비실행 응답 규약을 API용 JSON 스키마로 변환한다.
def analysis_schema(contract: dict) -> dict:
    properties = {}
    for name, specification in contract.items():
        if specification == ["string"]:
            properties[name] = {"type": "array", "items": {"type": "string"}}
        elif specification in {"string", "boolean"}:
            properties[name] = {"type": specification}
        else:
            raise ValueError("Unsupported response contract")
    return {"type": "object", "additionalProperties": False,
            "properties": properties, "required": list(properties)}


class ClaudeAnalyzer:
    # API 접속 설정을 준비하며 생성 자체로 네트워크 호출하지 않는다.
    def __init__(self, *, tier: str = "haiku", model: str | None = None, max_tokens: int = 1600, timeout: float = 60.0):
        if tier not in MODELS or max_tokens < 1 or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("Invalid tier, max_tokens, or timeout")
        if model is not None and not model.strip():
            raise ValueError("Model ID cannot be empty")
        self._api_key = get_anthropic_api_key()
        if not self._api_key:
            raise ValueError("ANTHROPIC_API_KEY is not set; fill the project-root .env or use --prepare-only")
        self.model = model or MODELS[tier]
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.last_usage: dict = {}

    # 명시적으로 호출한 경우에만 증거 요청을 한 번 전송한다.
    def __call__(self, request: dict) -> dict:
        self.last_usage = {}
        content = {key: request[key] for key in ("input_id", "kind", "work_type", "task", "evidence")}
        payload = {
            "model": self.model, "max_tokens": self.max_tokens,
            "system": request["system"],
            "messages": [{"role": "user", "content": json.dumps(content, ensure_ascii=False)}],
            "output_config": {"format": {
                "type": "json_schema",
                "schema": analysis_schema(request["response_contract"]),
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
            raise ClaudeAPIError("http_error", f"Claude API HTTP {exc.code}; check key, model access, and account limits", exc.code) from None
        except URLError:
            raise ClaudeAPIError("connection_error", "Claude API connection failed") from None
        except TimeoutError:
            raise ClaudeAPIError("timeout", "Claude API request timed out; not retried") from None
        except (ValueError, UnicodeError):
            raise ClaudeAPIError("invalid_api_response", "Claude API returned an unreadable response") from None
        if not isinstance(data, dict):
            raise ClaudeAPIError("invalid_api_response", "Expected an API response object")
        self.last_usage = {
            "provider": "anthropic", "requested_model": self.model,
            "returned_model": data.get("model"), "message_id": data.get("id"),
            "stop_reason": data.get("stop_reason"), "tokens": data.get("usage", {}),
        }
        if data.get("stop_reason") != "end_turn":
            raise ClaudeAPIError("incomplete_response", "Claude did not complete the response; inspect ai_usage.stop_reason")
        try:
            text = "".join(block["text"] for block in data.get("content", []) if block.get("type") == "text")
            return json.loads(text)
        except (TypeError, KeyError, ValueError, AttributeError):
            raise ClaudeAPIError("invalid_model_json", "Claude response did not contain valid JSON") from None
