# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Wire behavior of the single choke point: headers, params, and typed failures."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from bkn_osdk import Context, HttpError, call
from bkn_osdk import http as http_module

PLATFORM = "https://platform.example"


def ctx(**fields: Any) -> Context:
    return Context(**{"base_url": PLATFORM, "token": "t-1", **fields})


@pytest.fixture
def record(monkeypatch: pytest.MonkeyPatch) -> list[httpx.Request]:
    """Capture requests and answer them from a stub, without a socket in sight."""
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return _response_for(request)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    return sent


def _response_for(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/boom":
        return httpx.Response(401, json={"error": {"message": "nope"}})
    if request.url.path == "/lifecycle":
        return httpx.Response(
            400,
            json={
                "error": {
                    "code": "conversation_required",
                    "required_action": "bkn_start_interaction",
                }
            },
        )
    if request.url.path == "/empty":
        return httpx.Response(204, content=b"")
    if request.url.path == "/gateway":
        return httpx.Response(502, text="<html>nginx</html>")
    return httpx.Response(200, json={"ok": True})


def test_get_by_default_and_json_out(record: list[httpx.Request]) -> None:
    assert http_module.request(ctx(), "/api/thing") == {"ok": True}

    assert record[0].method == "GET"
    assert str(record[0].url) == f"{PLATFORM}/api/thing"


def test_a_body_implies_post_and_sets_content_type(record: list[httpx.Request]) -> None:
    http_module.request(ctx(), "/api/thing", body={"a": 1})

    assert record[0].method == "POST"
    assert record[0].headers["content-type"] == "application/json"
    # Parsed, not compared byte for byte: httpx 0.27 separates with a space
    # and 0.28 does not, and the wire meaning is the same either way.
    assert json.loads(record[0].read()) == {"a": 1}


def test_the_token_rides_in_authorization_and_nothing_else_is_added(
    record: list[httpx.Request],
) -> None:
    """`x-business-domain` was removed platform-side (bkn-sdk#78); sending a
    stale one is worse than sending none — a wrong domain filters a read to
    zero rows and reports success."""
    http_module.request(ctx(), "/api/thing")

    assert record[0].headers["authorization"] == "Bearer t-1"
    assert "x-business-domain" not in record[0].headers


def test_method_override_rides_a_header(record: list[httpx.Request]) -> None:
    """The read path posts a body but means GET, which is what `ontology-query` expects."""
    http_module.request(ctx(), "/api/query", body={}, method_override="GET")

    assert record[0].method == "POST"
    assert record[0].headers["x-http-method-override"] == "GET"


def test_query_params_repeat_lists_drop_none_and_lowercase_bools(
    record: list[httpx.Request],
) -> None:
    http_module.request(
        ctx(),
        "/api/thing",
        query={"branch": "main", "limit": -1, "id": ["a", "b"], "deep": True, "skip": None},
    )

    assert record[0].url.params.multi_items() == [
        ("branch", "main"),
        ("limit", "-1"),
        ("id", "a"),
        ("id", "b"),
        ("deep", "true"),
    ]


def test_absolute_paths_are_left_alone(record: list[httpx.Request]) -> None:
    http_module.request(ctx(), "https://elsewhere.example/x")

    assert str(record[0].url) == "https://elsewhere.example/x"


def test_an_empty_body_decodes_to_none(record: list[httpx.Request]) -> None:
    assert http_module.request(ctx(), "/empty") is None


def test_an_error_carries_status_and_body(record: list[httpx.Request]) -> None:
    with pytest.raises(HttpError) as excinfo:
        http_module.request(ctx(), "/boom")

    assert excinfo.value.status == 401
    assert excinfo.value.payload == {"error": {"message": "nope"}}


def test_an_appkey_401_says_to_re_issue_rather_than_retry(record: list[httpx.Request]) -> None:
    with pytest.raises(HttpError) as excinfo:
        http_module.request(ctx(token="bak_live_123"), "/boom")

    hint = excinfo.value.hint or ""
    assert "re-issue" in hint
    assert "Do not auto-retry" in hint


def test_a_bearer_401_gets_no_appkey_hint(record: list[httpx.Request]) -> None:
    with pytest.raises(HttpError) as excinfo:
        http_module.request(ctx(), "/boom")

    assert excinfo.value.hint is None


def test_a_lifecycle_rejection_says_where_to_get_a_session(record: list[httpx.Request]) -> None:
    with pytest.raises(HttpError) as excinfo:
        http_module.request(ctx(), "/lifecycle")

    assert "bkn_context" in (excinfo.value.hint or "")


def test_call_resolves_credentials_the_same_way_a_query_does(
    record: list[httpx.Request], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "env-token")

    assert call("/api/dataflow-manager/v1/flows") == {"ok": True}
    assert record[0].headers["authorization"] == "Bearer env-token"


def test_an_explicit_method_beats_the_body_default(record: list[httpx.Request]) -> None:
    http_module.request(ctx(), "/api/thing", method="PUT", body={"a": 1})

    assert record[0].method == "PUT"


def test_an_empty_dict_still_counts_as_a_body(record: list[httpx.Request]) -> None:
    """`{}` is a real request body — only `None` means "no body"."""
    http_module.request(ctx(), "/api/thing", body={})

    assert record[0].method == "POST"
    assert json.loads(record[0].read()) == {}


def test_no_body_means_no_content_type(record: list[httpx.Request]) -> None:
    http_module.request(ctx(), "/api/thing")

    assert "content-type" not in record[0].headers


def test_extra_headers_merge_and_may_override(record: list[httpx.Request]) -> None:
    http_module.request(
        ctx(),
        "/api/thing",
        headers={"bkn-request-id": "req-1", "accept": "text/plain"},
    )

    assert record[0].headers["bkn-request-id"] == "req-1"
    assert record[0].headers["accept"] == "text/plain"
    assert record[0].headers["authorization"] == "Bearer t-1"


def test_the_context_timeout_is_sent_and_the_per_call_one_wins(
    record: list[httpx.Request],
) -> None:
    http_module.request(ctx(timeout=5.0), "/api/thing")
    http_module.request(ctx(timeout=5.0), "/api/thing", timeout=90.0)

    assert record[0].extensions["timeout"]["read"] == 5.0
    assert record[1].extensions["timeout"]["read"] == 90.0


def test_a_base_url_carrying_a_path_prefix_keeps_it(record: list[httpx.Request]) -> None:
    """Some deploys sit behind a path prefix; joining must not eat it."""
    http_module.request(ctx(base_url="https://host.example/bkn"), "/api/thing")

    assert str(record[0].url) == "https://host.example/bkn/api/thing"


def test_a_non_json_error_body_survives_as_text(record: list[httpx.Request]) -> None:
    """A gateway that never reached the backend answers HTML — that must not crash the client."""
    with pytest.raises(HttpError) as excinfo:
        http_module.request(ctx(), "/gateway")

    assert excinfo.value.status == 502
    assert excinfo.value.body == "<html>nginx</html>"
    assert excinfo.value.payload is None


# ---- connection pooling -----------------------------------------------------


@pytest.fixture(autouse=True)
def clean_client_cache() -> Iterator[None]:
    """The pool is process-global; a leaked client would let tests see each other."""
    http_module._clients.clear()
    yield
    for client in http_module._clients.values():
        client.close()
    http_module._clients.clear()


def test_one_client_is_reused_per_platform() -> None:
    assert http_module._client(ctx()) is http_module._client(ctx())


def test_a_tls_opt_out_gets_its_own_client() -> None:
    """`insecure` is scoped to the platform that asked for it, never process-wide."""
    verifying = http_module._client(ctx())
    skipping = http_module._client(ctx(insecure=True))

    assert verifying is not skipping
    assert http_module._client(ctx(base_url="https://other.example")) is not verifying


def test_a_closed_client_is_replaced_rather_than_handed_out() -> None:
    stale = http_module._client(ctx())
    stale.close()

    assert http_module._client(ctx()) is not stale


def test_a_cross_host_redirect_does_not_replay_the_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The token rides in `authorization` precisely because httpx drops that
    header when a redirect changes origin — pinned here so a custom header is
    never quietly substituted for it."""
    seen: list[tuple[str, str | None]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.host, request.headers.get("authorization")))
        if request.url.host == "platform.example":
            return httpx.Response(301, headers={"location": "https://elsewhere.example/x"})
        return httpx.Response(200, json={})

    client = httpx.Client(transport=httpx.MockTransport(handle), follow_redirects=True)
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)

    http_module.request(Context(base_url="https://platform.example", token="secret"), "/x")

    assert seen == [("platform.example", "Bearer secret"), ("elsewhere.example", None)]
