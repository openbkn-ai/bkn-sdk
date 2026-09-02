# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The descriptor split, the filter expressions, and wire decoding."""

from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, cast

import pytest

from bkn_osdk import InputError, SchemaDriftError
from bkn_osdk.query import Comparison, Composite
from bkn_osdk.types import ObjectType, Property, PropertyRef, Relation, decode


class Order(ObjectType):
    __kn_id__ = "kn"
    __bkn_id__ = "order"
    __primary_key__ = ("order_id",)
    __display_key__ = "order_no"

    order_id = Property[int]("order_id")
    order_no = Property[str]("order_no")
    total_amount = Property[Decimal]("total_amount")
    created_at = Property[datetime]("created_at")
    paid_on = Property[date]("paid_on")
    settled_at = Property[time]("settled_at")
    payload = Property[Any]("payload")
    count_ = Property[int]("count")

    buyer = Relation["Order"]("order_to_buyer", target="people", join=(("user_id", "person_id"),))


WIRE = {
    "order_id": 10357,
    "order_no": "2026070720DC7170D9C74799",
    "total_amount": "14485.37",
    "created_at": "2026-07-07T21:14:17.891674+08:00",
    "paid_on": "2026-07-08",
    "settled_at": "21:14:17",
    "payload": {"channel": "app"},
    "count": 3,
    "_instance_id": "order-10357",
    "_instance_identity": {"order_id": 10357},
    "_display": "2026070720DC7170D9C74799",
}


# ---- the descriptor split ---------------------------------------------------


def test_class_access_gives_a_reference_and_instance_access_gives_the_value() -> None:
    """One name, two jobs — the trick the whole query API rests on."""
    assert isinstance(Order.order_no, PropertyRef)
    assert Order(WIRE).order_no == "2026070720DC7170D9C74799"


def test_a_reference_carries_the_id_and_the_declared_type() -> None:
    reference = Order.total_amount

    assert reference.bkn_id == "total_amount"
    assert reference.python_type is Decimal


def test_a_suffixed_attribute_still_filters_on_its_real_id() -> None:
    """`count_` exists so `count()` keeps working; the wire must still see `count`."""
    assert (Order.count_ > 3) == Comparison(">", "count", 3)
    assert Order(WIRE).count_ == 3


def test_declared_properties_are_discoverable() -> None:
    ids = {prop.bkn_id for prop in Order.__properties__()}

    assert {"order_id", "total_amount", "count"} <= ids


# ---- filter expressions -----------------------------------------------------


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        (Order.order_id == 1, Comparison("==", "order_id", 1)),
        (Order.order_id != 1, Comparison("!=", "order_id", 1)),
        (Order.order_id > 1, Comparison(">", "order_id", 1)),
        (Order.order_id >= 1, Comparison(">=", "order_id", 1)),
        (Order.order_id < 1, Comparison("<", "order_id", 1)),
        (Order.order_id <= 1, Comparison("<=", "order_id", 1)),
        (Order.order_id.is_in([1, 2]), Comparison("in", "order_id", [1, 2])),
        (Order.order_id.not_in([1, 2]), Comparison("not_in", "order_id", [1, 2])),
        (Order.order_no.like("2026%"), Comparison("like", "order_no", "2026%")),
        (Order.order_no.not_like("2025%"), Comparison("not_like", "order_no", "2025%")),
        (Order.order_no.match("DC71"), Comparison("match", "order_no", "DC71")),
        (Order.order_no.exists(), Comparison("exist", "order_no")),
        (Order.order_no.not_exists(), Comparison("not_exist", "order_no")),
    ],
)
def test_operators_build_their_node(expression: Comparison, expected: Comparison) -> None:
    assert expression == expected


def test_knn_carries_its_neighbour_count_beside_the_vector() -> None:
    assert Order.payload.near([0.1, 0.2], k=20) == Comparison(
        "knn", "payload", [0.1, 0.2], limit_key="k", limit_value=20
    )


def test_ordering_terms() -> None:
    assert (Order.order_id.asc().field, Order.order_id.asc().direction) == ("order_id", "asc")
    assert Order.order_id.desc().direction == "desc"


def test_and_composes() -> None:
    combined = (Order.order_id > 1) & (Order.order_no == "x")

    assert combined == Composite(
        "and", (Comparison(">", "order_id", 1), Comparison("==", "order_no", "x"))
    )


def test_composing_the_same_operator_flattens_instead_of_nesting() -> None:
    """`(a & b) & c` is one three-child `and`, not a tree the backend walks twice."""
    combined = ((Order.order_id > 1) & (Order.order_id < 9)) & (Order.order_no == "x")

    assert isinstance(combined, Composite)
    assert len(combined.sub_conditions) == 3


def test_mixing_operators_keeps_the_nesting() -> None:
    combined = (Order.order_id > 1) & ((Order.order_no == "a") | (Order.order_no == "b"))

    assert isinstance(combined, Composite)
    assert combined.operation == "and"
    inner = combined.sub_conditions[1]
    assert isinstance(inner, Composite)
    assert inner.operation == "or"


def test_a_reference_is_still_usable_as_a_dict_key() -> None:
    """`__eq__` builds filters, so hashing falls back to identity rather than breaking."""
    reference = Order.order_id

    assert {reference: "x"}[reference] == "x"


# ---- decoding ---------------------------------------------------------------


def test_a_decimal_arrives_as_a_string_and_stays_exact() -> None:
    """Float would already have rounded by the time anyone looked."""
    assert Order(WIRE).total_amount == Decimal("14485.37")


def test_datetimes_dates_and_times_are_parsed() -> None:
    order = Order(WIRE)

    assert order.created_at.year == 2026
    assert order.created_at.utcoffset() is not None  # the offset survives
    assert order.paid_on == date(2026, 7, 8)
    assert order.settled_at == time(21, 14, 17)


def test_json_and_unknown_types_pass_through_untouched() -> None:
    assert Order(WIRE).payload == {"channel": "app"}


def test_null_stays_null_whatever_the_declared_type_is() -> None:
    assert decode(None, Decimal) is None


def test_decoding_happens_once_per_property() -> None:
    """A query selecting three of forty properties should not pay for the other thirty-seven."""
    order = Order(WIRE)

    assert order.total_amount is order.total_amount


# ---- reserved keys ----------------------------------------------------------


def test_the_three_reserved_keys_are_renamed_out_of_the_way() -> None:
    """A real property called `id` must not collide with the platform's own keys."""
    order = Order(WIRE)

    assert order.__instance_id__ == "order-10357"
    assert order.__identity__ == {"order_id": 10357}
    assert order.__display__ == "2026070720DC7170D9C74799"
    assert "_instance_id" not in order.__data__


def test_a_display_key_that_was_not_selected_reads_as_none() -> None:
    assert Order({"order_id": 1}).__display__ is None


def test_instances_compare_and_hash_on_identity() -> None:
    one = Order(WIRE)
    same = Order({"order_id": 999, "_instance_identity": {"order_id": 10357}})

    assert one == same
    assert len({one, same}) == 1


def test_an_absent_property_says_which_of_the_two_causes_it_has() -> None:
    """Selected-subset or stale package — both are worth knowing at the call site."""
    with pytest.raises(SchemaDriftError) as excinfo:
        Order({"order_id": 1}).total_amount  # noqa: B018

    message = str(excinfo.value)
    assert "Order.total_amount" in message
    assert "bkn-osdk check" in message


def test_a_property_without_a_declared_type_passes_its_value_through() -> None:
    class Loose(ObjectType):
        anything: Property[Any] = Property("anything")  # no parameter, so no conversion

    assert Loose({"anything": "14485.37"}).anything == "14485.37"


def test_relations_record_their_endpoint_and_join() -> None:
    relation = Order.buyer

    assert relation.bkn_id == "order_to_buyer"
    assert relation.target == "people"
    assert relation.join == (("user_id", "person_id"),)


def test_comparing_a_property_to_none_names_the_operator_that_means_absence() -> None:
    """`paid_at == None` reads as "unpaid" and answers HTTP 400 `无效的参数`.

    A typed caller never gets that far — mypy already refuses `PropertyRef[date]
    == None`, which is the descriptor earning its keep. This is the untyped path:
    a value that turns out to be `None` at runtime, which is how the example that
    found this built its filter.
    """
    with pytest.raises(InputError, match=r"paid_on.not_exists\(\)"):
        Order.paid_on.__eq__(cast(Any, None))

    with pytest.raises(InputError, match=r"paid_on.exists\(\)"):
        Order.paid_on.__ne__(cast(Any, None))
