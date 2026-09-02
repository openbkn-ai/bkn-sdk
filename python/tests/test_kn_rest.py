# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The generated capability layer: what the emitter promises, and what it sends.

`bkn_osdk/kn.py` is generated from `contracts/kn-rest.json` and committed, so
the first test here is the one that matters most: regenerating produces the file
in the tree. The rest pin the decisions the emitter makes on the caller's
behalf — the query/body split, the turn, the arguments it refuses to invent.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from bkn_osdk import Context, kn
from bkn_osdk import http as http_module
from bkn_osdk import lifecycle as lifecycle_module
from bkn_osdk import mcp as mcp_module
from bkn_osdk.codegen.kn_rest import generate_kn_module

ROOT = Path(__file__).parent.parent
CONTRACT = json.loads((ROOT / "contracts" / "kn-rest.json").read_text(encoding="utf-8"))
KN = "ecommerce_ops_bkn_public"
PLATFORM = "https://platform.example"
CONTEXT = Context(base_url=PLATFORM, token="t-1")


def operation(name: str) -> dict[str, Any]:
    return next(op for op in CONTRACT["operations"] if op["operation"] == name)


# ---- the generated file is the contract's own output -------------------------


def test_regenerating_reproduces_the_committed_module() -> None:
    """Editing `kn.py` by hand, or letting the contract drift from it, is the
    failure this catches — both would be invisible until a call went wrong."""
    assert generate_kn_module(CONTRACT) == (ROOT / "bkn_osdk" / "kn.py").read_text(encoding="utf-8")


def test_every_route_in_the_contract_is_exported() -> None:
    expected = {op["operation"].replace("-", "_") for op in CONTRACT["operations"]}

    assert set(kn.__all__) == expected


def test_a_route_id_that_is_not_an_identifier_still_gets_a_function() -> None:
    """`logic-property-resolver` is a path segment; the function needs a name."""
    assert callable(kn.logic_property_resolver)


def test_the_compatibility_shell_is_not_generated() -> None:
    """The spec calls `kn_search` a shell for existing callers. Generating it
    would hand new code a front door onto a route being retired."""
    assert not hasattr(kn, "kn_search")
    assert all(op["operation"] != "kn_search" for op in CONTRACT["operations"])


# ---- what the emitter decides for the caller ---------------------------------


def test_the_lifecycle_context_is_never_a_parameter() -> None:
    """A caller building a `bkn_context` by hand is a caller who can get it
    wrong; the runtime attaches it from the turn in scope."""
    import inspect

    for name in kn.__all__:
        parameters = inspect.signature(getattr(kn, name)).parameters
        assert "bkn_context" not in parameters, name


def test_every_function_takes_the_network_first() -> None:
    """Even where the route does not send one: the turn belongs to a network."""
    import inspect

    for name in kn.__all__:
        first = next(iter(inspect.signature(getattr(kn, name)).parameters))
        assert first == "kn_id", name


def test_required_arguments_are_positional_and_the_rest_are_not() -> None:
    import inspect

    signature = inspect.signature(kn.get_object_types)
    kinds = {name: p.kind for name, p in signature.parameters.items()}

    assert kinds["ids"] is inspect.Parameter.POSITIONAL_OR_KEYWORD
    assert kinds["context"] is inspect.Parameter.KEYWORD_ONLY


def test_an_argument_the_spec_does_not_publish_is_not_invented() -> None:
    """`query_instance_subgraph` takes `limit` as an MCP tool and does not
    declare it on this route. The wrapper follows the contract rather than
    guessing that the two surfaces match."""
    import inspect

    assert "limit" not in inspect.signature(kn.query_instance_subgraph).parameters


# ---- what goes on the wire ---------------------------------------------------


class Deploy:
    """Serves the capability surface, recording what each call carried."""

    def __init__(self) -> None:
        self.paths: list[str] = []
        self.queries: list[dict[str, str]] = []
        self.bodies: list[dict[str, Any]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/mcp/info"):
            return httpx.Response(
                200,
                json={
                    "tools": [{"name": "bkn_start_interaction"}, {"name": "bkn_finish_interaction"}]
                },
            )
        if path.endswith("/mcp"):
            body = json.loads(request.read())
            if body.get("method") != "tools/call":
                return httpx.Response(200, json={"result": {}}, headers={"mcp-session-id": "s"})
            payload = (
                {"conversation_id": "c1", "interaction_id": "i1"}
                if body["params"]["name"] == "bkn_start_interaction"
                else {"execution_status": "completed"}
            )
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {"content": [{"type": "text", "text": json.dumps(payload)}]},
                },
            )
        self.paths.append(path)
        self.queries.append(dict(request.url.params))
        self.bodies.append(json.loads(request.read()))
        return httpx.Response(200, json={"datas": []})


@pytest.fixture
def deploy(monkeypatch: pytest.MonkeyPatch) -> Iterator[Deploy]:
    mcp_module._reset_for_tests()
    lifecycle_module._reset_for_tests()
    stub = Deploy()
    client = httpx.Client(transport=httpx.MockTransport(stub.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    yield stub
    mcp_module._reset_for_tests()
    lifecycle_module._reset_for_tests()


def test_the_query_string_and_the_body_go_where_the_spec_says(deploy: Deploy) -> None:
    """Three of these routes split their arguments across both, and nothing at
    the call site says so — sending `kn_id` in the body answers `Public.NotFound`
    ("对象不存在"), which reads as a missing object type rather than a misplaced
    argument."""
    kn.query_object_instance(KN, "order", limit=2, response_format="json", context=CONTEXT)

    assert deploy.paths[0] == "/api/agent-retrieval/v1/kn/query_object_instance"
    assert deploy.queries[0] == {"kn_id": KN, "ot_id": "order", "response_format": "json"}
    assert deploy.bodies[0]["limit"] == 2
    assert "kn_id" not in deploy.bodies[0]


def test_a_call_carries_a_turn_without_being_asked(deploy: Deploy) -> None:
    kn.list_resources(KN, context=CONTEXT)

    assert deploy.bodies[0]["bkn_context"] == {"conversation_id": "c1", "interaction_id": "i1"}


def test_unset_optional_arguments_are_not_sent(deploy: Deploy) -> None:
    """`None` is absence here, not a value: sending `"limit": null` is a
    different request from sending no limit at all."""
    kn.list_skills(KN, context=CONTEXT)

    assert set(deploy.bodies[0]) == {"bkn_context"}


def test_a_route_that_sends_the_network_still_sends_it(deploy: Deploy) -> None:
    """`kn_id` is the first argument everywhere, but only the routes that declare
    it put it on the wire."""
    kn.find_skills(KN, "order", context=CONTEXT)
    kn.run_sql(KN, "SELECT 1 FROM {{.r}}", context=CONTEXT)

    assert deploy.bodies[0]["kn_id"] == KN
    assert "kn_id" not in deploy.bodies[1]  # run_sql finds its data through the placeholder
