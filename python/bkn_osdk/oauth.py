# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Signing a user in to an app, and keeping the tokens alive.

An app that calls the platform as its user needs an OAuth token for that user.
These are the flows that produce one — the loopback authorization-code flow
(`login`), its two halves for a web app (`authorization_request` +
`exchange_code`), the device flow (`device_login`) — plus the refresh grant and
self-registration of a public client. Hand the result to
`configure(tokens=…)` / `session(tokens=…)` and it refreshes like a stored
session does.

Endpoints are fixed paths on the base URL (Hydra's `/oauth2/*`, bkn-safe's
registration route), like the refresh code in `auth.py`; there is no discovery.
Only `httpx` and the standard library are used.

This module reads and writes nothing on disk. Where the tokens are kept is the
app's business; `Tokens.to_dict()` / `from_dict()` are there to make that easy.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import socket
import sys
import time
import urllib.parse
import webbrowser
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, cast

import httpx

from .errors import AuthError, InputError

__all__ = [
    "DEFAULT_REDIRECT_URI",
    "DEFAULT_SCOPE",
    "AuthorizationRequest",
    "DevicePrompt",
    "RegisteredClient",
    "Tokens",
    "authorization_request",
    "device_login",
    "exchange_code",
    "login",
    "refresh",
    "register_client",
]

#: The callback Studio registers by default; a loopback port the CLI does not use.
DEFAULT_REDIRECT_URI = "http://127.0.0.1:8765/callback"
DEFAULT_SCOPE = "openid offline"
#: The public client the CLI and device-code logins use.
DEVICE_CLIENT_ID = "openbkn-sdk"

AUTH_PATH = "/oauth2/auth"
TOKEN_PATH = "/oauth2/token"
DEVICE_PATH = "/oauth2/device/auth"
REGISTER_PATH = "/api/safe/v1/oauth/register"

_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
_DEFAULT_TIMEOUT = 30.0
_DEFAULT_LOGIN_TIMEOUT = 300.0
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

#: Replaced in tests so polling does not wait out real intervals.
_sleep: Callable[[float], None] = time.sleep
_monotonic: Callable[[], float] = time.monotonic


@dataclass(frozen=True)
class Tokens:
    """An OAuth token set.

    `expires_at` is ISO 8601 UTC computed from the grant's `expires_in`: the only
    expiry an opaque (non-JWT) access token has.
    """

    access_token: str
    refresh_token: str | None = None
    id_token: str | None = None
    expires_at: str | None = None

    def to_dict(self) -> dict[str, str]:
        """A JSON-safe dict for storage; unset fields are omitted."""
        raw = {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "id_token": self.id_token,
            "expires_at": self.expires_at,
        }
        return {key: value for key, value in raw.items() if value is not None}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Tokens:
        """Inverse of `to_dict`."""
        access = data.get("access_token")
        if not isinstance(access, str) or not access:
            raise InputError("Tokens.from_dict needs an 'access_token' string.")

        def text(key: str) -> str | None:
            value = data.get(key)
            return value if isinstance(value, str) and value else None

        return cls(access, text("refresh_token"), text("id_token"), text("expires_at"))

    def expires_within(self, seconds: float) -> bool:
        """True when the access token expires within `seconds` (or already has).

        A token with no known expiry is never "about to expire": it is renewed
        only after the platform says 401.
        """
        if self.expires_at is None:
            return False
        try:
            expiry = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
        except ValueError:
            return False
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        return expiry - datetime.now(timezone.utc) <= timedelta(seconds=seconds)


@dataclass(frozen=True)
class RegisteredClient:
    """A public client the platform registered for this app."""

    client_id: str
    client_name: str
    redirect_uris: list[str]


@dataclass(frozen=True)
class AuthorizationRequest:
    """One authorization attempt: the URL to send the user to, and what to keep.

    `state` and `code_verifier` must survive until the callback arrives — in a
    web app, in the user's server-side session — and go back to `exchange_code`.
    """

    url: str
    state: str
    code_verifier: str
    client_id: str
    redirect_uri: str


@dataclass(frozen=True)
class DevicePrompt:
    """What the user needs to approve a device login."""

    user_code: str
    verification_uri: str
    verification_uri_complete: str | None = None


# ---- PKCE --------------------------------------------------------------------


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _challenge(verifier: str) -> str:
    """RFC 7636 S256: base64url(sha256(verifier)) without padding."""
    return _b64url(hashlib.sha256(verifier.encode("ascii")).digest())


def authorization_request(
    base_url: str,
    client_id: str,
    redirect_uri: str = DEFAULT_REDIRECT_URI,
    scope: str = DEFAULT_SCOPE,
) -> AuthorizationRequest:
    """Build a PKCE (S256) authorization URL with a fresh verifier and state.

    Pure: no I/O. For web apps, whose own server receives the callback and then
    calls `exchange_code`.
    """
    verifier = _b64url(secrets.token_bytes(32))
    state = _b64url(secrets.token_bytes(16))
    query = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": scope,
            "state": state,
            "code_challenge": _challenge(verifier),
            "code_challenge_method": "S256",
        }
    )
    return AuthorizationRequest(
        url=f"{_base(base_url)}{AUTH_PATH}?{query}",
        state=state,
        code_verifier=verifier,
        client_id=client_id,
        redirect_uri=redirect_uri,
    )


# ---- HTTP --------------------------------------------------------------------


def _base(base_url: str) -> str:
    return base_url.rstrip("/")


def _send(
    method: str,
    url: str,
    *,
    insecure: bool,
    timeout: float,
    form: dict[str, str] | None = None,
    json: Any = None,
) -> tuple[int, Any]:
    """One request; the status and parsed JSON body (None when it is not JSON).

    A transport failure becomes an `AuthError`: to a caller signing a user in,
    "the platform could not be reached" is a sign-in that did not happen.
    """
    try:
        with httpx.Client(verify=not insecure, timeout=timeout) as client:
            response = client.request(
                method,
                url,
                data=form,
                json=json,
                headers={"accept": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise AuthError(
            f"Could not reach {url}: {type(exc).__name__}", error="request_failed"
        ) from exc
    try:
        payload = response.json()
    except ValueError:
        payload = None
    return response.status_code, payload


def _fields(payload: Any) -> tuple[str | None, str | None]:
    """`error` and `error_description` from an OAuth error body, either may be None."""
    if not isinstance(payload, dict):
        return None, None
    error, description = payload.get("error"), payload.get("error_description")
    return (
        error if isinstance(error, str) else None,
        description if isinstance(description, str) else None,
    )


def _failure(action: str, status: int, payload: Any) -> AuthError:
    error, description = _fields(payload)
    message = f"{action} failed: {error or f'HTTP {status}'}"
    if description:
        message = f"{message} ({description})"
    return AuthError(message, error=error or f"http_{status}", description=description)


def _tokens(payload: Any, *, keep_refresh: str | None = None) -> Tokens:
    """Map a token response; `keep_refresh` stands in when no new one was issued."""
    access = payload.get("access_token") if isinstance(payload, dict) else None
    if not isinstance(access, str) or not access:
        raise AuthError("The token endpoint returned no access_token.", error="invalid_response")

    def text(key: str) -> str | None:
        value = payload.get(key)
        return value if isinstance(value, str) and value else None

    lifetime = payload.get("expires_in")
    expires_at = None
    if isinstance(lifetime, (int, float)) and not isinstance(lifetime, bool) and lifetime > 0:
        expires_at = (
            (datetime.now(timezone.utc) + timedelta(seconds=lifetime))
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        )
    return Tokens(access, text("refresh_token") or keep_refresh, text("id_token"), expires_at)


def _grant(
    base_url: str,
    action: str,
    form: dict[str, str],
    *,
    insecure: bool,
    timeout: float,
    keep_refresh: str | None = None,
) -> Tokens:
    status, payload = _send(
        "POST",
        f"{_base(base_url)}{TOKEN_PATH}",
        form=form,
        insecure=insecure,
        timeout=timeout,
    )
    if status >= 400:
        raise _failure(action, status, payload)
    return _tokens(payload, keep_refresh=keep_refresh)


# ---- registration, exchange, refresh -----------------------------------------


def register_client(
    base_url: str,
    client_name: str,
    redirect_uris: list[str] | None = None,
    *,
    insecure: bool = False,
    timeout: float = _DEFAULT_TIMEOUT,
) -> RegisteredClient:
    """Self-register a public client with bkn-safe.

    The platform may not offer this — 0.2.0 has no such route, and an operator
    can disable it — and a 404/405 is reported as exactly that.
    """
    uris = list(redirect_uris) if redirect_uris else [DEFAULT_REDIRECT_URI]
    status, payload = _send(
        "POST",
        f"{_base(base_url)}{REGISTER_PATH}",
        json={"client_name": client_name, "redirect_uris": uris},
        insecure=insecure,
        timeout=timeout,
    )
    if status in (404, 405):
        raise AuthError(
            "This platform does not let clients register themselves (0.2.0 has no "
            "self-registration, or an operator disabled it). Use device_login, or "
            "ask an operator to register a client for the app.",
            error="registration_unavailable",
        )
    if status >= 400:
        raise _failure("Client registration", status, payload)
    client_id = payload.get("client_id") if isinstance(payload, dict) else None
    if not isinstance(client_id, str) or not client_id:
        raise AuthError("Registration returned no client_id.", error="invalid_response")
    returned = payload.get("redirect_uris")
    name = payload.get("client_name")
    return RegisteredClient(
        client_id=client_id,
        client_name=name if isinstance(name, str) else client_name,
        redirect_uris=[u for u in returned if isinstance(u, str)]
        if isinstance(returned, list)
        else uris,
    )


def exchange_code(
    base_url: str,
    request: AuthorizationRequest,
    code: str,
    state: str,
    *,
    insecure: bool = False,
    timeout: float = _DEFAULT_TIMEOUT,
) -> Tokens:
    """Trade the callback's `code` for tokens, after checking its `state`.

    The state check is what ties the callback to the sign-in this process
    started; a mismatch means the callback is somebody else's and is refused
    before the code is sent anywhere.
    """
    if not secrets.compare_digest(state.encode(), request.state.encode()):
        raise AuthError(
            "The callback's state does not match the sign-in that was started.",
            error="state_mismatch",
        )
    return _grant(
        base_url,
        "Code exchange",
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": request.redirect_uri,
            "client_id": request.client_id,
            "code_verifier": request.code_verifier,
        },
        insecure=insecure,
        timeout=timeout,
    )


def refresh(
    base_url: str,
    tokens: Tokens,
    *,
    client_id: str,
    insecure: bool = False,
    timeout: float = _DEFAULT_TIMEOUT,
) -> Tokens:
    """The `refresh_token` grant.

    The platform rotates refresh tokens, so the old one is spent: save the one in
    the result. When the response carries none, the old one is kept in it.
    """
    if not tokens.refresh_token:
        raise AuthError(
            "These tokens have no refresh token; sign the user in again.",
            error="invalid_grant",
        )
    return _grant(
        base_url,
        "Token refresh",
        {
            "grant_type": "refresh_token",
            "refresh_token": tokens.refresh_token,
            "client_id": client_id,
        },
        insecure=insecure,
        timeout=timeout,
        keep_refresh=tokens.refresh_token,
    )


# ---- loopback login ----------------------------------------------------------


class _CallbackServer(HTTPServer):
    """A one-shot listener: serves the redirect path, 404s everything else."""

    expected_path = "/"
    expected_state = ""
    #: Set by the handler once the real callback arrives: (code, error, error_description).
    outcome: tuple[str | None, AuthError | None] | None = None


class _CallbackServerV6(_CallbackServer):
    address_family = socket.AF_INET6


class _Callback(BaseHTTPRequestHandler):
    #: A browser holding a connection open must not stall the wait for the real one.
    timeout = 5

    def do_GET(self) -> None:
        server = cast(_CallbackServer, self.server)
        url = urllib.parse.urlsplit(self.path)
        if url.path != server.expected_path:
            self._reply(404, "Not found.")
            return
        params = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        if "error" in params:
            description = params.get("error_description")
            failure = AuthError(
                f"Sign-in was not completed: {params['error']}"
                + (f" ({description})" if description else ""),
                error=params["error"],
                description=description,
            )
            server.outcome = (None, failure)
            self._reply(200, f"Sign-in failed: {params['error']}. You can close this page.")
        elif "code" not in params:
            self._reply(400, "Missing code.")
        elif not secrets.compare_digest(
            params.get("state", "").encode(), server.expected_state.encode()
        ):
            mismatch = AuthError(
                "The callback's state does not match the sign-in that was started.",
                error="state_mismatch",
            )
            server.outcome = (None, mismatch)
            self._reply(400, "Sign-in failed: state mismatch. You can close this page.")
        else:
            server.outcome = (params["code"], None)
            self._reply(200, "Signed in. You can close this page.")

    def _reply(self, status: int, text: str) -> None:
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.send_header("connection", "close")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: Any) -> None:
        return


def _loopback_target(redirect_uri: str) -> tuple[str, int, str]:
    """Host, port and path of a loopback redirect, or an `InputError` saying why not."""
    parts = urllib.parse.urlsplit(redirect_uri)
    if parts.scheme != "http" or parts.hostname not in _LOOPBACK_HOSTS:
        raise InputError(
            f"login() can only receive a callback on an http loopback address "
            f"(127.0.0.1, localhost, [::1]); got {redirect_uri}. A web app should "
            "use authorization_request() and exchange_code() from its own handler."
        )
    return parts.hostname, parts.port or 80, parts.path or "/"


def _listen(host: str, port: int, path: str, state: str) -> _CallbackServer:
    cls = _CallbackServerV6 if ":" in host else _CallbackServer
    try:
        server = cls((host, port), _Callback)
    except OSError as exc:
        raise InputError(
            f"Cannot listen on {host}:{port} for the sign-in callback ({exc.strerror or exc}). "
            "Free the port or register a redirect URI on another one."
        ) from exc
    server.expected_path = path
    server.expected_state = state
    return server


def _print_url(url: str) -> None:
    print(f"Open this URL to sign in:\n{url}", file=sys.stderr)


def login(
    base_url: str,
    client_id: str,
    redirect_uri: str = DEFAULT_REDIRECT_URI,
    scope: str = DEFAULT_SCOPE,
    *,
    open_browser: bool = True,
    on_url: Callable[[str], None] | None = None,
    timeout: float = _DEFAULT_LOGIN_TIMEOUT,
    insecure: bool = False,
    http_timeout: float = _DEFAULT_TIMEOUT,
) -> Tokens:
    """The whole loopback sign-in: listen, open the browser, wait, exchange.

    The listener is up **before** the browser is opened or `on_url` is called: a
    user who already has a platform session is redirected back at once, and a
    callback with nobody listening would be lost. `on_url` is always called with
    the URL (default: print it to stderr) so a headless run can show it.
    Requests for any other path get a 404 and the wait goes on; the one request
    on the redirect path ends it.
    """
    host, port, path = _loopback_target(redirect_uri)
    request = authorization_request(base_url, client_id, redirect_uri, scope)
    server = _listen(host, port, path, request.state)
    try:
        (on_url or _print_url)(request.url)
        if open_browser:
            _open(request.url)
        code = _await_callback(server, timeout)
    finally:
        server.server_close()
    return exchange_code(
        base_url, request, code, request.state, insecure=insecure, timeout=http_timeout
    )


def _open(url: str) -> None:
    try:
        webbrowser.open(url)
    except Exception:  # no browser is not a failure; the URL was shown
        return


def _await_callback(server: _CallbackServer, timeout: float) -> str:
    deadline = _monotonic() + timeout
    while server.outcome is None:
        remaining = deadline - _monotonic()
        if remaining <= 0:
            raise AuthError(
                f"No sign-in callback arrived within {timeout:g} seconds.", error="timeout"
            )
        server.timeout = remaining
        server.handle_request()
    code, failure = server.outcome
    if failure is not None:
        raise failure
    assert code is not None
    return code


# ---- device login ------------------------------------------------------------


def _print_prompt(prompt: DevicePrompt) -> None:
    target = prompt.verification_uri_complete or prompt.verification_uri
    print(
        f"Open {target} and enter the code {prompt.user_code} to sign in.",
        file=sys.stderr,
    )


def _on_base_host(base_url: str, uri: str) -> str:
    """Present a verification URI on the origin the caller actually reached.

    Hydra may advertise an internal host (a container name); the user's browser
    can only get to the base URL.
    """
    base, target = urllib.parse.urlsplit(base_url), urllib.parse.urlsplit(uri)
    if not base.scheme or not base.netloc or not target.path:
        return uri
    return urllib.parse.urlunsplit((base.scheme, base.netloc, target.path, target.query, ""))


def device_login(
    base_url: str,
    client_id: str = DEVICE_CLIENT_ID,
    scope: str = DEFAULT_SCOPE,
    *,
    on_prompt: Callable[[DevicePrompt], None] | None = None,
    timeout: float | None = None,
    insecure: bool = False,
    http_timeout: float = _DEFAULT_TIMEOUT,
) -> Tokens:
    """RFC 8628 device authorization: show a code, poll until it is approved.

    Needs no callback address, so it suits headless machines. Tokens issued to
    the default client refresh with the default `client_id` of `configure`.
    """
    base = _base(base_url)
    status, payload = _send(
        "POST",
        f"{base}{DEVICE_PATH}",
        form={"client_id": client_id, "scope": scope},
        insecure=insecure,
        timeout=http_timeout,
    )
    if status >= 400:
        raise _failure("Device authorization", status, payload)
    data = payload if isinstance(payload, dict) else {}
    device_code, user_code = data.get("device_code"), data.get("user_code")
    uri, complete = data.get("verification_uri"), data.get("verification_uri_complete")
    if not (isinstance(device_code, str) and isinstance(user_code, str) and isinstance(uri, str)):
        raise AuthError(
            "Device authorization returned no code or verification_uri; is the "
            "platform's device flow configured?",
            error="invalid_response",
        )
    (on_prompt or _print_prompt)(
        DevicePrompt(
            user_code=user_code,
            verification_uri=_on_base_host(base, uri),
            verification_uri_complete=_on_base_host(base, complete)
            if isinstance(complete, str)
            else None,
        )
    )
    expires_in = (
        float(data["expires_in"]) if isinstance(data.get("expires_in"), (int, float)) else 600.0
    )
    # Whichever ends first decides what the caller is told: their own deadline is
    # a timeout, the code's lifetime is an expiry.
    caller_deadline = timeout is not None and timeout < expires_in
    interval = data.get("interval")
    return _poll_device(
        base,
        device_code,
        client_id,
        float(interval) if isinstance(interval, (int, float)) and interval > 0 else 5.0,
        timeout if caller_deadline and timeout is not None else expires_in,
        caller_deadline,
        insecure,
        http_timeout,
    )


def _poll_device(
    base: str,
    device_code: str,
    client_id: str,
    interval: float,
    window: float,
    caller_deadline: bool,
    insecure: bool,
    http_timeout: float,
) -> Tokens:
    deadline = _monotonic() + window
    while _monotonic() < deadline:
        _sleep(interval)
        status, payload = _send(
            "POST",
            f"{base}{TOKEN_PATH}",
            form={"grant_type": _DEVICE_GRANT, "device_code": device_code, "client_id": client_id},
            insecure=insecure,
            timeout=http_timeout,
        )
        if status < 400:
            return _tokens(payload)
        error, description = _fields(payload)
        if error == "authorization_pending":
            continue
        if error == "slow_down":
            interval += 5.0  # RFC 8628 3.5
            continue
        if error == "access_denied":
            raise AuthError("The user denied the sign-in.", error=error, description=description)
        if error == "expired_token":
            break
        raise _failure("Device sign-in", status, payload)
    else:
        if caller_deadline:
            raise AuthError(f"No approval arrived within {window:g} seconds.", error="timeout")
    raise AuthError("The device code expired before it was approved.", error="expired_token")
