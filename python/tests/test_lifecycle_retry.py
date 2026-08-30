# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Deploys that enforce the lifecycle contract on calls that carry no turn.

One live deploy answers a context-free read with `{"error": {"code":
"conversation_required", "required_action": "create_conversation"}}`, while
another serves the same request happily. Rather than pre-opening an interaction
for a deploy that may not want one, a call with no turn to attach goes out bare
and the requirement is learned from the refusal — over REST and over the MCP
tool alike, since both surfaces sit behind the same middleware.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from bkn_osdk import HttpError, search, session
from bkn_osdk import http as http_module
from bkn_osdk import lifecycle as lifecycle_module
from bkn_osdk import mcp as mcp_module
from bkn_osdk.types import ObjectType, Property

KN = "worldcup_vega_catalog_bkn"
PLATFORM = "https://platform.example"

REFUSAL = {
    "error": {
        "code": "conversation_required",
        "message": "conversation_id is required",
        "required_action": "create_conversation",
        "retryable": False,
    }
}


class Tournaments(ObjectType):
    __kn_id__ = KN
    __bkn_id__ = "tournaments"
    __primary_key__ = ("key_id",)

    key_id = Property[str]("key_id")


class Deploy:
    """A platform that refuses context-free reads, and the record of what it saw."""

    def __init__(self, *, enforces: bool = True) -> None:
        self.enforces = enforces
        self.rest_bodies: list[dict[str, Any]] = []
        self.tool_calls: list[str] = []
        #: Arguments of every non-lifecycle tool call, in order.
        self.tool_args: list[dict[str, Any]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/mcp/info"):
            return httpx.Response(
                200,
                json={
                    "tools": [
                        {"name": "bkn_start_interaction"},
                        {"name": "bkn_finish_interaction"},
                    ]
                },
            )
        if path.endswith("/mcp"):
            return self._mcp(json.loads(request.read()))

        body = json.loads(request.read())
        self.rest_bodies.append(body)
        if self.enforces and "bkn_context" not in body:
            return httpx.Response(400, json=REFUSAL)
        return httpx.Response(200, json={"datas": [{"key_id": "1"}], "concepts": []})

    def _mcp(self, body: dict[str, Any]) -> httpx.Response:
        if body["method"] != "tools/call":
            return httpx.Response(200, json={"result": {}}, headers={"mcp-session-id": "s"})
        name = body["params"]["name"]
        self.tool_calls.append(name)
        if name == "bkn_start_interaction":
            return self._rpc({"conversation_id": "c1", "interaction_id": "i1"})
        if name == "bkn_finish_interaction":
            return self._rpc({"execution_status": "completed"})

        arguments = body["params"]["arguments"]
        self.tool_args.append(arguments)
        if self.enforces and "bkn_context" not in arguments:
            return self._rpc({"error": {"code": "conversation_required"}}, is_error=True)
        return self._rpc({"object_types": [], "relation_types": []})

    def _rpc(self, payload: dict[str, Any], *, is_error: bool = False) -> httpx.Response:
        result: dict[str, Any] = {
            "content": [{"type": "text", "text": json.dumps(payload)}],
            "structuredContent": payload,
        }
        if is_error:
            result["isError"] = True
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})


@pytest.fixture(autouse=True)
def clean_caches() -> Iterator[None]:
    mcp_module._reset_for_tests()
    lifecycle_module._reset_for_tests()
    yield
    mcp_module._reset_for_tests()
    lifecycle_module._reset_for_tests()


def serve(monkeypatch: pytest.MonkeyPatch, stub: Deploy) -> Deploy:
    client = httpx.Client(transport=httpx.MockTransport(stub.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")
    return stub


@pytest.fixture
def enforcing(monkeypatch: pytest.MonkeyPatch) -> Deploy:
    return serve(monkeypatch, Deploy())


@pytest.fixture
def relaxed(monkeypatch: pytest.MonkeyPatch) -> Deploy:
    return serve(monkeypatch, Deploy(enforces=False))


# ---- a deploy that demands a session -----------------------------------------


def test_a_refused_read_is_retried_with_a_context(enforcing: Deploy) -> None:
    rows = Tournaments.take(1)

    assert [("bkn_context" in body) for body in enforcing.rest_bodies] == [False, True]
    assert rows[0].key_id == "1"


def test_the_retry_opens_and_closes_a_turn_of_its_own(enforcing: Deploy) -> None:
    """Outside a traced scope the read still lands in the chain, on its own turn."""
    Tournaments.take(1)

    assert enforcing.tool_calls == ["bkn_start_interaction", "bkn_finish_interaction"]


def test_inside_a_traced_scope_the_scope_owns_the_turn(enforcing: Deploy) -> None:
    """Evidence stays on one turn rather than fragmenting per query."""
    with session(traced=True):
        Tournaments.take(1)
        Tournaments.take(1)

    assert enforcing.tool_calls.count("bkn_start_interaction") == 1
    assert enforcing.tool_calls.count("bkn_finish_interaction") == 1


def test_search_takes_the_same_path(enforcing: Deploy) -> None:
    """Search is an MCP tool, but the lifecycle rule it meets is the same one."""
    search(KN, "world cup winners")

    assert [("bkn_context" in args) for args in enforcing.tool_args] == [False, True]
    assert enforcing.tool_args[1]["bkn_context"] == {
        "conversation_id": "c1",
        "interaction_id": "i1",
    }


# ---- a deploy that does not ---------------------------------------------------


def test_a_relaxed_deploy_pays_nothing(relaxed: Deploy) -> None:
    """No probe, no session, no second request — the bare read simply works."""
    Tournaments.take(1)

    assert len(relaxed.rest_bodies) == 1
    assert relaxed.tool_calls == []


def test_an_unrelated_error_is_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    """Only the lifecycle refusal means "open a session"; everything else stands."""
    stub = Deploy()
    monkeypatch.setattr(
        stub,
        "handle",
        lambda request: httpx.Response(400, json={"error": {"code": "bad_argument"}}),
    )
    serve(monkeypatch, stub)

    with pytest.raises(HttpError) as excinfo:
        Tournaments.take(1)

    assert excinfo.value.status == 400
    assert stub.tool_calls == []


# ---- where a turn exists, every call carries it --------------------------------


def test_a_traced_scope_attaches_the_turn_without_being_asked(relaxed: Deploy) -> None:
    """A deploy that does not demand a context still records the call, because the
    scope asked for evidence. Waiting for a refusal would drop it in silence.

    Shown on `search`, whose tool call carries the turn on the first attempt.
    """
    with session(traced=True):
        search(KN, "who owns supply chain")

    assert relaxed.tool_args[0]["bkn_context"] == {
        "conversation_id": "c1",
        "interaction_id": "i1",
    }
    assert len(relaxed.tool_args) == 1  # attached first time, no retry


def test_a_caller_named_turn_is_attached_without_a_traced_scope(
    relaxed: Deploy, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The platform's rule: name a session and the call is managed. The sandbox
    names one per execution, so its reads land on the host's turn."""
    monkeypatch.setenv("BKN_CONVERSATION_ID", "host-conv")
    monkeypatch.setenv("BKN_INTERACTION_ID", "host-int")

    search(KN, "who owns supply chain")

    assert relaxed.tool_args[0]["bkn_context"] == {
        "conversation_id": "host-conv",
        "interaction_id": "host-int",
    }
    assert "bkn_start_interaction" not in relaxed.tool_calls  # nothing opened or finished


def test_without_a_turn_none_is_minted(relaxed: Deploy) -> None:
    """A capability call is not an agent turn; minting one would file a
    single-operation record that documents nothing."""
    Tournaments.take(1)

    assert "bkn_context" not in relaxed.rest_bodies[0]
    assert relaxed.tool_calls == []
