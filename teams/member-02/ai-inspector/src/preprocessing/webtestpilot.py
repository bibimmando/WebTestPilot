"""One-command crawl and ranking with a bounded SPA fallback."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

# Allow direct script execution as well as python -m from the project root.
if __package__ in {None, ""}:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from typing import Any, Callable

from src.preprocessing.crawler import Crawler
from src.preprocessing.ranker import rank


def needs_browser_observation(crawl_result: dict[str, Any], ranked: dict[str, Any]) -> bool:
    """A zero-candidate HTML crawl lacks evidence for a useful ranking."""
    pages = crawl_result.get("pages", [])
    return ranked["metrics"]["selected_candidates"] == 0 and any(
        page.get("status", 0) in range(200, 400)
        and page.get("content_type") in {"text/html", "application/xhtml+xml"}
        for page in pages
    )


def run_pipeline(
    crawl_result: dict[str, Any], *,
    observer: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    static_only: bool = False,
    top: int = 50,
    min_score: int = 3,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Rank static evidence and observe one browser page only when needed."""
    ranked = rank(crawl_result, max_candidates=top, min_score=min_score)
    evidence = crawl_result
    mode = "static"
    warning = ""
    if needs_browser_observation(crawl_result, ranked):
        if static_only:
            warning = "No ranked candidates from static HTML; browser fallback was disabled."
        elif observer is None:
            warning = "No ranked candidates from static HTML; browser observer is unavailable."
        else:
            try:
                evidence = observer(crawl_result)
                ranked = rank(evidence, max_candidates=top, min_score=min_score)
                mode = "static_plus_browser_initial_page"
                if ranked["metrics"]["selected_candidates"] == 0:
                    warning = "The initial rendered page still contains no ranked candidates; deeper interaction discovery is needed."
            except Exception as exc:
                warning = f"Browser fallback failed ({type(exc).__name__}: {exc}); static ranking retained."
    ranked["pipeline"] = {
        "mode": mode,
        "browser_pages": evidence.get("browser_observation", {}).get("pages", 0),
        "warning": warning,
        "static_visited_pages": crawl_result.get("metrics", {}).get("visited_pages", len(crawl_result.get("pages", []))),
    }
    return ranked, evidence


def _installed_browser() -> str | None:
    for path in (
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    ):
        if path.is_file():
            return str(path)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Crawl and rank in one command; observe SPA DOM only when necessary")
    parser.add_argument("url", help="HTTP(S) starting URL")
    parser.add_argument("-o", "--output", required=True, help="ranked JSON output")
    parser.add_argument("--max-depth", type=int, default=3)
    parser.add_argument("--max-pages", type=int, default=100)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--delay", type=float, default=0.0)
    parser.add_argument("--no-sitemap", action="store_true")
    parser.add_argument("--static-only", action="store_true", help="disable the one-page browser fallback")
    parser.add_argument("--browser-executable", help="installed Chrome or Edge path")
    parser.add_argument("--save-evidence", help="optionally save crawl/observation JSON")
    parser.add_argument("--top", type=int, default=50)
    parser.add_argument("--min-score", type=int, default=3)
    args = parser.parse_args()
    if args.top < 1 or args.min_score < 0:
        parser.error("--top must be positive and --min-score must be nonnegative")
    output_path = Path(args.output)
    evidence_path = Path(args.save_evidence) if args.save_evidence else None
    if evidence_path and evidence_path.resolve() == output_path.resolve():
        parser.error("ranked output and evidence paths must differ")
    crawler = Crawler(
        args.url, max_depth=max(0, args.max_depth), max_pages=max(1, args.max_pages),
        timeout=max(0.1, args.timeout), delay=max(0.0, args.delay),
        include_sitemap=not args.no_sitemap,
    )
    crawl_result = crawler.crawl()

    def observer(data: dict[str, Any]) -> dict[str, Any]:
        from src.preprocessing.browser_observer import observe
        return observe(data, timeout=max(1, args.timeout), browser_executable=args.browser_executable or _installed_browser())

    ranked, evidence = run_pipeline(
        crawl_result, observer=observer, static_only=args.static_only,
        top=args.top, min_score=args.min_score,
    )
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(ranked, file, ensure_ascii=False, indent=2)
        file.write("\n")
    if evidence_path:
        with evidence_path.open("w", encoding="utf-8") as file:
            json.dump(evidence, file, ensure_ascii=False, indent=2)
            file.write("\n")
    print(f"Mode: {ranked['pipeline']['mode']}; selected: {ranked['metrics']['selected_candidates']}; wrote {output_path}")
    if ranked["pipeline"]["warning"]:
        print(f"Warning: {ranked['pipeline']['warning']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
