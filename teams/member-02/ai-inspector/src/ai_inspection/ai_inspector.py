"""Explicit preparation, evidence analysis or injected shared-tab inspection."""

import argparse
import math
from pathlib import Path

# 직접 파일 실행도 지원하며 유료 호출은 명시적인 분석 모드에서만 수행한다.
if __package__ in {None, ""}:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.ai_inspection.evidence_inspector import inspect_hybrid_input


# 전처리 증거를 준비하거나 명시적 선택에 따라 Claude에 분석 요청한다.
def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Prepare or analyze crawler hybrid JSONL evidence")
    parser.add_argument("--hybrid-input", required=True, help="path to hybrid_ai_input.jsonl")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare-only", action="store_true", help="prepare requests without AI or browser calls")
    mode.add_argument("--analyze", action="store_true", help="explicitly authorize paid Claude API analysis")
    mode.add_argument("--execute", action="store_true", help="authorize paid planning and approved shared-tab actions")
    parser.add_argument("--runtime-factory", help="trusted local module:function creating a RuntimeBinding")
    parser.add_argument("--max-rounds", type=int, default=3)
    parser.add_argument("--max-actions", type=int, default=10)
    parser.add_argument("--max-seconds", type=float, default=60.0)
    parser.add_argument("--limit", type=int, default=1, help="maximum records, in input order (default: 1)")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--tier", choices=["haiku", "sonnet", "opus"], default="haiku")
    parser.add_argument("--model", help="override the configured Claude API model ID")
    parser.add_argument("--max-tokens", type=int, default=1600, help="output token cap per API call")
    parser.add_argument("--api-timeout", type=float, default=60.0, help="API network timeout in seconds")
    args = parser.parse_args(argv)
    if args.limit < 1 or args.max_tokens < 1:
        parser.error("--limit and --max-tokens must be positive")
    if not math.isfinite(args.api_timeout) or args.api_timeout <= 0:
        parser.error("--api-timeout must be finite and positive")
    if args.execute and (not args.runtime_factory or args.runtime_factory.count(":") != 1):
        parser.error("--execute requires --runtime-factory module:function for the prepared shared tab")
    if not args.execute and args.runtime_factory:
        parser.error("--runtime-factory is only supported with --execute")
    factory = None
    config = None
    if args.analyze:
        from src.ai_inspection.claude_client import ClaudeAnalyzer, MODELS
        config = {"provider": "anthropic", "tier": args.tier, "model": args.model or MODELS[args.tier],
                  "max_tokens": args.max_tokens, "api_timeout": args.api_timeout}

        # 입력·출력 검증 후에 키를 읽고 분석기를 생성한다.
        def factory():
            return ClaudeAnalyzer(tier=args.tier, model=args.model, max_tokens=args.max_tokens, timeout=args.api_timeout)

    try:
        if args.execute:
            from src.ai_inspection.inspection_runtime import RuntimeLimits, run_inspection
            limits = RuntimeLimits(args.max_rounds, args.max_actions, args.max_seconds)

            def runtime_factory(context):
                # The CLI integration module is trusted code, never a JSONL/page field.
                import importlib
                from src.ai_inspection.claude_client import ClaudePlanner
                module, name = args.runtime_factory.split(":")
                create = getattr(importlib.import_module(module), name)
                planner = ClaudePlanner(tier=args.tier, model=args.model,
                                        max_tokens=args.max_tokens, timeout=args.api_timeout)
                return create(context=context, planner=planner, output_dir=Path(args.output_dir))

            result = run_inspection(Path(args.hybrid_input), Path(args.output_dir),
                                    runtime_factory=runtime_factory, limit=args.limit, limits=limits)
            incomplete = sum(row["execution_status"] != "completed" for row in result["results"])
            print(f"Mode: execute; processed: {result['processed_count']}/{result['total_records']}; actions: {result['action_count']}; incomplete: {incomplete}; wrote {args.output_dir}/inspection_run.json")
            return 1 if incomplete or result["termination_reason"] != "completed" else 0
        result = inspect_hybrid_input(Path(args.hybrid_input), Path(args.output_dir), limit=args.limit,
                                      analyzer_factory=factory, analysis_config=config)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(f"Mode: {result['mode']}; selected: {result['selected_count']}/{result['total_records']}; analyzer calls: {result['analyzer_calls']}; errors: {result['error_count']}; wrote {args.output_dir}/evidence_batch.json")
    return 1 if result["error_count"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
