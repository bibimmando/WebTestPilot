"""WebTestPilot safety controls.

Modes:
- safe (default, real sites): navigation allowed; form submission only for
  search and login; destructive/payment/submit-like actions blocked; robots.txt
  must be loaded explicitly or URLs are rejected; unknown risk is denied.
- sandbox (local fault-injected app): all in-scope actions allowed; robots.txt
  is optional. Scope and /__* exclusion still apply.
- permitted (authorized sites): like safe, plus low-risk active checks
  (e.g. S-07, S-08) and generic low-risk form submissions; destructive and
  payment actions remain blocked; robots.txt is honored if loaded.
Logout is classified separately so the crawler can defer it (S-06).
"""
from __future__ import annotations

import asyncio
import fnmatch
import math
import re
import time
from dataclasses import dataclass, field
from typing import Any, Mapping
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

MODES = ("safe", "sandbox", "permitted")
LOW_RISK_CHECKS = frozenset({"S-07", "S-08"})

_DESTRUCTIVE = re.compile(
    r"delete|remove|destroy|drop|erase|purge|wipe|unsubscribe|deactivate|"
    r"close\s*account|cancel\s*(order|subscription)|\bpay\b|payment|checkout|"
    r"purchase|\bbuy\b|order\s*now|place\s*order|withdraw|transfer|donate|"
    r"\bsend\b|publish|post\s*comment|reset|삭제|결제|구매|주문|탈퇴|해지|전송|송금|초기화",
    re.I)
_LOGOUT = re.compile(r"log\s*out|sign\s*out|logoff|로그아웃", re.I)
_LOGIN = re.compile(r"log\s*in|sign\s*in|signin|login|로그인", re.I)
_SEARCH = re.compile(r"search|find|query|검색|찾기", re.I)
_NAV = re.compile(r"next|prev|more|view|open|details|menu|home|back|page|다음|이전|더보기|보기", re.I)


@dataclass(frozen=True)
class Decision:
    allowed: bool
    reason: str
    risk: str = "unknown"


@dataclass
class _OriginPacer:
    interval: float
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    next_at: float = 0.0


# URL의 출처(scheme://host:port)를 정규화하여 반환한다
def origin_of(url: str) -> str:
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not parts.hostname:
        raise ValueError(f"not an http(s) URL: {url!r}")
    port = parts.port or (443 if scheme == "https" else 80)
    return f"{scheme}://{parts.hostname.lower()}:{port}"


class SafetyGuard:
    # 가드를 모드·범위·속도 제한 설정으로 초기화한다
    def __init__(self, start_url: str, mode: str = "safe",
                 allowed_paths: list[str] | None = None,
                 extra_origins: list[str] | None = None,
                 rate_per_sec: float = 2.0, user_agent: str = "WebTestPilot") -> None:
        if mode not in MODES:
            raise ValueError(f"unknown mode {mode!r}; expected one of {MODES}")
        if not math.isfinite(rate_per_sec) or rate_per_sec <= 0:
            raise ValueError("rate_per_sec must be positive and finite")
        self.mode = mode
        self.origins = {origin_of(start_url)}
        for o in extra_origins or []:
            self.origins.add(origin_of(o))
        self.allowed_paths = list(allowed_paths or ["/*"])
        self.interval = 1.0 / rate_per_sec
        self.user_agent = user_agent
        self._robots: dict[str, RobotFileParser] = {}
        self._pacers: dict[str, _OriginPacer] = {}

    # 주어진 robots.txt 문자열을 해당 출처의 정책으로 등록한다
    def load_robots(self, origin_url: str, robots_txt: str) -> None:
        parser = RobotFileParser()
        parser.parse(robots_txt.splitlines())
        parser.modified()
        self._robots[origin_of(origin_url)] = parser

    # URL이 범위·제외 경로·robots 정책을 만족하는지 판단한다
    def check_url(self, url: str) -> Decision:
        try:
            origin = origin_of(url)
        except ValueError as exc:
            return Decision(False, str(exc), "scope")
        if origin not in self.origins:
            return Decision(False, f"cross-origin URL {origin} not allowed", "scope")
        path = urlsplit(url).path or "/"
        if path.startswith("/__"):
            return Decision(False, "evaluation route /__* is always excluded", "scope")
        if not any(fnmatch.fnmatchcase(path, p) for p in self.allowed_paths):
            return Decision(False, f"path {path} outside allowed patterns", "scope")
        robots = self._robots.get(origin)
        if robots is None:
            if self.mode == "safe":
                return Decision(False, "robots.txt not loaded for origin (safe mode)", "policy")
        elif self.mode != "sandbox" and not robots.can_fetch(self.user_agent, url):
            return Decision(False, "disallowed by robots.txt", "policy")
        return Decision(True, "URL in scope", "low")

    # 라벨·역할·속성으로 컨트롤의 위험 분류를 결정한다
    def classify(self, action: Mapping[str, Any]) -> str:
        attrs = action.get("attributes") or {}
        pieces = [str(action.get("label") or ""), str(action.get("role") or "")]
        for key in ("id", "name", "class", "value", "aria-label", "title",
                    "action", "href", "formaction", "type", "method", "data-action"):
            if attrs.get(key):
                pieces.append(str(attrs[key]))
        text = " ".join(pieces)
        if _DESTRUCTIVE.search(text):
            return "destructive"
        if _LOGOUT.search(text):
            return "logout"
        if _LOGIN.search(text) or str(attrs.get("type", "")).lower() == "password" \
                or action.get("has_password_field"):
            return "login"
        if _SEARCH.search(text) or str(action.get("role", "")).lower() == "search" \
                or str(attrs.get("type", "")).lower() == "search":
            return "search"
        kind = str(action.get("kind", "")).lower()
        role = str(action.get("role", "")).lower()
        if kind == "navigate" or role == "link" or (attrs.get("href") and kind != "submit"):
            return "navigation"
        if kind == "click" and _NAV.search(text):
            return "navigation"
        if kind == "submit" or str(attrs.get("type", "")).lower() == "submit":
            return "form_submit"
        return "unknown"

    # 액션을 모드에 따라 허용할지 결정하고 사유를 반환한다
    def allow_action(self, action: Mapping[str, Any]) -> Decision:
        url = action.get("url")
        if not url:
            return Decision(False, "action URL is required", "scope")
        scoped = self.check_url(str(url))
        if not scoped.allowed:
            return scoped
        attrs = action.get("attributes") or {}
        target = attrs.get("href") or attrs.get("formaction")
        if target:
            target_decision = self.check_url(urljoin(str(url), str(target)))
            if not target_decision.allowed:
                return target_decision
        check = action.get("check")
        if check:
            if self.mode == "sandbox":
                return Decision(True, f"active check {check} allowed in sandbox", "active")
            if self.mode == "permitted" and check in LOW_RISK_CHECKS:
                return Decision(True, f"low-risk active check {check} permitted", "active")
            return Decision(False, f"active check {check} not allowed in {self.mode} mode", "active")
        risk = self.classify(action)
        if self.mode == "sandbox":
            return Decision(True, "sandbox mode allows all actions", risk)
        if risk == "destructive":
            return Decision(False, "destructive/payment/send action blocked", risk)
        if risk == "logout":
            if action.get("final_phase"):
                return Decision(True, "logout allowed in final phase (S-06)", risk)
            return Decision(False, "logout deferred until final phase", risk)
        if risk in ("navigation", "search", "login"):
            return Decision(True, f"{risk} action allowed", risk)
        if risk == "form_submit" and self.mode == "permitted":
            return Decision(True, "low-risk form submit allowed in permitted mode", risk)
        if risk == "form_submit":
            return Decision(False, "safe mode allows only search/login submissions", risk)
        return Decision(False, "uncertain risk; denied by default", risk)

    # 출처별 공유 스케줄로 요청 간격을 지키도록 대기한다
    async def pace(self, url: str) -> None:
        decision = self.check_url(url)
        if not decision.allowed:
            raise ValueError(decision.reason)
        origin = origin_of(url)
        pacer = self._pacers.get(origin)
        if pacer is None:
            pacer = self._pacers.setdefault(origin, _OriginPacer(self.interval))
        async with pacer.lock:
            now = time.monotonic()
            wait = pacer.next_at - now
            pacer.next_at = max(now, pacer.next_at) + pacer.interval
        if wait > 0:
            await asyncio.sleep(wait)


__all__ = ["SafetyGuard", "Decision", "MODES", "origin_of"]
