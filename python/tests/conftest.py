# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

import bkn_osdk

_ENV_VARS = (
    "BKN_TOKEN",
    "BKN_BASE_URL",
    "BKN_USER",
    "BKN_PROFILE",
    "BKN_CONFIG_DIR",
    "BKN_CONVERSATION_ID",
    "BKN_INTERACTION_ID",
    "BKN_PARENT_OPERATION_ID",
)


@pytest.fixture(autouse=True)
def isolated_config(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    """Point every test at an empty store and clear ambient credentials.

    Without this a developer's own `~/.bkn` would decide what the tests assert.
    """
    for var in _ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    store = tmp_path / "bkn"
    monkeypatch.setenv("BKN_CONFIG_DIR", str(store))
    bkn_osdk.configure()
    yield store
    bkn_osdk.configure()


def encode_key(base_url: str) -> str:
    return base64.urlsafe_b64encode(base_url.encode("utf-8")).decode("ascii").rstrip("=")


def write_store(
    root: Path,
    base_url: str,
    *,
    user_id: str = "u-1",
    token: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
    active: bool = True,
    profile: str | None = None,
) -> None:
    """Write the layout `openbkn auth login` produces, so the reader can be tested against it."""
    user_dir = root / "platforms" / encode_key(base_url) / "users" / user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    payload = {"baseUrl": base_url, "accessToken": "stored-token", **(token or {})}
    (user_dir / "token.json").write_text(json.dumps(payload), encoding="utf-8")
    if config is not None:
        (user_dir / "config.json").write_text(json.dumps(config), encoding="utf-8")
    if not active:
        return
    state_path = (
        root / "state.json" if profile is None else root / "profiles" / profile / "state.json"
    )
    state_path.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, Any] = {}
    if state_path.exists():
        existing = json.loads(state_path.read_text(encoding="utf-8"))
    existing["currentPlatform"] = base_url
    existing.setdefault("activeUsers", {})[base_url] = user_id
    state_path.write_text(json.dumps(existing), encoding="utf-8")
