"""Run a real MCP browser locally with mock planning, or explicitly with Claude."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import sys
import threading

INSPECTOR = Path(__file__).resolve().parents[1]
REPO = INSPECTOR.parents[2]
sys.path.insert(0, str(INSPECTOR))

from src.ai_inspection.inspection_runtime import RuntimeLimits, run_inspection
from src.ai_inspection.playwright_mcp_runtime import ScriptedPlanner, create


class QuietHandler(SimpleHTTPRequestHandler):
    # 테스트 서버의 요청·입력값을 콘솔에 출력하지 않는다.
    def log_message(self, *args):
        pass


# 로컬 fixture만 제공하며 검토 가능한 설정·계획·실제 JSON 결과를 남긴다.
def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--planner", choices=["mock", "claude"], default="mock")
    parser.add_argument("--output-dir", default=str(REPO / ".tools/mcp-smoke"))
    parser.add_argument("--mcp-cli", default=str(REPO / ".tools/playwright-mcp/node_modules/@playwright/mcp/cli.js"))
    parser.add_argument("--node", default=shutil.which("node"))
    parser.add_argument("--model", default="claude-haiku-4-5-20251001")
    args = parser.parse_args(argv)
    if not args.node or not Path(args.mcp_cli).is_file():
        parser.error("Install the local MCP server and provide --node/--mcp-cli")
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if args.planner == "claude":
        from src.ai_inspection.claude_client import ClaudePlanner
        # API 호출은 명시적 claude 모드에서만 최대 한 번 수행한다.
        planner = ClaudePlanner(model=args.model, max_tokens=1200, timeout=30)
    else:
        planner = None
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(INSPECTOR / "examples")))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        url = f"http://127.0.0.1:{server.server_port}/mcp_fixture.html"
        record = {"schema": "webtestpilot.hybrid-ai-input.v1", "input_id": "local-mcp-smoke",
                  "kind": "semantic_test_planning", "url": url, "payload": {}}
        source = output / "hybrid_ai_input.jsonl"
        source.write_text(json.dumps(record) + "\n", encoding="utf-8")
        check = {"kind": "text_contains", "value": "typed pilot", "source": "requirement",
                 "evidence_ref": "examples/mcp_fixture.html: Enter echoes the field value"}
        config = {"mcp_command": args.node, "mcp_args": [str(Path(args.mcp_cli).resolve())],
                  "timeout": 20, "controls": {"click": "#click", "field": "#field"},
                  "permissions": {"click": {"actions": ["click"], "values": []},
                                  "field": {"actions": ["fill", "press"], "values": ["pilot", "Enter"]}},
                  "checks": {"echo": check}}
        config_path = output / "runtime.json"
        config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        plans = [{"decision": "act", "check_id": "echo", "steps": [
            {"action": "click", "control_id": "click", "value": ""},
            {"action": "fill", "control_id": "field", "value": "pilot"},
            {"action": "press", "control_id": "field", "value": "Enter"}]}]
        (output / "mock_plan.json").write_text(json.dumps(plans, indent=2) + "\n", encoding="utf-8")
        if planner is None:
            planner = ScriptedPlanner(plans)
        else:
            delegate = planner
            calls = 0
            # 완료 조건이 관찰되면 추가 유료 호출 없이 기존 루프에서 종료한다.
            def planner(request):
                nonlocal calls
                if calls or "typed pilot" in request["context"]["page_observation"].get("text", ""):
                    planner.last_usage = {}
                    return {"decision": "finish", "check_id": "", "steps": []}
                calls += 1
                request["system"] += (" The registered local fixture needs click on click, fill field with pilot, "
                                      "then press Enter on field, in one small plan. Never choose other values.")
                try:
                    return delegate(request)
                finally:
                    planner.last_usage = delegate.last_usage
            planner.last_usage = {}
        result = run_inspection(source, output, runtime_factory=lambda context: create(
            context=context, planner=planner, output_dir=output, config_path=config_path),
            limits=RuntimeLimits(max_seconds=90))
        row = result["results"][0]
        print(f"Planner: {args.planner}; status: {row['execution_status']}; actions: {result['action_count']}; output: {output}")
        passed = any(judgment["status"] == "passed" for judgment in row["judgments"])
        return 0 if row["execution_status"] == "completed" and passed else 1
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())
