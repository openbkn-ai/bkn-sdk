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

from bkn_osdk import BknError, ToolError, session
from bkn_osdk import http as http_module
from bkn_osdk import lifecycle as lifecycle_module
from bkn_osdk import mcp as mcp_module
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
        self.interactions = 0

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/mcp/info"):
            return httpx.Response(200, json={"tools": [self._tool(n) for n in self.tools]})
        if not request.url.path.endswith("/mcp"):
            return httpx.Response(200, json={"datas": []})  # the REST read path

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


def test_an_older_deploys_result_wrapper_is_unwrapped() -> None:
    """One deploy wraps a tool's payload in `result` and another does not, and a
    caller cannot tell which it reached — so the transport settles it."""
    from bkn_osdk.mcp import _unwrap

    wrapped = {
        "result": {
            "content": [{"type": "text", "text": json.dumps({"result": {"id": "kn", "types": []}})}]
        }
    }

    assert _unwrap(wrapped).value == {"id": "kn", "types": []}


def test_a_payload_whose_own_field_is_called_result_is_left_alone() -> None:
    """Unwrapping is for the envelope, not for a field that happens to share its name."""
    from bkn_osdk.mcp import _unwrap

    payload = {"result": "ok", "count": 2}
    body = {"result": {"content": [{"type": "text", "text": json.dumps(payload)}]}}

    assert _unwrap(body).value == payload


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


def test_rest_only_arguments_are_dropped_rather_than_ignored_in_silence(deploy: Deploy) -> None:
    """The tool accepts neither `sort` nor `need_total`, and says nothing about it."""
    with session(traced=True):
        Tournaments.objects().order_by(Tournaments.tournament_id.desc()).count()

    arguments = tool_calls(deploy, "query_object_instance")[0]
    assert "sort" not in arguments
    assert "need_total" not in arguments


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
