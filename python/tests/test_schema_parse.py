# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Parsing the schema, against payloads recorded from a live platform.

The fixtures under `tests/fixtures/schema/` are what
`https://14.103.77.23` answered for `ecommerce_ops_bkn_public` on 2026-08-12 —
captured, not authored, so the parser is tested against the shape the backend
actually sends. Re-record with `scripts/capture_schema_fixtures.py`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from bkn_osdk.schema import parse_schema

FIXTURES = Path(__file__).parent / "fixtures" / "schema" / "ecommerce_ops_bkn_public"


def payload(name: str) -> Any:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def schema() -> Any:
    return parse_schema(payload("network"), payload("object_types"), payload("relation_types"))


def test_the_network_itself(schema: Any) -> None:
    assert schema.kn_id == "ecommerce_ops_bkn_public"
    assert schema.branch == "main"
    assert schema.display_name == "电商经营决策知识网络"


def test_every_object_type_is_parsed(schema: Any) -> None:
    """20 object types, 18 relation types — the counts the live platform reports."""
    assert len(schema.object_types) == 20
    assert len(schema.relation_types) == 18


def test_an_object_type_carries_its_keys_and_properties(schema: Any) -> None:
    order = next(o for o in schema.object_types if o.bkn_id == "order")

    assert order.primary_key == ("order_id",)
    assert order.display_key == "order_no"
    assert order.display_name == "销售订单"
    assert {prop.bkn_id for prop in order.properties} >= {
        "order_id",
        "order_no",
        "total_amount",
        "created_at",
        "order_status",
    }


def test_property_types_come_through_as_the_platform_declares_them(schema: Any) -> None:
    order = next(o for o in schema.object_types if o.bkn_id == "order")
    types = {prop.bkn_id: prop.type for prop in order.properties}

    assert types["order_id"] == "integer"
    assert types["total_amount"] == "decimal"
    assert types["created_at"] == "datetime"
    assert types["order_no"] == "string"


def test_computed_properties_are_left_out(schema: Any) -> None:
    """A live instance query returns no `logic_properties`, so generating them would
    produce attributes that always raise. The raw payload has them; the schema must not."""
    raw = next(e for e in payload("object_types")["entries"] if e["id"] == "order")
    order = next(o for o in schema.object_types if o.bkn_id == "order")

    assert any(prop["name"].startswith("lp_") for prop in raw["logic_properties"])
    assert not any(prop.bkn_id.startswith("lp_") for prop in order.properties)


def test_relations_carry_their_endpoints_and_join_columns(schema: Any) -> None:
    relation = next(r for r in schema.relation_types if r.bkn_id == "rel_order_user")

    assert (relation.source, relation.target) == ("order", "user")
    assert relation.mapping_rules == (("user_id", "user_id"),)
    assert relation.display_name == "订单属于用户"


def test_empty_strings_are_read_as_absent(schema: Any) -> None:
    """The platform writes `""` where it means "unset" — `color`, `icon`, and often `comment`."""
    assert all(o.display_name for o in schema.object_types)
    assert all(r.display_name for r in schema.relation_types)


def test_parsing_is_pure_and_tolerates_a_missing_envelope() -> None:
    """A bare list, an empty payload, or junk must not raise inside the generator's input."""
    assert parse_schema({}, None, None).object_types == ()
    assert parse_schema({"id": "kn"}, [], []).kn_id == "kn"
    assert parse_schema({"id": "kn"}, {"entries": "nonsense"}, {}).object_types == ()


def test_the_same_payload_parses_to_the_same_schema(schema: Any) -> None:
    """Parsing must be deterministic, or the fingerprint it feeds is worthless."""
    again = parse_schema(payload("network"), payload("object_types"), payload("relation_types"))

    assert again == schema
