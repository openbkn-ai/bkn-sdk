# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Traversal: one hop, expressed as a filter on the target object type.

The schema declares the join columns, so `order.buyer` is
`User.where(User.user_id == order.user_id)` — the same REST read path as any
other query, with no lifecycle session and no second grammar. Multi-hop paths
are what `query_instance_subgraph` is for and are not modelled here.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from bkn_osdk import Context, InputError, SchemaDriftError
from bkn_osdk import http as http_module
from bkn_osdk.query import Comparison, Composite, ObjectSet, to_condition
from bkn_osdk.types import ObjectType, Property, Relation

CONTEXT = Context(base_url="https://platform.example", token="t-1")


class User(ObjectType):
    __kn_id__ = "kn"
    __bkn_id__ = "user"
    __primary_key__ = ("user_id",)

    user_id = Property[int]("user_id")
    name = Property[str]("name")


class OrderItem(ObjectType):
    __kn_id__ = "kn"
    __bkn_id__ = "order_item"
    __primary_key__ = ("order_id", "item_no")

    order_id = Property[int]("order_id")
    item_no = Property[int]("item_no")


class Order(ObjectType):
    __kn_id__ = "kn"
    __bkn_id__ = "order"
    __primary_key__ = ("order_id",)

    order_id = Property[int]("order_id")
    user_id = Property[int]("user_id")
    channel_id = Property[int]("channel_id")

    buyer = Relation["User"]("rel_order_user", target="user", join=(("user_id", "user_id"),))
    items = Relation["OrderItem"](
        "rel_order_item", target="order_item", join=(("order_id", "order_id"),)
    )
    composite = Relation["OrderItem"](
        "rel_order_composite",
        target="order_item",
        join=(("order_id", "order_id"), ("channel_id", "item_no")),
    )
    orphan = Relation["User"]("rel_orphan", target="missing_type", join=(("user_id", "x"),))
    unjoined = Relation["User"]("rel_unjoined", target="user")


ROW = {"order_id": 10357, "user_id": 42845, "channel_id": 1, "_instance_id": "order-10357"}


class Sent:
    """Every request the traversal made: where it went and what it asked."""

    def __init__(self) -> None:
        self.paths: list[str] = []
        self.bodies: list[dict[str, Any]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        self.bodies.append(json.loads(request.read()))
        return httpx.Response(200, json={"datas": [{"user_id": 42845, "name": "Zhang San"}]})

    def __getitem__(self, index: int) -> dict[str, Any]:
        return self.bodies[index]


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> Sent:
    recorder = Sent()
    client = httpx.Client(transport=httpx.MockTransport(recorder.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    return recorder


def test_class_access_returns_the_declaration() -> None:
    assert isinstance(Order.buyer, Relation)
    assert Order.buyer.target == "user"


def test_instance_access_returns_a_set_of_the_target_type() -> None:
    hop = Order(ROW).buyer

    assert isinstance(hop, ObjectSet)
    assert hop.object_type is User


def test_the_hop_filters_the_target_on_the_declared_join() -> None:
    condition = to_condition(Order(ROW).buyer.filter)  # type: ignore[arg-type]

    assert condition == {
        "operation": "==",
        "field": "user_id",
        "value": 42845,
        "value_from": "const",
    }


def test_a_multi_column_join_ands_its_parts() -> None:
    combined = Order(ROW).composite.filter

    assert isinstance(combined, Composite)
    assert combined.operation == "and"
    assert combined.sub_conditions == (
        Comparison("==", "order_id", 10357),
        Comparison("==", "item_no", 1),
    )


def test_a_hop_is_an_ordinary_set_so_it_pages_and_orders(sent: Sent) -> None:
    """The point of expressing traversal as a filter: everything else already works."""
    Order(ROW).items.with_context(CONTEXT).order_by(OrderItem.item_no.desc()).take(5)

    assert sent[0]["limit"] == 5
    assert sent[0]["sort"] == [{"field": "item_no", "direction": "desc"}]
    assert sent[0]["condition"]["field"] == "order_id"


def test_a_hop_can_be_narrowed_further(sent: Sent) -> None:
    Order(ROW).items.with_context(CONTEXT).where(OrderItem.item_no > 2).take(5)

    assert sent[0]["condition"]["operation"] == "and"
    assert len(sent[0]["condition"]["sub_conditions"]) == 2


def test_the_hop_queries_the_target_object_type(sent: Sent) -> None:
    """The request goes to the target's endpoint — the source is only the filter."""
    Order(ROW).buyer.with_context(CONTEXT).take(1)

    assert sent.paths == ["/api/ontology-query/v1/knowledge-networks/kn/object-types/user"]


def test_rows_come_back_as_the_target_type(sent: Sent) -> None:
    rows = Order(ROW).buyer.with_context(CONTEXT).take(1)

    assert isinstance(rows[0], User)
    assert rows[0].name == "Zhang San"


def test_traversing_without_the_join_property_says_to_select_it() -> None:
    """A property selection that dropped the join column is the likely cause."""
    partial = Order({"order_id": 1})

    with pytest.raises(SchemaDriftError) as excinfo:
        partial.buyer  # noqa: B018

    assert "user_id" in str(excinfo.value)
    assert "select it" in str(excinfo.value)


def test_a_relation_with_no_join_columns_is_refused() -> None:
    with pytest.raises(InputError, match="no join columns"):
        Order(ROW).unjoined  # noqa: B018


def test_a_relation_pointing_outside_the_package_says_to_regenerate() -> None:
    with pytest.raises(SchemaDriftError, match="does not define"):
        Order(ROW).orphan  # noqa: B018
