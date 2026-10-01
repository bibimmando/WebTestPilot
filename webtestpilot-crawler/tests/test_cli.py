from webtestpilot_crawler.cli import build_parser


def test_cli_accepts_local_benchmark_options():
    args = build_parser().parse_args(
        [
            "https://example.com",
            "--benchmark",
            "--benchmark-tokenizer",
            "heuristic",
            "--benchmark-max-content-chars",
            "50000",
        ]
    )

    assert args.benchmark is True
    assert args.benchmark_tokenizer == "heuristic"
    assert args.benchmark_max_content_chars == 50_000
