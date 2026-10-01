from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from .config import CrawlConfig, CrawlLimits, QueryParamPolicy
from .crawler import WebTestPilotCrawler


# 명령행 옵션과 기본값을 정의한 인자 파서를 만든다.
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="webtestpilot-crawl",
        description="Crawl an authorized website and separate deterministic findings from AI review candidates.",
    )
    parser.add_argument("url", help="Authorized http(s) URL to crawl")
    parser.add_argument("--output", type=Path, default=Path("crawl-results"))
    parser.add_argument("--headed", action="store_true", help="Show the Chromium window")
    parser.add_argument("--max-pages", type=int, default=50)
    parser.add_argument("--max-depth", type=int, default=3)
    parser.add_argument("--max-actions-per-page", type=int, default=8)
    parser.add_argument("--max-runtime", type=float, default=120.0, help="Seconds")
    parser.add_argument("--max-states-per-url", type=int, default=3)
    parser.add_argument("--max-variants-per-path", type=int, default=6)
    parser.add_argument("--max-ai-candidates", type=int, default=100)
    parser.add_argument(
        "--benchmark",
        action="store_true",
        help="Export raw, standard, and hybrid AI inputs without calling an API",
    )
    parser.add_argument(
        "--benchmark-tokenizer",
        default="auto",
        help="Local tiktoken encoding (default: auto/o200k_base) or heuristic",
    )
    parser.add_argument(
        "--benchmark-max-content-chars",
        type=int,
        default=1_000_000,
        help="Maximum raw HTML and visible-text characters captured per page",
    )
    parser.add_argument("--keep-query-param", action="append", default=[])
    parser.add_argument("--drop-query-param", action="append", default=[])
    parser.add_argument("--drop-unknown-query", action="store_true")
    parser.add_argument(
        "--allow-cross-origin",
        action="store_true",
        help="Allow navigation outside the start origin (disabled by default)",
    )
    parser.add_argument(
        "--allow-risky-interactions",
        action="store_true",
        help="Allow form submits and destructive-looking controls (not recommended)",
    )
    return parser


# 명령행 인자를 크롤 설정으로 변환하고 비동기 크롤을 실행한다.
async def _run(args: argparse.Namespace) -> dict[str, Path]:
    query_policy = QueryParamPolicy(
        keep_names=set(args.keep_query_param),
        ignored_names=QueryParamPolicy().ignored_names | set(args.drop_query_param),
        drop_unknown=args.drop_unknown_query,
    )
    limits = CrawlLimits(
        max_pages=args.max_pages,
        max_depth=args.max_depth,
        max_actions_per_page=args.max_actions_per_page,
        max_runtime_seconds=args.max_runtime,
        max_states_per_url=args.max_states_per_url,
        max_variants_per_path_family=args.max_variants_per_path,
        max_ai_candidates=args.max_ai_candidates,
    )
    config = CrawlConfig(
        start_url=args.url,
        output_dir=args.output.resolve(),
        headless=not args.headed,
        same_origin_only=not args.allow_cross_origin,
        safe_interactions_only=not args.allow_risky_interactions,
        benchmark_mode=args.benchmark,
        benchmark_tokenizer=args.benchmark_tokenizer,
        benchmark_max_content_chars=args.benchmark_max_content_chars,
        query_policy=query_policy,
        limits=limits,
    )
    return await WebTestPilotCrawler(config).run()


# CLI 진입점에서 인자를 읽고 결과 파일 위치를 출력한다.
def main() -> None:
    args = build_parser().parse_args()
    paths = asyncio.run(_run(args))
    print(f"Crawl complete: {paths['summary']}")
    print(f"Full report:    {paths['report']}")
    print(f"AI queue:       {paths['ai_queue']}")
    print(f"AI handoff:     {paths['hybrid_ai_input']}")
    if "comparison_report" in paths:
        print(f"Benchmark:      {paths['comparison_report']}")
        print(f"Token metrics:  {paths['token_comparison']}")
