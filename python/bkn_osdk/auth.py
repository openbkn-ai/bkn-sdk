# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Keeping a stored session alive for the length of a Python process.

Access tokens on this platform are short-lived, so a long-running script that
resolved its credentials from `~/.bkn` goes stale mid-run and starts getting
401s. The `openbkn` CLI solves that by refreshing on a 401 and persisting; this
side does the same exchange, in memory.

**The one time this writes to the store** is refresh-token rotation. Where the
authorization server returns a *new* refresh token, the old one is spent — so
keeping the new one to ourselves would strand the CLI with a dead credential and
force a re-login. Writing it back is what preserves the CLI's session, not a
land-grab on a file it owns; where no new token comes back, nothing is written.

Refresh applies only to credentials that came from the store. An explicit
`token=` or `BKN_TOKEN` is the caller's to manage, and an AppKey has no refresh
at all — its 401 means re-issue.
"""

from __future__ import annotations

import threading
import urllib.parse
from dataclasses import dataclass

import httpx

from .config import Context, StoredCredential, write_refreshed_token

__all__ = ["refreshed_token", "token_for"]

TOKEN_PATH = "/oauth2/token"

_lock = threading.Lock()
#: (base URL, user id) -> the freshest access token this process has obtained.
_fresh: dict[tuple[str, str], str] = {}


@dataclass(frozen=True)
class _Tokens:
    access_token: str
    refresh_token: str | None


def token_for(ctx: Context) -> str:
    """The token to send: whatever this process last refreshed, else the stored one.

    Without this, every request after the first expiry would pay for its own
    refresh round trip.
    """
    credential = ctx.credential
    if credential is None:
        return ctx.token
    with _lock:
        return _fresh.get((credential.base_url, credential.user_id), ctx.token)


def refreshed_token(ctx: Context, used: str) -> str | None:
    """Exchange the refresh token for a fresh access token, or None if that fails.

    `used` is the token that just came back 401; if another thread refreshed in
    the meantime, its result is returned instead of a second exchange.
    """
    credential = ctx.credential
    if credential is None:
        return None

    key = (credential.base_url, credential.user_id)
    with _lock:
        current = _fresh.get(key)
        if current is not None and current != used:
            return current

    tokens = _exchange(credential, ctx.insecure, ctx.timeout)
    if tokens is None:
        return None

    with _lock:
        _fresh[key] = tokens.access_token

    if tokens.refresh_token and tokens.refresh_token != credential.refresh_token:
        # Rotation: the stored refresh token is now spent. Hand the replacement
        # back to the store, or the next `openbkn` command has no way in.
        write_refreshed_token(
            credential.base_url,
            credential.user_id,
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
        )
    return tokens.access_token


def _exchange(credential: StoredCredential, insecure: bool, timeout: float) -> _Tokens | None:
    """The RFC 6749 refresh grant, against a public client with no secret.

    A failure returns None rather than raising, so the caller surfaces the
    original 401 — which carries the platform's own next-step hint — instead of
    a second error about the refresh.
    """
    body = urllib.parse.urlencode(
        {
            "grant_type": "refresh_token",
            "refresh_token": credential.refresh_token,
            "client_id": credential.client_id,
        }
    )
    try:
        with httpx.Client(verify=not insecure, timeout=timeout) as client:
            response = client.post(
                f"{credential.base_url}{TOKEN_PATH}",
                content=body,
                headers={
                    "content-type": "application/x-www-form-urlencoded",
                    "accept": "application/json",
                },
            )
        if response.is_error:
            return None
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return None

    access = payload.get("access_token") if isinstance(payload, dict) else None
    if not isinstance(access, str) or not access:
        return None
    rotated = payload.get("refresh_token") if isinstance(payload, dict) else None
    return _Tokens(access, rotated if isinstance(rotated, str) and rotated else None)


def _reset_for_tests() -> None:
    with _lock:
        _fresh.clear()
