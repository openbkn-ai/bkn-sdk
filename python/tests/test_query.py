# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The read path, replayed against exchanges recorded from a live platform.

Each fixture under `tests/fixtures/query/` holds the body sent and the body
received, so a test can assert both halves: that the runtime asks the platform
exactly what the recording asked, and that it makes the right thing of the
answer. Re-record with `scripts/capture_query_fixtures.py`.

The recording is `ecommerce_ops_bkn_public/order` on `https://14.103.77.23`,
2026-08-12 — 15000 orders, 1746 of them `pending_payment`.
"""

from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest

from bkn_osdk import Context, InputError
from bkn_osdk import http as http_module
from bkn_osdk.query import MAX_LIMIT, Filter, ObjectSet, to_condition
from bkn_osdk.types import ObjectType, Property

FIXTURES = Path(__file__).parent / "fixtures" / "query" / "ecommerce_ops_bkn_public" / "order"
CONTEXT = Context(base_url="https://platform.example", token="t-1")


class Order(ObjectType):
    """The live object type, declared by hand so the query layer stands alone."""

    __kn_id__ = "ecommerce_ops_bkn_public"
    __bkn_id__ = "order"
    __primary_key__ = ("order_id",)
    __display_key__ = "order_no"

    order_id = Property[int]("order_id")
    order_no = Property[str]("order_no")
    order_status = Property[str]("order_status")
    total_amount = Property[Decimal]("total_amount")
    created_at = Property[datetime]("created_at")
    channel_id = Property[int]("channel_id")
    payment_time = Property[datetime]("payment_time")


class OrderLine(ObjectType):
    __kn_id__ = "ecommerce_ops_bkn_public"
    __bkn_id__ = "order_line"
    __primary_key__ = ("order_id", "line_no")

    order_id = Property[int]("order_id")
    line_no = Property[int]("line_no")


class Keyless(ObjectType):
    __kn_id__ = "kn"
    __bkn_id__ = "keyless"


def fixture(name: str) -> dict[str, Any]:
    recorded: dict[str, Any] = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    return recorded


class Replay:
    """Serve recorded responses in order, and keep every body the runtime sent."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self._queued: list[dict[str, Any]] = []

    def queue(self, *names: str) -> None:
        self._queued.extend(fixture(name)["response"] for name in names)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.sent.append(json.loads(request.read()))
        return httpx.Response(200, json=self._queued.pop(0) if self._queued else {"datas": []})


@pytest.fixture
def replay(monkeypatch: pytest.MonkeyPatch) -> Replay:
    recording = Replay()
    client = httpx.Client(transport=httpx.MockTransport(recording.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    return recording


def orders() -> ObjectSet[Order]:
    return Order.objects().with_context(CONTEXT)


# ---- the condition tree -----------------------------------------------------


def test_a_leaf_condition_matches_the_recording() -> None:
    """`value_from: "const"` is not decoration — the grammar names the value's source."""
    assert (
        to_condition(Order.order_status == "pending_payment")
        == (fixture("flat_condition")["request"]["condition"])
    )


def test_a_nested_and_or_matches_the_recording() -> None:
    expression = (Order.order_status == "pending_payment") & (
        (Order.total_amount > Decimal(10000)) | (Order.total_amount < Decimal(100))
    )

    assert to_condition(expression) == fixture("nested_and_or")["request"]["condition"]


def test_a_decimal_is_sent_as_a_string_so_no_digit_is_lost() -> None:
    """Both forms match the same rows live; only one of them is exact."""
    assert to_condition(Order.total_amount > Decimal("14485.37"))["value"] == "14485.37"


def test_dates_and_times_go_over_as_iso_8601() -> None:
    condition = to_condition(Order.created_at > datetime(2026, 7, 7, 21, 14, 17))

    assert condition["value"] == "2026-07-07T21:14:17"


def test_an_in_condition_matches_the_recording() -> None:
    assert (
        to_condition(Order.channel_id.is_in([1, 3]))
        == (fixture("in_operator")["request"]["condition"])
    )


def test_an_existence_check_sends_no_value() -> None:
    """`exist` takes no operand; the live platform answered 11697 / 3303 for the pair."""
    assert to_condition(Order.payment_time.exists()) == {
        "operation": "exist",
        "field": "payment_time",
    }


def test_a_vector_search_carries_its_neighbour_count() -> None:
    assert to_condition(Order.order_no.near([0.1, 0.2], k=5)) == {
        "operation": "knn",
        "field": "order_no",
        "value": [0.1, 0.2],
        "value_from": "const",
        "limit_key": "k",
        "limit_value": 5,
    }


def test_a_foreign_node_is_refused_rather_than_half_serialised() -> None:
    class Impostor(Filter):
        """A filter subclass the serialiser has never heard of."""

    with pytest.raises(InputError):
        to_condition(Impostor())


# ---- the request body -------------------------------------------------------


def test_the_read_posts_a_body_but_means_get(replay: Replay) -> None:
    replay.queue("unfiltered_page")

    orders().take(2)

    assert replay.sent[0] == {"response_format": "json", "limit": 2}


def test_json_is_always_asked_for(replay: Replay) -> None:
    """`response_format` defaults to `toon`, a compact text format we cannot parse."""
    replay.queue("unfiltered_page")

    orders().take(2)

    assert replay.sent[0]["response_format"] == "json"


def test_a_filter_becomes_the_condition(replay: Replay) -> None:
    replay.queue("flat_condition")

    orders().where(Order.order_status == "pending_payment").take(2)

    assert replay.sent[0]["condition"] == fixture("flat_condition")["request"]["condition"]


def test_several_where_calls_compose_with_and(replay: Replay) -> None:
    replay.queue("unfiltered_page")

    orders().where(Order.channel_id == 1).where(Order.order_id > 5).take(2)

    assert replay.sent[0]["condition"]["operation"] == "and"
    assert len(replay.sent[0]["condition"]["sub_conditions"]) == 2


def test_ordering_is_sent_as_sort_and_only_as_sort(replay: Replay) -> None:
    """`order_by` and `orders` are accepted and silently ignored — a wrong key
    returns unsorted rows with no error, so only `sort` is ever emitted."""
    replay.queue("sorted_desc")

    orders().order_by(Order.order_id.desc()).take(2)

    assert replay.sent[0]["sort"] == [{"field": "order_id", "direction": "desc"}]
    assert "order_by" not in replay.sent[0]
    assert "orders" not in replay.sent[0]


def test_property_selection_uses_the_one_key_that_works(replay: Replay) -> None:
    """Four other spellings were probed live and every one returned the full row."""
    replay.queue("property_selection")

    rows = orders().select(Order.order_id, "order_no").take(2)

    assert replay.sent[0]["properties"] == ["order_id", "order_no"]
    assert rows[0].order_no


def test_selecting_the_same_property_twice_sends_it_once(replay: Replay) -> None:
    replay.queue("property_selection")

    orders().select(Order.order_id).select(Order.order_id, "order_no").take(2)

    assert replay.sent[0]["properties"] == ["order_id", "order_no"]


def test_need_total_is_sent_only_for_count(replay: Replay) -> None:
    """It costs the backend a second pass, so a plain page never asks for it."""
    replay.queue("unfiltered_page", "count_unfiltered")

    orders().take(2)
    orders().count()

    assert "need_total" not in replay.sent[0]
    assert replay.sent[1]["need_total"] is True


def test_offset_is_omitted_when_it_is_zero(replay: Replay) -> None:
    replay.queue("unfiltered_page", "offset_paging")

    orders().page(limit=2)
    orders().page(limit=2, offset=2)

    assert "offset" not in replay.sent[0]
    assert replay.sent[1]["offset"] == 2


@pytest.mark.parametrize("limit", [0, -1, MAX_LIMIT + 1])
def test_an_out_of_range_limit_fails_here_rather_than_as_a_400(limit: int) -> None:
    """The backend answers "limit可选值 1-10000"; saying so locally keeps the call site honest."""
    with pytest.raises(InputError, match="limit must be between"):
        orders().page(limit=limit)


def test_a_negative_offset_is_refused() -> None:
    with pytest.raises(InputError, match="offset"):
        orders().page(limit=1, offset=-1)


# ---- the response -----------------------------------------------------------


def test_rows_come_back_as_typed_instances(replay: Replay) -> None:
    replay.queue("flat_condition")

    rows = orders().where(Order.order_status == "pending_payment").take(2)

    assert all(isinstance(row, Order) for row in rows)
    assert isinstance(rows[0].total_amount, Decimal)
    assert isinstance(rows[0].created_at, datetime)
    assert rows[0].order_status == "pending_payment"


def test_count_reads_the_total_from_the_envelope(replay: Replay) -> None:
    replay.queue("count_unfiltered", "count_filtered")

    assert orders().count() == 15000
    assert orders().where(Order.order_status == "pending_payment").count() == 1746


def test_a_count_with_no_matches_reads_as_zero(replay: Replay) -> None:
    """The platform omits `total_count` entirely when nothing matched."""
    replay.queue("no_match")

    assert orders().where(Order.order_status == "no_such_status").count() == 0


def test_an_empty_result_is_an_empty_list(replay: Replay) -> None:
    replay.queue("no_match")

    assert orders().where(Order.order_status == "no_such_status").take(2) == []


def test_the_index_hint_is_recorded_rather_than_discarded(replay: Replay) -> None:
    """`search_after` is inert on this deploy and `search_from_index: false` is why —
    a future cursor implementation switches on this, not on a version number."""
    replay.queue("unfiltered_page")

    assert orders().page(limit=2).search_from_index is False


def test_paging_walks_by_offset_until_a_short_page(replay: Replay) -> None:
    replay.queue("unfiltered_page", "offset_paging", "no_match")

    rows = list(orders().iterate(page_size=2))

    assert len(rows) == 4
    assert [body.get("offset") for body in replay.sent] == [None, 2, 4]


def test_paging_stops_on_the_first_short_page(replay: Replay) -> None:
    """A page shorter than asked for means the end — no extra round trip to prove it."""
    replay.queue("in_operator")

    rows = list(orders().iterate(page_size=5))

    assert len(rows) == 3
    assert len(replay.sent) == 1


# ---- get --------------------------------------------------------------------


def test_get_builds_an_equality_on_the_primary_key(replay: Replay) -> None:
    replay.queue("get_by_primary_key")

    order = Order.objects().with_context(CONTEXT).get(10357)

    assert replay.sent[0]["condition"] == fixture("get_by_primary_key")["request"]["condition"]
    assert replay.sent[0]["limit"] == 1
    assert order is not None
    assert order.order_id == 10357
    assert order.__identity__ == {"order_id": 10357}


def test_get_returns_none_when_nothing_matches(replay: Replay) -> None:
    replay.queue("no_match")

    assert Order.objects().with_context(CONTEXT).get(-1) is None


def test_a_composite_key_takes_one_argument_per_part(replay: Replay) -> None:
    replay.queue("no_match")

    OrderLine.objects().with_context(CONTEXT).get(order_id=10357, line_no=2)

    assert replay.sent[0]["condition"] == {
        "operation": "and",
        "sub_conditions": [
            {"operation": "==", "field": "order_id", "value": 10357, "value_from": "const"},
            {"operation": "==", "field": "line_no", "value": 2, "value_from": "const"},
        ],
    }


def test_the_wrong_number_of_key_parts_says_what_the_key_is() -> None:
    with pytest.raises(InputError, match="primary key has 2 part"):
        OrderLine.objects().with_context(CONTEXT).get(10357)


def test_naming_the_wrong_key_part_says_what_the_key_is() -> None:
    with pytest.raises(InputError, match="primary key is order_id, line_no"):
        OrderLine.objects().with_context(CONTEXT).get(order_id=1, line=2)


def test_mixing_positional_and_named_parts_is_refused() -> None:
    with pytest.raises(InputError, match="not both"):
        OrderLine.objects().with_context(CONTEXT).get(1, line_no=2)


def test_an_object_type_without_a_key_says_to_use_where_instead() -> None:
    with pytest.raises(InputError, match="declares no primary key"):
        Keyless.objects().with_context(CONTEXT).get("x")


# ---- the escape hatch -------------------------------------------------------


def test_raw_sends_the_argument_map_verbatim(replay: Replay) -> None:
    """The backend can grow fields faster than this runtime models them."""
    replay.queue("count_filtered")

    page = orders().raw({"limit": 1, "need_total": True, "some_new_field": "x"})

    assert replay.sent[0] == {
        "response_format": "json",
        "limit": 1,
        "need_total": True,
        "some_new_field": "x",
    }
    assert page.total == 1746


def test_the_set_is_immutable_so_a_refinement_cannot_leak(replay: Replay) -> None:
    """A shared base set is the normal way to use this; it must not accumulate."""
    replay.queue("unfiltered_page", "unfiltered_page")
    base = orders()

    base.where(Order.channel_id == 1).take(2)
    base.take(2)

    assert "condition" in replay.sent[0]
    assert "condition" not in replay.sent[1]
