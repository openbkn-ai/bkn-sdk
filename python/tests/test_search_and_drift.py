# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Two capabilities that hang off the package rather than off a class.

`search` is network-level — its request body has no object-type dimension at
all — and the schema check is per network too. Both are therefore reached
through the generated package, not through `People`.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import replace
from typing import Any

import httpx
import pytest
from schema_fixtures import DEMO_SCHEMA

from bkn_osdk import Context, SchemaDriftError, configure, search
from bkn_osdk import http as http_module
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


class Sent:
    def __init__(self) -> None:
        self.paths: list[str] = []
        self.bodies: list[dict[str, Any]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        self.bodies.append(json.loads(request.read()))
        return httpx.Response(200, json={"concepts": [], "datas": []})


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> Sent:
    recorder = Sent()
    client = httpx.Client(transport=httpx.MockTransport(recorder.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    return recorder


# ---- search -----------------------------------------------------------------


def test_search_sends_the_network_level_body(sent: Sent) -> None:
    """No object-type dimension exists in this request — which is why it is not on a class."""
    search(KN, "who owns supply chain", context=CONTEXT)

    assert sent.paths == ["/api/agent-retrieval/v1/kn/semantic-search"]
    assert sent.bodies[0] == {
        "kn_id": KN,
        "query": "who owns supply chain",
        "mode": "keyword_vector_retrieval",
        "max_concepts": 10,
        "return_query_understanding": False,
    }


def test_search_options_reach_the_body(sent: Sent) -> None:
    search(KN, "q", mode="vector", max_concepts=3, return_query_understanding=True, context=CONTEXT)

    assert sent.bodies[0]["mode"] == "vector"
    assert sent.bodies[0]["max_concepts"] == 3
    assert sent.bodies[0]["return_query_understanding"] is True


def test_search_returns_the_platform_result_unchanged(sent: Sent) -> None:
    """Whether a hit resolves to a typed instance is not yet known, so nothing is invented."""
    assert search(KN, "q", context=CONTEXT) == {"concepts": [], "datas": []}


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
