# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Credential resolution: the four levels, and the isolation that keeps them apart."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from conftest import encode_key, write_store

import bkn_osdk
from bkn_osdk import InputError, configure, resolve_context, session

PLATFORM = "https://platform.example"


def test_env_alone_resolves(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BKN_BASE_URL", f"{PLATFORM}/")
    monkeypatch.setenv("BKN_TOKEN", "env-token")

    ctx = resolve_context()

    assert ctx.base_url == PLATFORM  # trailing slash stripped
    assert ctx.token == "env-token"
    assert ctx.business_domain == "bd_public"
    assert ctx.insecure is False


def test_store_is_the_last_resort(isolated_config: Path) -> None:
    write_store(
        isolated_config,
        PLATFORM,
        token={"accessToken": "stored-token", "tlsInsecure": True},
        config={"businessDomain": "bd_ops"},
    )

    ctx = resolve_context()

    assert (ctx.base_url, ctx.token) == (PLATFORM, "stored-token")
    assert ctx.insecure is True
    assert ctx.business_domain == "bd_ops"


def test_env_token_wins_over_the_store_while_base_url_still_comes_from_it(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write_store(isolated_config, PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "env-token")

    ctx = resolve_context()

    assert (ctx.base_url, ctx.token) == (PLATFORM, "env-token")


def test_configure_beats_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "env-token")
    configure(base_url="https://other.example", token="process-token")

    ctx = resolve_context()

    assert (ctx.base_url, ctx.token) == ("https://other.example", "process-token")


def test_configure_with_no_arguments_clears_the_process_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure(base_url=PLATFORM, token="process-token")
    configure()

    with pytest.raises(InputError, match="No base URL"):
        resolve_context()


def test_session_beats_configure_and_inherits_what_it_omits() -> None:
    configure(base_url=PLATFORM, token="process-token", business_domain="bd_ops")

    with session(token="scoped-token") as ctx:
        assert (ctx.base_url, ctx.token) == (PLATFORM, "scoped-token")
        assert ctx.business_domain == "bd_ops"

    assert resolve_context().token == "process-token"


def test_nested_sessions_resolve_innermost_first() -> None:
    configure(base_url=PLATFORM, token="process-token")

    with session(token="outer"), session(insecure=True):
        ctx = resolve_context()
        assert ctx.token == "outer"
        assert ctx.insecure is True

    assert resolve_context().insecure is False


def test_session_restores_the_previous_scope_on_an_exception() -> None:
    configure(base_url=PLATFORM, token="process-token")

    with pytest.raises(RuntimeError), session(token="scoped"):
        raise RuntimeError("boom")

    assert resolve_context().token == "process-token"


def test_missing_base_url_names_all_three_ways_to_supply_one() -> None:
    with pytest.raises(InputError) as excinfo:
        resolve_context()

    message = str(excinfo.value)
    assert "BKN_BASE_URL" in message
    assert "openbkn auth login" in message


def test_missing_token_is_reported_separately(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)

    with pytest.raises(InputError, match="No access token"):
        resolve_context()


def test_profile_selects_its_own_state_file(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write_store(isolated_config, PLATFORM, profile="work")
    monkeypatch.setenv("BKN_PROFILE", "work")

    assert resolve_context().base_url == PLATFORM

    monkeypatch.delenv("BKN_PROFILE")
    with pytest.raises(InputError, match="No base URL"):
        resolve_context()


def test_invalid_profile_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BKN_PROFILE", "../escape")

    with pytest.raises(InputError, match="BKN_PROFILE"):
        resolve_context()


def test_user_selects_a_saved_identity_by_username(isolated_config: Path) -> None:
    write_store(isolated_config, PLATFORM, user_id="u-1", token={"accessToken": "first"})
    write_store(
        isolated_config,
        PLATFORM,
        user_id="u-2",
        token={"accessToken": "second", "username": "ops@example.com"},
        active=False,
    )

    with session(user="ops@example.com") as ctx:
        assert ctx.token == "second"

    assert resolve_context().token == "first"


def test_unknown_user_lists_what_is_saved_instead(isolated_config: Path) -> None:
    write_store(isolated_config, PLATFORM, user_id="u-1")

    with pytest.raises(InputError) as excinfo, session(user="nobody"):
        pass

    assert "No saved user 'nobody'" in str(excinfo.value)
    assert "u-1" in str(excinfo.value)


def test_bkn_user_selects_a_saved_identity_too(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write_store(isolated_config, PLATFORM, user_id="u-1", token={"accessToken": "first"})
    write_store(
        isolated_config,
        PLATFORM,
        user_id="u-2",
        token={"accessToken": "second"},
        active=False,
    )
    monkeypatch.setenv("BKN_USER", "u-2")

    assert resolve_context().token == "second"


def test_a_base_url_picks_that_platforms_stored_token(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One process, two platforms: the scope's base URL decides whose token is read."""
    other = "https://staging.example"
    write_store(isolated_config, PLATFORM, user_id="u-1", token={"accessToken": "prod-token"})
    write_store(isolated_config, other, user_id="u-2", token={"accessToken": "staging-token"})

    with session(base_url=PLATFORM) as ctx:
        assert ctx.token == "prod-token"
    with session(base_url=other) as ctx:
        assert ctx.token == "staging-token"


def test_a_corrupt_token_file_is_ignored_rather_than_raised(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A truncated write must not make every command fail with a JSON error."""
    write_store(isolated_config, PLATFORM)
    token_path = (
        isolated_config / "platforms" / encode_key(PLATFORM) / "users" / "u-1" / "token.json"
    )
    token_path.write_text('{"accessToken": "trunc', encoding="utf-8")

    with pytest.raises(InputError, match="No access token"):
        resolve_context()

    monkeypatch.setenv("BKN_TOKEN", "env-token")
    assert resolve_context().token == "env-token"


def test_a_stored_tls_opt_out_can_be_overridden_explicitly(isolated_config: Path) -> None:
    write_store(isolated_config, PLATFORM, token={"tlsInsecure": True})

    with session(insecure=False) as ctx:
        assert ctx.insecure is False

    assert resolve_context().insecure is True


def test_business_domain_prefers_the_scope_over_the_stored_platform_config(
    isolated_config: Path,
) -> None:
    write_store(isolated_config, PLATFORM, config={"businessDomain": "bd_ops"})

    with session(business_domain="bd_finance") as ctx:
        assert ctx.business_domain == "bd_finance"

    assert resolve_context().business_domain == "bd_ops"


def test_the_timeout_has_a_default_and_a_scope_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "env-token")

    assert resolve_context().timeout == bkn_osdk.DEFAULT_TIMEOUT

    with session(timeout=5.0) as ctx:
        assert ctx.timeout == 5.0


def test_an_empty_env_token_does_not_shadow_the_store(
    isolated_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`BKN_TOKEN=` in a shell profile is absence, not a credential."""
    write_store(isolated_config, PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "")

    assert resolve_context().token == "stored-token"


# ---- isolation --------------------------------------------------------------
#
# A regression here is a cross-tenant credential leak, so both concurrency
# models get an explicit test rather than trusting ContextVar semantics to be
# obviously correct.


def test_threads_under_different_scopes_keep_their_own_token() -> None:
    configure(base_url=PLATFORM, token="process-token")

    def resolve_under(token: str) -> str:
        with session(token=token) as ctx:
            return ctx.token

    with ThreadPoolExecutor(max_workers=8) as pool:
        tokens = list(pool.map(resolve_under, [f"tenant-{i}" for i in range(8)]))

    assert tokens == [f"tenant-{i}" for i in range(8)]
    assert resolve_context().token == "process-token"


def test_concurrent_tasks_under_different_scopes_keep_their_own_token() -> None:
    configure(base_url=PLATFORM, token="process-token")

    async def resolve_under(token: str) -> str:
        with session(token=token):
            await asyncio.sleep(0)  # yield, so the tasks interleave inside their scopes
            return resolve_context().token

    async def run() -> list[str]:
        return await asyncio.gather(*(resolve_under(f"tenant-{i}") for i in range(8)))

    assert asyncio.run(run()) == [f"tenant-{i}" for i in range(8)]


def test_import_is_side_effect_free() -> None:
    """Nothing resolves at import: a bare import must not touch the store or the network."""
    assert bkn_osdk.__version__
    with pytest.raises(InputError):
        resolve_context()
