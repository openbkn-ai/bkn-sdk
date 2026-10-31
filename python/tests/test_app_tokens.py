# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""An app's own tokens, configured with `tokens=`, refresh like a stored session does."""

from __future__ import annotations

import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import pytest

import bkn_osdk
from bkn_osdk import HttpError, InputError, http, oauth

PLATFORM = "https://platform.example"
CLIENT = "my-app"


def expiring(seconds: float) -> str:
    when = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    return when.isoformat(timespec="seconds").replace("+00:00", "Z")


class Platform:
    """API calls accept only `valid`; the refresh grant swaps the set for the next one."""

    def __init__(self, *, refresh_works: bool = True, delay: float = 0.0) -> None:
        self.valid = "at-2"
        self.refresh_works = refresh_works
        self.delay = delay
        self.bearers: list[str] = []
        self.grants: list[dict[str, str]] = []
        self._lock = threading.Lock()

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            form = dict(urllib.parse.parse_qsl(request.read().decode()))
            with self._lock:
                self.grants.append(form)
            time.sleep(self.delay)
            if not self.refresh_works:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(
                200,
                json={"access_token": "at-2", "refresh_token": "rt-2", "expires_in": 3600},
            )
        with self._lock:
            self.bearers.append(request.headers.get("authorization", ""))
        if request.headers.get("authorization") == f"Bearer {self.valid}":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(401, json={"description": "no"})


@pytest.fixture
def platform(monkeypatch: pytest.MonkeyPatch) -> Platform:
    return serve(monkeypatch, Platform())


def serve(monkeypatch: pytest.MonkeyPatch, stub: Platform) -> Platform:
    transport = httpx.MockTransport(stub.handle)
    build = httpx.Client
    monkeypatch.setattr(http, "_client", lambda _ctx: build(transport=transport))
    monkeypatch.setattr(httpx, "Client", lambda **_kwargs: build(transport=transport))
    return stub


def get() -> Any:
    return http.request(bkn_osdk.resolve_context(), "/api/thing")


def test_a_token_that_is_about_to_expire_is_refreshed_before_the_request(
    platform: Platform,
) -> None:
    saved: list[oauth.Tokens] = []
    bkn_osdk.configure(
        base_url=PLATFORM,
        tokens=oauth.Tokens("at-1", "rt-1", expires_at=expiring(30)),
        client_id=CLIENT,
        on_refresh=saved.append,
    )

    assert get() == {"ok": True}

    assert platform.bearers == ["Bearer at-2"]  # the stale token was never sent
    assert platform.grants == [
        {"grant_type": "refresh_token", "refresh_token": "rt-1", "client_id": CLIENT}
    ]
    assert [(t.access_token, t.refresh_token) for t in saved] == [("at-2", "rt-2")]


def test_a_token_with_plenty_of_life_left_is_not_refreshed(platform: Platform) -> None:
    platform.valid = "at-1"
    bkn_osdk.configure(
        base_url=PLATFORM, tokens=oauth.Tokens("at-1", "rt-1", expires_at=expiring(3600))
    )

    get()

    assert platform.grants == []


def test_a_401_refreshes_once_and_retries(platform: Platform) -> None:
    saved: list[oauth.Tokens] = []
    bkn_osdk.configure(
        base_url=PLATFORM, tokens=oauth.Tokens("at-1", "rt-1"), on_refresh=saved.append
    )

    assert get() == {"ok": True}
    assert get() == {"ok": True}

    assert platform.bearers == ["Bearer at-1", "Bearer at-2", "Bearer at-2"]
    assert len(platform.grants) == 1
    assert platform.grants[0]["client_id"] == "openbkn-sdk"  # the default
    assert len(saved) == 1


def test_concurrent_requests_share_one_refresh_and_one_callback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub = serve(monkeypatch, Platform(delay=0.1))
    saved: list[oauth.Tokens] = []
    bkn_osdk.configure(
        base_url=PLATFORM, tokens=oauth.Tokens("at-1", "rt-1"), on_refresh=saved.append
    )
    results: list[Any] = []

    def worker() -> None:
        results.append(get())

    threads = [threading.Thread(target=worker) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert results == [{"ok": True}] * 6
    assert len(stub.grants) == 1  # a second use of rt-1 would revoke the chain
    assert len(saved) == 1
    assert saved[0].refresh_token == "rt-2"


def test_a_failed_refresh_surfaces_the_401_with_a_sign_in_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    serve(monkeypatch, Platform(refresh_works=False))
    bkn_osdk.configure(base_url=PLATFORM, tokens=oauth.Tokens("at-1", "rt-1"))

    with pytest.raises(HttpError) as caught:
        get()

    assert caught.value.status == 401
    assert caught.value.hint is not None
    assert "Sign the user in again" in caught.value.hint
    assert "openbkn auth login" not in caught.value.hint


def test_tokens_without_a_refresh_token_fail_with_the_same_hint(platform: Platform) -> None:
    bkn_osdk.configure(base_url=PLATFORM, tokens=oauth.Tokens("at-1"))

    with pytest.raises(HttpError, match="Sign the user in again"):
        get()
    assert platform.grants == []


def test_an_on_refresh_failure_reaches_the_caller(platform: Platform) -> None:
    def boom(_tokens: oauth.Tokens) -> None:
        raise RuntimeError("disk full")

    bkn_osdk.configure(base_url=PLATFORM, tokens=oauth.Tokens("at-1", "rt-1"), on_refresh=boom)

    with pytest.raises(RuntimeError, match="disk full"):
        get()


def test_token_and_tokens_together_are_refused() -> None:
    with pytest.raises(InputError):
        bkn_osdk.configure(base_url=PLATFORM, token="x", tokens=oauth.Tokens("y"))
    with (
        pytest.raises(InputError),
        bkn_osdk.session(base_url=PLATFORM, token="x", tokens=oauth.Tokens("y")),
    ):
        pass


def test_client_id_or_on_refresh_without_tokens_is_refused() -> None:
    with pytest.raises(InputError):
        bkn_osdk.configure(base_url=PLATFORM, token="x", client_id=CLIENT)


def test_session_tokens_keep_users_apart(platform: Platform) -> None:
    platform.valid = "alice-2"
    seen: dict[str, str] = {}

    with bkn_osdk.session(base_url=PLATFORM, tokens=oauth.Tokens("alice-1", "a-rt")) as ctx:
        seen["alice"] = ctx.token
    with bkn_osdk.session(base_url=PLATFORM, tokens=oauth.Tokens("bob-1", "b-rt")) as ctx:
        seen["bob"] = ctx.token

    assert seen == {"alice": "alice-1", "bob": "bob-1"}
    with pytest.raises(InputError):  # nothing leaks out of the scopes
        bkn_osdk.resolve_context()


def test_a_session_token_overrides_configured_tokens(platform: Platform) -> None:
    bkn_osdk.configure(base_url=PLATFORM, tokens=oauth.Tokens("app-1", "app-rt"))

    with bkn_osdk.session(token="explicit") as ctx:
        assert ctx.token == "explicit"
        assert ctx.app_tokens is None

    assert bkn_osdk.resolve_context().token == "app-1"


def test_each_configure_call_owns_its_own_token_set(platform: Platform) -> None:
    bkn_osdk.configure(base_url=PLATFORM, tokens=oauth.Tokens("at-1", "rt-1"))
    first = bkn_osdk.resolve_context().app_tokens
    assert bkn_osdk.resolve_context().app_tokens is first

    bkn_osdk.configure(base_url=PLATFORM, tokens=oauth.Tokens("at-1", "rt-1"))
    assert bkn_osdk.resolve_context().app_tokens is not first
