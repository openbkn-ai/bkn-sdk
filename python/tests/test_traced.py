# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The traced read path: one interaction per scope, and the receipt it earns.

Recorded against `https://10.211.55.4` on 2026-08-12, whose catalog carries
`bkn_start_interaction` and `bkn_finish_interaction` and no
`bkn_create_conversation` — the contract where one call mints both ids and
`bkn_context` accepts only those two.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from bkn_osdk import BknError, Context, ToolError, search, session
from bkn_osdk import http as http_module
from bkn_osdk import lifecycle as lifecycle_module
from bkn_osdk import mcp as mcp_module
from bkn_osdk.config import StoredCredential
from bkn_osdk.types import ObjectType, Property

KN = "worldcup_vega_catalog_bkn"
PLATFORM = "https://platform.example"

RECEIPT = {
    "operation_id": "op_1",
    "operation_key": "mcp:bbfbe454a6a9faf22b99afd572c65c26",
    "payload_hash": "sha256:…",
    "business_refs": [
        {"ref_type": "object_type", "ref_id": f"object:{KN}:tournaments"},
    ],
}
ROW = {"tournament_id": "WC-1966", "tournament_name": "1966 FIFA World Cup"}


class Tournaments(ObjectType):
    __kn_id__ = KN
    __bkn_id__ = "tournaments"
    __primary_key__ = ("tournament_id",)

    tournament_id = Property[str]("tournament_id")
    tournament_name = Property[str]("tournament_name")


class Deploy:
    """A stub speaking the MCP transport, recording every call it serves."""

    def __init__(
        self,
        *,
        sse: bool = False,
        tools: tuple[str, ...] = (),
        declares_conversation_mode: bool = False,
    ) -> None:
        self.sse = sse
        self.declares_conversation_mode = declares_conversation_mode
        self.tools = tools or ("bkn_start_interaction", "bkn_finish_interaction")
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.rpc_methods: list[str] = []
        self.headers: list[dict[str, str]] = []
        self.rest_bodies: list[dict[str, Any]] = []
        self.interactions = 0

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/mcp/info"):
            return httpx.Response(200, json={"tools": [self._tool(n) for n in self.tools]})
        if not request.url.path.endswith("/mcp"):
            self.rest_bodies.append(json.loads(request.read()))
            return httpx.Response(200, json={"datas": [], "total_count": 0})  # the REST read path

        body = json.loads(request.read())
        self.rpc_methods.append(body["method"])
        self.headers.append(dict(request.headers))
        if body["method"] == "initialize":
            return httpx.Response(200, json={"result": {}}, headers={"mcp-session-id": "sess-1"})
        if body["method"] == "notifications/initialized":
            return httpx.Response(202, json={})

        name = body["params"]["name"]
        arguments = body["params"]["arguments"]
        self.calls.append((name, arguments))
        return self._respond(name)

    def _tool(self, name: str) -> dict[str, Any]:
        """A catalog entry, with the start tool's schema where it declares one."""
        if name != "bkn_start_interaction" or not self.declares_conversation_mode:
            return {"name": name}
        return {
            "name": name,
            "input_schema": {
                "properties": {
                    "question": {"type": "string"},
                    "agent_name": {"type": "string"},
                    "conversation_mode": {"enum": ["new", "continue"]},
                },
                "required": ["conversation_mode", "question", "agent_name"],
            },
        }

    def _respond(self, name: str) -> httpx.Response:
        if name == "bkn_start_interaction":
            self.interactions += 1
            payload = {
                "conversation_id": f"conv_{self.interactions}",
                "interaction_id": f"int_{self.interactions}",
            }
            return self._rpc(payload)
        if name == "bkn_finish_interaction":
            return self._rpc({"execution_status": "completed"})
        return self._rpc({"datas": [ROW]}, receipt=RECEIPT)

    def _rpc(
        self, payload: dict[str, Any], receipt: dict[str, Any] | None = None
    ) -> httpx.Response:
        structured: dict[str, Any] = {**payload}
        if receipt is not None:
            structured["bkn_receipt"] = receipt
        result = {
            "content": [{"type": "text", "text": json.dumps(payload)}],
            "structuredContent": structured,
        }
        envelope = {"jsonrpc": "2.0", "id": 1, "result": result}
        if not self.sse:
            return httpx.Response(200, json=envelope)
        # The same endpoint also answers as an SSE frame, so both are parsed.
        text = f"event: message\ndata: {json.dumps(envelope)}\n\n"
        return httpx.Response(200, text=text, headers={"content-type": "text/event-stream"})


@pytest.fixture(autouse=True)
def clean_caches() -> Iterator[None]:
    mcp_module._reset_for_tests()
    lifecycle_module._reset_for_tests()
    yield
    mcp_module._reset_for_tests()
    lifecycle_module._reset_for_tests()


@pytest.fixture
def deploy(monkeypatch: pytest.MonkeyPatch) -> Deploy:
    stub = Deploy()
    _serve(monkeypatch, stub)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")
    return stub


def _serve(monkeypatch: pytest.MonkeyPatch, stub: Deploy) -> None:
    client = httpx.Client(transport=httpx.MockTransport(stub.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)


def tool_calls(deploy: Deploy, name: str) -> list[dict[str, Any]]:
    return [args for called, args in deploy.calls if called == name]


# ---- the handshake -----------------------------------------------------------


def test_the_transport_handshake_runs_once(deploy: Deploy) -> None:
    """Two round trips that say nothing about the query — not worth repeating."""
    with session(traced=True):
        Tournaments.objects().page(limit=1)
        Tournaments.objects().page(limit=1)

    assert deploy.rpc_methods.count("initialize") == 1
    assert deploy.rpc_methods.count("notifications/initialized") == 1


def test_the_session_id_and_network_travel_in_headers(deploy: Deploy) -> None:
    with session(traced=True):
        Tournaments.objects().page(limit=1)

    call_headers = deploy.headers[-1]
    assert call_headers["mcp-session-id"] == "sess-1"
    assert call_headers["x-kn-id"] == KN
    assert call_headers["mcp-protocol-version"] == "2024-11-05"
    assert "text/event-stream" in call_headers["accept"]


def test_an_sse_framed_response_is_parsed_too(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = Deploy(sse=True)
    _serve(monkeypatch, stub)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")

    with session(traced=True):
        page = Tournaments.objects().page(limit=1)

    assert page.rows[0].tournament_id == "WC-1966"
    assert page.receipt == RECEIPT


# ---- the interaction ---------------------------------------------------------


def test_one_interaction_serves_every_read_in_the_scope(deploy: Deploy) -> None:
    """One per read would cost a round trip each and shatter the evidence chain."""
    with session(traced=True):
        Tournaments.objects().page(limit=1)
        Tournaments.objects().page(limit=1)
        Tournaments.objects().count()

    assert len(tool_calls(deploy, "bkn_start_interaction")) == 1


def test_every_read_carries_the_two_ids_and_nothing_else(deploy: Deploy) -> None:
    """This contract rejects any other field in `bkn_context` outright."""
    with session(traced=True):
        Tournaments.objects().page(limit=1)

    context = tool_calls(deploy, "query_object_instance")[0]["bkn_context"]
    assert context == {"conversation_id": "conv_1", "interaction_id": "int_1"}


def test_the_interaction_is_finished_on_the_way_out(deploy: Deploy) -> None:
    with session(traced=True):
        Tournaments.objects().page(limit=1)

    assert tool_calls(deploy, "bkn_finish_interaction") == [
        {"interaction_id": "int_1", "outcome": "completed"}
    ]


def test_an_exception_finishes_the_interaction_as_failed(deploy: Deploy) -> None:
    """The turn is closed either way; leaving it open would strand the evidence."""
    with pytest.raises(RuntimeError), session(traced=True):
        Tournaments.objects().page(limit=1)
        raise RuntimeError("boom")

    assert tool_calls(deploy, "bkn_finish_interaction")[0]["outcome"] == "failed"


def test_a_scope_that_reads_nothing_opens_no_interaction(deploy: Deploy) -> None:
    """Opening one eagerly would bill a turn for a scope that never asked a question."""
    with session(traced=True):
        pass

    assert deploy.calls == []


def test_each_scope_gets_its_own_interaction(deploy: Deploy) -> None:
    with session(traced=True):
        Tournaments.objects().page(limit=1)
    with session(traced=True):
        Tournaments.objects().page(limit=1)

    assert [args["interaction_id"] for args in tool_calls(deploy, "bkn_finish_interaction")] == [
        "int_1",
        "int_2",
    ]


def test_a_traced_read_outside_a_scope_says_how_to_open_one() -> None:
    from bkn_osdk import Context
    from bkn_osdk.query import ObjectSet

    traced = Context(base_url=PLATFORM, token="t-1", traced=True)

    with pytest.raises(BknError, match="traced=True"):
        ObjectSet(Tournaments).with_context(traced).page(limit=1)


# ---- what the traced path sends and returns ----------------------------------


def test_the_query_arguments_name_the_network_and_object_type(deploy: Deploy) -> None:
    with session(traced=True):
        Tournaments.objects().where(Tournaments.tournament_id == "WC-1966").page(limit=2)

    arguments = tool_calls(deploy, "query_object_instance")[0]
    assert arguments["kn_id"] == KN
    assert arguments["ot_id"] == "tournaments"
    assert arguments["limit"] == 2
    assert arguments["condition"]["field"] == "tournament_id"


def test_a_query_the_tool_cannot_answer_takes_the_rest_path(deploy: Deploy) -> None:
    """The tool accepts `sort` and `need_total` and honours neither. Dropping them
    would answer an unsorted page, or a count of zero for a set with matches —
    so the query goes over REST instead, carrying the scope's turn."""
    with session(traced=True):
        Tournaments.objects().order_by(Tournaments.tournament_id.desc()).count()

    assert tool_calls(deploy, "query_object_instance") == []
    read = deploy.rest_bodies[-1]
    assert read["sort"] == [{"field": "tournament_id", "direction": "desc"}]
    assert read["need_total"] is True
    assert read["bkn_context"]["interaction_id"] == "int_1"


def test_a_query_the_tool_can_answer_still_goes_over_it(deploy: Deploy) -> None:
    """Only what the tool cannot do moves; a plain read keeps its receipt."""
    with session(traced=True):
        Tournaments.objects().take(1)

    assert len(tool_calls(deploy, "query_object_instance")) == 1


def test_the_receipt_reaches_the_page_and_every_row(deploy: Deploy) -> None:
    """A caller citing one instance should not have to thread the page around."""
    with session(traced=True):
        page = Tournaments.objects().page(limit=1)

    assert page.receipt == RECEIPT
    assert page.rows[0].__receipt__ == RECEIPT


def test_receipts_accumulate_on_the_interaction(deploy: Deploy) -> None:
    with session(traced=True):
        Tournaments.objects().page(limit=1)
        Tournaments.objects().page(limit=1)
        registry = lifecycle_module.interaction_scope().get() or {}
        assert len(registry[KN].receipts) == 2


def test_an_untraced_read_keeps_the_rest_path_and_has_no_receipt(deploy: Deploy) -> None:
    page = Tournaments.objects().page(limit=1)

    assert page.receipt is None
    assert deploy.calls == []


# ---- deploys that speak something else ---------------------------------------


def test_a_deploy_without_the_lifecycle_tool_says_to_read_untraced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub = Deploy(tools=("query_object_instance",))
    _serve(monkeypatch, stub)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")

    with pytest.raises(BknError, match="no bkn_start_interaction"), session(traced=True):
        Tournaments.objects().page(limit=1)


def test_the_older_two_step_contract_is_refused_rather_than_guessed_at(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`bkn_create_conversation` is a contract this runtime has never exercised."""
    stub = Deploy(tools=("bkn_create_conversation", "bkn_start_interaction"))
    _serve(monkeypatch, stub)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")

    with pytest.raises(BknError, match="bkn_create_conversation"), session(traced=True):
        Tournaments.objects().page(limit=1)


def test_a_tool_error_keeps_its_structured_code(monkeypatch: pytest.MonkeyPatch) -> None:
    """`conversation_required` is `retryable: false` — a runtime bug, not a retry."""
    stub = Deploy()

    def failing(name: str) -> httpx.Response:
        if name != "query_object_instance":
            return Deploy._respond(stub, name)
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "isError": True,
                    "content": [{"type": "text", "text": "no session"}],
                    "structuredContent": {
                        "error": {
                            "code": "conversation_required",
                            "required_action": "bkn_start_interaction",
                            "retryable": False,
                        }
                    },
                },
            },
        )

    monkeypatch.setattr(stub, "_respond", failing)
    _serve(monkeypatch, stub)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")

    with pytest.raises(ToolError) as excinfo, session(traced=True):
        Tournaments.objects().page(limit=1)

    assert excinfo.value.code == "conversation_required"
    assert excinfo.value.required_action == "bkn_start_interaction"
    assert excinfo.value.retryable is False


# ---- a turn the caller already owns -------------------------------------------


def test_a_caller_owned_turn_is_joined_rather_than_replaced(
    deploy: Deploy, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The sandbox injects both ids per execution; that turn is the real one."""
    monkeypatch.setenv("BKN_CONVERSATION_ID", "host-conv")
    monkeypatch.setenv("BKN_INTERACTION_ID", "host-int")

    with session(traced=True):
        Tournaments.objects().page(limit=1)

    assert tool_calls(deploy, "bkn_start_interaction") == []
    assert tool_calls(deploy, "query_object_instance")[0]["bkn_context"] == {
        "conversation_id": "host-conv",
        "interaction_id": "host-int",
    }


def test_conversation_mode_is_sent_only_where_the_tool_declares_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two builds advertise the same tool names and disagree on the arguments —
    one declares the field required, the other never published it, and this
    contract rejects an argument it does not know."""
    declaring = Deploy(declares_conversation_mode=True)
    _serve(monkeypatch, declaring)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")

    with session(traced=True):
        Tournaments.objects().page(limit=1)

    assert tool_calls(declaring, "bkn_start_interaction")[0]["conversation_mode"] == "new"


def test_joining_a_conversation_continues_it_rather_than_starting_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    declaring = Deploy(declares_conversation_mode=True)
    _serve(monkeypatch, declaring)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")
    monkeypatch.setenv("BKN_CONVERSATION_ID", "host-conv")

    with session(traced=True):
        Tournaments.objects().page(limit=1)

    assert tool_calls(declaring, "bkn_start_interaction")[0]["conversation_mode"] == "continue"


def test_a_deploy_that_never_published_the_field_is_not_sent_it(deploy: Deploy) -> None:
    with session(traced=True):
        Tournaments.objects().page(limit=1)

    assert "conversation_mode" not in tool_calls(deploy, "bkn_start_interaction")[0]


def test_a_caller_owned_turn_is_never_finished(
    deploy: Deploy, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ending someone else's business turn early is not ours to do."""
    monkeypatch.setenv("BKN_CONVERSATION_ID", "host-conv")
    monkeypatch.setenv("BKN_INTERACTION_ID", "host-int")

    with session(traced=True):
        Tournaments.objects().page(limit=1)

    assert tool_calls(deploy, "bkn_finish_interaction") == []


def test_a_caller_named_conversation_is_joined_not_replaced(
    deploy: Deploy, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A conversation without an interaction is a supported input, not a half one:
    the turn opens inside it rather than in a fresh conversation nobody asked for."""
    monkeypatch.setenv("BKN_CONVERSATION_ID", "host-conv")

    with session(traced=True):
        Tournaments.objects().page(limit=1)

    started = tool_calls(deploy, "bkn_start_interaction")[0]
    assert started["conversation_id"] == "host-conv"


def test_our_own_turn_is_still_finished(deploy: Deploy) -> None:
    with session(traced=True):
        Tournaments.objects().page(limit=1)

    assert len(tool_calls(deploy, "bkn_finish_interaction")) == 1


# ---- the scope's registry, put back rather than blanked ---------------------


def test_a_traced_scope_that_read_nothing_leaves_no_scope_behind(deploy: Deploy) -> None:
    """An empty registry left installed looks like an open scope to the next
    call, which would then open a turn nobody is left to finish."""
    with session(traced=True):
        pass

    assert lifecycle_module.interaction_scope().get() is None

    search(KN, "who owns supply chain")  # outside any scope, so its own turn

    assert deploy.calls[-1][0] == "bkn_finish_interaction"


def test_an_inner_scope_does_not_stand_the_outer_one_down(deploy: Deploy) -> None:
    """Scopes nest, so what an inner one restores is the outer registry — not nothing."""
    with session(traced=True):
        Tournaments.take(1)
        with session(traced=True):
            Tournaments.take(1)
        Tournaments.take(1)  # the outer scope is still live and must still read

    assert deploy.calls.count(("bkn_start_interaction", deploy.calls[0][1])) >= 1
    assert [name for name, _ in deploy.calls].count("bkn_finish_interaction") == 2


# ---- an expired stored token, on the MCP transport too ----------------------


def test_the_mcp_transport_refreshes_an_expired_stored_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """REST self-heals; before this, every tool call in the same process did not."""
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("authorization", ""))
        if request.url.path.endswith("/mcp/info"):
            return httpx.Response(200, json={"tools": []})
        if seen[-1] == "Bearer stale":
            return httpx.Response(401, json={"error": "expired"})
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": 1, "result": {}},
            headers={"mcp-session-id": "sess-1"},
        )

    client = httpx.Client(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    monkeypatch.setattr("bkn_osdk.auth.refreshed_token", lambda _ctx, _token: "fresh")
    stored = Context(
        base_url=PLATFORM,
        token="stale",
        credential=StoredCredential(base_url=PLATFORM, user_id="u", refresh_token="r"),
    )

    mcp_module._raw_post(stored, KN, None, {"jsonrpc": "2.0", "method": "initialize"})

    assert seen == ["Bearer stale", "Bearer fresh"]


# ---- what a dead session looks like, and what is not one --------------------


def rejecting(monkeypatch: pytest.MonkeyPatch, status: int, body: str) -> list[str]:
    """A deploy that answers every tool call with one status, recording the calls."""
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.read())
        method = payload.get("method", "")
        if method == "initialize":
            return httpx.Response(200, json={"result": {}}, headers={"mcp-session-id": "sess-1"})
        if method == "notifications/initialized":
            return httpx.Response(202, json={})
        seen.append(payload["params"]["name"])
        return httpx.Response(status, text=body)

    client = httpx.Client(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    return seen


def test_a_400_is_not_treated_as_a_dead_session(monkeypatch: pytest.MonkeyPatch) -> None:
    """Only 404 means the session is gone — both deploys answer `404 Invalid
    session ID`. Re-handshaking on a 400 would send a non-idempotent tool twice."""
    seen = rejecting(monkeypatch, 400, "bad argument")
    ctx = Context(base_url=PLATFORM, token="t-1")

    with pytest.raises(BknError, match="MCP transport failed: HTTP 400"):
        mcp_module.call_tool(ctx, KN, "bkn_start_interaction", {})

    assert seen == ["bkn_start_interaction"]  # sent once, not twice


def test_a_404_reopens_the_session_once(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = rejecting(monkeypatch, 404, "Invalid session ID")
    ctx = Context(base_url=PLATFORM, token="t-1")

    with pytest.raises(BknError, match="just issued"):
        mcp_module.call_tool(ctx, KN, "search_schema", {})

    assert seen == ["search_schema", "search_schema"]  # one retry, then a real message


def test_a_deploy_that_does_not_serve_the_catalog_can_still_open_a_turn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`/mcp/info` is a probe, not the read path. Losing it should cost the
    argument it informs, not every traced read."""
    stub = Deploy()

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/mcp/info"):
            return httpx.Response(404, text="not found")
        return stub.handle(request)

    client = httpx.Client(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")

    with session(traced=True):
        Tournaments.objects().take(1)

    started = tool_calls(stub, "bkn_start_interaction")[0]
    assert "conversation_mode" not in started  # unknown means unsent, not guessed
    assert stub.interactions == 1


def test_an_unreadable_catalog_is_retried_rather_than_remembered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A probe that fails once should not disable `conversation_mode` for the
    life of the process."""
    stub = Deploy(declares_conversation_mode=True)
    failures = [True]

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/mcp/info") and failures:
            failures.pop()
            return httpx.Response(503, text="try later")
        return stub.handle(request)

    client = httpx.Client(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")

    with session(traced=True):
        Tournaments.objects().take(1)
    with session(traced=True):
        Tournaments.objects().take(1)

    starts = tool_calls(stub, "bkn_start_interaction")
    assert "conversation_mode" not in starts[0]
    assert starts[1]["conversation_mode"] == "new"


def test_a_handshake_refused_at_its_own_notification_reads_as_a_deploy_problem(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The `initialized` notification carries the session id the server just
    issued, so it can be refused too — and that is not an internal signal to
    hand the caller."""

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.read())
        if body.get("method") == "initialize":
            return httpx.Response(200, json={"result": {}}, headers={"mcp-session-id": "sess-1"})
        return httpx.Response(404, text="Invalid session ID")

    client = httpx.Client(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)

    with pytest.raises(BknError, match="just issued"):
        mcp_module.call_tool(Context(base_url=PLATFORM, token="t-1"), KN, "search_schema", {})


def test_two_credentials_against_one_deploy_do_not_share_a_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The server binds a session to whoever opened it, so handing one user's
    session to another reads as the wrong user — or is refused outright."""
    handshakes: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.read())
        if body.get("method") == "initialize":
            bearer = request.headers["authorization"]
            handshakes.append(bearer)
            return httpx.Response(
                200, json={"result": {}}, headers={"mcp-session-id": f"sess-{len(handshakes)}"}
            )
        if body.get("method") == "notifications/initialized":
            return httpx.Response(202, json={})
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {"content": [{"type": "text", "text": json.dumps({"ok": True})}]},
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)

    for token in ("token-a", "token-b", "token-a"):
        mcp_module.call_tool(Context(base_url=PLATFORM, token=token), KN, "search_schema", {})

    assert handshakes == ["Bearer token-a", "Bearer token-b"]  # third call reuses the first


# ---- a refusal the platform itself calls transient ---------------------------


def failing(monkeypatch: pytest.MonkeyPatch, error: dict[str, Any], until: int) -> list[int]:
    """A deploy that fails the first `until` tool calls, then succeeds."""
    seen = [0]

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.read())
        if body.get("method") != "tools/call":
            return httpx.Response(200, json={"result": {}}, headers={"mcp-session-id": "s"})
        seen[0] += 1
        if seen[0] <= until:
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "isError": True,
                        "content": [{"type": "text", "text": json.dumps({"error": error})}],
                        "structuredContent": {"error": error},
                    },
                },
            )
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {"content": [{"type": "text", "text": json.dumps({"ok": True})}]},
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    monkeypatch.setattr("time.sleep", lambda _seconds: None)
    return seen


TRANSIENT = {
    "code": "trace_core_unavailable",
    "message": "BKN Trace Core is temporarily unavailable",
    "retryable": True,
    "required_action": "retry_later",
    "retry_after_ms": 0,
}


def test_a_retryable_refusal_is_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    """The platform says `retryable: true` for a dependency restarting under the
    call. Surfacing that to whoever asked for a read, when one short wait would
    have covered it, is a failure this SDK chose rather than met."""
    seen = failing(monkeypatch, TRANSIENT, until=1)

    result = mcp_module.call_tool(Context(base_url=PLATFORM, token="t-1"), KN, "search_schema", {})

    assert result.value == {"ok": True}
    assert seen[0] == 2


def test_retrying_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    """A dependency that is down stays down; a caller would rather hear so."""
    seen = failing(monkeypatch, TRANSIENT, until=99)

    with pytest.raises(ToolError, match="trace_core_unavailable"):
        mcp_module.call_tool(Context(base_url=PLATFORM, token="t-1"), KN, "search_schema", {})

    assert seen[0] == mcp_module.RETRY_ATTEMPTS + 1


def test_a_refusal_that_is_not_retryable_is_raised_at_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`conversation_required` is `retryable: false` — repeating it would only
    delay the turn the caller has to open."""
    seen = failing(
        monkeypatch,
        {"code": "conversation_required", "retryable": False, "required_action": "start"},
        until=99,
    )

    with pytest.raises(ToolError, match="conversation_required"):
        mcp_module.call_tool(Context(base_url=PLATFORM, token="t-1"), KN, "search_schema", {})

    assert seen[0] == 1


def test_a_turn_opened_for_a_call_that_raised_is_closed_as_failed(deploy: Deploy) -> None:
    """Every capability route opens one of these, so a turn recorded as
    `completed` after its call raised would be the common entry in the evidence
    chain rather than the rare one."""
    from bkn_osdk.lifecycle import ensure_interaction

    with (
        pytest.raises(RuntimeError),
        ensure_interaction(Context(base_url=PLATFORM, token="t-1"), KN),
    ):
        raise RuntimeError("the call this turn exists for")

    finished = [args for name, args in deploy.calls if name == "bkn_finish_interaction"]
    assert finished[-1]["outcome"] == "failed"


def test_a_turn_that_completed_is_closed_as_completed(deploy: Deploy) -> None:
    from bkn_osdk.lifecycle import ensure_interaction

    with ensure_interaction(Context(base_url=PLATFORM, token="t-1"), KN):
        pass

    finished = [args for name, args in deploy.calls if name == "bkn_finish_interaction"]
    assert finished[-1]["outcome"] == "completed"


def test_a_delay_the_platform_names_is_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    """`retry_after_ms: 30000` would block a read for a minute across two
    attempts — silently, and against the bound this promises."""
    failing(monkeypatch, {**TRANSIENT, "retry_after_ms": 30_000}, until=99)
    slept: list[float] = []
    monkeypatch.setattr("time.sleep", slept.append)  # after `failing`, which stubs it too

    with pytest.raises(ToolError):
        mcp_module.call_tool(Context(base_url=PLATFORM, token="t-1"), KN, "search_schema", {})

    assert slept and max(slept) <= mcp_module.RETRY_MAX_WAIT_SECONDS
