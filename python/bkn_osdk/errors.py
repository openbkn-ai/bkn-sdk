# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Error types, mirroring the TypeScript SDK's semantics.

`HttpError` carries the same next-step hints as `src/api/http.ts`, so an AppKey
401 tells the caller to re-issue the key rather than to retry, and a deploy that
demands a managed lifecycle session says where to get one.
"""

from __future__ import annotations

import json
from typing import Any

__all__ = [
    "BknError",
    "FormatVersionError",
    "HttpError",
    "InputError",
    "ObjectNotFound",
    "SchemaDriftError",
    "ToolError",
    "lifecycle_hint",
]


class BknError(Exception):
    """Base for every error this runtime raises on purpose."""


class InputError(BknError):
    """Caller-side mistake: missing credentials, bad arguments, unusable filter."""


class HttpError(BknError):
    """Non-2xx response, with the body and a next-step hint when one applies."""

    def __init__(
        self,
        status: int,
        reason: str,
        body: str,
        hint: str | None = None,
    ) -> None:
        message = f"HTTP {status} {reason}".rstrip()
        if body:
            message = f"{message}: {body[:2000]}"
        if hint:
            message = f"{message}\n\n{hint}"
        super().__init__(message)
        self.status = status
        self.reason = reason
        self.body = body
        self.hint = hint

    @property
    def payload(self) -> Any:
        """The body parsed as JSON, or None when it is not JSON."""
        return _parse_json(self.body)


class ToolError(BknError):
    """Structured MCP tool failure.

    `retryable` is honored rather than guessed at: `conversation_required` is
    `retryable: false` and means the session was never opened, which is a runtime
    bug to surface — not a condition to retry into.
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        required_action: str | None = None,
        retryable: bool = False,
        retry_after_ms: int | None = None,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.required_action = required_action
        self.retryable = retryable
        self.retry_after_ms = retry_after_ms


class SchemaDriftError(BknError):
    """The live schema no longer matches the fingerprint the package was generated from."""


class FormatVersionError(BknError):
    """The generated package's emitted-code format is outside the runtime's supported range."""


class ObjectNotFound(BknError):
    """`get()` found no instance for the given primary key."""


# ---- next-step hints --------------------------------------------------------

_LIFECYCLE_ACTIONS = frozenset(
    {
        "create_conversation",
        "start_interaction",
        "ensure_operation",
        "bkn_start_interaction",
    }
)


def hint_for(token: str, status: int, body: str) -> str | None:
    """Status-specific guidance, matching `hintFor` in `src/api/http.ts`.

    An AppKey (`bak_…`) 401 means the key is invalid / expired / revoked or its
    owner was disabled — re-issue it; there is no login or refresh to fall back on.
    """
    if status == 401 and token.startswith("bak_"):
        return (
            "AppKey invalid / expired / revoked / owner disabled — re-issue with "
            "`openbkn appkey create` (or `appkey regenerate <id>`). Do not auto-retry."
        )
    return lifecycle_hint(body)


def lifecycle_hint(body: str) -> str | None:
    """Guidance when a deploy rejects a request for want of a lifecycle session.

    Returns None for every other error, so any body can be passed in.
    """
    if required_action(body) not in _LIFECYCLE_ACTIONS:
        return None
    return (
        "This deploy requires a managed lifecycle session: the request needs a `bkn_context` "
        "with conversation_id and interaction_id, obtained from the deploy's lifecycle tools "
        "(`bkn_start_interaction`, preceded by `bkn_create_conversation` where the catalog "
        "lists one). `openbkn context info` reports which shape this deploy uses."
    )


def required_action(body: str) -> str | None:
    """`error.required_action` from a JSON error body, or None."""
    parsed = _parse_json(body)
    if not isinstance(parsed, dict):
        return None
    error = parsed.get("error")
    if not isinstance(error, dict):
        return None
    action = error.get("required_action")
    return action if isinstance(action, str) else None


def _parse_json(body: str) -> Any:
    try:
        return json.loads(body)
    except (ValueError, TypeError):
        return None
