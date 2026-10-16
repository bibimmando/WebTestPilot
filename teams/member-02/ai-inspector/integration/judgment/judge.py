"""Injected model boundary and offline request/response artifact generation."""
import argparse
from copy import deepcopy
import json
from pathlib import Path

from .images import load_images
from .input_contract import CONTRACT_COMMIT, read_input, schema, validate_input
from .prompts import SYSTEM
from .response_contract import validate_response
from .assessment import assessment_schema


def prepare_request(payload, *, run_root=None, structured=False):
    payload = validate_input(payload)
    image_blocks, image_records = load_images(payload, run_root)
    content = [{"type": "text", "text": json.dumps({"task": "Judge each scenario by calling scenario_judgments exactly once.",
                **payload, "image_availability": image_records}, ensure_ascii=False)}]
    content.extend(image_blocks)
    return {"system": SYSTEM, "messages": [{"role": "user", "content": content}],
            "tools": [{"name": "scenario_judgments", "description": "Judge the provided executed scenarios using only their evidence.",
                       "input_schema": assessment_schema() if structured else schema("scenario_judgments.schema.json")}],
            "tool_choice": {"type": "tool", "name": "scenario_judgments"}}, image_records


def judge(payload, *, model, run_root=None):
    """model(request) -> tool input dict; model owns transport/budgets/cancellation.

    This function creates no provider, browser, API key or automatic retry.
    ResponseError/transport failures propagate for the integration owner to handle.
    """
    if not callable(model):
        raise ValueError("A callable model adapter is required")
    payload = validate_input(payload)
    if not payload["scenarios"]:
        return {"judgments": []}
    request, images = prepare_request(payload, run_root=run_root)
    response = model(deepcopy(request))
    return validate_response(response, payload, images)


def export_judgment(input_path, output_dir, *, run_root=None, model=None, mock_response=None):
    if model is not None and mock_response is not None:
        raise ValueError("Choose either a model adapter or a mock response")
    if model is not None and not callable(model):
        raise ValueError("A callable model adapter is required")
    payload = read_input(input_path)
    request, images = prepare_request(payload, run_root=run_root)
    output_dir = Path(output_dir)
    targets = [output_dir / name for name in ("judgment_request.json", "judgment_response.json", "judgment_run.json")]
    protected = {Path(input_path).resolve()}
    if mock_response:
        protected.add(Path(mock_response).resolve())
    protected.update(Path(record["path"]).resolve() for record in images.values() if record["status"] == "available")
    if any(target.resolve() in protected for target in targets):
        raise ValueError("Judgment output would overwrite source evidence")
    # A request artifact uses references instead of binary data; the injected model receives actual bytes.
    saved = deepcopy(request)
    available = iter(record for record in images.values() if record["status"] == "available")
    for block in saved["messages"][0]["content"]:
        if block["type"] == "image":
            record = next(available)
            block.clear()
            block.update(type="image_reference", path=record["path"], media_type=record["media_type"])
    output_dir.mkdir(parents=True, exist_ok=True)
    write = lambda path, value: path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {"schema_version": "judgment-module-run/1", "contract_version": "judge_input/2",
               "contract_commit": CONTRACT_COMMIT, "run_id": payload["run_id"], "flow_id": payload["flow_id"],
               "status": "prepared", "mode": "prepare_only", "scenario_count": len(payload["scenarios"]),
               "model_calls": 0, "images": images, "response_validated": False}
    write(targets[0], saved)
    write(targets[1], {"status": "not_run"})  # Remove any previous accepted response before a fresh run.
    write(targets[2], summary)
    try:
        if mock_response is not None:
            summary["mode"] = "mock_response"
            try:
                response = json.loads(Path(mock_response).read_text(encoding="utf-8-sig"))
            except (json.JSONDecodeError, UnicodeError):
                raise ValueError("Cannot decode mock response JSON") from None
        elif model is not None:
            summary.update(mode="injected_model", model_calls=int(bool(payload["scenarios"])))
            response = model(deepcopy(request)) if payload["scenarios"] else {"judgments": []}
        else:
            return summary
        response = validate_response(response, payload, images)
        write(targets[1], response)
        summary.update(status="completed", response_validated=True)
        return summary
    except Exception as exc:
        summary.update(status="error", error_type=type(exc).__name__)
        raise
    finally:
        usage = getattr(model, "last_usage", None) if model is not None else None
        if isinstance(usage, dict) and usage:
            summary["usage"] = deepcopy(usage)
        write(targets[2], summary)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prepare or mock-check judge_input/2; no paid API calls")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--run-root", help="explicit execution output root for actual images")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare-only", action="store_true")
    mode.add_argument("--mock-response", help="synthetic scenario_judgments tool-input JSON")
    args = parser.parse_args(argv)
    try:
        result = export_judgment(args.input, args.output_dir, run_root=args.run_root, mock_response=args.mock_response)
    except (ValueError, OSError) as exc:
        # Input/schema errors use our bounded messages; omit filesystem details.
        parser.error(str(exc) if isinstance(exc, ValueError) else "Judgment file operation failed")
    print(f"Status: {result['status']}; scenarios: {result['scenario_count']}; model calls: {result['model_calls']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
