# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Import the generated package for a network, generating it first if needed.

In a service the package is generated once, committed, and imported like any
other module — that is the point of generating it. A script or a notebook is
the case where that ceremony costs more than it pays, so this writes the package
into a cache directory the first time and imports it from there.

Every example takes its network from `BKN_KN_ID` and its platform from the usual
places (`BKN_BASE_URL`, or `openbkn auth login`), so they run against whichever
deploy you are pointed at.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import ModuleType

import bkn_osdk
from bkn_osdk.codegen.emit import GenOptions, generate
from bkn_osdk.schema import fetch_schema

CACHE = Path(os.environ.get("BKN_PACKAGE_DIR", Path.home() / ".cache" / "bkn-osdk"))


def kn_id() -> str:
    network = os.environ.get("BKN_KN_ID")
    if not network:
        raise SystemExit("Set BKN_KN_ID to the knowledge network to read, then run this again.")
    return network


def package(name: str = "bkn") -> ModuleType:
    """The generated package for `BKN_KN_ID`, written to the cache on first use."""
    network = kn_id()
    root = CACHE / network
    target = root / name
    if not (target / "_meta.py").exists():
        schema = fetch_schema(bkn_osdk.resolve_context(), network)
        target.mkdir(parents=True, exist_ok=True)
        for filename, content in generate(schema, GenOptions(package=name)).items():
            (target / filename).write_text(content, encoding="utf-8")
        print(
            f"generated {name} for {network}: {len(schema.object_types)} object types -> {target}",
            file=sys.stderr,
        )
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    return __import__(name)


def object_type(module: ModuleType, bkn_id: str) -> type:
    """One generated class by its platform id, with a readable failure if absent."""
    for candidate in module.OBJECT_TYPES:
        if candidate.__bkn_id__ == bkn_id:
            return candidate  # type: ignore[no-any-return]
    available = ", ".join(sorted(c.__bkn_id__ for c in module.OBJECT_TYPES)[:12])
    raise SystemExit(f"'{bkn_id}' is not an object type of {kn_id()}. Try one of: {available}")
