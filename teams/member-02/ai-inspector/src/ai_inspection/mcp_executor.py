"""Adapter for an existing MCP session and the team's shared-tab observer.

Tool names/arguments come from the integration's registered bindings, rather
than hard-coded assumptions about a server. This module owns no browser.
"""

from copy import deepcopy


class MCPExecutor:
    def __init__(self, *, call_tool, observe, action_bindings, permission):
        if not all(callable(callback) for callback in (call_tool, observe, permission)):
            raise ValueError("MCP callbacks must be callable")
        if not isinstance(action_bindings, dict):
            raise ValueError("MCP action bindings must be an object")
        for action, binding in action_bindings.items():
            if (action not in {"click", "fill", "press"} or not isinstance(binding, tuple) or len(binding) != 2 or
                    not isinstance(binding[0], str) or not binding[0] or not callable(binding[1])):
                raise ValueError("Each action needs a registered tool name and argument builder")
        self._call_tool = call_tool
        self._observe = observe
        self._bindings = dict(action_bindings)
        self._permission = permission

    def observe(self):
        return self._observe()

    def execute(self, step):
        if self._permission(deepcopy(step)) is not True:
            raise PermissionError("MCP action permission denied")
        if step.get("action") not in self._bindings:
            raise ValueError("No registered MCP tool for this action")
        name, build_arguments = self._bindings[step["action"]]
        arguments = build_arguments(deepcopy(step))
        if not isinstance(arguments, dict):
            raise ValueError("MCP arguments must be an object")
        response = self._call_tool(name, arguments)
        # The session adapter must normalize its CallToolResult to a dictionary.
        if not isinstance(response, dict) or response.get("isError") is not False:
            raise RuntimeError("MCP tool failed or returned an unrecognized result")
        return {"execution_status": "completed", "tool_name": name}
