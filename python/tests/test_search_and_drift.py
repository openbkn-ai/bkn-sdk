# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Two capabilities that hang off the package rather than off a class.

`search` is network-level — its request carries no object-type dimension at all
— and the schema check is per network too. Both are therefore reached through
the generated package, not through `People`.

Search goes out as the `search_schema` MCP tool, the same call the TypeScript
SDK makes, so one contract covers both clients.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import replace
from typing import Any

import httpx
import pytest
from schema_fixtures import DEMO_SCHEMA

from bkn_osdk import Context, SchemaDriftError, configure, search, search_instances
from bkn_osdk import http as http_module
from bkn_osdk import lifecycle as lifecycle_module
from bkn_osdk import mcp as mcp_module
from bkn_osdk import meta as meta_module
from bkn_osdk.schema import PropertyDef, fingerprint
from bkn_osdk.types import ObjectType, Property

CONTEXT = Context(base_url="https://platform.example", token="t-1")
KN = "ecommerce_ops_bkn_public"


class Order(ObjectType):
    __kn_id__ = KN
    __bkn_id__ = "order"
    __primary_key__ = ("order_id",)

    order_id = Property[int]("order_id")


RESULT = {"object_types": [{"id": "people"}], "relation_types": []}


class Sent:
    """Records the REST reads and the MCP tool calls a test provokes."""

    def __init__(self) -> None:
        self.paths: list[str] = []
        self.bodies: list[dict[str, Any]] = []
        self.tools: list[tuple[str, dict[str, Any]]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        if request.url.path.endswith("/mcp/info"):
            return httpx.Response(
                200,
                json={
                    "tools": [{"name": "bkn_start_interaction"}, {"name": "bkn_finish_interaction"}]
                },
            )
        if not request.url.path.endswith("/mcp"):
            self.bodies.append(json.loads(request.read()))
            return httpx.Response(200, json={"datas": []})

        body = json.loads(request.read())
        if body["method"] != "tools/call":
            return httpx.Response(200, json={"result": {}}, headers={"mcp-session-id": "s"})
        name = body["params"]["name"]
        if name in ("bkn_start_interaction", "bkn_finish_interaction"):
            payload = (
                {"conversation_id": "c1", "interaction_id": "i1"}
                if name == "bkn_start_interaction"
                else {"execution_status": "completed"}
            )
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {"content": [{"type": "text", "text": json.dumps(payload)}]},
                },
            )
        self.tools.append((name, body["params"]["arguments"]))
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {"content": [{"type": "text", "text": json.dumps(RESULT)}]},
            },
        )

    @property
    def arguments(self) -> dict[str, Any]:
        return self.tools[0][1]

    @property
    def tool_names(self) -> list[str]:
        return [name for name, _ in self.tools]


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> Sent:
    recorder = Sent()
    client = httpx.Client(transport=httpx.MockTransport(recorder.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    mcp_module._reset_for_tests()
    lifecycle_module._reset_for_tests()
    return recorder


# ---- search -----------------------------------------------------------------


def test_search_calls_the_same_tool_the_typescript_sdk_calls(sent: Sent) -> None:
    """One contract for both clients — and the network rides in the header, not the body."""
    search(KN, "who owns supply chain", context=CONTEXT)

    assert sent.tools[0][0] == "search_schema"
    assert sent.arguments["query"] == "who owns supply chain"
    assert sent.arguments["response_format"] == "json"
    assert "kn_id" not in sent.arguments  # the network rides in the header
    assert sent.paths[-1] == "/api/agent-retrieval/v1/mcp"


def test_only_the_options_that_were_given_are_sent(sent: Sent) -> None:
    """An omitted option is left out rather than sent as a guessed default."""
    search(KN, "q", max_concepts=3, search_scope={"include_action_types": False}, context=CONTEXT)

    assert sent.arguments["max_concepts"] == 3
    assert sent.arguments["search_scope"] == {"include_action_types": False}
    assert "include_columns" not in sent.arguments


def test_search_returns_the_platform_result_unchanged(sent: Sent) -> None:
    """Whether a hit resolves to a typed instance is not yet known, so nothing is invented."""
    assert search(KN, "q", context=CONTEXT) == RESULT


def test_instance_search_asks_for_rows_rather_than_types(sent: Sent) -> None:
    """The other question: not "which types answer this" but "which rows do"."""
    search_instances(KN, "Lionel Messi", context=CONTEXT)

    assert sent.tool_names == ["search_instance"]
    assert sent.arguments["query"] == "Lionel Messi"
    assert sent.arguments["kn_id"] == KN


def test_a_capability_tool_opens_a_turn_rather_than_being_refused_once(sent: Sent) -> None:
    """The catalog declares `bkn_context` required for all of them, so spending a
    first attempt to be told that would be a round trip bought with nothing."""
    search_instances(KN, "Lionel Messi", context=CONTEXT)

    assert sent.arguments["bkn_context"] == {"conversation_id": "c1", "interaction_id": "i1"}


def test_instance_search_narrows_to_the_types_it_was_given(sent: Sent) -> None:
    search_instances(KN, "Messi", object_types=["players"], rerank=True, context=CONTEXT)

    assert sent.arguments["object_types"] == ["players"]
    assert sent.arguments["rerank"] is True
    assert "max_object_types" not in sent.arguments  # unset stays unsent


# ---- the opt-in schema check -------------------------------------------------


@pytest.fixture(autouse=True)
def clean_registry() -> Iterator[None]:
    """The package registry is process-wide, like the import it records."""
    meta_module._packages.clear()
    meta_module._checked.clear()
    yield
    meta_module._packages.clear()
    meta_module._checked.clear()


def register(fingerprint_value: str) -> None:
    meta_module.validate_package(
        "bkn", 1, ">=0.1,<0.2", kn_id=KN, branch="main", fingerprint=fingerprint_value
    )


def serve_schema(monkeypatch: pytest.MonkeyPatch, schema: Any) -> list[str]:
    """Answer `fetch_schema` from a fixture, recording each call."""
    calls: list[str] = []

    def fetch(_ctx: Context, kn_id: str, branch: str = "main") -> Any:
        calls.append(kn_id)
        return schema

    monkeypatch.setattr("bkn_osdk.schema.fetch_schema", fetch)
    return calls


def test_the_check_is_off_unless_asked_for(sent: Sent, monkeypatch: pytest.MonkeyPatch) -> None:
    """It costs a round trip, and CI already has `bkn-osdk check`."""
    register("whatever")
    calls = serve_schema(monkeypatch, DEMO_SCHEMA)

    Order.objects().with_context(CONTEXT).take(1)

    assert calls == []


def test_an_unchanged_schema_passes_the_check(sent: Sent, monkeypatch: pytest.MonkeyPatch) -> None:
    register(fingerprint(DEMO_SCHEMA))
    calls = serve_schema(monkeypatch, DEMO_SCHEMA)
    checked = replace(CONTEXT, check_schema=True)

    Order.objects().with_context(checked).take(1)

    assert calls == [KN]


def test_a_moved_schema_fails_the_first_query(sent: Sent, monkeypatch: pytest.MonkeyPatch) -> None:
    register("a3f9c2e1" * 8)
    serve_schema(monkeypatch, DEMO_SCHEMA)
    checked = replace(CONTEXT, check_schema=True)

    with pytest.raises(SchemaDriftError) as excinfo:
        Order.objects().with_context(checked).take(1)

    message = str(excinfo.value)
    assert "bkn-osdk generate" in message
    assert "bkn-osdk check" in message


def test_the_check_costs_one_round_trip_per_process(
    sent: Sent, monkeypatch: pytest.MonkeyPatch
) -> None:
    register(fingerprint(DEMO_SCHEMA))
    calls = serve_schema(monkeypatch, DEMO_SCHEMA)
    checked = replace(CONTEXT, check_schema=True)

    Order.objects().with_context(checked).take(1)
    Order.objects().with_context(checked).take(1)
    Order.objects().with_context(checked).count()

    assert calls == [KN]


def test_a_network_with_no_imported_package_is_not_checked(
    sent: Sent, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Nothing was registered, so there is no fingerprint to compare against."""
    calls = serve_schema(monkeypatch, DEMO_SCHEMA)
    checked = replace(CONTEXT, check_schema=True)

    Order.objects().with_context(checked).take(1)

    assert calls == []


def test_configure_carries_the_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BKN_BASE_URL", "https://platform.example")
    monkeypatch.setenv("BKN_TOKEN", "t-1")
    configure(check_schema=True)

    from bkn_osdk import resolve_context

    assert resolve_context().check_schema is True


def test_an_added_property_is_drift_too(sent: Sent, monkeypatch: pytest.MonkeyPatch) -> None:
    """Additive or not, the package no longer matches — `check` classifies it, this reports it."""
    register(fingerprint(DEMO_SCHEMA))
    people = next(o for o in DEMO_SCHEMA.object_types if o.bkn_id == "people")
    grown = replace(people, properties=(*people.properties, PropertyDef("nickname", "string")))
    moved = replace(
        DEMO_SCHEMA,
        object_types=tuple(grown if o.bkn_id == "people" else o for o in DEMO_SCHEMA.object_types),
    )
    serve_schema(monkeypatch, moved)

    with pytest.raises(SchemaDriftError):
        Order.objects().with_context(replace(CONTEXT, check_schema=True)).take(1)


def test_two_branches_of_one_network_are_both_checked(
    sent: Sent, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Comparing a release branch against main means two packages for one
    network in one process; checking only whichever registered first would
    compare against the wrong one."""
    meta_module.validate_package(
        "bkn", 1, ">=0.1,<0.2", kn_id=KN, branch="main", fingerprint=fingerprint(DEMO_SCHEMA)
    )
    meta_module.validate_package(
        "bkn_release", 1, ">=0.1,<0.2", kn_id=KN, branch="release", fingerprint="a3f9c2e1" * 8
    )
    calls = serve_schema(monkeypatch, DEMO_SCHEMA)
    checked = replace(CONTEXT, check_schema=True)

    with pytest.raises(SchemaDriftError, match="branch release"):
        Order.objects().with_context(checked).take(1)

    assert calls == [KN, KN]  # both branches, not just the first registered
