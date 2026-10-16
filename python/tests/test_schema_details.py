# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""List summaries must not become generated classes without properties."""

from typing import Any

import httpx
import pytest

from bkn_osdk import Context, InputError
from bkn_osdk import http as http_module
from bkn_osdk.schema import fetch_schema


@pytest.mark.parametrize("envelope", ["direct", "entries", "list"])
def test_summary_is_hydrated_with_caller_branch_and_encoded_id(
    monkeypatch: pytest.MonkeyPatch, envelope: str
) -> None:
    seen: list[httpx.Request] = []
    detail = {
        "id": "type/a b",
        "data_properties": [{"name": "code", "type": "string"}],
        "primary_keys": ["code"],
        "display_key": "code",
    }

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        if path.endswith("/object-types/type/a b"):
            body: Any = (
                detail
                if envelope == "direct"
                else ({"entries": [detail]} if envelope == "entries" else [detail])
            )
            return httpx.Response(200, json=body)
        if path.endswith("/object-types"):
            return httpx.Response(200, json={"entries": [{"id": "type/a b", "primary_keys": None}]})
        if path.endswith(("/relation-types", "/object-metrics")):
            return httpx.Response(200, json={"entries": [], "total_count": 0})
        return httpx.Response(200, json={"id": "kn", "branch": "feature"})

    client = httpx.Client(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    schema = fetch_schema(
        Context(base_url="https://platform.example", token="caller"), "kn", "feature"
    )
    ot = schema.object_types[0]
    assert ot.primary_key == ("code",)
    assert [prop.bkn_id for prop in ot.properties] == ["code"]
    read = next(r for r in seen if "/object-types/type" in str(r.url))
    assert read.url.raw_path.split(b"?")[0].endswith(b"/type%2Fa%20b")
    assert read.url.params["branch"] == "feature"
    assert read.headers["Authorization"] == "Bearer caller"


@pytest.mark.parametrize("detail", [{}, {"id": "other", "data_properties": []}, {"id": "item"}])
def test_incomplete_detail_does_not_silently_generate_a_partial_schema(
    monkeypatch: pytest.MonkeyPatch, detail: dict[str, Any]
) -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/object-types"):
            return httpx.Response(200, json={"entries": [{"id": "item"}]})
        if request.url.path.endswith("/object-types/item"):
            return httpx.Response(200, json=detail)
        return httpx.Response(200, json={"id": "kn"})

    client = httpx.Client(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    with pytest.raises(InputError, match="schema is incomplete"):
        fetch_schema(Context(base_url="https://platform.example", token="caller"), "kn")


def test_platform_generated_metric_uuid_is_a_valid_generated_class() -> None:
    from bkn_osdk.codegen.emit import GenOptions, generate, metric_class_name
    from bkn_osdk.schema import KnSchema, MetricDef, ObjectTypeDef

    metric_id = "01a13d1f-6e04-73c9-aa08-413c3a51967e"
    assert metric_class_name(metric_id) == "Metric01a13d1f6e0473c9Aa08413c3a51967e"
    schema = KnSchema(
        kn_id="kn",
        object_types=(ObjectTypeDef(bkn_id="material", properties=()),),
        metrics=(MetricDef(bkn_id=metric_id, object_type="material"),),
    )
    generated = generate(schema, GenOptions(package="bkn"))
    compile(generated["metrics.py"], "metrics.py", "exec")
    assert metric_id in generated["metrics.py"]
