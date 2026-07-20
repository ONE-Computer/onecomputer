"""Fail-closed LiteLLM MCP pre-call policy callback owned by ONEComputer."""

import asyncio
import hashlib
import json
import os
import urllib.error
import urllib.request

from fastapi import HTTPException
from litellm.integrations.custom_logger import CustomLogger


POLICY_URL = os.environ.get(
    "ONECOMPUTER_MCP_POLICY_URL",
    "http://control-api:4100/internal/v1/mcp/authorize",
)
POLICY_TOKEN = os.environ.get("ONECOMPUTER_MCP_POLICY_TOKEN", "")
MS365_SERVER_NAME = "onecomputer_ms365"
MS365_SERVER_ID = hashlib.sha256(
    b"onecomputer_ms365|http://ms365-mcp:3000/mcp|http|oauth2|"
).hexdigest()[:32]


def _metadata(auth):
    value = getattr(auth, "metadata", None)
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = None
    return value if isinstance(value, dict) else {}


def _optional_string(metadata, name):
    value = metadata.get(name)
    return value if isinstance(value, str) and value else None


def _request_decision(payload):
    if len(POLICY_TOKEN) < 24:
        raise RuntimeError("MCP policy callback token is not configured")
    request = urllib.request.Request(
        POLICY_URL,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        method="POST",
        headers={
            "content-type": "application/json",
            "x-onecomputer-mcp-policy-token": POLICY_TOKEN,
        },
    )
    with urllib.request.urlopen(request, timeout=2) as response:
        if response.status != 200:
            raise RuntimeError("MCP policy authority returned a non-success status")
        result = json.load(response)
    required = {"schemaVersion", "decision", "code", "capabilityId", "schemaId", "schemaHash", "operationId"}
    if not isinstance(result, dict) or set(result) != required or result.get("schemaVersion") != 1:
        raise RuntimeError("MCP policy authority returned a malformed decision")
    if result.get("decision") not in ("allow", "deny", "approval_required"):
        raise RuntimeError("MCP policy authority returned an unknown decision")
    return result


class OneComputerMcpPolicyCallback(CustomLogger):
    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        if call_type != "call_mcp_tool":
            return data

        metadata = _metadata(user_api_key_dict)
        permission = getattr(user_api_key_dict, "object_permission", None)
        permitted_servers = getattr(permission, "mcp_servers", None)
        if permitted_servers is None and isinstance(permission, dict):
            permitted_servers = permission.get("mcp_servers")
        if permitted_servers != [MS365_SERVER_ID]:
            raise HTTPException(status_code=403, detail={"error": "MCP_SERVER_BINDING_INVALID"})
        server_id = MS365_SERVER_ID
        payload = {
            "schemaVersion": 1,
            "tenantId": _optional_string(metadata, "onecomputer_tenant_id"),
            "subjectId": _optional_string(metadata, "onecomputer_subject_id"),
            "workspaceId": _optional_string(metadata, "onecomputer_workspace_id"),
            "agentId": _optional_string(metadata, "onecomputer_agent_id"),
            "policyVersionId": _optional_string(metadata, "onecomputer_policy_version_id"),
            "policyHash": _optional_string(metadata, "onecomputer_policy_hash"),
            "operationId": _optional_string(metadata, "onecomputer_operation_id"),
            "operationDigest": _optional_string(metadata, "onecomputer_operation_digest"),
            "leaseId": _optional_string(metadata, "onecomputer_lease_id"),
            "serverId": server_id,
            "serverName": MS365_SERVER_NAME,
            "toolName": data.get("name"),
            "arguments": data.get("arguments"),
        }
        # LiteLLM invokes the proxy hook once while parsing /mcp-rest/tools/call
        # with the tool fields still empty, then again from the resolved MCP
        # dispatcher. Authority is enforced only on the resolved invocation.
        if payload["toolName"] is None and payload["arguments"] is None:
            return data
        missing = [name for name in ("tenantId", "subjectId", "workspaceId", "agentId", "serverName", "toolName", "arguments") if payload.get(name) is None]
        if missing:
            raise HTTPException(status_code=403, detail={"error": "MCP_IDENTITY_CONTEXT_MISSING", "missing": missing})
        try:
            decision = await asyncio.to_thread(_request_decision, payload)
        except (OSError, ValueError, RuntimeError, urllib.error.URLError):
            raise HTTPException(status_code=503, detail={"error": "MCP_POLICY_UNAVAILABLE"}) from None

        if decision["decision"] == "allow":
            return data
        if decision["decision"] == "approval_required":
            raise HTTPException(
                status_code=409,
                detail={
                    "error": decision["code"],
                    "operation_id": decision["operationId"],
                },
            )
        raise HTTPException(status_code=403, detail={"error": decision["code"]})


proxy_handler_instance = OneComputerMcpPolicyCallback(turn_off_message_logging=True)
