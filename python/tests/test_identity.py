# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""`me()`: one GET to bkn-safe's self-service record, read into a typed value."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

import bkn_osdk
from bkn_osdk import BknError, Context, HttpError, Me, me
from bkn_osdk import http as http_module

PLATFORM = "https://platform.example"

RECORD: dict[str, Any] = {
    "id": "u-1",
    "account": "zhangsan",
    "name": "Zhang San",
    "email": "zs@example.com",
    "telephone": "13800000000",
    "account_type": "other",
    "enabled": True,
    "departments": ["d-1", "d-2"],
    "roles": ["Analyst"],
    "role_ids": ["r-1"],
    "updated_at": "2026-10-29T08:00:00.123456Z",
}


def answer(monkeypatch: pytest.MonkeyPatch, response: httpx.Response) -> list[httpx.Request]:
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return response

    client = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    return sent


def test_reads_the_callers_own_record(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = answer(monkeypatch, httpx.Response(200, json=RECORD))

    user = me(context=Context(base_url=PLATFORM, token="t-1"))

    assert user == Me(
        id="u-1",
        account="zhangsan",
        name="Zhang San",
        email="zs@example.com",
        telephone="13800000000",
        account_type="other",
        enabled=True,
        departments=("d-1", "d-2"),
        roles=("Analyst",),
        role_ids=("r-1",),
        updated_at="2026-10-29T08:00:00.123456Z",
    )
    assert len(sent) == 1
    assert sent[0].method == "GET"
    assert str(sent[0].url) == f"{PLATFORM}/api/safe/v1/me"
    assert sent[0].headers["authorization"] == "Bearer t-1"


def test_uses_the_ambient_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    # How a Function sees it: the sandbox sets these, the caller passes nothing.
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "caller-token")
    sent = answer(monkeypatch, httpx.Response(200, json=RECORD))

    assert bkn_osdk.me().account == "zhangsan"
    assert sent[0].headers["authorization"] == "Bearer caller-token"


def test_null_and_missing_fields_become_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    # A user with no departments is sent as null; older platforms omit fields.
    answer(
        monkeypatch,
        httpx.Response(200, json={"id": "u-2", "account": "lisi", "departments": None}),
    )

    user = me(context=Context(base_url=PLATFORM, token="t-1"))

    assert user.departments == ()
    assert user.roles == ()
    assert user.role_ids == ()
    assert user.name == ""
    assert user.enabled is False
    assert user.updated_at is None


def test_http_failure_is_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    answer(monkeypatch, httpx.Response(401, json={"error": {"message": "nope"}}))

    with pytest.raises(HttpError) as raised:
        me(context=Context(base_url=PLATFORM, token="t-1"))
    assert raised.value.status == 401


@pytest.mark.parametrize("body", [[], {"account": "no-id"}, {"id": ""}])
def test_a_record_without_an_id_is_rejected(monkeypatch: pytest.MonkeyPatch, body: Any) -> None:
    answer(monkeypatch, httpx.Response(200, json=body))

    with pytest.raises(BknError, match="unexpected /api/safe/v1/me response"):
        me(context=Context(base_url=PLATFORM, token="t-1"))
