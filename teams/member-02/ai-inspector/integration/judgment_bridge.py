"""Use the member-02 judgment package through the existing staged call manager."""
import json

from .judgment.async_adapter import JudgmentValidationError, judge_async


async def run_judgment(runtime, evidence, flow, payload, *, call):
    """call is staged._call; it owns limits, usage, cancellation and native IDs."""
    async def exchange(request):
        content = request["messages"][0]["content"]
        return await call(runtime, evidence, flow, "judgment", request["system"],
                          json.loads(content[0]["text"]), request["tools"][0], content[1:])
    audit = {}
    try:
        result = await judge_async(payload, call=exchange, run_root=runtime.output,
            structured=getattr(runtime, 'quality_checks', False), assessment_sink=audit.update)
        audit['status'] = 'accepted'
        return result
    except JudgmentValidationError as exc:
        from .staged import ResponseError
        error = ResponseError("judgment module: " + str(exc))
        error.tool_use_id = exc.tool_use_id
        raise error from None
    finally:
        if audit.get('scenarios') is not None:
            from .runtime import write_json
            audit.setdefault('status', 'rejected')
            write_json(runtime.output / 'flows' / flow['flow_id'] / 'judgment_assessment.json',
                       evidence.collector._sanitize(audit))
