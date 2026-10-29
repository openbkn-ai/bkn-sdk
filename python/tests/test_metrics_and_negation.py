# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Object Metric V1 queries and condition negation."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from bkn_osdk import InputError, Metric
from bkn_osdk import http as http_module
from bkn_osdk.query import Comparison, Composite, to_condition

KN = "ecommerce_ops_bkn_public"
PLATFORM = "https://platform.example"
WINDOW = {"start": 1751328000000, "end": 1753920000000}
CHANNEL = {"object_type_id": "order", "property_name": "channel_id"}


class Gmv(Metric):
    __kn_id__ = KN
    __bkn_id__ = "m_gmv"
    __version__ = 3
    __object_type__ = "order"
    __dimensions__ = (("order", "channel_id", ""), ("order", "channel_id", "relation"))


class Unversioned(Metric):
    __kn_id__ = KN
    __bkn_id__ = "m_old"


class Deploy:
    def __init__(self) -> None:
        self.paths: list[str] = []
        self.queries: list[dict[str, str]] = []
        self.bodies: list[dict[str, Any]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        self.queries.append(dict(request.url.params.multi_items()))
        self.bodies.append(json.loads(request.read()))
        return httpx.Response(
            200, json={"model": {}, "entries": [{"value": 42}], "status": "success"}
        )


@pytest.fixture
def deploy(monkeypatch: pytest.MonkeyPatch) -> Deploy:
    stub = Deploy()
    client = httpx.Client(transport=httpx.MockTransport(stub.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")
    return stub


def test_v1_route_version_body_and_response(deploy: Deploy) -> None:
    filter_ast = {
        "node_type": "predicate",
        "left": {"source": "property", "property_ref": CHANNEL},
        "comparison_operator": "eq",
        "right": [{"source": "literal", "value_type": "string", "value": "online"}],
    }
    result = Gmv.query(time=WINDOW, group_by=[CHANNEL], filter=filter_ast)

    assert deploy.paths == [
        f"/api/ontology-query/v1/knowledge-networks/{KN}/object-metrics/m_gmv/data"
    ]
    assert deploy.queries == [{"version": "3"}]
    assert deploy.bodies == [
        {
            "time": WINDOW,
            "group_by": [CHANNEL],
            "filter": filter_ast,
        }
    ]
    assert result == {"model": {}, "entries": [{"value": 42}], "status": "success"}


def test_optional_v1_branch(
    deploy: Deploy, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Gmv, "__branch__", "release")
    Gmv.query()

    assert deploy.queries == [{"branch": "release", "version": "3"}]
    assert deploy.bodies == [{}]


def test_analysis_dimensions_is_a_group_by_compatibility_alias(deploy: Deploy) -> None:
    Gmv.query(analysis_dimensions=[CHANNEL])

    assert deploy.bodies == [{"group_by": [CHANNEL]}]


def test_current_query_choices_are_forwarded(deploy: Deploy) -> None:
    Gmv.query(
        having={"operator": "gt", "value": 0},
        order_by=[{"field": "value", "direction": "desc"}],
        page_size=20,
        cursor="next-1",
        bucket_selection={"parent_query": {"group_by": [CHANNEL]}, "bucket_key": "bucket-1"},
    )

    assert deploy.bodies == [
        {
            "having": {"operator": "gt", "value": 0},
            "order_by": [{"field": "value", "direction": "desc"}],
            "page_size": 20,
            "cursor": "next-1",
            "bucket_selection": {
                "parent_query": {"group_by": [CHANNEL]},
                "bucket_key": "bucket-1",
            },
        }
    ]


def test_group_by_aliases_are_mutually_exclusive(deploy: Deploy) -> None:
    with pytest.raises(InputError, match="either group_by or analysis_dimensions"):
        Gmv.query(group_by=[CHANNEL], analysis_dimensions=[CHANNEL])
    assert deploy.bodies == []


def test_cursor_requires_page_size(deploy: Deploy) -> None:
    with pytest.raises(InputError, match="requires page_size"):
        Gmv.query(cursor="next-1")
    assert deploy.bodies == []


def test_unversioned_class_fails_closed(deploy: Deploy) -> None:
    with pytest.raises(InputError, match="no published Object Metric V1 version"):
        Unversioned.query()
    assert deploy.bodies == []


def test_dimension_name_must_be_unambiguous(deploy: Deploy) -> None:
    with pytest.raises(InputError, match="uniquely"):
        Gmv.query(group_by=["channel_id"])
    assert deploy.bodies == []


def test_undeclared_dimension_ref_is_rejected(deploy: Deploy) -> None:
    with pytest.raises(InputError, match="does not declare"):
        Gmv.query(group_by=[{"object_type_id": "order", "property_name": "region"}])
    assert deploy.bodies == []


@pytest.mark.parametrize(
    "window",
    [
        {"start": 1},
        {"instant": True},
        {**WINDOW, "step": "day"},
        {"start": True, "end": 2},
        {"start": 3, "end": 2},
    ],
)
def test_invalid_or_legacy_time_is_rejected(deploy: Deploy, window: dict[str, Any]) -> None:
    with pytest.raises(InputError, match="time"):
        Gmv.query(time=window)
    assert deploy.bodies == []


@pytest.mark.parametrize(
    "window",
    [
        {"start": 1751328000, "end": 1753920000},
        {"start": 1751328000000, "end": 1753920000},
    ],
)
def test_seconds_in_v1_window_are_rejected(deploy: Deploy, window: dict[str, int]) -> None:
    with pytest.raises(InputError, match="milliseconds, not seconds"):
        Gmv.query(time=window)
    assert deploy.bodies == []


def test_legacy_query_arguments_are_not_accepted(deploy: Deploy) -> None:
    with pytest.raises(TypeError, match="unexpected keyword"):
        Gmv.query(condition={"operation": "eq"})  # type: ignore[call-arg]
    assert deploy.bodies == []


def test_metric_and_network_ids_are_encoded(
    deploy: Deploy, monkeypatch: pytest.MonkeyPatch
) -> None:
    raw: list[str] = []
    original = deploy.handle

    def handle(request: httpx.Request) -> httpx.Response:
        raw.append(request.url.raw_path.decode("ascii"))
        return original(request)

    client = httpx.Client(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)

    class Odd(Metric):
        __kn_id__ = "kn/a"
        __bkn_id__ = "m?1"
        __version__ = 1

    Odd.query()
    assert raw == [
        "/api/ontology-query/v1/knowledge-networks/kn%2Fa/object-metrics/m%3F1/data?version=1"
    ]


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
    with pytest.raises(InputError, match="has no negation"):
        ~Comparison(operation, "field", "x")
