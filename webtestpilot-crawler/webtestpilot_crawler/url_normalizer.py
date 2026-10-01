from __future__ import annotations

import posixpath
import re
from urllib.parse import parse_qsl, quote, urlencode, urldefrag, urljoin, urlsplit, urlunsplit

from .config import QueryParamPolicy

_UUID = re.compile(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_DATE = re.compile(r"^(?:19|20)\d{2}(?:[-_/](?:0?[1-9]|1[0-2])(?:[-_/](?:0?[1-9]|[12]\d|3[01]))?)?$")
_NUMBER = re.compile(r"^\d+$")


# 생략된 포트를 스킴의 기본 포트로 환산한다.
def _effective_port(scheme: str, port: int | None) -> int:
    if port is not None:
        return port
    return 443 if scheme == "https" else 80


# URL을 동일 출처 비교용 (스킴, 호스트, 포트) 튜플로 바꾼다.
def origin(url: str) -> tuple[str, str, int]:
    parsed = urlsplit(url)
    return parsed.scheme.casefold(), (parsed.hostname or "").casefold(), _effective_port(parsed.scheme, parsed.port)


# 두 URL이 같은 출처인지 확인하며 잘못된 포트는 안전하게 거부한다.
def same_origin(left: str, right: str) -> bool:
    try:
        return origin(left) == origin(right)
    except (ValueError, UnicodeError):
        return False


# 상대 URL과 쿼리 정책을 반영해 중복 제거에 쓸 안정적인 URL로 정규화한다.
def normalize_url(
    url: str,
    *,
    base_url: str | None = None,
    policy: QueryParamPolicy | None = None,
) -> str | None:
    """Return a stable URL key while preserving meaningful query parameters."""

    policy = policy or QueryParamPolicy()
    absolute = urljoin(base_url, url) if base_url else url
    absolute, _ = urldefrag(absolute)
    parsed = urlsplit(absolute)
    scheme = parsed.scheme.casefold()
    if scheme not in {"http", "https"} or not parsed.hostname:
        return None

    host = parsed.hostname.casefold()
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    default_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    display_host = f"[{host}]" if ":" in host else host
    netloc = display_host if port is None or default_port else f"{display_host}:{port}"

    raw_path = parsed.path or "/"
    # Decode is intentionally avoided: encoded slashes must not become path separators.
    normalized_path = posixpath.normpath(raw_path)
    if not normalized_path.startswith("/"):
        normalized_path = "/" + normalized_path
    if raw_path.endswith("/") and normalized_path != "/":
        normalized_path += "/"
    normalized_path = quote(normalized_path, safe="/%:@!$&'()*+,;=-._~")

    query_pairs = [
        (name, value)
        for name, value in parse_qsl(parsed.query, keep_blank_values=True)
        if policy.should_keep(name)
    ]
    query_pairs.sort(key=lambda item: (item[0].casefold(), item[1]))
    query = urlencode(query_pairs, doseq=True)
    return urlunsplit((scheme, netloc, normalized_path, query, ""))


# 날짜·숫자 ID·UUID를 묶어 무한 URL 패턴을 제한할 경로 그룹을 만든다.
def path_family(url: str) -> str:
    """Group dates, numeric IDs and UUIDs so infinite URL sequences can be capped."""

    parsed = urlsplit(url)
    parts: list[str] = []
    for segment in parsed.path.split("/"):
        if _UUID.fullmatch(segment):
            parts.append("{uuid}")
        elif _DATE.fullmatch(segment):
            parts.append("{date}")
        elif _NUMBER.fullmatch(segment):
            parts.append("{n}")
        else:
            parts.append(segment.casefold())

    query_names = sorted({name.casefold() for name, _ in parse_qsl(parsed.query, keep_blank_values=True)})
    query_shape = "&".join(f"{name}={{value}}" for name in query_names)
    suffix = f"?{query_shape}" if query_shape else ""
    return f"{parsed.scheme.casefold()}://{parsed.netloc.casefold()}{'/'.join(parts)}{suffix}"
