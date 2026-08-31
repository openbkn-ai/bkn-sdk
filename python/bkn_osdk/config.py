# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Credential resolution and the ambient request context.

Queries are issued from class-level calls (`People.take(10)`), so credentials
have to reach them without appearing in the signature. They are resolved in
this order, innermost first:

1. the active `session(...)` scope,
2. the process default set by `configure(...)`,
3. `BKN_TOKEN` / `BKN_BASE_URL`,
4. `~/.bkn/platforms/<base64url(baseUrl)>/users/<userId>/token.json` — the store
   the `openbkn` CLI writes.

The scope lives in a `contextvars.ContextVar`, so each thread and each asyncio
task carries its own: a multi-tenant server cannot leak one user's token into
another's request, and tests need no global teardown.

This side is a **reader** of the store. `openbkn auth login` owns those files;
nothing here writes or refreshes one.
"""

from __future__ import annotations

import base64
import json
import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import InputError

__all__ = [
    "DEFAULT_CLIENT_ID",
    "DEFAULT_TIMEOUT",
    "Context",
    "StoredCredential",
    "configure",
    "resolve_context",
    "session",
    "write_refreshed_token",
]

DEFAULT_TIMEOUT = 30.0
#: The public OAuth client the CLI logs in as; the refresh grant needs the same one.
DEFAULT_CLIENT_ID = "openbkn-sdk"

_PROFILE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@dataclass(frozen=True)
class StoredCredential:
    """A refreshable session read from the store.

    Present only when the token came from `~/.bkn` — an explicit `token=`, a
    `BKN_TOKEN`, or an AppKey has no refresh, and inventing one would be wrong
    in three different ways.
    """

    base_url: str
    user_id: str
    refresh_token: str
    client_id: str = DEFAULT_CLIENT_ID


@dataclass(frozen=True)
class Context:
    """A fully resolved request context — everything an HTTP call needs."""

    base_url: str
    token: str
    insecure: bool = False
    timeout: float = DEFAULT_TIMEOUT
    #: Set when the token came from the store and can be refreshed in place.
    credential: StoredCredential | None = None
    #: Verify the generated package against the live schema on the first query.
    check_schema: bool = False
    #: A business turn the caller already owns. When both ids are present the
    #: runtime joins that turn instead of opening one, and never finishes it.
    conversation_id: str | None = None
    interaction_id: str | None = None
    #: Route reads through MCP inside a managed interaction, keeping the receipt.
    traced: bool = False


@dataclass(frozen=True)
class _Overrides:
    """A partially specified context. `None` means "ask the next level down"."""

    base_url: str | None = None
    token: str | None = None
    insecure: bool | None = None
    timeout: float | None = None
    user: str | None = None
    check_schema: bool | None = None
    traced: bool | None = None
    conversation_id: str | None = None
    interaction_id: str | None = None


@dataclass(frozen=True)
class _Scope:
    overrides: _Overrides
    parent: _Scope | None


_scope: ContextVar[_Scope | None] = ContextVar("bkn_osdk_scope", default=None)
_process_default = _Overrides()


def configure(
    *,
    base_url: str | None = None,
    token: str | None = None,
    insecure: bool | None = None,
    timeout: float | None = None,
    user: str | None = None,
    check_schema: bool | None = None,
    traced: bool | None = None,
    conversation_id: str | None = None,
    interaction_id: str | None = None,
) -> None:
    """Set the process default (level 2).

    Each call **replaces** the whole default rather than merging into it, so
    `configure()` with no arguments clears it — which is what a test teardown
    wants, and what makes the resulting state readable from one line.
    """
    global _process_default
    _process_default = _Overrides(
        base_url=base_url,
        token=token,
        insecure=insecure,
        timeout=timeout,
        user=user,
        check_schema=check_schema,
        traced=traced,
        conversation_id=conversation_id,
        interaction_id=interaction_id,
    )


@contextmanager
def session(
    *,
    base_url: str | None = None,
    token: str | None = None,
    insecure: bool | None = None,
    timeout: float | None = None,
    user: str | None = None,
    check_schema: bool | None = None,
    traced: bool | None = None,
    conversation_id: str | None = None,
    interaction_id: str | None = None,
) -> Iterator[Context]:
    """Bind credentials for the duration of a scope (level 1).

    Fields left unset fall through to the enclosing scope, then to the process
    default, the environment, and the store — so `session(token=…)` inside a
    process that already knows its platform does not have to repeat the base URL.

    Resolution happens on entry, so a scope that cannot be satisfied fails at
    the `with` rather than at the first query.
    """
    scope = _Scope(
        overrides=_Overrides(
            base_url=base_url,
            token=token,
            insecure=insecure,
            timeout=timeout,
            user=user,
            check_schema=check_schema,
            traced=traced,
            conversation_id=conversation_id,
            interaction_id=interaction_id,
        ),
        parent=_scope.get(),
    )
    reset_to = _scope.set(scope)
    try:
        # Inside the try: a scope that cannot be resolved must still be popped,
        # or the failed `with` would leak its overrides into the whole process.
        resolved = resolve_context()
        opened = _open_interactions(resolved)
        try:
            yield resolved
        except BaseException:
            _finish_interactions(resolved, opened, "failed")
            raise
        else:
            _finish_interactions(resolved, opened, "completed")
    finally:
        _scope.reset(reset_to)


#: A traced scope's registry, and the token that puts back whatever was there
#: before it — scopes nest, so "before" is not always nothing.
_Opened = tuple[dict[str, Any], "Token[dict[str, Any] | None]"]


def _open_interactions(ctx: Context) -> _Opened | None:
    """A traced scope holds one managed interaction per network it reads.

    The registry is created empty here and filled by the first read of each
    network, so a scope that ends up reading nothing costs no round trip. The
    reset token comes back with it: scopes nest, and an inner one that blanked
    the variable on exit would strand the outer scope's own registry.
    """
    if not ctx.traced:
        return None
    from .lifecycle import interaction_scope

    registry: dict[str, Any] = {}
    return registry, interaction_scope().set(registry)


def _finish_interactions(ctx: Context, opened: _Opened | None, outcome: str) -> None:
    """Close every interaction the scope opened, including on the way out of an error.

    The variable is restored even when the scope read nothing — an empty
    registry left installed would look like an open scope to the next call,
    which would then open a turn nobody finishes.
    """
    if opened is None:
        return
    from .lifecycle import finish, interaction_scope

    registry, reset_to = opened
    try:
        for interaction in registry.values():
            finish(ctx, interaction, outcome, None)
        registry.clear()
    finally:
        interaction_scope().reset(reset_to)


def resolve_context() -> Context:
    """Walk the four levels and produce a usable `Context`, or explain what is missing."""
    levels: list[_Overrides] = []
    scope = _scope.get()
    while scope is not None:
        levels.append(scope.overrides)
        scope = scope.parent
    levels.append(_process_default)

    def pick(field: str) -> Any:
        for level in levels:
            value = getattr(level, field)
            if value is not None:
                return value
        return None

    base_url = pick("base_url") or os.environ.get("BKN_BASE_URL") or _active_platform()
    if not base_url:
        raise InputError(
            "No base URL. Pass base_url=…, set BKN_BASE_URL, or run `openbkn auth login`."
        )
    base_url = base_url.rstrip("/")

    user = pick("user") or os.environ.get("BKN_USER")
    user_id = _resolve_user_id(base_url, user) if user else _active_user_id(base_url)
    stored = _read_token(base_url, user_id) or {}

    explicit = pick("token") or os.environ.get("BKN_TOKEN")
    token = explicit or stored.get("accessToken")
    if not isinstance(token, str) or not token:
        raise InputError(
            "No access token. Pass token=…, set BKN_TOKEN, or run `openbkn auth login`."
        )

    # Refresh is offered only for a session this store owns. A token passed in
    # explicitly is the caller's to manage, and an AppKey has no refresh at all.
    refresh_token = stored.get("refreshToken")
    credential = (
        StoredCredential(base_url=base_url, user_id=user_id, refresh_token=refresh_token)
        if not explicit and user_id and isinstance(refresh_token, str) and refresh_token
        else None
    )

    insecure = pick("insecure")
    if insecure is None:
        # A `-k` login is remembered per platform, so a self-signed host needn't
        # repeat it. The opt-out is scoped to this platform's own requests.
        insecure = bool(stored.get("tlsInsecure", False))

    timeout = pick("timeout")

    return Context(
        base_url=base_url,
        token=token,
        credential=credential,
        insecure=bool(insecure),
        timeout=float(timeout) if timeout is not None else DEFAULT_TIMEOUT,
        check_schema=bool(pick("check_schema")),
        traced=bool(pick("traced")),
        # A host that already owns a business turn passes it in the environment —
        # the sandbox injects both per execution. Joining it is what keeps the
        # evidence on the caller's turn instead of an anonymous one of our own.
        conversation_id=pick("conversation_id") or os.environ.get("BKN_CONVERSATION_ID") or None,
        interaction_id=pick("interaction_id") or os.environ.get("BKN_INTERACTION_ID") or None,
    )


# ---- the ~/.bkn store (read-only) -------------------------------------------


def _config_dir() -> Path:
    return Path(os.environ.get("BKN_CONFIG_DIR") or (Path.home() / ".bkn"))


def _state_path() -> Path:
    raw = (os.environ.get("BKN_PROFILE") or "").strip()
    if not raw:
        return _config_dir() / "state.json"
    if not _PROFILE_RE.match(raw):
        raise InputError(f"BKN_PROFILE='{raw}' is invalid. Use 1-64 chars from [A-Za-z0-9_-].")
    return _config_dir() / "profiles" / raw / "state.json"


def _encode_key(base_url: str) -> str:
    return base64.urlsafe_b64encode(base_url.encode("utf-8")).decode("ascii").rstrip("=")


def _user_dir(base_url: str, user_id: str) -> Path:
    return _config_dir() / "platforms" / _encode_key(base_url) / "users" / user_id


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _state() -> dict[str, Any]:
    return _read_json(_state_path()) or {}


def _active_platform() -> str | None:
    value = _state().get("currentPlatform")
    return value if isinstance(value, str) else None


def _active_user_id(base_url: str) -> str | None:
    users = _state().get("activeUsers")
    if not isinstance(users, dict):
        return None
    value = users.get(base_url)
    return value if isinstance(value, str) else None


def _read_token(base_url: str, user_id: str | None) -> dict[str, Any] | None:
    if not user_id:
        return None
    return _read_json(_user_dir(base_url, user_id) / "token.json")


def _read_platform_config(base_url: str, user_id: str | None = None) -> dict[str, Any]:
    user_id = user_id or _active_user_id(base_url)
    if not user_id:
        return {}
    return _read_json(_user_dir(base_url, user_id) / "config.json") or {}


def write_refreshed_token(
    base_url: str, user_id: str, *, access_token: str, refresh_token: str
) -> None:
    """Put a rotated credential back where the CLI will look for it.

    The only write this side performs, and it exists to stop a Python process
    from spending the CLI's refresh token and leaving nothing in its place. Only
    the two token fields move; everything else in the file is preserved, and a
    failure to write is swallowed — the process has a working access token
    either way, and a read-only store is not a reason to fail a query.
    """
    path = _user_dir(base_url, user_id) / "token.json"
    existing = _read_json(path)
    if existing is None:
        return
    updated = {**existing, "accessToken": access_token, "refreshToken": refresh_token}
    try:
        path.write_text(json.dumps(updated, indent=2) + "\n", encoding="utf-8")
        path.chmod(0o600)
    except OSError:
        return


def _saved_users(base_url: str) -> list[tuple[str, dict[str, Any]]]:
    root = _config_dir() / "platforms" / _encode_key(base_url) / "users"
    if not root.is_dir():
        return []
    out: list[tuple[str, dict[str, Any]]] = []
    for entry in sorted(root.iterdir()):
        token = _read_json(entry / "token.json")
        if token is not None:
            out.append((entry.name, token))
    return out


def _resolve_user_id(base_url: str, user_or_name: str) -> str:
    """Map a user id or the username saved at login to a user id.

    A miss is an error, never a fall back to the active user: the point of
    naming a user is to not act as a different one.
    """
    saved = _saved_users(base_url)
    for user_id, _token in saved:
        if user_id == user_or_name:
            return user_id
    for user_id, token in saved:
        if token.get("username") == user_or_name or token.get("displayName") == user_or_name:
            return user_id
    known = ", ".join(str(t.get("username") or uid) for uid, t in saved) or "(none)"
    raise InputError(
        f"No saved user '{user_or_name}' on {base_url}. Saved: {known}. "
        f"See `openbkn auth users {base_url}`."
    )
