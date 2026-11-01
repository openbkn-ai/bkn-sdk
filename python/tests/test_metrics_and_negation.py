# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Object Metric V1 queries and condition negation."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from bkn_osdk import Context, InputError, Metric, session
from bkn_osdk import http as http_module
from bkn_osdk import lifecycle as lifecycle_module
from bkn_osdk import mcp as mcp_module
from bkn_osdk.lifecycle import current_interaction
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
        body = json.loads(request.read())
        self.bodies.append(body)
        if "bkn_context" in body:
            return httpx.Response(
                400,
                json={
                    "error_code": "OntologyQuery.Metric.InvalidParameter",
                    "error_details": 'bind json: json: unknown field "bkn_context"',
                },
            )
        return httpx.Response(
            200, json={"model": {}, "entries": [{"value": 42}], "status": "success"}
        )


RECEIPT = {
    "receipt_status": "completed",
    "evidence_durability": "durable",
    "observed_evidence_refs": ["ev_metric"],
}


class ManagedDeploy:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.paths: list[str] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        if request.url.path.endswith("/mcp/info"):
            return httpx.Response(
                200,
                json={
                    "tools": [
                        {"name": "bkn_start_interaction"},
                        {"name": "bkn_finish_interaction"},
                        {"name": "query_metric"},
                    ]
                },
            )
        if not request.url.path.endswith("/mcp"):
            return httpx.Response(500, json={"error": "managed metric bypassed MCP"})

        body = json.loads(request.read())
        method = body["method"]
        if method == "initialize":
            return httpx.Response(200, json={"result": {}}, headers={"mcp-session-id": "sess-1"})
        if method == "notifications/initialized":
            return httpx.Response(202, json={})

        name = body["params"]["name"]
        arguments = body["params"]["arguments"]
        self.calls.append((name, arguments))
        if name == "bkn_start_interaction":
            return self._tool_result(
                {"conversation_id": "conv-opened", "interaction_id": "int-opened"}
            )
        if name == "bkn_finish_interaction":
            return self._tool_result({"execution_status": "completed"})
        return self._tool_result(
            {
                "kn_id": arguments["kn_id"],
                "metric_id": arguments["metric_id"],
                "version": arguments["version"],
                "model": {},
                "entries": [{"status": "ok", "value": 100001}],
                "status": "ok",
                "total_count": 1,
                "overall_ms": 7,
                "evaluated_at": 1_761_264_000_000,
            },
            RECEIPT,
        )

    @staticmethod
    def _tool_result(value: dict[str, Any], receipt: dict[str, Any] | None = None) -> Any:
        structured = {**value}
        if receipt is not None:
            structured["bkn_receipt"] = receipt
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(value)}],
                    "structuredContent": structured,
                },
            },
        )


@pytest.fixture
def deploy(monkeypatch: pytest.MonkeyPatch) -> Deploy:
    stub = Deploy()
    client = httpx.Client(transport=httpx.MockTransport(stub.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")
    return stub


@pytest.fixture
def managed_deploy(monkeypatch: pytest.MonkeyPatch) -> Iterator[ManagedDeploy]:
    mcp_module._reset_for_tests()
    lifecycle_module._reset_for_tests()
    stub = ManagedDeploy()
    client = httpx.Client(transport=httpx.MockTransport(stub.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    yield stub
    mcp_module._reset_for_tests()
    lifecycle_module._reset_for_tests()


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


def test_optional_v1_branch(deploy: Deploy, monkeypatch: pytest.MonkeyPatch) -> None:
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


def test_managed_query_uses_context_loader_and_preserves_the_v1_envelope(
    managed_deploy: ManagedDeploy,
) -> None:
    ctx = Context(
        PLATFORM,
        "t-1",
        conversation_id="conv-host",
        interaction_id="int-host",
        parent_operation_id="op-function",
    )

    result = Gmv.query(
        time=WINDOW,
        group_by=[CHANNEL],
        filter={"node_type": "predicate"},
        having={"operator": "gt", "value": 0},
        order_by=[{"field": "value", "direction": "desc"}],
        page_size=20,
        cursor="next-1",
        bucket_selection={"parent_query": {"group_by": [CHANNEL]}, "bucket_key": "bucket-1"},
        context=ctx,
    )

    assert all(path.endswith(("/mcp", "/mcp/info")) for path in managed_deploy.paths)
    query_call = next(
        arguments for name, arguments in managed_deploy.calls if name == "query_metric"
    )
    assert query_call == {
        "kn_id": KN,
        "metric_id": "m_gmv",
        "version": 3,
        "response_format": "json",
        "query": {
            "time": WINDOW,
            "group_by": [CHANNEL],
            "filter": {"node_type": "predicate"},
            "having": {"operator": "gt", "value": 0},
            "order_by": [{"field": "value", "direction": "desc"}],
            "page_size": 20,
            "cursor": "next-1",
            "bucket_selection": {
                "parent_query": {"group_by": [CHANNEL]},
                "bucket_key": "bucket-1",
            },
        },
        "bkn_context": {
            "conversation_id": "conv-host",
            "interaction_id": "int-host",
            "parent_operation_id": "op-function",
        },
    }
    assert result == {
        "model": {},
        "entries": [{"status": "ok", "value": 100001}],
        "status": "ok",
        "total_count": 1,
        "overall_ms": 7,
        "evaluated_at": 1_761_264_000_000,
    }


def test_traced_metric_collects_the_receipt_and_forwards_a_non_main_branch(
    managed_deploy: ManagedDeploy, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Gmv, "__branch__", "release")

    with session(base_url=PLATFORM, token="t-1", traced=True) as ctx:
        Gmv.query(context=ctx)
        interaction = current_interaction(ctx, KN)
        assert interaction.receipts == [RECEIPT]

    query_call = next(
        arguments for name, arguments in managed_deploy.calls if name == "query_metric"
    )
    assert query_call["branch"] == "release"
    assert query_call["bkn_context"] == {
        "conversation_id": "conv-opened",
        "interaction_id": "int-opened",
    }


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
