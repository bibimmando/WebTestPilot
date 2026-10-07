"""Passive, bounded browser observation for JavaScript-rendered crawl results.

No controls are clicked and no forms are submitted. This stage collects the
initial rendered DOM and same-origin fetch/XHR metadata without using an LLM.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

# Allow direct script execution as well as python -m from the project root.
if __package__ in {None, ""}:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from urllib.parse import parse_qsl, urlsplit

from src.preprocessing.crawler import _PageParser, infer_type, is_static_resource, normalize_url, parameterized_path


def _network_endpoint(url: str, method: str, source: str) -> dict:
    parts = urlsplit(url)
    path, schema, _ = parameterized_path(parts.path)
    for name, value in parse_qsl(parts.query, keep_blank_values=True):
        schema[name] = infer_type(value)
    if parts.query:
        path += "?" + "&".join(f"{name}={{{schema[name]}}}" for name in sorted(schema) if name in dict(parse_qsl(parts.query)))
    return {
        "method": method,
        "url_pattern": path,
        "parameter_schema": schema,
        "origin": f"{parts.scheme}://{parts.netloc}",
        "source_pages": [source],
        "sample_values": {},
        "requires_auth": False,
        "discovery_methods": ["browser_network"],
        "response_hashes": [],
    }


def observe(data: dict, *, timeout: float = 15.0, browser_executable: str | None = None) -> dict:
    """Enrich one seed page in a crawler result; leave the source object untouched."""
    from playwright.sync_api import sync_playwright

    result = json.loads(json.dumps(data))
    start = normalize_url(result["start_url"])
    origin = (urlsplit(start).scheme, urlsplit(start).netloc)
    requests: list[tuple[str, str]] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=browser_executable)
        try:
            context = browser.new_context(service_workers="block")
            page = context.new_page()

            def record(request) -> None:
                url = normalize_url(request.url)
                if not url or (urlsplit(url).scheme, urlsplit(url).netloc) != origin:
                    return
                if request.resource_type not in {"fetch", "xhr"} or is_static_resource(url):
                    return
                requests.append((request.method.upper(), url))

            page.on("request", record)
            response = page.goto(start, wait_until="domcontentloaded", timeout=int(timeout * 1000))
            page.wait_for_timeout(1500)
            try:
                page.wait_for_load_state("networkidle", timeout=min(int(timeout * 1000), 4000))
            except Exception:
                pass  # Polling apps may never become idle; snapshot the bounded wait.
            final_url = normalize_url(page.url)
            if (urlsplit(final_url).scheme, urlsplit(final_url).netloc) != origin:
                raise ValueError("Browser navigated outside the starting origin")
            parser = _PageParser()
            parser.feed(page.content())
            parser.finish()

            source_page = next((item for item in result.get("pages", []) if item.get("final_url") == start), None)
            if source_page is None:
                raise ValueError("Seed page not found in crawler JSON")
            source_page["browser_observed"] = True
            source_page["browser_status"] = response.status if response else 0
            source_page["browser_title"] = page.title()
            existing_inputs = {(item.get("selector"), item.get("name")) for item in source_page.get("inputs", [])}
            existing_actions = {(item.get("selector"), item.get("action_hint")) for item in result.get("dynamic_candidates", [])}
            added_inputs = 0
            added_actions = 0
            for field in parser.inputs:
                if not field.user_editable or not field.selector:
                    continue
                try:
                    if not page.locator(field.selector).first.is_visible():
                        continue
                except Exception:
                    continue
                field_data = vars(field).copy()
                key = (field.selector, field.name)
                if key not in existing_inputs:
                    source_page.setdefault("inputs", []).append(field_data)
                    existing_inputs.add(key)
                    added_inputs += 1
                if field.form_selector:
                    continue  # Existing forms are ranked by their endpoint.
                action_key = (field.selector, "user_input")
                if action_key not in existing_actions:
                    selector_label = ""
                    selector_id = re.search(r"#([A-Za-z][\w-]*)", field.selector)
                    if selector_id:
                        selector_label = re.sub(r"([a-z])([A-Z])", r"\1 \2", selector_id.group(1))
                    candidate = {
                        "element": "input", "label": field.label or field.placeholder or field.name or selector_label,
                        "selector": field.selector, "source_page": final_url,
                        "action_hint": "user_input", "reason": "browser_rendered_control",
                        "input_type": field.type, "required": field.required,
                        "constraints": field.constraints,
                        "label_source": "field_metadata" if field.label or field.placeholder or field.name else "selector_id",
                    }
                    result.setdefault("dynamic_candidates", []).append(candidate)
                    source_page.setdefault("dynamic_candidates", []).append(candidate)
                    existing_actions.add(action_key)
                    added_actions += 1

            for action in parser.dynamic:
                if action.get("disabled") or action.get("hidden_markup") or not action.get("selector"):
                    continue
                try:
                    if not page.locator(action["selector"]).first.is_visible():
                        continue
                except Exception:
                    continue
                action_key = (action["selector"], action.get("action_hint"))
                if action_key in existing_actions:
                    continue
                candidate = {**action, "source_page": final_url, "reason": "browser_rendered_control"}
                result.setdefault("dynamic_candidates", []).append(candidate)
                source_page.setdefault("dynamic_candidates", []).append(candidate)
                existing_actions.add(action_key)
                added_actions += 1

            endpoint_keys = {(item.get("origin"), item.get("method"), item.get("url_pattern")) for item in result.get("endpoints", [])}
            added_endpoints = 0
            for method, url in sorted(set(requests)):
                endpoint = _network_endpoint(url, method, final_url)
                key = (endpoint["origin"], method, endpoint["url_pattern"])
                if key not in endpoint_keys:
                    result.setdefault("endpoints", []).append(endpoint)
                    endpoint_keys.add(key)
                    added_endpoints += 1
            result["browser_observation"] = {
                "mode": "initial_page_passive", "pages": 1,
                "added_inputs": added_inputs, "added_actions": added_actions,
                "observed_fetch_xhr_requests": len(requests),
                "added_endpoints": added_endpoints,
                "note": "No clicks or form submissions; initial rendering may itself send app requests.",
            }
            return result
        finally:
            browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Passively observe one JavaScript-rendered seed page")
    parser.add_argument("crawl_result", help="existing static crawler JSON")
    parser.add_argument("-o", "--output", required=True, help="separate enriched JSON path")
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--browser-executable", help="installed Chrome/Edge path; omit for Playwright Chromium")
    args = parser.parse_args()
    source, target = Path(args.crawl_result), Path(args.output)
    if source.resolve() == target.resolve():
        parser.error("input and output paths must differ")
    with source.open(encoding="utf-8") as file:
        data = json.load(file)
    enriched = observe(data, timeout=max(1, args.timeout), browser_executable=args.browser_executable)
    with target.open("w", encoding="utf-8") as file:
        json.dump(enriched, file, ensure_ascii=False, indent=2)
        file.write("\n")
    print(f"Browser evidence: {enriched['browser_observation']}; wrote {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
