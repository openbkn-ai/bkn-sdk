# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The platform version floor: refuse a stated old version, let an unknown one through."""

from __future__ import annotations

from collections.abc import Callable, Iterator

import httpx
import pytest

from bkn_osdk import Context, PlatformVersionError
from bkn_osdk import http as http_module
from bkn_osdk import mcp as mcp_module

PLATFORM = "https://platform.example"
HEALTH = "/api/bkn-backend/v1/health"


@pytest.fixture(autouse=True)
def real_floor(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Undo conftest's stub and start every test with nothing cached."""
    monkeypatch.setattr(http_module, "_ensure_platform_floor", _REAL_FLOOR, raising=True)
    http_module._platform_versions.clear()
    yield
    http_module._platform_versions.clear()


_REAL_FLOOR = http_module.__dict__["_ensure_platform_floor"]


def serve(
    monkeypatch: pytest.MonkeyPatch, health: Callable[[], httpx.Response]
) -> list[httpx.Request]:
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        if request.url.path == HEALTH:
            return health()
        return httpx.Response(200, json={"ok": True})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    return sent


def ctx() -> Context:
    return Context(base_url=PLATFORM, token="t-1")


def test_refuses_a_platform_that_states_an_older_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent = serve(monkeypatch, lambda: httpx.Response(200, json={"ServerVersion": "0.1.4"}))
    with pytest.raises(
        PlatformVersionError, match=r"runs platform 0\.1\.4; bkn-osdk needs 0\.1\.5"
    ):
        http_module.request(ctx(), "/api/thing")
    assert [r.url.path for r in sent] == [HEALTH]


def test_reads_the_version_from_the_response_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    serve(
        monkeypatch,
        lambda: httpx.Response(200, json={"data": {"ServerVersion": "v0.1.4-hotfix.2"}}),
    )
    with pytest.raises(PlatformVersionError):
        http_module.request(ctx(), "/api/thing")


@pytest.mark.parametrize("version", ["0.1.5", "0.1.5-main.20260912.sha1", "0.2.0", "1.0.0"])
def test_lets_a_current_platform_through_with_one_health_read(
    monkeypatch: pytest.MonkeyPatch, version: str
) -> None:
    sent = serve(monkeypatch, lambda: httpx.Response(200, json={"ServerVersion": version}))
    assert http_module.request(ctx(), "/api/a") == {"ok": True}
    assert http_module.request(ctx(), "/api/b") == {"ok": True}
    assert [r.url.path for r in sent] == [HEALTH, "/api/a", "/api/b"]


@pytest.mark.parametrize(
    "health",
    [
        lambda: httpx.Response(404, text="404 page not found"),
        lambda: httpx.Response(200, text="ready"),
        lambda: httpx.Response(200, json={"status": "ok"}),
        lambda: httpx.Response(200, json={"ServerVersion": "dev"}),
    ],
)
def test_an_unknown_version_is_not_an_old_one(
    monkeypatch: pytest.MonkeyPatch, health: Callable[[], httpx.Response]
) -> None:
    # Inside a sandbox the base URL is Context Loader, which serves no bkn-backend health.
    serve(monkeypatch, health)
    assert http_module.request(ctx(), "/api/thing") == {"ok": True}


def test_an_unreachable_health_route_is_not_an_old_one(monkeypatch: pytest.MonkeyPatch) -> None:
    def health() -> httpx.Response:
        raise httpx.ConnectError("refused")

    serve(monkeypatch, health)
    assert http_module.request(ctx(), "/api/thing") == {"ok": True}


def test_mcp_transport_takes_the_same_floor(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = serve(monkeypatch, lambda: httpx.Response(200, json={"ServerVersion": "0.1.4"}))
    with pytest.raises(PlatformVersionError):
        mcp_module._raw_post(ctx(), "kn-1", None, {"jsonrpc": "2.0", "method": "ping"})
    assert [r.url.path for r in sent] == [HEALTH]
