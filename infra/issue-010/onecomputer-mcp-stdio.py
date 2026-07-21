#!/usr/bin/env python3
"""Credentialless stdio MCP bridge for Claude Desktop inside a managed workspace."""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request


BROKER = "http://127.0.0.1:4312"
PROTOCOL_VERSION = "2024-11-05"
TOOLS: dict[str, dict] = {}


def request_json(path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"{BROKER}{path}",
        data=None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8"),
        method="GET" if body is None else "POST",
        headers={} if body is None else {"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=70) as response:
        return json.load(response)


def operation_id(value: object) -> str | None:
    if isinstance(value, dict):
        candidate = value.get("operation_id")
        if isinstance(candidate, str):
            return candidate
        for child in value.values():
            found = operation_id(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = operation_id(child)
            if found:
                return found
    return None


def discover_tools() -> list[dict]:
    response = request_json("/mcp-rest/tools/list")
    tools = response.get("tools", [])
    if not isinstance(tools, list):
        raise RuntimeError("gateway returned an invalid tool list")
    result = []
    TOOLS.clear()
    for raw in tools:
        if not isinstance(raw, dict) or not isinstance(raw.get("name"), str):
            continue
        TOOLS[raw["name"]] = raw
        result.append({
            "name": raw["name"],
            "description": raw.get("description", "Microsoft 365 tool governed by ONEComputer policy."),
            "inputSchema": raw.get("inputSchema", raw.get("input_schema", {"type": "object"})),
        })
    return result


def wait_for_operation(identifier: str) -> dict:
    deadline = time.monotonic() + 610
    while time.monotonic() < deadline:
        operation = request_json(f"/onecomputer/operations/{identifier}")
        state = operation.get("state")
        if state in {"succeeded", "denied", "failed", "expired"}:
            return operation
        time.sleep(1)
    return {"id": identifier, "state": "expired", "failureCode": "APPROVAL_WAIT_TIMED_OUT"}


def call_tool(name: str, arguments: dict) -> dict:
    selected = TOOLS.get(name)
    if selected is None:
        discover_tools()
        selected = TOOLS.get(name)
    server_id = (selected or {}).get("mcp_info", {}).get("server_id")
    if not isinstance(server_id, str):
        return error_result("That tool is not assigned to this workspace.")
    try:
        return request_json("/mcp-rest/tools/call", {
            "server_id": server_id,
            "name": name,
            "arguments": arguments,
        })
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = {}
        identifier = operation_id(payload)
        if error.code != 409 or not identifier:
            message = nested_error(payload) or f"ONEComputer rejected the tool call (HTTP {error.code})."
            return error_result(message)

    operation = wait_for_operation(identifier)
    if operation.get("state") == "succeeded":
        receipt = operation.get("receipt") if isinstance(operation.get("receipt"), dict) else {}
        summary = receipt.get("resultSummary") or f"{operation.get('safeSummary', name)} completed after approval."
        return {
            "content": [{"type": "text", "text": str(summary)}],
            "isError": False,
            "_meta": {"onecomputer": {"operationId": identifier, "state": "succeeded", "approval": "openvtc-task-consent"}},
        }
    state = operation.get("state", "failed")
    return error_result(f"The governed action was {state}. No further tool execution occurred.", identifier, state)


def nested_error(value: object) -> str | None:
    if isinstance(value, dict):
        candidate = value.get("error")
        if isinstance(candidate, str):
            return candidate
        for child in value.values():
            found = nested_error(child)
            if found:
                return found
    return None


def error_result(message: str, identifier: str | None = None, state: str | None = None) -> dict:
    result = {"content": [{"type": "text", "text": message}], "isError": True}
    if identifier:
        result["_meta"] = {"onecomputer": {"operationId": identifier, "state": state}}
    return result


def respond(identifier: object, result: dict | None = None, error: dict | None = None) -> None:
    document = {"jsonrpc": "2.0", "id": identifier}
    document["result" if error is None else "error"] = result if error is None else error
    print(json.dumps(document, separators=(",", ":")), flush=True)


def handle(message: dict) -> None:
    method = message.get("method")
    identifier = message.get("id")
    if identifier is None:
        return
    try:
        if method == "initialize":
            respond(identifier, {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "onecomputer-microsoft-365", "version": "0.1.0"},
            })
        elif method == "ping":
            respond(identifier, {})
        elif method == "tools/list":
            respond(identifier, {"tools": discover_tools()})
        elif method == "tools/call":
            params = message.get("params", {})
            name = params.get("name")
            arguments = params.get("arguments", {})
            if not isinstance(name, str) or not isinstance(arguments, dict):
                raise ValueError("invalid tool call")
            respond(identifier, call_tool(name, arguments))
        else:
            respond(identifier, error={"code": -32601, "message": "Method not found"})
    except Exception as error:  # MCP must report failures without terminating the managed connector.
        print(f"onecomputer-mcp: {type(error).__name__}", file=sys.stderr, flush=True)
        respond(identifier, error={"code": -32603, "message": "The governed Microsoft 365 connector is unavailable."})


for line in sys.stdin:
    try:
        message = json.loads(line)
        if isinstance(message, dict):
            handle(message)
    except json.JSONDecodeError:
        print("onecomputer-mcp: ignored malformed input", file=sys.stderr, flush=True)
