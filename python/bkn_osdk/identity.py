# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Who the current credential belongs to.

`me()` reads bkn-safe's self-service record for the caller::

    from bkn_osdk import me
    user = me()
    user.account, user.name, user.roles

Inside a Function the credential is the invoking caller's own, so `me()` names
the person who ran it — for a Function behind an action, the person who
triggered the action. It is a live read, not decoded from a token, so a profile
edit shows up on the next call.

It goes through the REST gateway at `BKN_BASE_URL`. In a sandbox where that is
empty it raises `InputError` ("No base URL") before sending anything, as every
other OSDK call does; when the address is set but the sandbox network does not
allow the gateway, it fails with a connection error.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from .config import Context, resolve_context
from .errors import BknError
from .http import request

__all__ = ["ME_PATH", "Me", "me"]

ME_PATH = "/api/safe/v1/me"


@dataclass(frozen=True)
class Me:
    """The caller's own directory record and role bindings.

    `departments` and `role_ids` are ids; `roles` are display names, falling
    back to the id for a role that no longer exists. `updated_at` is the
    platform's timestamp string as sent.
    """

    id: str
    account: str
    name: str
    email: str
    telephone: str
    account_type: str
    enabled: bool
    departments: tuple[str, ...]
    roles: tuple[str, ...]
    role_ids: tuple[str, ...]
    updated_at: str | None


def me(*, context: Context | None = None) -> Me:
    """Return the record of the user the current credential belongs to."""
    body = request(context or resolve_context(), ME_PATH)
    if not isinstance(body, dict) or not isinstance(body.get("id"), str) or not body["id"]:
        raise BknError(f"unexpected {ME_PATH} response: {body!r}")
    return Me(
        id=body["id"],
        account=_text(body.get("account")),
        name=_text(body.get("name")),
        email=_text(body.get("email")),
        telephone=_text(body.get("telephone")),
        account_type=_text(body.get("account_type")),
        enabled=body.get("enabled") is True,
        departments=_ids(body.get("departments")),
        roles=_ids(body.get("roles")),
        role_ids=_ids(body.get("role_ids")),
        updated_at=body.get("updated_at") if isinstance(body.get("updated_at"), str) else None,
    )


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _ids(value: Any) -> tuple[str, ...]:
    # The platform sends null, not [], for a user with no departments.
    if not isinstance(value, Iterable) or isinstance(value, (str, bytes, dict)):
        return ()
    return tuple(item for item in value if isinstance(item, str))
