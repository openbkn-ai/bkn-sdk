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

**Platform 0.1.5 is the baseline.** A payload is taken as it arrives, so a
deploy that shapes it differently is one this SDK does not target: 0.1.4 wraps
`get_kn_detail`, `list_resources`, `list_skills`, `get_object_types` and
`list_knowledge_networks` in a `result` key while answering the query tools
flat, and reading against one means unwrapping at the call site.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass
from typing import Any

from .config import Context
from .errors import BknError, ToolError
from .http import request

__all__ = ["MCP_PATH", "ToolResult", "call_tool", "tool_catalog"]

MCP_PATH = "/api/agent-retrieval/v1/mcp"
PROTOCOL_VERSION = "2024-11-05"

_lock = threading.Lock()
#: (base URL, kn id, who) -> MCP session id. The handshake is not worth
#: repeating, but it is not shareable either: the server binds a session to the
#: credential that opened it, so a process reading as two users must not hand
#: one user's session to the other. `who` is a digest, never the token itself.
_sessions: dict[tuple[str, str, str], str] = {}
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


#: How many times a tool that says `retryable` is tried again, and how long the
#: waits are when the platform names no delay of its own. Small and bounded: a
#: dependency that is down stays down, and a caller waiting on a read would
#: rather hear that than sit through a backoff.
RETRY_ATTEMPTS = 2
RETRY_BACKOFF_SECONDS = (0.25, 1.0)
#: The platform's own `retry_after_ms` is honoured only up to here. A deploy
#: answering `retry_after_ms: 30000` would otherwise block a read for a minute
#: across two attempts — silently, and against the bound this section promises.
RETRY_MAX_WAIT_SECONDS = 2.0


def call_tool(ctx: Context, kn_id: str, name: str, arguments: dict[str, Any]) -> ToolResult:
    """Call one MCP tool, retrying where the platform says the failure is transient.

    A refusal carries `retryable` and sometimes `retry_after_ms`. Honouring them
    costs one or two short waits and covers the case they exist for: a dependency
    restarting under a call that would otherwise surface as a hard failure to
    whoever asked. A refusal that is not retryable is raised on the first try.
    """
    for attempt in range(RETRY_ATTEMPTS + 1):
        try:
            return _attempt(ctx, kn_id, name, arguments)
        except ToolError as error:
            if not error.retryable or attempt == RETRY_ATTEMPTS:
                raise
            named = min((error.retry_after_ms or 0) / 1000, RETRY_MAX_WAIT_SECONDS)
            time.sleep(named or RETRY_BACKOFF_SECONDS[attempt])
    raise AssertionError("unreachable")  # pragma: no cover


def _attempt(ctx: Context, kn_id: str, name: str, arguments: dict[str, Any]) -> ToolResult:
    """One call, opening the transport session if this process has none."""
    try:
        # Inside the try: the handshake's own `initialized` notification carries
        # the new session id, so it can be refused the same way a call can.
        return _unwrap(_post(ctx, kn_id, _session(ctx, kn_id), _tool_call(name, arguments)))
    except _SessionGone:
        # The server forgot the transport session — reopen once and repeat. This
        # is the connection, not the business lifecycle: no evidence is lost.
        with _lock:
            _sessions.pop(_session_key(ctx, kn_id), None)
        try:
            return _unwrap(_post(ctx, kn_id, _session(ctx, kn_id), _tool_call(name, arguments)))
        except _SessionGone as gone:
            # A session opened seconds ago and already rejected is not something
            # a third attempt fixes, and `_SessionGone` is an internal signal:
            # let it out as itself and the caller learns nothing usable.
            raise BknError(
                f"The MCP endpoint rejected a session it had just issued ({gone}). "
                "This is a deploy-side problem rather than a bad request."
            ) from gone


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


def _session_key(ctx: Context, kn_id: str) -> tuple[str, str, str]:
    return (ctx.base_url, kn_id, hashlib.sha256(ctx.token.encode()).hexdigest()[:16])


def _session(ctx: Context, kn_id: str) -> str:
    key = _session_key(ctx, kn_id)
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
    from .auth import refreshed_token, token_for
    from .http import _client, _headers

    def send(bearer: str) -> Any:
        headers = _headers(
            ctx,
            bearer,
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
        return _client(ctx).post(
            f"{ctx.base_url}{MCP_PATH}", json=body, headers=headers, timeout=ctx.timeout
        )

    token = token_for(ctx)
    response = send(token)
    if response.status_code == 401 and ctx.credential is not None:
        # A stored session that expired mid-process, exactly as the REST path
        # handles it. Without this a long-lived process keeps reading over REST
        # while every traced read and every tool call fails for good.
        refreshed = refreshed_token(ctx, token)
        if refreshed is not None:
            response = send(refreshed)
    if response.status_code == 404 and session_id is not None:
        # What a forgotten session answers, measured on both deploys: `404
        # Invalid session ID`. A 400 is not that — a tool given bad arguments
        # answers 200 with an `isError` result — so treating one as a dead
        # session would re-handshake and send a non-idempotent call twice.
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
            # The structured `message` where the deploy sent one: `text` is the
            # whole payload, and quoting a JSON blob at a caller who asked for a
            # search tells them less than the sentence inside it.
            str(error.get("message") or text or "tool call failed"),
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
