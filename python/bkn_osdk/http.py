# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The single choke point for every backend call: JSON in, JSON out, typed errors.

Mirrors `src/api/http.ts` — explicit timeout, auth headers, and the same
next-step hints on failure. Token refresh is deliberately absent: the CLI owns
the store, so an expired stored token is reported rather than silently rewritten
from a Python process.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin

import httpx

from .auth import refreshed_token, token_for
from .config import Context, resolve_context
from .errors import HttpError, PlatformVersionError, hint_for

__all__ = ["MIN_PLATFORM_VERSION", "call", "request"]

#: The first platform release whose Context Loader recalls skills and tools from a
#: network's capability bindings. Earlier releases recall skills from a `skills` object
#: type, a path this runtime does not describe; talking to one would look like it works.
MIN_PLATFORM_VERSION = (0, 1, 5)
HEALTH_PATH = "/api/bkn-backend/v1/health"
_HEALTH_TIMEOUT = 5.0

QueryValue = str | int | float | bool | list[str | int | float | bool] | None


def request(
    ctx: Context,
    path: str,
    *,
    method: str | None = None,
    body: Any = None,
    query: dict[str, QueryValue] | None = None,
    headers: dict[str, str] | None = None,
    method_override: str | None = None,
    timeout: float | None = None,
) -> Any:
    """Send one request and return its parsed JSON body (None for an empty body).

    `method_override` sets `X-HTTP-Method-Override`, which the read path needs:
    `ontology-query` takes a GET semantically but a body in practice.
    """
    url = path if path.startswith("http") else urljoin(f"{ctx.base_url}/", path.lstrip("/"))
    _ensure_platform_floor(ctx)
    has_body = body is not None
    token = token_for(ctx)

    def send(bearer: str) -> httpx.Response:
        return _client(ctx).request(
            method or ("POST" if has_body else "GET"),
            url,
            json=body if has_body else None,
            params=_params(query),
            headers=_headers(
                ctx,
                bearer,
                has_body=has_body,
                extra=headers,
                method_override=method_override,
            ),
            timeout=timeout if timeout is not None else ctx.timeout,
        )

    response = send(token)
    if response.status_code == 401 and ctx.credential is not None:
        # A stored session that expired mid-process. Swap it for a fresh access
        # token and retry once; on failure the original 401 stands, hint included.
        refreshed = refreshed_token(ctx, token)
        if refreshed is not None:
            response = send(refreshed)

    text = response.text
    if response.is_error:
        raise HttpError(
            response.status_code,
            response.reason_phrase,
            text,
            hint_for(ctx.token, response.status_code, text),
        )
    if not text:
        return None
    return response.json()


def call(
    path: str,
    *,
    method: str | None = None,
    body: Any = None,
    query: dict[str, QueryValue] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float | None = None,
) -> Any:
    """Authenticated escape hatch onto any backend endpoint.

    The Python side ports none of the TypeScript SDK's eleven resource
    namespaces — they are HTTP wrapping with no Python-specific value. This
    covers them, reusing the same credential resolution and error mapping as a
    query::

        bkn_osdk.call("/api/dataflow-manager/v1/flows")
    """
    return request(
        resolve_context(),
        path,
        method=method,
        body=body,
        query=query,
        headers=headers,
        timeout=timeout,
    )


def _ensure_platform_floor(ctx: Context) -> None:
    """Refuse a platform that states a version below MIN_PLATFORM_VERSION.

    Only a stated version is acted on; one health read per base URL per process. A health
    route that is missing, unreachable or answers something unexpected lets the call
    through: inside a sandbox the base URL is Context Loader itself, which does not serve
    bkn-backend's health, and refusing there would break every Function on a current
    platform.
    """
    if ctx.base_url not in _platform_versions:
        _platform_versions[ctx.base_url] = _stated_version(ctx)
    stated = _platform_versions[ctx.base_url]
    if stated is not None and stated < MIN_PLATFORM_VERSION:
        floor = ".".join(str(part) for part in MIN_PLATFORM_VERSION)
        found = ".".join(str(part) for part in stated)
        raise PlatformVersionError(
            f"{ctx.base_url} runs platform {found}; bkn-osdk needs {floor} or later. "
            "Upgrade the platform, or use a bkn-osdk released with it."
        )


def _stated_version(ctx: Context) -> tuple[int, int, int] | None:
    try:
        response = _client(ctx).get(
            urljoin(f"{ctx.base_url}/", HEALTH_PATH.lstrip("/")),
            headers={"accept": "application/json"},
            timeout=min(ctx.timeout, _HEALTH_TIMEOUT),
        )
        if response.is_error:
            return None
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        payload = payload["data"]
    raw = payload.get("ServerVersion") if isinstance(payload, dict) else None
    match = re.match(r"^v?(\d+)\.(\d+)\.(\d+)", raw) if isinstance(raw, str) else None
    if match is None:
        return None
    major, minor, patch = (int(group) for group in match.groups())
    return (major, minor, patch)


_platform_versions: dict[str, tuple[int, int, int] | None] = {}


def _headers(
    ctx: Context,
    bearer: str,
    *,
    has_body: bool,
    extra: dict[str, str] | None,
    method_override: str | None,
) -> dict[str, str]:
    # Only `authorization` carries the token: a custom header would survive a
    # cross-origin redirect that strips `authorization`, handing the bearer to
    # the redirect target.
    headers = {
        "authorization": f"Bearer {bearer}",
        "accept": "application/json",
    }
    if has_body:
        headers["content-type"] = "application/json"
    if method_override:
        headers["x-http-method-override"] = method_override
    headers.update(extra or {})
    return headers


def _params(
    query: dict[str, QueryValue] | None,
) -> list[tuple[str, str | int | float | bool | None]]:
    """Flatten query params the way the TypeScript client does: repeat lists, drop None."""
    out: list[tuple[str, str | int | float | bool | None]] = []
    for key, value in (query or {}).items():
        if value is None:
            continue
        for item in value if isinstance(value, list) else [value]:
            out.append((key, _param_str(item)))
    return out


def _param_str(value: str | int | float | bool) -> str:
    return "true" if value is True else "false" if value is False else str(value)


def _client(ctx: Context) -> httpx.Client:
    """One pooled client per (host, TLS policy).

    `verify=False` is scoped to the platform the caller opted out for — it is
    never a process-wide TLS setting, so an unrelated request in the same
    process keeps verifying.
    """
    key = (ctx.base_url, ctx.insecure)
    client = _clients.get(key)
    if client is None or client.is_closed:
        client = httpx.Client(verify=not ctx.insecure, follow_redirects=True)
        _clients[key] = client
    return client


_clients: dict[tuple[str, bool], httpx.Client] = {}
