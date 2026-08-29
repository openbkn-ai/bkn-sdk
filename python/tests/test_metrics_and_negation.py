# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Aggregation via metrics, and `~` over the operators that can express it.

An instance query cannot aggregate — it takes a condition, a limit, an offset
and a property selection and nothing else — so `sum`, `avg` and `group_by` over
an object set have no endpoint. Metrics are the platform's aggregation surface,
and richer than that would have been: dimensions, a `having` filter, ordering, a
time window, and a period-over-period block.

The transport is `POST …/metrics/{metric_id}/data` — the same REST layer as
every other read, with the ids in the path rather than the body.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from bkn_osdk import InputError, Metric
from bkn_osdk import http as http_module
from bkn_osdk.query import Comparison, Composite, Sort, to_condition

KN = "ecommerce_ops_bkn_public"
PLATFORM = "https://platform.example"


class Gmv(Metric):
    __kn_id__ = KN
    __bkn_id__ = "m_gmv"
    __object_type__ = "order"
    __dimensions__ = ("order_status", "channel_id", "payment_method")


class Unconstrained(Metric):
    __kn_id__ = KN
    __bkn_id__ = "m_free"


class Deploy:
    """A platform answering the metric data endpoint, recording what it was asked."""

    def __init__(self) -> None:
        self.paths: list[str] = []
        self.bodies: list[dict[str, Any]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        self.bodies.append(json.loads(request.read()))
        return httpx.Response(200, json={"datas": [{"gmv": "14485.37", "channel_id": 1}]})


@pytest.fixture
def deploy(monkeypatch: pytest.MonkeyPatch) -> Deploy:
    stub = Deploy()
    client = httpx.Client(transport=httpx.MockTransport(stub.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")
    return stub


SERIES = {"start": 1751328000, "end": 1753920000, "step": "day"}


# ---- the request -------------------------------------------------------------


def test_the_network_and_metric_are_in_the_path_not_the_body(deploy: Deploy) -> None:
    Gmv.query(time=SERIES)

    assert deploy.paths == [f"/api/ontology-query/v1/knowledge-networks/{KN}/metrics/m_gmv/data"]
    assert deploy.bodies[0]["time"] == SERIES
    assert deploy.bodies[0]["response_format"] == "json"


def test_dimensions_condition_having_and_ordering_all_travel(deploy: Deploy) -> None:
    Gmv.query(
        time=SERIES,
        analysis_dimensions=["channel_id"],
        condition=Comparison("==", "order_status", "paid"),
        having={"field": "gmv", "operation": ">", "value": 100},
        order_by=[Sort("gmv", "desc")],
        limit=5,
    )

    body = deploy.bodies[0]
    assert body["analysis_dimensions"] == ["channel_id"]
    assert body["condition"] == to_condition(Comparison("==", "order_status", "paid"))
    assert body["having"] == {"field": "gmv", "operation": ">", "value": 100}
    assert body["limit"] == 5
    # A metric spells this key `property`, not the `field` an instance sort uses.
    assert body["order_by"] == [{"property": "gmv", "direction": "desc"}]


def test_plain_pairs_order_the_same_way(deploy: Deploy) -> None:
    Gmv.query(time=SERIES, order_by=[("gmv", "asc")])

    assert deploy.bodies[0]["order_by"] == [{"property": "gmv", "direction": "asc"}]


def test_absent_arguments_are_omitted_rather_than_sent_empty(deploy: Deploy) -> None:
    Gmv.query(time=SERIES)

    assert set(deploy.bodies[0]) == {"response_format", "time"}


def test_a_metric_query_opens_no_session_of_its_own(deploy: Deploy) -> None:
    """It is an ordinary read; a deploy that demands a context still gets one on retry."""
    Gmv.query(time=SERIES)

    assert len(deploy.bodies) == 1
    assert "bkn_context" not in deploy.bodies[0]


def test_the_period_over_period_block_passes_through(deploy: Deploy) -> None:
    """`metrics` is a REST-only field the MCP tool never exposed."""
    Gmv.query(time=SERIES, metrics=[{"type": "yoy"}])

    assert deploy.bodies[0]["metrics"] == [{"type": "yoy"}]


def test_the_rows_come_back_unchanged(deploy: Deploy) -> None:
    """A metric row is not an object instance; nothing is decoded into a class."""
    assert Gmv.query(time=SERIES) == [{"gmv": "14485.37", "channel_id": 1}]


# ---- what is checked before the round trip ------------------------------------


def test_a_dimension_the_metric_does_not_declare_is_refused(deploy: Deploy) -> None:
    """The tool says values must come from `related_metrics[].analysis_dimensions`."""
    with pytest.raises(InputError, match="can only be split by"):
        Gmv.query(time=SERIES, analysis_dimensions=["region"])


def test_a_metric_that_declares_no_dimensions_accepts_any(deploy: Deploy) -> None:
    """Nothing was declared, so there is nothing to check against."""
    Unconstrained.query(time=SERIES, analysis_dimensions=["anything"])

    assert deploy.bodies[0]["analysis_dimensions"] == ["anything"]


def test_a_series_without_a_step_is_refused(deploy: Deploy) -> None:
    with pytest.raises(InputError, match="needs a `step`"):
        Gmv.query(time={"start": 1, "end": 2})


def test_an_instant_query_needs_no_step(deploy: Deploy) -> None:
    Gmv.query(time={"instant": True})

    assert deploy.bodies[0]["time"] == {"instant": True}


def test_an_instant_query_with_a_step_is_refused(deploy: Deploy) -> None:
    with pytest.raises(InputError, match="cannot also take a `step`"):
        Gmv.query(time={"instant": True, "step": "day"})


def test_a_half_open_window_is_refused(deploy: Deploy) -> None:
    with pytest.raises(InputError, match="both `start` and `end`"):
        Gmv.query(time={"start": 1, "step": "day"})


def test_an_unknown_step_is_refused(deploy: Deploy) -> None:
    with pytest.raises(InputError, match="`step` must be one of"):
        Gmv.query(time={"start": 1, "end": 2, "step": "fortnight"})


def test_a_metric_with_no_time_dimension_can_omit_the_window(deploy: Deploy) -> None:
    Gmv.query()

    assert "time" not in deploy.bodies[0]


# ---- negation -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("operation", "opposite"),
    [
        ("==", "!="),
        ("!=", "=="),
        (">", "<="),
        ("<=", ">"),
        ("<", ">="),
        (">=", "<"),
        ("in", "not_in"),
        ("not_in", "in"),
        ("like", "not_like"),
        ("not_like", "like"),
        ("exist", "not_exist"),
        ("not_exist", "exist"),
    ],
)
def test_every_operator_that_has_an_opposite_inverts(operation: str, opposite: str) -> None:
    assert (~Comparison(operation, "field", 1)).operation == opposite  # type: ignore[attr-defined]


def test_de_morgan_pushes_the_negation_down_to_the_leaves() -> None:
    """The platform's enum has no `not`, so the negation cannot stay at the top."""
    negated = ~((Comparison(">", "age", 30)) & (Comparison("in", "dept", ["ops"])))

    assert isinstance(negated, Composite)
    assert negated.operation == "or"
    assert to_condition(negated)["sub_conditions"] == [
        {"operation": "<=", "field": "age", "value": 30, "value_from": "const"},
        {"operation": "not_in", "field": "dept", "value": ["ops"], "value_from": "const"},
    ]


def test_a_double_negation_is_the_original() -> None:
    original = (Comparison(">", "age", 30)) | (Comparison("like", "name", "z"))

    assert to_condition(~~original) == to_condition(original)


@pytest.mark.parametrize("operation", ["match", "knn"])
def test_an_operator_with_no_opposite_refuses_rather_than_inventing_one(operation: str) -> None:
    """There is no `not_match`; a guessed negation returns wrong rows, not an error."""
    with pytest.raises(InputError, match="has no negation"):
        ~Comparison(operation, "field", "x")
