# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Refreshing a stored session mid-process, and the one write that permits.

Access tokens here are short-lived, so a script that runs for an hour starts
getting 401s on a credential that is still perfectly valid. These tests pin the
retry, the caching that keeps it to one exchange, and the rotation write-back
that stops a Python process from stranding the CLI.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import encode_key, write_store

from bkn_osdk import Context, HttpError, resolve_context
from bkn_osdk import auth as auth_module
from bkn_osdk import http as http_module

PLATFORM = "https://platform.example"


@pytest.fixture(autouse=True)
def clean_refresh_cache() -> Iterator[None]:
    """The refreshed-token cache is process-wide; a leak would let tests see each other."""
    auth_module._reset_for_tests()
    yield
    auth_module._reset_for_tests()


class Exchange:
    """A platform whose access token has expired, and whose refresh grant works."""

    def __init__(self, *, rotate: bool = False, refresh_works: bool = True) -> None:
        self.rotate = rotate
        self.refresh_works = refresh_works
        self.bearers: list[str] = []
        self.refreshes: list[dict[str, str]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            self.refreshes.append(dict(_form(request.read().decode())))
            if not self.refresh_works:
                return httpx.Response(400, json={"error": "invalid_grant"})
            body: dict[str, Any] = {"access_token": "fresh-token"}
            if self.rotate:
                body["refresh_token"] = "rotated-refresh"
            return httpx.Response(200, json=body)
        bearer = request.headers.get("authorization", "")
        self.bearers.append(bearer)
        if bearer == "Bearer fresh-token":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(401, json={"description": "认证失败"})


def _form(body: str) -> list[tuple[str, str]]:
    return [
        (pair.split("=", 1)[0], pair.split("=", 1)[1]) for pair in body.split("&") if "=" in pair
    ]


@pytest.fixture
def platform(monkeypatch: pytest.MonkeyPatch) -> Exchange:
    exchange = Exchange()
    _serve(monkeypatch, exchange)
    return exchange


def _serve(monkeypatch: pytest.MonkeyPatch, exchange: Exchange) -> None:
    """Route both the API call and the refresh grant at one stub platform.

    The refresh opens its own short-lived client, so the transport is shared
    rather than the client itself.
    """
    transport = httpx.MockTransport(exchange.handle)
    build = httpx.Client
    monkeypatch.setattr(http_module, "_client", lambda _ctx: build(transport=transport))
    monkeypatch.setattr(httpx, "Client", lambda **_kwargs: build(transport=transport))


def stored_context(isolated_config: Path, **token_fields: Any) -> Context:
    write_store(
        isolated_config,
        PLATFORM,
        token={"accessToken": "stale-token", "refreshToken": "stored-refresh", **token_fields},
    )
    return resolve_context()


# ---- when a refresh happens -------------------------------------------------


def test_a_stored_session_refreshes_and_retries_once(
    isolated_config: Path, platform: Exchange
) -> None:
    ctx = stored_context(isolated_config)

    assert http_module.request(ctx, "/api/thing") == {"ok": True}
    assert platform.bearers == ["Bearer stale-token", "Bearer fresh-token"]


def test_the_refresh_grant_is_the_one_the_cli_logged_in_with(
    isolated_config: Path, platform: Exchange
) -> None:
    ctx = stored_context(isolated_config)

    http_module.request(ctx, "/api/thing")

    assert platform.refreshes == [
        {
            "grant_type": "refresh_token",
            "refresh_token": "stored-refresh",
            "client_id": "openbkn-sdk",
        }
    ]


def test_later_requests_reuse_the_refreshed_token(
    isolated_config: Path, platform: Exchange
) -> None:
    """Otherwise every request after the first expiry pays for its own exchange."""
    ctx = stored_context(isolated_config)

    http_module.request(ctx, "/api/thing")
    http_module.request(ctx, "/api/thing")

    assert len(platform.refreshes) == 1
    assert platform.bearers == ["Bearer stale-token", "Bearer fresh-token", "Bearer fresh-token"]


def test_a_context_resolved_after_a_refresh_starts_fresh(
    isolated_config: Path, platform: Exchange
) -> None:
    http_module.request(stored_context(isolated_config), "/api/thing")
    platform.bearers.clear()

    http_module.request(resolve_context(), "/api/thing")

    assert platform.bearers == ["Bearer fresh-token"]
    assert len(platform.refreshes) == 1


# ---- when it does not --------------------------------------------------------


def test_an_explicit_token_is_never_refreshed(
    isolated_config: Path, platform: Exchange, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A token passed in or set in the environment is the caller's to manage."""
    write_store(isolated_config, PLATFORM, token={"refreshToken": "stored-refresh"})
    monkeypatch.setenv("BKN_TOKEN", "env-token")
    ctx = resolve_context()

    assert ctx.credential is None
    with pytest.raises(HttpError) as excinfo:
        http_module.request(ctx, "/api/thing")

    assert excinfo.value.status == 401
    assert platform.refreshes == []


def test_a_store_without_a_refresh_token_offers_no_refresh(isolated_config: Path) -> None:
    """An AppKey saved by hand, or a login that returned no refresh token."""
    write_store(isolated_config, PLATFORM, token={"accessToken": "bak_live_1"})

    assert resolve_context().credential is None


def test_a_failed_refresh_surfaces_the_original_401(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The first error carries the platform's next-step hint; a second one about
    the refresh would bury it."""
    exchange = Exchange(refresh_works=False)
    _serve(monkeypatch, exchange)
    ctx = stored_context(isolated_config)

    with pytest.raises(HttpError) as excinfo:
        http_module.request(ctx, "/api/thing")

    assert excinfo.value.status == 401
    assert "认证失败" in excinfo.value.body
    assert len(exchange.refreshes) == 1  # tried once, did not loop


def test_a_non_401_is_not_a_refresh_trigger(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    exchange = Exchange()
    monkeypatch.setattr(
        exchange,
        "handle",
        lambda request: httpx.Response(500, json={"description": "boom"}),
    )
    _serve(monkeypatch, exchange)
    ctx = stored_context(isolated_config)

    with pytest.raises(HttpError) as excinfo:
        http_module.request(ctx, "/api/thing")

    assert excinfo.value.status == 500
    assert exchange.refreshes == []


# ---- rotation ----------------------------------------------------------------


def test_a_rotated_refresh_token_is_written_back(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Spending the CLI's refresh token and keeping the replacement would strand it."""
    exchange = Exchange(rotate=True)
    _serve(monkeypatch, exchange)
    ctx = stored_context(isolated_config)

    http_module.request(ctx, "/api/thing")

    saved = json.loads(_token_path(isolated_config).read_text(encoding="utf-8"))
    assert saved["refreshToken"] == "rotated-refresh"
    assert saved["accessToken"] == "fresh-token"


def test_a_write_back_preserves_everything_else_in_the_file(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    exchange = Exchange(rotate=True)
    _serve(monkeypatch, exchange)
    ctx = stored_context(isolated_config, tlsInsecure=True, username="admin")

    http_module.request(ctx, "/api/thing")

    saved = json.loads(_token_path(isolated_config).read_text(encoding="utf-8"))
    assert saved["username"] == "admin"
    assert saved["tlsInsecure"] is True
    assert saved["baseUrl"] == PLATFORM


def test_a_server_that_does_not_rotate_gets_no_write(
    isolated_config: Path, platform: Exchange
) -> None:
    """The store is the CLI's; this side touches it only when it has to."""
    ctx = stored_context(isolated_config)
    before = _token_path(isolated_config).read_text(encoding="utf-8")

    http_module.request(ctx, "/api/thing")

    assert _token_path(isolated_config).read_text(encoding="utf-8") == before


def test_a_read_only_store_does_not_fail_the_query(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The process has a working access token either way."""
    exchange = Exchange(rotate=True)
    _serve(monkeypatch, exchange)
    ctx = stored_context(isolated_config)
    _token_path(isolated_config).chmod(0o400)

    try:
        assert http_module.request(ctx, "/api/thing") == {"ok": True}
    finally:
        _token_path(isolated_config).chmod(0o600)


def _token_path(root: Path) -> Path:
    return root / "platforms" / encode_key(PLATFORM) / "users" / "u-1" / "token.json"
