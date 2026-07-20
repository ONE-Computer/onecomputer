#!/usr/bin/env python3
"""Issue 007 live route probe that never prints prompt or response content."""

import hashlib
import json
import os
import sys
import urllib.error
import urllib.request


BASE_URL = os.environ.get("ONECOMPUTER_LITELLM_URL", "http://litellm:4000").rstrip("/")
API_KEY = os.environ.get("OPENAI_API_KEY", "")
ASSIGNED_ALIAS = os.environ.get("ONECOMPUTER_MODEL_ALIAS", "onecomputer-assistant")
TIMEOUT_SECONDS = int(os.environ.get("ONECOMPUTER_QUALIFICATION_TIMEOUT", "90"))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "normal"
    request_class = sys.argv[2] if len(sys.argv) > 2 else "assigned"
    requested_model = {
        "assigned": ASSIGNED_ALIAS,
        "unassigned": "onecomputer-unassigned",
        "raw": "gpt-5.6-luna",
    }.get(request_class)
    if mode not in ("normal", "stream") or requested_model is None:
        raise SystemExit("usage: qualify-route.py [normal|stream] [assigned|unassigned|raw]")
    synthetic_marker = hashlib.sha256(os.urandom(32)).hexdigest()[:12]
    payload = {
        "model": requested_model,
        "messages": [{"role": "user", "content": "Return only this synthetic marker: " + synthetic_marker}],
        "max_completion_tokens": 64,
        "store": False,
        "stream": mode == "stream",
    }
    if mode == "stream":
        payload["stream_options"] = {"include_usage": True}
    request = urllib.request.Request(
        BASE_URL + "/v1/chat/completions",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Authorization": "Bearer " + API_KEY, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            content = ""
            usage = {}
            if mode == "normal":
                result = json.load(response)
                choices = result.get("choices", [])
                content = choices[0].get("message", {}).get("content", "") if choices else ""
                usage = result.get("usage") or {}
            else:
                for raw_line in response:
                    line = raw_line.decode("utf-8").strip()
                    if not line.startswith("data: ") or line == "data: [DONE]":
                        continue
                    chunk = json.loads(line[6:])
                    choices = chunk.get("choices", [])
                    if choices:
                        content += choices[0].get("delta", {}).get("content") or ""
                    if chunk.get("usage"):
                        usage = chunk["usage"]
            print(json.dumps({
                "mode": mode,
                "requestClass": request_class,
                "httpStatus": response.status,
                "contentReceived": bool(content),
                "contentBytes": len(content.encode()),
                "responseDigest": hashlib.sha256(content.encode()).hexdigest() if content else None,
                "usage": {
                    "promptTokens": usage.get("prompt_tokens"),
                    "completionTokens": usage.get("completion_tokens"),
                    "totalTokens": usage.get("total_tokens"),
                },
            }))
    except urllib.error.HTTPError as error:
        print(json.dumps({
            "mode": mode,
            "requestClass": request_class,
            "httpStatus": error.code,
            "denied": error.code in (401, 403, 429),
        }))
    except (TimeoutError, urllib.error.URLError) as error:
        print(json.dumps({
            "mode": mode,
            "requestClass": request_class,
            "upstreamUnavailable": True,
            "failureClass": type(error).__name__,
        }))


if __name__ == "__main__":
    main()
