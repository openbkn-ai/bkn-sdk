# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Error semantics: what an error says, and when it stays quiet.

A hint is guidance the caller acts on, so a wrong one is worse than none — these
pin both directions.
"""

from __future__ import annotations

import json

import pytest

from bkn_osdk import BknError, HttpError, ToolError
from bkn_osdk.errors import hint_for, lifecycle_hint, required_action

LIFECYCLE_BODY = json.dumps(
    {"error": {"code": "conversation_required", "required_action": "bkn_start_interaction"}}
)


# ---- HttpError --------------------------------------------------------------


def test_the_message_carries_status_body_and_hint() -> None:
    error = HttpError(401, "Unauthorized", '{"description":"认证失败"}', "re-issue the key")

    message = str(error)
    assert "HTTP 401 Unauthorized" in message
    assert "认证失败" in message
    assert "re-issue the key" in message


def test_a_long_body_is_truncated_in_the_message_but_kept_whole_on_the_error() -> None:
    body = "x" * 5000

    error = HttpError(500, "Internal Server Error", body)

    assert len(str(error)) < 2500
    assert error.body == body


def test_payload_parses_json_and_shrugs_at_anything_else() -> None:
    assert HttpError(400, "Bad Request", '{"a":1}').payload == {"a": 1}
    assert HttpError(502, "Bad Gateway", "<html>nginx</html>").payload is None
    assert HttpError(204, "No Content", "").payload is None


def test_every_error_is_catchable_as_one_type() -> None:
    """One `except BknError` has to cover the whole runtime, or callers write four."""
    with pytest.raises(BknError):
        raise HttpError(500, "Internal Server Error", "")
    with pytest.raises(BknError):
        raise ToolError("run_sql_failed", "bad sql")


# ---- ToolError --------------------------------------------------------------


def test_a_tool_error_keeps_the_envelope_the_platform_sent() -> None:
    error = ToolError(
        "rate_limited",
        "too many calls",
        required_action="wait",
        retryable=True,
        retry_after_ms=1500,
    )

    assert (error.code, error.required_action) == ("rate_limited", "wait")
    assert error.retryable is True
    assert error.retry_after_ms == 1500
    assert str(error) == "rate_limited: too many calls"


def test_a_tool_error_is_not_retryable_by_default() -> None:
    """`conversation_required` arrives with `retryable: false` — honor it, don't guess."""
    error = ToolError("conversation_required", "no session")

    assert error.retryable is False
    assert error.retry_after_ms is None


# ---- hints ------------------------------------------------------------------


def test_an_appkey_401_overrides_everything_else() -> None:
    hint = hint_for("bak_live_1", 401, LIFECYCLE_BODY) or ""

    assert "re-issue" in hint
    assert "Do not auto-retry" in hint


@pytest.mark.parametrize(
    ("token", "status"),
    [
        ("bak_live_1", 403),  # an AppKey, but not an auth failure
        ("ory_at_1", 401),  # a 401, but a refreshable session token
    ],
)
def test_the_appkey_hint_stays_out_of_neighbouring_cases(token: str, status: int) -> None:
    assert hint_for(token, status, '{"description":"nope"}') is None


def test_a_lifecycle_rejection_is_recognised_whatever_the_status() -> None:
    for status in (400, 403, 500):
        assert "bkn_context" in (hint_for("ory_at_1", status, LIFECYCLE_BODY) or "")


@pytest.mark.parametrize(
    "action",
    ["create_conversation", "start_interaction", "ensure_operation", "bkn_start_interaction"],
)
def test_every_lifecycle_action_the_deploys_use_is_covered(action: str) -> None:
    """The handshake differs by deploy and `required_action` does not distinguish them."""
    body = json.dumps({"error": {"required_action": action}})

    assert lifecycle_hint(body) is not None


@pytest.mark.parametrize(
    "body",
    [
        "",
        "not json at all",
        "[]",
        json.dumps({"error": "a string, not an object"}),
        json.dumps({"error": {"required_action": 42}}),
        json.dumps({"error": {"required_action": "some_unrelated_action"}}),
        json.dumps({"message": "no error key"}),
    ],
)
def test_an_unrelated_body_produces_no_hint(body: str) -> None:
    """Any body can be passed in — a parser accident must not become false guidance."""
    assert lifecycle_hint(body) is None


def test_required_action_reads_only_a_string() -> None:
    assert required_action(LIFECYCLE_BODY) == "bkn_start_interaction"
    assert required_action(json.dumps({"error": {"required_action": ["a"]}})) is None
    assert required_action("{") is None
