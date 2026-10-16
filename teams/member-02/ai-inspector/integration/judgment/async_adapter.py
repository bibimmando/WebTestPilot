"""Async boundary; retain the integration's transport, limits and real tool ID."""
from copy import deepcopy

from .input_contract import validate_input
from .judge import prepare_request
from .response_contract import validate_response
from .assessment import review_response


class JudgmentValidationError(ValueError):
    """Safe contract failure retaining a received tool ID for error artifacts."""

    def __init__(self, message, *, tool_use_id=None):
        super().__init__(message)
        self.tool_use_id = tool_use_id


async def judge_async(payload, *, call, run_root=None, structured=False, assessment_sink=None):
    """await call(request) -> (scenario_judgments input, actual tool_use_id).

    No thread, API client, retry or new budget is created here. Cancellation
    and transport/limit failures propagate to the owner unchanged.
    """
    if not callable(call):
        raise ValueError("An asynchronous integration callback is required")
    try:
        payload = validate_input(payload)
        if not payload["scenarios"]:
            return {"judgments": []}, None
        request, images = prepare_request(payload, run_root=run_root, structured=structured)
    except ValueError as exc:
        raise JudgmentValidationError(str(exc)) from None
    response, tool_use_id = await call(deepcopy(request))
    if not isinstance(tool_use_id, str) or not tool_use_id.strip():
        raise JudgmentValidationError("Received judgment tool_use ID is missing")
    try:
        if structured:
            response, audit = review_response(response, payload)
            if assessment_sink is not None:
                assessment_sink(audit)
        accepted = validate_response(response, payload, images)
    except ValueError as exc:
        raise JudgmentValidationError(str(exc), tool_use_id=tool_use_id) from None
    return accepted, tool_use_id
