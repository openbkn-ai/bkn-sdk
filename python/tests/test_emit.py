# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The generator: golden output, determinism, and the ids it refuses to name.

Changing what the emitter writes means updating the goldens in the same commit —
that is the point of them. What must never change without a `FORMAT_VERSION`
bump is the *shape*.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from schema_fixtures import DEMO_SCHEMA

from bkn_osdk.codegen.emit import (
    FORMAT_VERSION,
    GenOptions,
    NamingError,
    class_name,
    generate,
    property_name,
)
from bkn_osdk.schema import KnSchema, ObjectTypeDef, PropertyDef, RelationTypeDef

GOLDEN_DIR = Path(__file__).parent / "fixtures" / "golden" / "demo"
OPTIONS = GenOptions(package="bkn", generated_by="bkn-osdk 0.1.0")


def demo() -> dict[str, str]:
    return generate(DEMO_SCHEMA, OPTIONS)


# ---- golden output ----------------------------------------------------------


@pytest.mark.parametrize(
    "filename", ["__init__.py", "_meta.py", "object_types.py", "relation_types.py"]
)
def test_the_emitted_file_matches_its_golden(filename: str) -> None:
    assert demo()[filename] == (GOLDEN_DIR / filename).read_text(encoding="utf-8")


def test_the_file_set_and_its_order_are_fixed() -> None:
    assert list(demo()) == [
        "__init__.py",
        "_meta.py",
        "metrics.py",
        "object_types.py",
        "relation_types.py",
        "py.typed",
    ]


def test_a_generated_package_declares_itself_typed() -> None:
    """Without `py.typed`, a consumer's mypy ignores every annotation we emit."""
    assert demo()["py.typed"] == ""


def test_regenerating_an_unchanged_schema_is_byte_identical() -> None:
    """The whole upgrade story rests on this: an unchanged schema means an empty diff."""
    assert generate(DEMO_SCHEMA, OPTIONS) == generate(DEMO_SCHEMA, OPTIONS)


def test_source_order_does_not_reach_the_output() -> None:
    """The platform is free to list types in any order; the output must not move."""
    shuffled = KnSchema(
        kn_id=DEMO_SCHEMA.kn_id,
        branch=DEMO_SCHEMA.branch,
        display_name=DEMO_SCHEMA.display_name,
        object_types=tuple(reversed(DEMO_SCHEMA.object_types)),
        relation_types=tuple(reversed(DEMO_SCHEMA.relation_types)),
    )

    assert generate(shuffled, OPTIONS) == demo()


# ---- what lands in the files ------------------------------------------------


def test_meta_carries_the_fingerprint_and_the_version_pair() -> None:
    meta = demo()["_meta.py"]

    assert 'KN_ID = "ecommerce_ops_bkn_public"' in meta
    assert f"FORMAT_VERSION = {FORMAT_VERSION}" in meta
    assert 'REQUIRES_RUNTIME = ">=0.1,<0.2"' in meta
    assert 'GENERATED_BY = "bkn-osdk 0.1.0"' in meta


def test_a_schema_change_moves_the_fingerprint_in_the_emitted_meta() -> None:
    extended = KnSchema(
        kn_id=DEMO_SCHEMA.kn_id,
        object_types=(
            *DEMO_SCHEMA.object_types,
            ObjectTypeDef(
                bkn_id="team", properties=(PropertyDef(bkn_id="team_id", type="string"),)
            ),
        ),
        relation_types=DEMO_SCHEMA.relation_types,
    )

    assert generate(extended, OPTIONS)["_meta.py"] != demo()["_meta.py"]


@pytest.mark.parametrize(
    ("bkn_type", "annotation"),
    [
        ("string", "str"),
        ("text", "str"),
        ("integer", "int"),
        ("float", "float"),
        ("decimal", "Decimal"),
        ("boolean", "bool"),
        ("date", "date"),
        ("time", "time"),
        ("datetime", "datetime"),
        ("json", "Any"),
        ("binary", "bytes"),
        ("vector", "Any"),  # non-standard types pass through, per the specification
        ("", "Any"),
    ],
)
def test_the_type_table(bkn_type: str, annotation: str) -> None:
    schema = KnSchema(
        kn_id="kn",
        object_types=(
            ObjectTypeDef(bkn_id="thing", properties=(PropertyDef(bkn_id="value", type=bkn_type),)),
        ),
    )

    assert (
        f'value = Property[{annotation}]("value")' in generate(schema, OPTIONS)["object_types.py"]
    )


def test_only_the_imports_the_file_uses_are_emitted() -> None:
    schema = KnSchema(
        kn_id="kn",
        object_types=(
            ObjectTypeDef(bkn_id="thing", properties=(PropertyDef(bkn_id="name", type="string"),)),
        ),
    )

    emitted = generate(schema, OPTIONS)["object_types.py"]
    assert "from decimal import" not in emitted
    assert "from datetime import" not in emitted
    assert "from typing import" not in emitted


def test_a_composite_primary_key_survives_as_a_tuple() -> None:
    assert '__primary_key__ = ("order_id", "line_no")' in demo()["object_types.py"]


def test_a_single_primary_key_is_still_a_tuple() -> None:
    """`get()` handles one signature, not two, so the key is always a tuple."""
    assert '__primary_key__ = ("person_id",)' in demo()["object_types.py"]


def test_an_object_type_without_a_display_key_emits_nothing_for_it() -> None:
    order_line = demo()["object_types.py"].split("class OrderLine")[1].split("class ")[0]

    assert "__primary_key__" in order_line
    assert "__display_key__" not in order_line


def test_relation_endpoints_are_emitted_as_data() -> None:
    relations = demo()["relation_types.py"]

    assert 'bkn_id="order_to_line"' in relations
    assert 'source="order"' in relations
    assert "RELATION_TYPES: tuple[RelationTypeDef, ...] = (ORDER_TO_BUYER, ORDER_TO_LINE)" in (
        relations
    )


def test_an_empty_network_still_produces_an_importable_package() -> None:
    files = generate(KnSchema(kn_id="empty_kn"), OPTIONS)

    assert "OBJECT_TYPES: tuple[type[ObjectType], ...] = ()" in files["__init__.py"]
    assert "RELATION_TYPES: tuple[RelationTypeDef, ...] = ()" in files["relation_types.py"]


# ---- naming -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("bkn_id", "expected"),
    [
        ("people", "People"),
        ("monitoring_task", "MonitoringTask"),
        ("order_line", "OrderLine"),
        ("supplychain_bkn_v4_new2", "SupplychainBknV4New2"),
        # PascalCase already escapes most keywords — `class` is a keyword, `Class` is not.
        ("class", "Class"),
        ("import", "Import"),
        # The three that survive capitalisation, and so still need the suffix.
        ("none", "None_"),
        ("true", "True_"),
        ("false", "False_"),
    ],
)
def test_class_names(bkn_id: str, expected: str) -> None:
    assert class_name(bkn_id) == expected


def test_an_id_that_cannot_be_a_class_name_is_refused() -> None:
    with pytest.raises(NamingError, match="not a Python identifier"):
        class_name("2fast")


def test_colliding_class_names_name_both_offenders() -> None:
    """`a_b` and `a__b` both want `AB` — a modelling mistake to fix upstream, not to paper over."""
    schema = KnSchema(
        kn_id="kn",
        object_types=(
            ObjectTypeDef(bkn_id="a_b", properties=()),
            ObjectTypeDef(bkn_id="a__b", properties=()),
        ),
    )

    with pytest.raises(NamingError) as excinfo:
        generate(schema, OPTIONS)

    message = str(excinfo.value)
    assert "'a_b'" in message and "'a__b'" in message and "AB" in message


def test_a_property_named_after_a_query_method_is_suffixed() -> None:
    """`Order.count` must stay callable, so the property moves aside and keeps its id."""
    assert 'count_ = Property[int]("count")' in demo()["object_types.py"]


@pytest.mark.parametrize("reserved", ["where", "take", "iterate", "get", "order_by", "raw"])
def test_every_query_method_is_protected(reserved: str) -> None:
    assert property_name(reserved, "thing") == f"{reserved}_"


def test_a_keyword_property_is_suffixed_but_keeps_its_id() -> None:
    schema = KnSchema(
        kn_id="kn",
        object_types=(
            ObjectTypeDef(bkn_id="thing", properties=(PropertyDef(bkn_id="class", type="string"),)),
        ),
    )

    assert 'class_ = Property[str]("class")' in generate(schema, OPTIONS)["object_types.py"]


def test_properties_colliding_after_suffixing_are_refused() -> None:
    schema = KnSchema(
        kn_id="kn",
        object_types=(
            ObjectTypeDef(
                bkn_id="thing",
                properties=(
                    PropertyDef(bkn_id="class", type="string"),
                    PropertyDef(bkn_id="class_", type="string"),
                ),
            ),
        ),
    )

    with pytest.raises(NamingError, match="both map to attribute 'class_'"):
        generate(schema, OPTIONS)


def test_a_separator_that_is_legal_in_an_id_becomes_an_underscore() -> None:
    """`unit-price` has to be reachable as something, and `unit_price` is the
    only spelling a reader would guess. The wire keeps the id either way."""
    assert property_name("unit-price", "order") == "unit_price"
    assert property_name("total amount", "order") == "total_amount"


def test_a_property_that_cannot_be_an_attribute_is_refused() -> None:
    """Separators convert; a leading digit has no spelling to convert to."""
    with pytest.raises(NamingError, match="not a usable Python attribute"):
        property_name("2nd-amount", "order")


def test_a_dunder_property_is_refused() -> None:
    """`__identity__` and friends are the runtime's; a property may not claim one."""
    with pytest.raises(NamingError):
        property_name("__identity__", "order")


def test_an_unusable_relation_id_is_refused() -> None:
    schema = KnSchema(
        kn_id="kn",
        relation_types=(RelationTypeDef(bkn_id="order-to-line", source="a", target="b"),),
    )

    with pytest.raises(NamingError, match="not a usable Python name"):
        generate(schema, OPTIONS)


def test_nothing_is_emitted_when_naming_fails() -> None:
    """A half-written package would surface later as a missing attribute, not as this error."""
    schema = KnSchema(
        kn_id="kn",
        object_types=(
            ObjectTypeDef(bkn_id="ok", properties=()),
            ObjectTypeDef(bkn_id="2bad", properties=()),
        ),
    )

    with pytest.raises(NamingError):
        generate(schema, OPTIONS)
