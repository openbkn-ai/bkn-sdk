# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Fixtures for the live suite: real credentials, a real network, a real package.

Nothing here is stubbed. The suite is skipped unless `BKN_E2E=1`, so an ordinary
`pytest` run stays hermetic and offline::

    BKN_E2E=1 BKN_E2E_KN=ecommerce_ops_bkn_public \
      BKN_BASE_URL=https://14.103.77.23 pytest tests/e2e

Credentials resolve the way they do for any caller — `BKN_TOKEN`, or the
`~/.bkn` store `openbkn auth login` writes — which is itself part of what the
suite proves. `tests/conftest.py` deliberately empties that environment for the
unit tests, so the real values are captured at import and put back here.
"""

from __future__ import annotations

import importlib
import os
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

import bkn_osdk
from bkn_osdk import Context, resolve_context
from bkn_osdk.codegen.emit import GenOptions, generate
from bkn_osdk.schema import KnSchema, fetch_schema

#: The ambient environment, read before the unit-test fixtures clear it.
_AMBIENT = {
    name: os.environ.get(name)
    for name in ("BKN_TOKEN", "BKN_BASE_URL", "BKN_USER", "BKN_PROFILE", "BKN_CONFIG_DIR")
}

pytestmark = pytest.mark.e2e


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Skip the whole directory unless it was asked for, and mark it either way."""
    if os.environ.get("BKN_E2E") == "1":
        return
    skip = pytest.mark.skip(reason="live suite: set BKN_E2E=1 and BKN_E2E_KN to run it")
    for item in items:
        if "e2e" in Path(str(item.fspath)).parts:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def live_credentials(monkeypatch: pytest.MonkeyPatch, isolated_config: Path) -> None:
    """Undo the unit-test isolation: this suite wants the caller's own credentials."""
    monkeypatch.delenv("BKN_CONFIG_DIR", raising=False)
    for name, value in _AMBIENT.items():
        if value is not None:
            monkeypatch.setenv(name, value)
    for name in ("BKN_CONVERSATION_ID", "BKN_INTERACTION_ID"):
        monkeypatch.delenv(name, raising=False)  # a host turn would mask what is being tested
    bkn_osdk.configure()


@pytest.fixture(scope="session")
def kn_id() -> str:
    value = os.environ.get("BKN_E2E_KN")
    if not value:
        pytest.skip("BKN_E2E_KN names the knowledge network to run against")
    return value


@pytest.fixture
def context() -> Context:
    return resolve_context()


@pytest.fixture(scope="session")
def schema(kn_id: str) -> KnSchema:
    """Fetched once: every later fixture is a function of this.

    Session fixtures are built before the function-scoped isolation runs, so the
    ambient credentials are still in place here.
    """
    return fetch_schema(resolve_context(), kn_id)


@pytest.fixture(scope="session")
def package(schema: KnSchema, tmp_path_factory: pytest.TempPathFactory) -> Any:
    """The generated package for this network, written to disk and imported.

    Generated per session rather than committed: the point of the suite is that
    what the generator writes today works against the platform as it is today.
    """
    root = tmp_path_factory.mktemp("generated")
    name = "live_bkn"
    (root / name).mkdir()
    for filename, content in generate(schema, GenOptions(package=name)).items():
        (root / name / filename).write_text(content, encoding="utf-8")
    sys.path.insert(0, str(root))
    try:
        return importlib.import_module(name)
    finally:
        sys.path.remove(str(root))


@pytest.fixture(scope="session")
def package_dir(package: Any) -> Path:
    return Path(package.__file__).parent


@pytest.fixture(scope="session")
def object_type(package: Any) -> Any:
    """The class under test: the one named, or the best the network offers.

    "Best" means rows to read and an edge to walk, so the traversal tests have
    something to do; a populated type with no relations is the fallback.
    """
    named = os.environ.get("BKN_E2E_OBJECT_TYPE")
    if named:
        found = next((c for c in package.OBJECT_TYPES if c.__bkn_id__ == named), None)
        if found is None:
            pytest.fail(f"{named} is not an object type of this network")
        return found

    fallback = None
    for candidate in package.OBJECT_TYPES:
        if candidate.count() == 0:
            continue
        if any(type(value).__name__ == "Relation" for value in vars(candidate).values()):
            return candidate
        fallback = fallback or candidate
    if fallback is not None:
        return fallback
    pytest.skip("every object type in this network is empty")


@pytest.fixture(scope="session")
def seed(object_type: Any) -> Any:
    """One real row, reused wherever a test needs a starting point."""
    rows = object_type.take(1)
    if not rows:
        pytest.skip(f"{object_type.__bkn_id__} has no rows to read")
    return rows[0]


@pytest.fixture
def clean_registry() -> Iterator[None]:
    from bkn_osdk import meta as meta_module

    meta_module._packages.clear()
    meta_module._checked.clear()
    yield
    meta_module._packages.clear()
    meta_module._checked.clear()
