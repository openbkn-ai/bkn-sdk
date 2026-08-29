# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The single choke point for every backend call: JSON in, JSON out, typed errors.

Mirrors `src/api/http.ts` — explicit timeout, auth headers, and the same
next-step hints on failure. Token refresh is deliberately absent: the CLI owns
the store, so an expired stored token is reported rather than silently rewritten
from a Python process.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

import httpx

from .auth import refreshed_token, token_for
from .config import Context, resolve_context
from .errors import HttpError, hint_for

__all__ = ["call", "request"]

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
        "x-business-domain": ctx.business_domain,
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
