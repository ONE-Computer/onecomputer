#!/usr/bin/env python3
"""Small credentialless-by-user ONEComputer workspace client."""

import json
import hashlib
import os
import shlex
import sys
import urllib.error
import urllib.request


BASE_URL = os.environ.get("ONECOMPUTER_LITELLM_URL", "http://litellm:4000").rstrip("/")
API_KEY = os.environ.get("OPENAI_API_KEY", "")
MODEL = os.environ.get("ONECOMPUTER_MODEL_ALIAS", "onecomputer-assistant")
ALLOWED = tuple(filter(None, os.environ.get("ONECOMPUTER_ALLOWED_TOOLS", "").split(",")))
AGENT_ID = os.environ.get("ONECOMPUTER_AGENT_ID", "unassigned")
SAFETY_IDENTIFIER = hashlib.sha256(("onecomputer:" + AGENT_ID).encode()).hexdigest()


def request(path, payload=None, timeout=20):
    if not API_KEY:
        raise RuntimeError("This workspace has no active ONEComputer grant. Restart it from ONEComputer.")
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        BASE_URL + path,
        data=body,
        method="POST" if body is not None else "GET",
        headers={"Authorization": "Bearer " + API_KEY, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            detail = json.load(error)
        except Exception:
            detail = {"status": error.code}
        raise RuntimeError("ONEComputer gateway rejected the request: " + json.dumps(detail)) from None
    except (TimeoutError, urllib.error.URLError):
        raise RuntimeError("The assigned ONEComputer route is unavailable. No fallback is configured.") from None


def tools():
    found = request("/mcp-rest/tools/list").get("tools", [])
    return [tool for tool in found if tool.get("name") in ALLOWED]


def call_tool(name, arguments=None):
    if name not in ALLOWED:
        raise RuntimeError("Tool is not assigned to this workspace: " + name)
    selected = next((tool for tool in tools() if tool.get("name") == name), None)
    if not selected:
        raise RuntimeError("Assigned tool is not currently available: " + name)
    server_id = selected.get("mcp_info", {}).get("server_id")
    if not server_id:
        raise RuntimeError("The gateway returned an invalid tool binding")
    return request("/mcp-rest/tools/call", {"server_id": server_id, "name": name, "arguments": arguments or {}})


def print_status():
    models = [item.get("id") for item in request("/v1/models").get("data", [])]
    print("ONEComputer Agent")
    print("  Agent:", os.environ.get("ONECOMPUTER_AGENT_ID", "unassigned"))
    print("  Policy:", os.environ.get("ONECOMPUTER_POLICY_VERSION", "unknown"))
    print("  Model:", MODEL, "(ready)" if MODEL in models else "(unavailable)")
    print("  Tools:", ", ".join(tool.get("name", "") for tool in tools()) or "none")


def chat(prompt, stream=False):
    if not prompt.strip():
        raise RuntimeError("Enter a prompt after the command")
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_completion_tokens": 256,
        "store": False,
        "safety_identifier": SAFETY_IDENTIFIER,
        "stream": stream,
    }
    if not stream:
        result = request("/v1/chat/completions", payload, timeout=60)
        choices = result.get("choices", [])
        content = choices[0].get("message", {}).get("content") if choices else None
        if not isinstance(content, str):
            raise RuntimeError("The assigned model route returned an invalid response")
        print(content)
        return

    req = urllib.request.Request(
        BASE_URL + "/v1/chat/completions",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Authorization": "Bearer " + API_KEY, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8").strip()
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                chunk = json.loads(line[6:])
                choices = chunk.get("choices", [])
                content = choices[0].get("delta", {}).get("content") if choices else None
                if isinstance(content, str):
                    print(content, end="", flush=True)
        print()
    except urllib.error.HTTPError as error:
        try:
            detail = json.load(error)
        except Exception:
            detail = {"status": error.code}
        raise RuntimeError("ONEComputer gateway rejected the request: " + json.dumps(detail)) from None
    except (TimeoutError, urllib.error.URLError):
        raise RuntimeError("The assigned ONEComputer route is unavailable. No fallback is configured.") from None


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "shell"
    if command in ("status", "tools"):
        print_status()
        return
    friendly = {"mail": "list-mail-folders", "calendar": "list-calendars", "drives": "list-drives"}
    if command in friendly:
        print(json.dumps(call_tool(friendly[command]), indent=2))
        return
    if command in ("chat", "stream") and len(sys.argv) >= 3:
        chat(" ".join(sys.argv[2:]), stream=command == "stream")
        return
    if command == "tool" and len(sys.argv) >= 3:
        arguments = json.loads(sys.argv[3]) if len(sys.argv) >= 4 else {}
        print(json.dumps(call_tool(sys.argv[2], arguments), indent=2))
        return
    if command != "shell":
        raise RuntimeError("Usage: onecomputer-agent [status|chat PROMPT|stream PROMPT|mail|calendar|drives|tool NAME JSON|shell]")
    print("ONEComputer Agent — policy-scoped models and Microsoft 365 access")
    print("Commands: status, chat PROMPT, stream PROMPT, mail, calendar, drives, tool NAME JSON, quit")
    while True:
        try:
            line = input("onecomputer> ").strip()
            if line in ("quit", "exit"):
                return
            if not line:
                continue
            main_command = shlex.split(line)
            sys.argv = [sys.argv[0], *main_command]
            main()
        except (RuntimeError, ValueError) as error:
            print("Error:", error)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError) as error:
        print("Error:", error, file=sys.stderr)
        sys.exit(1)
