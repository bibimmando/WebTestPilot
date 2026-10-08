"""A small, safe crawler prototype for WebTestPilot.

The crawler deliberately performs GET requests only.  Forms, JavaScript actions,
and state-changing endpoints are discovered and described, but never submitted.
The output is intended to be the input of a later Playwright/test generation step.
"""

from __future__ import annotations

import argparse
import hashlib
from http.client import HTTPException
import json
import re
import time
from collections import defaultdict, deque
from dataclasses import asdict, dataclass, field
from html.parser import HTMLParser
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree


TRACKING_PARAMETERS = {
    "fbclid",
    "gclid",
    "ref",
    "referrer",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
}
STATIC_EXTENSIONS = {
    ".avi", ".bmp", ".css", ".eot", ".gif", ".ico", ".jpeg", ".jpg",
    ".m4a", ".mov", ".mp3", ".mp4", ".ogg", ".otf", ".png", ".svg",
    ".ttf", ".webm", ".webp", ".woff", ".woff2", ".jfif",
    ".bin", ".csv", ".doc", ".docx", ".pdf", ".ppt", ".pptx",
    ".txt", ".xls", ".xlsx", ".zip",
}
DANGEROUS_WORDS = {
    "delete", "logout", "payment", "purchase", "refund", "remove",
    "terminate", "unsubscribe", "withdraw",
}
INTEGER_RE = re.compile(r"^[+-]?\d+$")
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)
JS_URL_RE = re.compile(
    r"(?:location(?:\.href)?\s*=|location\.assign\s*\(|window\.open\s*\()\s*['\"]([^'\"]+)",
    re.I,
)
FETCH_RE = re.compile(
    r"fetch\s*\(\s*['\"](?P<url>[^'\"]+)['\"](?P<options>[^)]*)\)", re.I | re.S
)
XHR_OPEN_RE = re.compile(
    r"\.open\s*\(\s*['\"](?P<method>GET|POST|PUT|PATCH|DELETE)['\"]\s*,\s*['\"](?P<url>[^'\"]+)['\"]",
    re.I,
)
METHOD_RE = re.compile(r"method\s*:\s*['\"](?P<method>GET|POST|PUT|PATCH|DELETE)['\"]", re.I)
VOID_ELEMENTS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
NON_EDITABLE_INPUT_TYPES = {"hidden", "submit", "button", "reset", "image"}
FRAMEWORK_FIELD_NAMES = {
    "__viewstate", "__viewstategenerator", "__eventvalidation", "__eventtarget",
    "__eventargument", "__requestverificationtoken",
}


def infer_type(value: str) -> str:
    """Infer a compact parameter type without retaining sensitive values."""
    if INTEGER_RE.fullmatch(value):
        return "integer"
    if UUID_RE.fullmatch(value):
        return "uuid"
    if value.lower() in {"true", "false"}:
        return "boolean"
    return "string"


def normalize_url(url: str, base: str | None = None) -> str:
    """Resolve and canonicalize a HTTP(S) URL."""
    absolute = urljoin(base, url) if base else url
    parts = urlsplit(absolute)
    scheme = parts.scheme.lower()
    if scheme not in {"http", "https"}:
        return ""
    hostname = (parts.hostname or "").lower()
    if not hostname:
        return ""
    try:
        port = parts.port
    except ValueError:
        return ""
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        netloc = f"{hostname}:{port}"
    else:
        netloc = hostname
    path = parts.path or "/"
    # Repeated slashes are navigation noise, except for the scheme separator.
    path = quote(re.sub(r"/{2,}", "/", path), safe="/%:@!$&'()*+,;=-._~")
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() not in TRACKING_PARAMETERS
    ]
    query.sort(key=lambda item: (item[0], item[1]))
    return urlunsplit((scheme, netloc, path, urlencode(query, doseq=True), ""))


def is_static_resource(url: str) -> bool:
    path = urlsplit(url).path.lower()
    return any(path.endswith(extension) for extension in STATIC_EXTENSIONS)


def is_dangerous(url_or_text: str) -> bool:
    tokens = set(re.findall(r"[a-z]+", url_or_text.lower()))
    return bool(tokens & DANGEROUS_WORDS)


def parameterized_path(path: str) -> tuple[str, dict[str, str], list[str]]:
    schema: dict[str, str] = {}
    samples: list[str] = []
    result: list[str] = []
    for index, segment in enumerate(path.split("/")):
        decoded = segment
        kind = infer_type(decoded)
        if kind in {"integer", "uuid"}:
            name = f"path_{index}"
            schema[name] = kind
            samples.append(decoded)
            result.append("{" + kind + "}")
        else:
            result.append(segment)
    return "/".join(result) or "/", schema, samples


@dataclass
class InputField:
    name: str
    type: str = "text"
    required: bool = False
    label: str = ""
    placeholder: str = ""
    selector: str = ""
    form_selector: str = ""
    disabled: bool = False
    readonly: bool = False
    user_editable: bool = False
    framework_field: bool = False
    constraints: dict[str, str | bool] = field(default_factory=dict)


@dataclass
class FormInfo:
    source_page: str
    action: str
    method: str
    fields: list[InputField] = field(default_factory=list)
    dangerous: bool = False
    selector: str = ""
    submit_controls: list[str] = field(default_factory=list)
    user_input_count: int = 0
    framework_only: bool = False


@dataclass
class Endpoint:
    method: str
    url_pattern: str
    parameter_schema: dict[str, str]
    origin: str = ""
    source_pages: list[str] = field(default_factory=list)
    sample_values: dict[str, list[str]] = field(default_factory=dict)
    requires_auth: bool = False
    discovery_methods: list[str] = field(default_factory=list)
    response_hashes: list[str] = field(default_factory=list)


@dataclass
class PageResult:
    url: str
    final_url: str
    status: int
    content_type: str
    response_hash: str
    duplicate_of: str | None
    depth: int
    title: str = ""
    links: list[str] = field(default_factory=list)
    forms: list[FormInfo] = field(default_factory=list)
    inputs: list[InputField] = field(default_factory=list)
    dynamic_candidates: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self.forms: list[dict[str, Any]] = []
        self.dynamic: list[dict[str, Any]] = []
        self.inputs: list[InputField] = []
        self._form: dict[str, Any] | None = None
        self._stack: list[dict[str, Any]] = []
        self._root_counts: dict[str, int] = defaultdict(int)
        self._label_for: dict[str, str] = {}
        self._field_ids: dict[str, list[InputField]] = defaultdict(list)
        self._wrapped_fields: list[tuple[InputField, dict[str, Any]]] = []
        self._title = False
        self.title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        parent = self._stack[-1] if self._stack else None
        counts = parent["children"] if parent else self._root_counts
        counts[tag] += 1
        element_id = values.get("id", "")
        if element_id and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", element_id):
            selector = f"#{element_id}"
        else:
            component = f"{tag}:nth-of-type({counts[tag]})"
            selector = f"{parent['selector']} > {component}" if parent else component
        frame: dict[str, Any] = {
            "tag": tag,
            "selector": selector,
            "children": defaultdict(int),
            "text": [],
            "candidate": None,
            "label_for": values.get("for", "") if tag == "label" else "",
        }
        if tag in {"a", "iframe"} and values.get("href" if tag == "a" else "src"):
            self.links.append((values["href" if tag == "a" else "src"], tag))
        if tag == "form":
            self._form = {
                "action": values.get("action", ""),
                "method": values.get("method", "get"),
                "fields": [],
                "selector": selector,
                "submit_controls": [],
            }
            self.forms.append(self._form)
        if tag in {"input", "textarea", "select"}:
            input_type = values.get("type", "text") if tag == "input" else tag
            name = values.get("name", "")
            disabled = "disabled" in values
            readonly = "readonly" in values
            field_info = InputField(
                name=name,
                type=input_type,
                required="required" in values,
                label=values.get("aria-label") or values.get("title", ""),
                placeholder=values.get("placeholder", ""),
                selector=selector,
                form_selector=self._form["selector"] if self._form else "",
                disabled=disabled,
                readonly=readonly,
                user_editable=input_type not in NON_EDITABLE_INPUT_TYPES and not disabled and not readonly and name.lower() not in FRAMEWORK_FIELD_NAMES,
                framework_field=name.lower() in FRAMEWORK_FIELD_NAMES,
                constraints={
                    key: (True if key == "multiple" else values[key])
                    for key in ("min", "max", "minlength", "maxlength", "pattern", "accept", "multiple")
                    if key in values
                },
            )
            self.inputs.append(field_info)
            if self._form is not None:
                self._form["fields"].append(field_info)
            if element_id:
                self._field_ids[element_id].append(field_info)
            for ancestor in reversed(self._stack):
                if ancestor["tag"] == "label":
                    self._wrapped_fields.append((field_info, ancestor))
                    break
        if tag in {"button", "input", "a"} or values.get("role") in {"button", "tab", "menuitem"}:
            event = values.get("onclick", "")
            target = ""
            match = JS_URL_RE.search(event)
            if match:
                target = match.group(1)
            if event or tag == "button" or values.get("role") in {"button", "tab", "menuitem"} or (tag == "input" and values.get("type", "").lower() in {"button", "submit", "image"}):
                ui_state_hint = values.get("data-bs-toggle") or values.get("data-toggle") or values.get("aria-haspopup") or ("tab" if values.get("role") == "tab" else "")
                candidate = {
                    "element": tag,
                    "label": values.get("aria-label") or values.get("value") or values.get("title") or values.get("name", ""),
                    "selector": selector,
                    "form_selector": self._form["selector"] if self._form else "",
                    "target": target,
                    "static_href": values.get("href", ""),
                    "has_click_handler": bool(event),
                    "disabled": "disabled" in values or values.get("aria-disabled", "").lower() == "true",
                    "hidden_markup": "hidden" in values or values.get("aria-hidden", "").lower() == "true",
                    "ui_state_hint": ui_state_hint,
                    "aria_controls": values.get("aria-controls", ""),
                    "reason": "clickable_element",
                    "action_hint": "javascript_navigation" if target else (
                        "form_submit" if self._form and (
                            tag == "button" and values.get("type", "submit").lower() == "submit"
                            or tag == "input" and values.get("type", "").lower() in {"submit", "image"}
                        ) else "interaction_candidate"
                    ),
                }
                self.dynamic.append(candidate)
                frame["candidate"] = candidate
                if self._form and candidate["action_hint"] == "form_submit":
                    self._form["submit_controls"].append(selector)
        if tag == "title":
            self._title = True
        if tag not in VOID_ELEMENTS:
            self._stack.append(frame)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self._stack) - 1, -1, -1):
            if self._stack[index]["tag"] == tag:
                for frame in reversed(self._stack[index:]):
                    self._finish_frame(frame)
                del self._stack[index:]
                break
        if tag == "form":
            self._form = None
        if tag == "title":
            self._title = False

    def handle_data(self, data: str) -> None:
        if self._title:
            self.title_parts.append(data.strip())
        if data.strip():
            inside_field_or_script = any(
                frame["tag"] in {"option", "textarea", "script", "style"}
                for frame in self._stack
            )
            for frame in self._stack:
                if frame["candidate"] is not None or (frame["tag"] == "label" and not inside_field_or_script):
                    frame["text"].append(data)

    def _finish_frame(self, frame: dict[str, Any]) -> None:
        label = re.sub(r"\s+", " ", " ".join(frame["text"])).strip()[:160]
        if frame["candidate"] is not None and not frame["candidate"]["label"]:
            frame["candidate"]["label"] = label
        if frame["tag"] == "label" and frame["label_for"] and label:
            self._label_for[frame["label_for"]] = label

    def finish(self) -> None:
        """Resolve labels after the entire document has been parsed."""
        for frame in reversed(self._stack):
            self._finish_frame(frame)
        for field_id, label in self._label_for.items():
            for field_info in self._field_ids[field_id]:
                if not field_info.label:
                    field_info.label = label
        for field_info, frame in self._wrapped_fields:
            if not field_info.label:
                field_info.label = re.sub(r"\s+", " ", " ".join(frame["text"])).strip()[:160]


class Crawler:
    def __init__(
        self,
        start_url: str,
        *,
        max_depth: int = 3,
        max_pages: int = 100,
        timeout: float = 10.0,
        delay: float = 0.0,
        max_response_bytes: int = 2_000_000,
        include_sitemap: bool = True,
        user_agent: str = "WebTestPilot-MVP/1.0",
    ) -> None:
        self.start_url = normalize_url(start_url)
        if not self.start_url:
            raise ValueError("start_url must be an absolute HTTP(S) URL")
        self.allowed_host = urlsplit(self.start_url).hostname
        self.max_depth = max_depth
        self.max_pages = max_pages
        self.timeout = timeout
        self.delay = delay
        self.max_response_bytes = max_response_bytes
        self.include_sitemap = include_sitemap
        self.user_agent = user_agent
        self.pages: list[PageResult] = []
        self.forms: list[FormInfo] = []
        self.dynamic_candidates: list[dict[str, Any]] = []
        self.blocked: list[dict[str, str]] = []
        self.external_urls: set[str] = set()
        self.discovered_urls: set[str] = set()
        self._endpoints: dict[tuple[Any, ...], Endpoint] = {}
        self._hash_owner: dict[str, str] = {}
        self._request_count = 0

    def _same_host(self, url: str) -> bool:
        return urlsplit(url).hostname == self.allowed_host

    def _fetch(self, url: str) -> tuple[str, int, str, bytes]:
        if self.delay and self._request_count:
            time.sleep(self.delay)
        request = Request(url, headers={"User-Agent": self.user_agent, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1"})
        self._request_count += 1
        with urlopen(request, timeout=self.timeout) as response:
            final_url = normalize_url(response.geturl())
            status = getattr(response, "status", 200)
            content_type = response.headers.get_content_type()
            data = response.read(self.max_response_bytes + 1)
            if len(data) > self.max_response_bytes:
                data = data[: self.max_response_bytes]
            return final_url, status, content_type, data

    def _add_endpoint(
        self,
        url: str,
        source: str,
        method: str = "GET",
        discovery_method: str = "static_link",
        body_fields: Iterable[InputField] = (),
        response_hash: str = "",
    ) -> None:
        parts = urlsplit(url)
        pattern_path, schema, path_samples = parameterized_path(parts.path)
        sample_values: dict[str, list[str]] = defaultdict(list)
        for name, value in parse_qsl(parts.query, keep_blank_values=True):
            schema[name] = infer_type(value)
            if value not in sample_values[name] and len(sample_values[name]) < 3:
                sample_values[name].append(value)
        for name, value in zip((key for key in schema if key.startswith("path_")), path_samples):
            sample_values[name].append(value)
        for input_field in body_fields:
            if input_field.name:
                schema[input_field.name] = "file" if input_field.type == "file" else "string"
        query_names = sorted(name for name, _ in parse_qsl(parts.query, keep_blank_values=True))
        if method.upper() == "GET":
            query_names = sorted(set(query_names) | {field.name for field in body_fields if field.name})
        pattern = pattern_path
        if query_names:
            pattern += "?" + "&".join(f"{name}={{{schema[name]}}}" for name in query_names)
        origin = f"{parts.scheme}://{parts.netloc}"
        key = (method.upper(), origin, pattern, tuple(sorted(schema.items())))
        endpoint = self._endpoints.get(key)
        if endpoint is None:
            endpoint = Endpoint(method.upper(), pattern, dict(sorted(schema.items())), origin=origin)
            self._endpoints[key] = endpoint
        if source and source not in endpoint.source_pages:
            endpoint.source_pages.append(source)
        if discovery_method not in endpoint.discovery_methods:
            endpoint.discovery_methods.append(discovery_method)
        for name, values in sample_values.items():
            endpoint.sample_values.setdefault(name, [])
            for value in values:
                if value not in endpoint.sample_values[name] and len(endpoint.sample_values[name]) < 3:
                    endpoint.sample_values[name].append(value)
        if response_hash and response_hash not in endpoint.response_hashes:
            endpoint.response_hashes.append(response_hash)

    def _sitemap_urls(self) -> list[str]:
        if not self.include_sitemap:
            return []
        root = urlunsplit((urlsplit(self.start_url).scheme, urlsplit(self.start_url).netloc, "/sitemap.xml", "", ""))
        try:
            _, status, content_type, data = self._fetch(root)
            if status >= 400 or "xml" not in content_type:
                return []
            tree = ElementTree.fromstring(data)
            return [normalize_url(node.text or "") for node in tree.iter() if node.tag.endswith("loc")]
        except (HTTPError, URLError, TimeoutError, OSError, HTTPException, ElementTree.ParseError, ValueError):
            return []

    def crawl(self) -> dict[str, Any]:
        queue: deque[tuple[str, int, str, str]] = deque([(self.start_url, 0, "seed", "")])
        for sitemap_url in self._sitemap_urls():
            if sitemap_url:
                queue.append((sitemap_url, 0, "sitemap", self.start_url))
        visited: set[str] = set()
        while queue and len(self.pages) < self.max_pages:
            url, depth, discovery_method, source = queue.popleft()
            url = normalize_url(url)
            if not url or url in visited:
                continue
            self.discovered_urls.add(url)
            if not self._same_host(url):
                self.external_urls.add(url)
                continue
            if is_static_resource(url):
                self.blocked.append({"url": url, "reason": "static_resource"})
                continue
            if is_dangerous(url):
                self.blocked.append({"url": url, "reason": "dangerous_action"})
                continue
            if depth > self.max_depth:
                self.blocked.append({"url": url, "reason": "max_depth"})
                continue
            visited.add(url)
            try:
                final_url, status, content_type, data = self._fetch(url)
                if not self._same_host(final_url):
                    self.external_urls.add(final_url)
                    self.pages.append(PageResult(url, final_url, status, content_type, "", None, depth))
                    continue
                digest = hashlib.sha256(data).hexdigest()
                duplicate_of = self._hash_owner.get(digest)
                self._hash_owner.setdefault(digest, final_url)
                page = PageResult(url, final_url, status, content_type, digest, duplicate_of, depth)
                self.pages.append(page)
                self._add_endpoint(final_url, source, "GET", discovery_method, response_hash=digest)
                if content_type not in {"text/html", "application/xhtml+xml"} or duplicate_of:
                    continue
                charset_match = re.search(br"charset\s*=\s*['\"]?([\w-]+)", data[:4096], re.I)
                charset = charset_match.group(1).decode("ascii", "ignore") if charset_match else "utf-8"
                try:
                    html = data.decode(charset, "replace")
                except LookupError:
                    html = data.decode("utf-8", "replace")
                parser = _PageParser()
                parser.feed(html)
                parser.finish()
                page.title = " ".join(part for part in parser.title_parts if part).strip()
                page.inputs = parser.inputs
                for raw_link, kind in parser.links:
                    target = normalize_url(raw_link, final_url)
                    if not target:
                        continue
                    page.links.append(target)
                    self.discovered_urls.add(target)
                    self._add_endpoint(target, final_url, discovery_method="iframe" if kind == "iframe" else "static_link")
                    queue.append((target, depth + 1, "iframe" if kind == "iframe" else "static_link", final_url))
                for raw_form in parser.forms:
                    action = normalize_url(raw_form["action"] or final_url, final_url)
                    method = raw_form["method"].upper()
                    form_fields = raw_form["fields"]
                    form = FormInfo(
                        final_url,
                        action,
                        method,
                        form_fields,
                        is_dangerous(action) or method in {"DELETE", "PATCH"},
                        selector=raw_form["selector"],
                        submit_controls=raw_form["submit_controls"],
                        user_input_count=sum(field.user_editable for field in form_fields),
                        framework_only=bool(form_fields) and all(
                            field.framework_field or field.type in {"submit", "button", "reset", "image"}
                            for field in form_fields
                        ),
                    )
                    page.forms.append(form)
                    self.forms.append(form)
                    self._add_endpoint(action, final_url, method, "form", form.fields)
                    if method == "GET" and not form.dangerous:
                        queue.append((action, depth + 1, "form", final_url))
                for candidate in parser.dynamic:
                    enriched = {**candidate, "source_page": final_url}
                    if candidate["target"]:
                        enriched["target_url"] = normalize_url(candidate["target"], final_url)
                    page.dynamic_candidates.append(enriched)
                    self.dynamic_candidates.append(enriched)
                    if candidate["target"]:
                        target = enriched["target_url"]
                        if target:
                            self._add_endpoint(target, final_url, discovery_method="javascript_candidate")
                        if target and not is_dangerous(target):
                            queue.append((target, depth + 1, "javascript_candidate", final_url))
                # Discover simple API calls without executing JavaScript.  They are
                # recorded as endpoints only; non-GET calls are never sent.
                api_calls: list[tuple[str, str]] = []
                for match in FETCH_RE.finditer(html):
                    method_match = METHOD_RE.search(match.group("options"))
                    api_calls.append((method_match.group("method") if method_match else "GET", match.group("url")))
                api_calls.extend((match.group("method"), match.group("url")) for match in XHR_OPEN_RE.finditer(html))
                for method, raw_api_url in api_calls:
                    api_url = normalize_url(raw_api_url, final_url)
                    if not api_url:
                        continue
                    candidate = {
                        "element": "script",
                        "label": "",
                        "target": api_url,
                        "reason": "network_request_candidate",
                        "source_page": final_url,
                        "method": method.upper(),
                    }
                    page.dynamic_candidates.append(candidate)
                    self.dynamic_candidates.append(candidate)
                    self._add_endpoint(api_url, final_url, method, "javascript_network")
                    if method.upper() == "GET" and self._same_host(api_url) and not is_dangerous(api_url):
                        queue.append((api_url, depth + 1, "javascript_network", final_url))
            except HTTPError as exc:
                self.pages.append(PageResult(url, normalize_url(exc.geturl()) or url, exc.code, exc.headers.get_content_type(), "", None, depth, error=str(exc)))
            except (URLError, TimeoutError, OSError, HTTPException, ValueError) as exc:
                message = str(exc) or type(exc).__name__
                self.pages.append(
                    PageResult(
                        url,
                        url,
                        0,
                        "",
                        "",
                        None,
                        depth,
                        error=f"{type(exc).__name__}: {message}",
                    )
                )

        endpoints = sorted(self._endpoints.values(), key=lambda item: (item.origin, item.method, item.url_pattern))
        duplicate_pages = sum(page.duplicate_of is not None for page in self.pages)
        endpoints_by_method: dict[str, int] = defaultdict(int)
        endpoints_by_discovery: dict[str, int] = defaultdict(int)
        for endpoint in endpoints:
            endpoints_by_method[endpoint.method] += 1
            for discovery_method in endpoint.discovery_methods:
                endpoints_by_discovery[discovery_method] += 1
        result = {
            "start_url": self.start_url,
            "config": {
                "max_depth": self.max_depth,
                "max_pages": self.max_pages,
                "timeout": self.timeout,
                "same_host_only": True,
                "safe_get_only": True,
            },
            "metrics": {
                "http_requests": self._request_count,
                "discovered_urls": len(self.discovered_urls),
                "visited_pages": len(self.pages),
                "endpoint_patterns": len(endpoints),
                "endpoints_by_method": dict(sorted(endpoints_by_method.items())),
                "endpoints_by_discovery_method": dict(sorted(endpoints_by_discovery.items())),
                "duplicate_pages": duplicate_pages,
                "failed_pages": sum(page.error is not None for page in self.pages),
                "duplicate_ratio": round(duplicate_pages / len(self.pages), 4) if self.pages else 0.0,
                "dynamic_candidates": len(self.dynamic_candidates),
                "blocked_urls": len(self.blocked),
            },
            "pages": [asdict(page) for page in self.pages],
            "endpoints": [asdict(endpoint) for endpoint in endpoints],
            "forms": [asdict(form) for form in self.forms],
            "dynamic_candidates": self.dynamic_candidates,
            "blocked": self.blocked,
            "external_urls": sorted(self.external_urls),
        }
        return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe static crawler prototype for WebTestPilot")
    parser.add_argument("url", help="absolute HTTP(S) start URL")
    parser.add_argument("-o", "--output", help="write JSON to this file (default: stdout)")
    parser.add_argument("--max-depth", type=int, default=3)
    parser.add_argument("--max-pages", type=int, default=100)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--delay", type=float, default=0.0, help="delay between requests in seconds")
    parser.add_argument("--no-sitemap", action="store_true")
    args = parser.parse_args()
    crawler = Crawler(
        args.url,
        max_depth=max(0, args.max_depth),
        max_pages=max(1, args.max_pages),
        timeout=max(0.1, args.timeout),
        delay=max(0.0, args.delay),
        include_sitemap=not args.no_sitemap,
    )
    output = json.dumps(crawler.crawl(), ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as file:
            file.write(output + "\n")
    else:
        print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
