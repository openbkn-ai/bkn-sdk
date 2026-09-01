# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Import the generated package for a network, generating it first if needed.

In a service the package is generated once, committed, and imported like any
other module — that is the point of generating it. A script or a notebook is
the case where that ceremony costs more than it pays, so this writes the package
into a cache directory the first time and imports it from there.

Every example takes its network from `BKN_KN_ID`. Nothing here names a platform
or a token: they resolve through the usual chain — a `session(...)` scope, then
`configure(...)`, then `BKN_BASE_URL` / `BKN_TOKEN`, then the store
`openbkn auth login` wrote, self-signed-certificate opt-out included. See
`examples/credentials.py` for what each level answers.
"""

from __future__ import annotations

import json
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


def chosen_object_type(available: list[str]) -> str:
    """The object type to read, named or picked.

    `BKN_OBJECT_TYPE` when it is set — and checked against what this network
    really has, because a name from another network fails at the platform with
    "对象不存在", which reads as a broken example rather than a wrong argument.
    Otherwise the network's own first type, so a script runs against a network
    nobody tuned it for.
    """
    named = os.environ.get("BKN_OBJECT_TYPE")
    if named and named in available:
        return named
    if named:
        print(
            f"{kn_id()} 没有对象类 {named!r}, 改用 {available[0]!r}. "
            f"可选: {', '.join(available[:8])}",
            file=sys.stderr,
        )
    if not available:
        raise SystemExit(f"{kn_id()} 没有任何对象类可读。")
    return available[0]


def readable_object_type(module: ModuleType, *, with_relations: bool = False) -> type:
    """A class this network can actually be read through.

    `BKN_OBJECT_TYPE` wins where it is set and readable. Otherwise the first
    type that answers a count: an object type with no data source bound is a
    real thing to find in a network — `对象类 activity 未绑定数据源` — and an
    example that stops there is reporting the network's state as its own
    failure.
    """
    from bkn_osdk import HttpError
    from bkn_osdk.types import Relation

    classes = list(module.OBJECT_TYPES)
    if with_relations:
        # A traversal example needs somewhere to go; a type with no relations is
        # readable and useless for it.
        classes = [
            c for c in classes if any(isinstance(getattr(c, n, None), Relation) for n in dir(c))
        ] or classes
    named = os.environ.get("BKN_OBJECT_TYPE")
    if named:
        chosen = [c for c in classes if c.__bkn_id__ == named]
        if chosen:
            return chosen[0]  # type: ignore[no-any-return]
        print(f"{kn_id()} 没有对象类 {named!r}, 自动挑一个", file=sys.stderr)

    skipped: list[str] = []
    reason = ""
    for candidate in classes:
        try:
            candidate.count()
            if skipped:
                print(f"跳过读不了的: {', '.join(skipped)}", file=sys.stderr)
            return candidate  # type: ignore[no-any-return]
        except HttpError as error:
            skipped.append(candidate.__bkn_id__)
            reason = _reason(error) or reason
    raise SystemExit(
        f"{kn_id()} 的 {len(classes)} 个对象类都读不了: {reason}\n"
        "这个网络只有 schema, 没有可读的数据。换一个网络, 或者跑 "
        "examples/platform/networks.py 看有哪些。"
    )


def _reason(error: Exception) -> str:
    """The platform's own sentence out of an error body, if there is one."""
    body = getattr(error, "body", "") or ""
    try:
        payload = json.loads(body)
    except ValueError:
        return ""
    return str(payload.get("error_details") or payload.get("description") or "")


def object_type(module: ModuleType, bkn_id: str) -> type:
    """One generated class by its platform id, with a readable failure if absent."""
    for candidate in module.OBJECT_TYPES:
        if candidate.__bkn_id__ == bkn_id:
            return candidate  # type: ignore[no-any-return]
    available = ", ".join(sorted(c.__bkn_id__ for c in module.OBJECT_TYPES)[:12])
    raise SystemExit(f"'{bkn_id}' is not an object type of {kn_id()}. Try one of: {available}")
