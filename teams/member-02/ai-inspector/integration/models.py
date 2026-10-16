"""Model transports for WebTestPilot: native Anthropic Messages and Timely (OpenAI-compatible SSE).

Network access uses cancellable HTTPX async streams with a total deadline. No automatic retries.
Errors are sanitized: no keys and no raw provider bodies are included.
"""
from __future__ import annotations

import asyncio
import copy
import json
import math
import os
import httpx
from pathlib import Path
from dotenv import dotenv_values
from typing import Any, Iterable

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
TIMELY_URL = "https://hello.timelygpt.co.kr/api/v2/chat/bridge/openai/chat/completions"
DEFAULT_MODELS = {"anthropic": None, "timely": "anthropic/claude-opus-5.5"}
KEY_ENV = {"anthropic": "ANTHROPIC_API_KEY", "timely": "TIMELYGPT_API_KEY"}
ENV_FILE = Path(__file__).resolve().parent.parent / '.env'
EFFORTS = ("low", "medium", "high")
ACCEPTED_STOPS = {"end_turn", "tool_use", "stop_sequence", "pause_turn"}
CODE_EXECUTION_TOOL = {"type": "code_execution_20250825", "name": "code_execution"}
FINISH_MAP = {"stop": "end_turn", "tool_calls": "tool_use", "function_call": "tool_use",
              "length": "max_tokens", "content_filter": "refusal"}


class ModelError(RuntimeError):
    """Sanitized model failure. Never carries credentials or raw provider bodies."""


def env_value(name: str) -> str | None:
    """Use the same literal .env precedence for credentials and planning options."""
    value = os.environ.get(name)
    if value is None:
        value = dotenv_values(ENV_FILE, encoding='utf-8-sig', interpolate=False).get(name)
    return value.strip() if isinstance(value, str) else None


def _image_url(block: dict) -> str:
    src = block.get("source") or {}
    if src.get("type") == "base64" and src.get("media_type") and src.get("data"):
        return f"data:{src['media_type']};base64,{src['data']}"
    if src.get("type") == "url" and src.get("url"):
        return src["url"]
    raise ModelError("unsupported image source")


def _parts(content: Any) -> list[dict]:
    """Convert native text/image blocks, or a string, to OpenAI content parts."""
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    parts: list[dict] = []
    for block in content or []:
        kind = block.get("type") if isinstance(block, dict) else None
        if kind == "text":
            parts.append({"type": "text", "text": block.get("text", "")})
        elif kind == "image":
            parts.append({"type": "image_url", "image_url": {"url": _image_url(block)}})
        else:
            raise ModelError(f"unsupported content block: {kind}")
    return parts


def to_openai_messages(system: str, messages: list) -> list[dict]:
    """Pure translation of native messages to OpenAI chat messages.

    Tool results become role=tool messages, placed directly after the assistant tool_calls.
    Images from tool results cannot be sent in tool messages, so they are re-attached in a
    following user message and labelled with their tool_use_id. This keeps the image association.
    """
    out: list[dict] = [{"role": "system", "content": system}] if system else []
    for msg in messages:
        role, content = msg.get("role"), msg.get("content")
        if isinstance(content, str):
            out.append({"role": role, "content": content})
            continue
        if role == "assistant":
            text = "".join(b.get("text", "") for b in content if b.get("type") == "text")
            calls = [{"id": b["id"], "type": "function",
                      "function": {"name": b["name"],
                                   "arguments": json.dumps(b.get("input") or {}, ensure_ascii=False)}}
                     for b in content if b.get("type") == "tool_use"]
            item: dict = {"role": "assistant", "content": text or None}
            if calls:
                item["tool_calls"] = calls
            out.append(item)
            continue
        if role != "user":
            raise ModelError(f"unsupported message role: {role}")
        tool_msgs: list[dict] = []
        user_parts: list[dict] = []
        for block in content:
            if block.get("type") != "tool_result":
                user_parts.extend(_parts([block]))
                continue
            inner = _parts(block.get("content", ""))
            text = "\n".join(p["text"] for p in inner if p["type"] == "text")
            images = [p for p in inner if p["type"] == "image_url"]
            if block.get("is_error"):
                text = "[tool error] " + text
            if images:
                text += f"\n[{len(images)} image(s) attached in the following user message]"
            tool_msgs.append({"role": "tool", "tool_call_id": block["tool_use_id"], "content": text})
            if images:
                user_parts.append({"type": "text", "text": f"Images from tool_result {block['tool_use_id']}:"})
                user_parts.extend(images)
        out.extend(tool_msgs)
        if user_parts:
            out.append({"role": "user", "content": user_parts})
    return out


def to_openai_tools(tools: list) -> list[dict]:
    return [{"type": "function", "function": {
        "name": t["name"], "description": t.get("description", ""),
        "parameters": t.get("input_schema") or {"type": "object", "properties": {}}}} for t in tools or []]


def parse_sse(lines: Iterable) -> dict:
    """Accumulate OpenAI SSE chunks: text, indexed tool_call fragments, finish_reason, usage, model."""
    acc: dict = {"text": [], "calls": {}, "finish": None, "usage": {}, "model": None, "done": False}
    for raw in lines:
        line = (raw.decode("utf-8", "replace") if isinstance(raw, bytes) else str(raw)).strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            acc["done"] = True
            break
        try:
            chunk = json.loads(data)
        except ValueError:
            raise ModelError("malformed stream chunk") from None
        if not isinstance(chunk, dict):
            raise ModelError("malformed stream chunk")
        if chunk.get("error"):
            raise ModelError("provider reported a stream error")
        acc["model"] = chunk.get("model") or acc["model"]
        if isinstance(chunk.get("usage"), dict):
            acc["usage"] = chunk["usage"]
        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or {}
            if isinstance(delta.get("content"), str) and delta["content"]:
                acc["text"].append(delta["content"])
            for frag in delta.get("tool_calls") or []:
                call = acc["calls"].setdefault(frag.get("index", 0), {"id": None, "name": "", "arguments": ""})
                if frag.get("id") and not call["id"]:
                    call["id"] = frag["id"]
                fn = frag.get("function") or {}
                if fn.get("name") and fn["name"] != call["name"]:
                    call["name"] += fn["name"]
                if fn.get("arguments"):
                    call["arguments"] += fn["arguments"]
            if choice.get("finish_reason"):
                acc["finish"] = choice["finish_reason"]
    return acc


def usage_from_openai(usage: dict) -> dict:
    usage = usage or {}
    return {"input_tokens": usage.get("prompt_tokens"), "output_tokens": usage.get("completion_tokens")}


def map_stop(acc: dict) -> str | None:
    stop = FINISH_MAP.get(acc["finish"], acc["finish"])
    return "tool_use" if stop == "end_turn" and acc["calls"] else stop


def openai_to_native(acc: dict, stop: str | None, usage: dict, requested_model: str) -> dict:
    """Build a native assistant message. Provider tool_call IDs are kept and never invented."""
    content: list[dict] = []
    text = "".join(acc["text"])
    if text:
        content.append({"type": "text", "text": text})
    for idx in sorted(acc["calls"]):
        call = acc["calls"][idx]
        if not call["id"] or not call["name"]:
            raise ModelError("provider tool call missing id or name")
        try:
            args = json.loads(call["arguments"]) if call["arguments"].strip() else {}
        except ValueError:
            raise ModelError("provider tool call arguments are not valid JSON") from None
        if not isinstance(args, dict):
            raise ModelError("provider tool call arguments must be an object")
        content.append({"type": "tool_use", "id": call["id"], "name": call["name"], "input": args})
    return {"role": "assistant", "content": content, "stop_reason": stop, "usage": usage,
            "model": acc["model"] or requested_model}


def validate_message(msg: Any) -> dict:
    if not isinstance(msg, dict) or msg.get("role") != "assistant" or not isinstance(msg.get("content"), list):
        raise ModelError("malformed model response")
    stop = msg.get("stop_reason")
    if stop == "max_tokens":
        raise ModelError("incomplete response: max_tokens reached")
    if stop not in ACCEPTED_STOPS:
        raise ModelError(f"unsupported stop_reason: {stop}")
    uses = [b for b in msg["content"] if isinstance(b, dict) and b.get("type") == "tool_use"]
    if any(not isinstance(b, dict) for b in msg["content"]):
        raise ModelError("malformed content block")
    for b in uses:
        if not (isinstance(b.get("id"), str) and b["id"] and isinstance(b.get("name"), str)
                and b['name'] and isinstance(b.get("input"), dict)):
            raise ModelError("malformed tool_use block")
    if len({b['id'] for b in uses}) != len(uses):
        raise ModelError('duplicate tool_use id')
    if stop == 'pause_turn':
        container = msg.get('container')
        if uses or not isinstance(container, dict) or not isinstance(container.get('id'), str) or not container['id'].strip():
            raise ModelError('pause_turn requires a reusable container and no client tool call')
    if stop == "tool_use" and not uses:
        raise ModelError("tool_use stop without tool_use block")
    return msg


async def _post(url: str, headers: dict, payload: dict, timeout: float, stream: bool) -> Any:
    async def exchange():
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream('POST', url, headers=headers, json=payload) as resp:
                resp.raise_for_status()
                return [line async for line in resp.aiter_lines()] if stream else await resp.aread()
    try:
        # Total deadline, including a stream that keeps sending small chunks.
        # Cancellation exits both async context managers and closes the connection.
        return await asyncio.wait_for(exchange(), timeout)
    except httpx.HTTPStatusError as exc:
        raise ModelError(f"provider HTTP error {exc.response.status_code}") from None
    except (TimeoutError, httpx.TimeoutException):
        raise ModelError("provider request timed out") from None
    except httpx.RequestError:
        raise ModelError("provider network error") from None
    except OSError:
        raise ModelError("provider connection error") from None


class HTTPModel:
    def __init__(self, provider: str = "timely", model: str | None = None, max_tokens: int = 4000, timeout: float = 60,
                 effort: str | None = None, skill_id: str | None = None, skill_version: str = 'latest'):
        if provider not in DEFAULT_MODELS:
            raise ValueError("provider must be 'timely' or 'anthropic'")
        if effort is not None and effort not in EFFORTS:
            raise ValueError('effort must be low, medium or high')
        if effort is not None and provider != 'anthropic':
            raise ValueError('effort is only supported with the anthropic provider')
        if skill_id is not None:
            if provider != 'anthropic':
                raise ValueError('planning skills require the anthropic provider')
            if not isinstance(skill_id, str) or not skill_id.strip() or len(skill_id) > 200 or any(c.isspace() for c in skill_id):
                raise ValueError('skill_id must be a nonblank ID without whitespace')
            if not isinstance(skill_version, str) or not skill_version.strip() or len(skill_version) > 200 or any(c.isspace() for c in skill_version):
                raise ValueError('skill_version must be a nonblank version without whitespace')
        self.skill_id, self.skill_version = skill_id, skill_version
        self.effort = effort
        if isinstance(max_tokens, bool) or not isinstance(max_tokens, int) or max_tokens < 1:
            raise ValueError('max_tokens must be a positive integer')
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('timeout must be positive and finite')
        self.provider = provider
        self.model = model or DEFAULT_MODELS[provider]
        if not isinstance(self.model, str) or not self.model.strip():
            raise ValueError('supply the model ID available in your provider account')
        self.max_tokens = int(max_tokens)
        self.timeout = float(timeout)
        self.last_usage: dict = {}

    def _key(self) -> str:
        name = KEY_ENV[self.provider]
        key = env_value(name)
        if not key:
            raise ModelError(f"{name} is not set")
        return key

    def _record(self, returned: Any, usage: dict, stop: Any) -> None:
        self.last_usage = {"provider": self.provider, "requested_model": self.model, "returned_model": returned,
                           "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"),
                           "stop_reason": stop}

    def request_options(self, tools: list, container_id: str | None = None) -> dict:
        """Skills are scoped to qa_test_plan, including when a model is shared by stages."""
        options = {'tools': copy.deepcopy(tools)}
        if self.skill_id and len(tools) == 1 and tools[0].get('name') == 'qa_test_plan':
            options['tools'].append(copy.deepcopy(CODE_EXECUTION_TOOL))
            options['container'] = {'skills': [{'type': 'custom', 'skill_id': self.skill_id,
                                                'version': self.skill_version}]}
            if container_id is not None:
                options['container']['id'] = container_id
        elif container_id is not None:
            raise ValueError('container continuation requires a configured planning skill')
        return options

    async def complete(self, system: str, messages: list, tools: list, *, container_id: str | None = None) -> dict:
        self.last_usage = {}
        if self.provider == "anthropic":
            return await self._anthropic(system, messages, tools, container_id)
        if container_id is not None:
            raise ModelError('container continuation is unsupported by this provider')
        return await self._timely(system, messages, tools)

    async def _anthropic(self, system: str, messages: list, tools: list, container_id: str | None = None) -> dict:
        payload: dict = {"model": self.model, "max_tokens": self.max_tokens, "messages": copy.deepcopy(messages)}
        options = self.request_options(tools, container_id)
        if system:
            payload["system"] = system
        if options['tools']:
            payload.update(options)
        if self.effort is not None:
            payload["output_config"] = {"effort": self.effort}
        headers = {"content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": self._key()}
        body = await _post(ANTHROPIC_URL, headers, payload, self.timeout, False)
        try:
            data = json.loads(body)
        except ValueError:
            raise ModelError("malformed provider response") from None
        if not isinstance(data, dict):
            raise ModelError("malformed provider response")
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        self._record(data.get("model"), usage, data.get("stop_reason"))
        if 'container' in payload:
            self.last_usage.update(skill_id=self.skill_id, skill_version=self.skill_version)
        if self.effort is not None:
            self.last_usage["effort"] = self.effort
        details = usage.get("output_tokens_details")
        if isinstance(details, dict) and "thinking_tokens" in details:
            self.last_usage["thinking_tokens"] = details["thinking_tokens"]
        return validate_message({"role": data.get("role"), "content": data.get("content"),
                                 "stop_reason": data.get("stop_reason"), "usage": usage,
                                 "container": data.get('container'),
                                 "model": data.get("model") or self.model})

    async def _timely(self, system: str, messages: list, tools: list) -> dict:
        payload: dict = {"model": self.model, "max_tokens": self.max_tokens, "stream": True,
                         "stream_options": {"include_usage": True},
                         "messages": to_openai_messages(system, messages)}
        if tools:
            payload["tools"] = to_openai_tools(tools)
        headers = {"Content-Type": "application/json", "Accept": "text/event-stream",
                   "Authorization": "Bearer " + self._key()}
        lines = await _post(TIMELY_URL, headers, payload, self.timeout, True)
        acc = parse_sse(lines)
        usage = usage_from_openai(acc["usage"])
        stop = map_stop(acc)
        self._record(acc["model"], usage, stop)
        if stop is None:
            raise ModelError("stream ended without finish_reason")
        if stop == "max_tokens":
            raise ModelError("incomplete response: max_tokens reached")
        return validate_message(openai_to_native(acc, stop, usage, self.model))


class ScriptedModel:
    """Offline model for tests. Returns deep-copied scripted responses, then a final 'finished' text."""

    def __init__(self, responses: list):
        self._responses = [copy.deepcopy(r) for r in responses]
        self.requests: list[dict] = []
        self.last_usage: dict = {}

    async def complete(self, system: str, messages: list, tools: list) -> dict:
        self.requests.append(copy.deepcopy({"system": system, "messages": messages, "tools": tools}))
        if self._responses:
            msg = self._responses.pop(0)
        else:
            msg = {"role": "assistant", "content": [{"type": "text", "text": "finished"}], "stop_reason": "end_turn"}
        msg.setdefault("role", "assistant")
        msg.setdefault("content", [])
        has_tool = any(isinstance(b, dict) and b.get("type") == "tool_use" for b in msg["content"])
        msg.setdefault("stop_reason", "tool_use" if has_tool else "end_turn")
        msg.setdefault("usage", {})
        msg.setdefault("model", "scripted")
        self.last_usage = {"provider": "scripted", "requested_model": "scripted", "returned_model": msg["model"],
                           "input_tokens": msg["usage"].get("input_tokens"),
                           "output_tokens": msg["usage"].get("output_tokens"), "stop_reason": msg["stop_reason"]}
        return validate_message(msg)
