# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The pairing check between a generated package and this runtime.

Three things move independently, and each has its own guard:

| What moves       | User action                | Guard              |
| ---------------- | -------------------------- | ------------------ |
| runtime          | `pip install -U bkn-osdk`  | `REQUIRES_RUNTIME` |
| KN schema        | `bkn-osdk generate` again  | `SCHEMA_FINGERPRINT` |
| emitted shape    | regenerate                 | `FORMAT_VERSION`   |

`FORMAT_VERSION` is separate from the runtime version because the two break in
opposite directions: a runtime must keep reading packages generated before it,
so it supports the current emitted format and the one before it — a release of
grace to regenerate — and dropping support is a loud failure, never a silent
misread.

Specifier parsing is done here rather than with `packaging` so the runtime keeps
its single dependency. The grammar accepted is the one the generator emits:
comma-separated `>=`, `>`, `<=`, `<`, `==`, `!=` against dotted numeric releases.
"""

from __future__ import annotations

import re

from .config import Context
from .errors import FormatVersionError, SchemaDriftError

__all__ = [
    "SUPPORTED_FORMAT_VERSIONS",
    "ensure_schema_checked",
    "satisfies",
    "validate_package",
]

#: (kn id, branch) -> the fingerprint the imported package was generated from.
_packages: dict[tuple[str, str], str] = {}
#: The pairs already checked in this process, so the check costs one round trip.
_checked: set[tuple[str, str]] = set()

#: Emitted-code shapes this runtime can read: the current one and its
#: predecessor. Format 1 is the first, so the list holds one entry today.
SUPPORTED_FORMAT_VERSIONS = (1,)

_CLAUSE = re.compile(r"^(==|!=|>=|<=|>|<)\s*([0-9]+(?:\.[0-9]+)*)$")


def validate_package(
    package: str,
    format_version: int,
    requires_runtime: str,
    runtime_version: str | None = None,
    *,
    kn_id: str | None = None,
    branch: str = "main",
    fingerprint: str | None = None,
) -> None:
    """Refuse a mismatched pair at import, naming the fix.

    Called from a generated `__init__.py`, so the failure lands on the import
    line rather than on the first query — the point at which a caller can still
    tell which of the two halves is stale.

    The schema fingerprint is only *recorded* here, never checked: verifying it
    would cost a round trip on every import, and import stays free of network IO.
    `configure(check_schema=True)` opts into one check, on the first query.
    """
    if kn_id and fingerprint:
        _packages[(kn_id, branch)] = fingerprint
    if format_version not in SUPPORTED_FORMAT_VERSIONS:
        supported = ", ".join(str(v) for v in SUPPORTED_FORMAT_VERSIONS)
        raise FormatVersionError(
            f"package '{package}' uses generated format {format_version}, supported: "
            f"{supported}. Regenerate it with `bkn-osdk generate`, or install a "
            f"bkn-osdk that still reads format {format_version}."
        )

    version = runtime_version or _runtime_version()
    if not satisfies(version, requires_runtime):
        raise FormatVersionError(
            f"package '{package}' needs bkn-osdk {requires_runtime}, but {version} is "
            f"installed. Either `pip install 'bkn-osdk{requires_runtime}'` or regenerate "
            "the package against this runtime."
        )


def ensure_schema_checked(ctx: Context, kn_id: str) -> None:
    """Compare the live schema against the imported package, once per process.

    Off by default: a per-request check would cost a round trip on every query,
    and `bkn-osdk check` already covers the case in CI, where a schema change
    should be caught. `configure(check_schema=True)` is for the callers who
    would rather fail loudly at the first query than read a stale attribute.
    """
    if not ctx.check_schema:
        return
    for branch in _branches_of(kn_id):
        _check_branch(ctx, kn_id, branch)


def _check_branch(ctx: Context, kn_id: str, branch: str) -> None:
    """Compare one generated package against the network it was generated from."""
    if (kn_id, branch) in _checked:
        return

    from .schema import fetch_schema, fingerprint

    _checked.add((kn_id, branch))  # one attempt, whatever the outcome
    live = fingerprint(fetch_schema(ctx, kn_id, branch))
    generated = _packages[(kn_id, branch)]
    if live != generated:
        raise SchemaDriftError(
            f"'{kn_id}' (branch {branch}) has moved since this package was generated "
            f"({generated[:12]}… -> {live[:12]}…). Regenerate with "
            f"`bkn-osdk generate {kn_id} --out <package directory>`, or run "
            "`bkn-osdk check` to see what changed."
        )


def _branches_of(kn_id: str) -> list[str]:
    """Every branch of this network a generated package was imported for.

    Usually one. Two packages for the same network on different branches is a
    real thing to do — comparing a release branch against main — and checking
    only whichever was registered first would test the wrong one.
    """
    return [branch for known_kn, branch in _packages if known_kn == kn_id]


def satisfies(version: str, specifier: str) -> bool:
    """Whether `version` meets every clause of a comma-separated specifier.

    An unparseable clause is treated as satisfied: refusing to import over a
    specifier this runtime cannot read would be a worse failure than running.
    """
    return all(_clause_holds(version, clause) for clause in specifier.split(",") if clause.strip())


def _clause_holds(version: str, clause: str) -> bool:
    match = _CLAUSE.match(clause.strip())
    if match is None:
        return True
    operator, bound = match.groups()
    left, right = _align(_release(version), _release(bound))
    if operator == "==":
        return left == right
    if operator == "!=":
        return left != right
    if operator == ">=":
        return left >= right
    if operator == "<=":
        return left <= right
    if operator == ">":
        return left > right
    return left < right


def _release(version: str) -> tuple[int, ...]:
    """The numeric release of a version, ignoring any pre/post/dev suffix."""
    digits = re.match(r"[0-9]+(?:\.[0-9]+)*", version.strip())
    if digits is None:
        return (0,)
    return tuple(int(part) for part in digits.group(0).split("."))


def _align(left: tuple[int, ...], right: tuple[int, ...]) -> tuple[tuple[int, ...], ...]:
    """Pad both releases to the same length, so `0.1` and `0.1.0` compare equal."""
    width = max(len(left), len(right))
    return (
        left + (0,) * (width - len(left)),
        right + (0,) * (width - len(right)),
    )


def _runtime_version() -> str:
    from . import __version__

    return __version__
