# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The MCP transport: JSON-RPC over one POST endpoint.

**The runtime channel.** This is how an agent reaches a knowledge network at
run time, and it is the surface the TypeScript SDK calls for every
context-loader capability, so keeping to it keeps one contract across the two
clients. It carries what REST does not:

* the `bkn_receipt` — operation id, payload hash, business refs down to the
  property — that puts a read in the evidence chain in-band, rather than only
  server-side;
* the capability tools themselves (`search_schema` and its neighbours), which
  have no stable REST equivalent: `semantic-search` was withdrawn between two
  deploys this SDK was tested against, while the tool name did not move;
* the managed lifecycle, `bkn_start_interaction` / `bkn_finish_interaction`.

REST still owns the typed read path — instances, metrics, subgraph — because
only it sorts, totals and pages, and it needs no session. The two are a
division of labour, not a migration.

`initialize` → the server hands back a session id in a header → an
`initialized` notification → `tools/call`. The session is per (deploy, network)
and cached for the process, because the handshake costs two round trips that
say nothing about the query.

Two response encodings are in the wild on the same endpoint — plain JSON and an
SSE `data:` stream — so both are parsed. A tool's real payload arrives as JSON
inside `content[0].text`, with the evidence receipt beside it in
`structuredContent.bkn_receipt`.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from typing import Any

from .config import Context
from .errors import BknError, ToolError
from .http import request

__all__ = ["MCP_PATH", "ToolResult", "call_tool", "tool_catalog"]

MCP_PATH = "/api/agent-retrieval/v1/mcp"
PROTOCOL_VERSION = "2024-11-05"

_lock = threading.Lock()
#: (base URL, kn id) -> MCP session id. The handshake is not worth repeating.
_sessions: dict[tuple[str, str], str] = {}
_rpc_id = 0


@dataclass(frozen=True)
class ToolResult:
    """A tool's payload, and the receipt that proves the read happened."""

    value: Any
    #: `operation_id`, `payload_hash`, `business_refs` down to property
    #: granularity — the evidence chain entry for this read.
    receipt: dict[str, Any] | None = None


def tool_catalog(ctx: Context) -> Any:
    """The deploy's tool catalog: a plain GET, no session and no network id."""
    return request(ctx, f"{MCP_PATH}/info")


def call_tool(ctx: Context, kn_id: str, name: str, arguments: dict[str, Any]) -> ToolResult:
    """Call one MCP tool, opening the transport session if this process has none."""
    session_id = _session(ctx, kn_id)
    try:
        return _unwrap(_post(ctx, kn_id, session_id, _tool_call(name, arguments)))
    except _SessionGone:
        # The server forgot the transport session — reopen once and repeat. This
        # is the connection, not the business lifecycle: no evidence is lost.
        with _lock:
            _sessions.pop((ctx.base_url, kn_id), None)
        return _unwrap(_post(ctx, kn_id, _session(ctx, kn_id), _tool_call(name, arguments)))


class _SessionGone(BknError):
    """The transport session id was rejected; a new handshake will fix it."""


def _tool_call(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    global _rpc_id
    with _lock:
        _rpc_id += 1
        rpc_id = _rpc_id
    return {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }


def _session(ctx: Context, kn_id: str) -> str:
    key = (ctx.base_url, kn_id)
    with _lock:
        cached = _sessions.get(key)
    if cached is not None:
        return cached

    response = _raw_post(
        ctx,
        kn_id,
        None,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "bkn-osdk", "version": _version()},
            },
        },
    )
    session_id: str = response.headers.get("mcp-session-id", "")
    if not session_id:
        raise BknError(
            "The MCP endpoint returned no session id, so no tool can be called. "
            "Check that this deploy exposes /api/agent-retrieval/v1/mcp."
        )
    _raw_post(ctx, kn_id, session_id, {"jsonrpc": "2.0", "method": "notifications/initialized"})
    with _lock:
        _sessions[key] = session_id
    return session_id


def _post(ctx: Context, kn_id: str, session_id: str, body: dict[str, Any]) -> Any:
    return _parse(_raw_post(ctx, kn_id, session_id, body).text)


def _raw_post(ctx: Context, kn_id: str, session_id: str | None, body: dict[str, Any]) -> Any:
    from .auth import token_for
    from .http import _client, _headers

    headers = _headers(
        ctx,
        token_for(ctx),
        has_body=True,
        extra={
            # Both encodings are accepted because the server picks; see `_parse`.
            "accept": "application/json, text/event-stream",
            "x-kn-id": kn_id,
            "mcp-protocol-version": PROTOCOL_VERSION,
            **({"mcp-session-id": session_id} if session_id else {}),
        },
        method_override=None,
    )
    response = _client(ctx).post(
        f"{ctx.base_url}{MCP_PATH}", json=body, headers=headers, timeout=ctx.timeout
    )
    if response.status_code in (400, 404) and session_id is not None:
        raise _SessionGone(f"MCP session rejected: HTTP {response.status_code}")
    if response.is_error:
        raise BknError(f"MCP transport failed: HTTP {response.status_code} {response.text[:300]}")
    return response


def _parse(text: str) -> Any:
    """Plain JSON, or the `data:` lines of an SSE frame."""
    try:
        return json.loads(text)
    except ValueError:
        payload = "".join(
            line[5:].strip() for line in text.splitlines() if line.startswith("data:")
        )
        if not payload:
            raise BknError(
                f"MCP returned a body that is neither JSON nor SSE: {text[:200]}"
            ) from None
        return json.loads(payload)


def _unwrap(parsed: Any) -> ToolResult:
    """Pull the payload and receipt out of a JSON-RPC tool result.

    A tool failure arrives as `isError` with a structured code beside the prose,
    and the code is what says whether it is worth retrying — a dead lifecycle
    session is reopenable, a bad argument is not.
    """
    if not isinstance(parsed, dict):
        raise BknError(f"MCP returned an unexpected body: {str(parsed)[:200]}")
    if isinstance(parsed.get("error"), dict):
        raise BknError(f"MCP error: {parsed['error'].get('message', parsed['error'])}")

    result = parsed.get("result")
    if not isinstance(result, dict):
        return ToolResult(parsed)

    structured = result.get("structuredContent")
    receipt = structured.get("bkn_receipt") if isinstance(structured, dict) else None
    content = result.get("content")
    text = (
        content[0].get("text")
        if isinstance(content, list) and content and isinstance(content[0], dict)
        else None
    )

    if result.get("isError") is True:
        error = _error_of(structured) or _error_of(_loads(text)) or {}
        raise ToolError(
            str(error.get("code") or "tool_error"),
            str(text or "tool call failed"),
            required_action=_str_or_none(error.get("required_action")),
            retryable=bool(error.get("retryable")),
            retry_after_ms=error.get("retry_after_ms")
            if isinstance(error.get("retry_after_ms"), int)
            else None,
        )

    if isinstance(text, str):
        try:
            return ToolResult(json.loads(text), receipt if isinstance(receipt, dict) else None)
        except ValueError:
            pass
    if isinstance(structured, dict):
        return ToolResult(structured, receipt if isinstance(receipt, dict) else None)
    return ToolResult(result, receipt if isinstance(receipt, dict) else None)


def _error_of(payload: Any) -> dict[str, Any] | None:
    """The structured error, wherever this deploy put it.

    A refusal arrives with its machine-readable part in `structuredContent` on
    one deploy and only inside the text payload on another — and the code is
    what decides whether the call is retryable, so both are read. Missing it
    turns "open a session and try again" into a hard failure.
    """
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    return error if isinstance(error, dict) else None


def _loads(text: str | None) -> Any:
    if not isinstance(text, str):
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def _str_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _version() -> str:
    from . import __version__

    return __version__


def _reset_for_tests() -> None:
    with _lock:
        _sessions.clear()
