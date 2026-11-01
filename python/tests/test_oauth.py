# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The sign-in flows, offline: the platform is a stub and the "browser" is a thread."""

from __future__ import annotations

import json
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from bkn_osdk import AuthError, InputError, oauth

PLATFORM = "https://platform.example"
CLIENT = "my-app"


class Platform:
    """Answers the token, device and registration routes from queued responses."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.token_replies: list[httpx.Response] = []
        self.routes: dict[str, httpx.Response] = {}

    def forms(self) -> list[dict[str, str]]:
        return [
            dict(urllib.parse.parse_qsl(r.read().decode()))
            for r in self.requests
            if r.url.path == "/oauth2/token"
        ]

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/oauth2/token" and self.token_replies:
            return self.token_replies.pop(0)
        return self.routes.get(request.url.path, httpx.Response(404, json={}))


@pytest.fixture
def platform(monkeypatch: pytest.MonkeyPatch) -> Platform:
    stub = Platform()
    transport = httpx.MockTransport(stub.handle)
    build = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **_kwargs: build(transport=transport))
    return stub


def ok(**fields: Any) -> httpx.Response:
    return httpx.Response(200, json={"access_token": "at-1", **fields})


def err(error: str, description: str | None = None, status: int = 400) -> httpx.Response:
    body = {"error": error, **({"error_description": description} if description else {})}
    return httpx.Response(status, json=body)


# The sandbox's proxy settings must not sit between the test and its own loopback.
_direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


# ---- PKCE and the authorization URL -----------------------------------------


def test_the_challenge_matches_rfc_7636_appendix_b() -> None:
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert oauth._challenge(verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_the_authorization_url_carries_pkce_and_state() -> None:
    req = oauth.authorization_request(f"{PLATFORM}/", CLIENT)
    parts = urllib.parse.urlsplit(req.url)
    query = dict(urllib.parse.parse_qsl(parts.query))

    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == f"{PLATFORM}/oauth2/auth"
    assert query == {
        "response_type": "code",
        "client_id": CLIENT,
        "redirect_uri": oauth.DEFAULT_REDIRECT_URI,
        "scope": "openid offline",
        "state": req.state,
        "code_challenge": oauth._challenge(req.code_verifier),
        "code_challenge_method": "S256",
    }
    assert len(req.code_verifier) >= 43
    assert oauth.authorization_request(PLATFORM, CLIENT).state != req.state


# ---- exchange_code and refresh ----------------------------------------------


def test_exchange_code_sends_the_verifier_and_maps_tokens(platform: Platform) -> None:
    platform.token_replies = [ok(refresh_token="rt-1", id_token="id-1", expires_in=3600)]
    req = oauth.authorization_request(PLATFORM, CLIENT)

    tokens = oauth.exchange_code(PLATFORM, req, "the-code", req.state)

    assert platform.forms() == [
        {
            "grant_type": "authorization_code",
            "code": "the-code",
            "redirect_uri": oauth.DEFAULT_REDIRECT_URI,
            "client_id": CLIENT,
            "code_verifier": req.code_verifier,
        }
    ]
    assert (tokens.access_token, tokens.refresh_token, tokens.id_token) == ("at-1", "rt-1", "id-1")
    assert tokens.expires_at is not None and tokens.expires_at.endswith("Z")
    assert not tokens.expires_within(60)
    assert oauth.Tokens.from_dict(tokens.to_dict()) == tokens


def test_exchange_code_refuses_a_foreign_state_without_calling_the_platform(
    platform: Platform,
) -> None:
    req = oauth.authorization_request(PLATFORM, CLIENT)

    with pytest.raises(AuthError) as caught:
        oauth.exchange_code(PLATFORM, req, "c", "someone-elses")

    assert caught.value.error == "state_mismatch"
    assert platform.requests == []


def test_exchange_code_reports_invalid_grant_with_the_platforms_words(platform: Platform) -> None:
    platform.token_replies = [err("invalid_grant", "The code has expired")]
    req = oauth.authorization_request(PLATFORM, CLIENT)

    with pytest.raises(AuthError) as caught:
        oauth.exchange_code(PLATFORM, req, "stale", req.state)

    assert caught.value.error == "invalid_grant"
    assert caught.value.description == "The code has expired"
    assert "The code has expired" in str(caught.value)
    assert req.code_verifier not in str(caught.value)


def test_refresh_returns_the_rotated_refresh_token(platform: Platform) -> None:
    platform.token_replies = [ok(access_token="at-2", refresh_token="rt-2")]

    renewed = oauth.refresh(PLATFORM, oauth.Tokens("at-1", "rt-1"), client_id=CLIENT)

    assert platform.forms() == [
        {"grant_type": "refresh_token", "refresh_token": "rt-1", "client_id": CLIENT}
    ]
    assert (renewed.access_token, renewed.refresh_token) == ("at-2", "rt-2")


def test_refresh_keeps_the_old_refresh_token_when_none_comes_back(platform: Platform) -> None:
    platform.token_replies = [ok(access_token="at-2")]

    renewed = oauth.refresh(PLATFORM, oauth.Tokens("at-1", "rt-1"), client_id=CLIENT)

    assert renewed.refresh_token == "rt-1"


def test_refresh_without_a_refresh_token_is_a_sign_in_error(platform: Platform) -> None:
    with pytest.raises(AuthError):
        oauth.refresh(PLATFORM, oauth.Tokens("at-1"), client_id=CLIENT)
    assert platform.requests == []


# ---- register_client ---------------------------------------------------------


def test_register_client_posts_name_and_redirects(platform: Platform) -> None:
    platform.routes["/api/safe/v1/oauth/register"] = httpx.Response(
        201, json={"client_id": "c-9", "client_name": "App", "redirect_uris": ["http://x/cb"]}
    )

    client = oauth.register_client(PLATFORM, "App", ["http://x/cb"])

    assert json.loads(platform.requests[0].read()) == {
        "client_name": "App",
        "redirect_uris": ["http://x/cb"],
    }
    assert client == oauth.RegisteredClient("c-9", "App", ["http://x/cb"])


def test_register_client_defaults_to_the_loopback_redirect(platform: Platform) -> None:
    platform.routes["/api/safe/v1/oauth/register"] = httpx.Response(200, json={"client_id": "c"})

    client = oauth.register_client(PLATFORM, "App")

    assert json.loads(platform.requests[0].read())["redirect_uris"] == [oauth.DEFAULT_REDIRECT_URI]
    assert client.redirect_uris == [oauth.DEFAULT_REDIRECT_URI]


@pytest.mark.parametrize("status", [404, 405])
def test_register_client_without_self_registration_points_at_device_login(
    platform: Platform, status: int
) -> None:
    platform.routes["/api/safe/v1/oauth/register"] = httpx.Response(status)

    with pytest.raises(AuthError, match="device_login") as caught:
        oauth.register_client(PLATFORM, "App")

    assert caught.value.error == "registration_unavailable"


# ---- login (loopback) --------------------------------------------------------


def browser(
    *paths: str, ignore_errors: bool = False
) -> tuple[Callable[[str], None], list[tuple[str, int]]]:
    """An `on_url` that plays the user's browser from a thread.

    Each entry in `paths` is requested in turn against the redirect, with the
    authorization URL's own state appended where it contains `{state}`. Returns
    the callback and the (path, status) answers it saw.
    """
    seen: list[tuple[str, int]] = []

    def on_url(url: str) -> None:
        query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
        redirect = urllib.parse.urlsplit(query["redirect_uri"])
        origin = f"{redirect.scheme}://{redirect.netloc}"

        def visit() -> None:
            for path in paths:
                target = origin + path.replace("{state}", query["state"])
                try:
                    with _direct.open(target, timeout=5) as response:
                        seen.append((path, response.status))
                except urllib.error.HTTPError as exc:
                    seen.append((path, exc.code))
                except OSError:
                    if not ignore_errors:
                        raise

        thread = threading.Thread(target=visit, daemon=True)
        _visitors.append(thread)
        thread.start()

    return on_url, seen


_visitors: list[threading.Thread] = []


def settle() -> None:
    """Wait for the fake browser to finish recording what it saw."""
    while _visitors:
        _visitors.pop().join(timeout=5)


def loopback() -> str:
    return f"http://127.0.0.1:{free_port()}/callback"


def test_login_end_to_end(platform: Platform) -> None:
    platform.token_replies = [ok(refresh_token="rt-1")]
    redirect = loopback()
    path = urllib.parse.urlsplit(redirect).path
    on_url, seen = browser(f"{path}?code=abc&state={{state}}")

    tokens = oauth.login(PLATFORM, CLIENT, redirect, open_browser=False, on_url=on_url, timeout=5)

    assert (tokens.access_token, tokens.refresh_token) == ("at-1", "rt-1")
    form = platform.forms()[0]
    assert (form["code"], form["redirect_uri"], form["client_id"]) == ("abc", redirect, CLIENT)
    settle()
    assert seen == [(f"{path}?code=abc&state={{state}}", 200)]


def test_login_answers_a_stray_path_with_404_and_keeps_waiting(platform: Platform) -> None:
    platform.token_replies = [ok()]
    redirect = loopback()
    path = urllib.parse.urlsplit(redirect).path
    on_url, seen = browser("/favicon.ico", f"{path}?code=abc&state={{state}}")

    tokens = oauth.login(PLATFORM, CLIENT, redirect, open_browser=False, on_url=on_url, timeout=5)

    settle()
    assert tokens.access_token == "at-1"
    assert [status for _path, status in seen] == [404, 200]


def test_login_refuses_a_state_mismatch_before_exchanging(platform: Platform) -> None:
    redirect = loopback()
    path = urllib.parse.urlsplit(redirect).path
    on_url, seen = browser(f"{path}?code=abc&state=forged")

    with pytest.raises(AuthError) as caught:
        oauth.login(PLATFORM, CLIENT, redirect, open_browser=False, on_url=on_url, timeout=5)

    assert caught.value.error == "state_mismatch"
    assert platform.requests == []
    settle()
    assert [status for _path, status in seen] == [400]


def test_login_reports_a_denied_sign_in(platform: Platform) -> None:
    redirect = loopback()
    path = urllib.parse.urlsplit(redirect).path
    on_url, _seen = browser(
        f"{path}?error=access_denied&error_description=User+said+no&state={{state}}"
    )

    with pytest.raises(AuthError) as caught:
        oauth.login(PLATFORM, CLIENT, redirect, open_browser=False, on_url=on_url, timeout=5)

    assert caught.value.error == "access_denied"
    assert caught.value.description == "User said no"
    assert platform.requests == []


def test_login_times_out_and_frees_the_port(platform: Platform) -> None:
    redirect = loopback()

    with pytest.raises(AuthError) as caught:
        oauth.login(
            PLATFORM, CLIENT, redirect, open_browser=False, on_url=lambda _u: None, timeout=0.3
        )

    assert caught.value.error == "timeout"
    port = urllib.parse.urlsplit(redirect).port
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", port or 0))


@pytest.mark.parametrize(
    "redirect",
    ["https://127.0.0.1:8765/callback", "http://app.example.com/callback", "http://10.0.0.5/cb"],
)
def test_login_refuses_a_redirect_that_is_not_http_loopback(redirect: str) -> None:
    with pytest.raises(InputError, match="exchange_code"):
        oauth.login(PLATFORM, CLIENT, redirect, open_browser=False, on_url=lambda _u: None)


def test_login_is_listening_before_it_hands_out_the_url(platform: Platform) -> None:
    redirect = loopback()
    port = urllib.parse.urlsplit(redirect).port
    listening: list[bool] = []

    def on_url(_url: str) -> None:
        with socket.socket() as probe:
            listening.append(probe.connect_ex(("127.0.0.1", port or 0)) == 0)

    with pytest.raises(AuthError):
        oauth.login(PLATFORM, CLIENT, redirect, open_browser=False, on_url=on_url, timeout=0.2)

    assert listening == [True]


def test_login_opens_the_browser_only_when_asked(
    platform: Platform, monkeypatch: pytest.MonkeyPatch
) -> None:
    opened: list[str] = []

    def record(url: str) -> bool:
        opened.append(url)
        return True

    monkeypatch.setattr(webbrowser, "open", record)
    urls: list[str] = []

    for open_browser in (False, True):
        with pytest.raises(AuthError):
            oauth.login(
                PLATFORM,
                CLIENT,
                loopback(),
                open_browser=open_browser,
                on_url=urls.append,
                timeout=0.1,
            )

    assert len(urls) == 2  # on_url is always called
    assert opened == [urls[1]]


def test_login_reports_a_busy_port() -> None:
    with socket.socket() as held:
        held.bind(("127.0.0.1", 0))
        held.listen()
        redirect = f"http://127.0.0.1:{held.getsockname()[1]}/callback"
        with pytest.raises(InputError, match="Cannot listen"):
            oauth.login(PLATFORM, CLIENT, redirect, open_browser=False, on_url=lambda _u: None)


# ---- device_login ------------------------------------------------------------


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Fake time: polling "sleeps" by advancing a counter, and records each wait."""
    now = [0.0]
    sleeps: list[float] = []

    def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        now[0] += seconds

    monkeypatch.setattr(oauth, "_sleep", sleep)
    monkeypatch.setattr(oauth, "_monotonic", lambda: now[0])
    return sleeps


def device_platform(platform: Platform, **extra: Any) -> None:
    platform.routes["/oauth2/device/auth"] = httpx.Response(
        200,
        json={
            "device_code": "dev-1",
            "user_code": "ABCD-EFGH",
            "verification_uri": "http://hydra:4444/device",
            "verification_uri_complete": "http://hydra:4444/device?user_code=ABCD-EFGH",
            "expires_in": 600,
            "interval": 2,
            **extra,
        },
    )


def test_device_login_polls_through_pending_and_slow_down(
    platform: Platform, clock: list[float]
) -> None:
    device_platform(platform)
    platform.token_replies = [
        err("authorization_pending"),
        err("slow_down"),
        err("authorization_pending"),
        ok(refresh_token="rt-1"),
    ]
    prompts: list[oauth.DevicePrompt] = []

    tokens = oauth.device_login(PLATFORM, on_prompt=prompts.append)

    assert clock == [2, 2, 7, 7]
    assert tokens.refresh_token == "rt-1"
    assert platform.forms()[0] == {
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "device_code": "dev-1",
        "client_id": "openbkn-sdk",
    }
    # Hydra's internal host is replaced by the one the user reached.
    assert prompts == [
        oauth.DevicePrompt(
            "ABCD-EFGH", f"{PLATFORM}/device", f"{PLATFORM}/device?user_code=ABCD-EFGH"
        )
    ]


def test_device_login_reports_a_denial(platform: Platform, clock: list[float]) -> None:
    device_platform(platform)
    platform.token_replies = [err("access_denied")]

    with pytest.raises(AuthError) as caught:
        oauth.device_login(PLATFORM, on_prompt=lambda _p: None)

    assert caught.value.error == "access_denied"


def test_device_login_reports_an_expired_code(platform: Platform, clock: list[float]) -> None:
    device_platform(platform)
    platform.token_replies = [err("authorization_pending"), err("expired_token")]

    with pytest.raises(AuthError) as caught:
        oauth.device_login(PLATFORM, on_prompt=lambda _p: None)

    assert caught.value.error == "expired_token"


def test_device_login_gives_up_at_its_timeout(platform: Platform, clock: list[float]) -> None:
    device_platform(platform)
    platform.token_replies = [err("authorization_pending")] * 50

    with pytest.raises(AuthError) as caught:
        oauth.device_login(PLATFORM, on_prompt=lambda _p: None, timeout=5)

    # The caller's deadline ended the wait, not the code's lifetime.
    assert caught.value.error == "timeout"
    assert sum(clock) <= 6
