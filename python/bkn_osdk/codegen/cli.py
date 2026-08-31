# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""`bkn-osdk` — the generator's IO shell.

    bkn-osdk generate <kn-id> --out ./bkn [--branch main] [--package bkn]
    bkn-osdk check ./bkn

Everything here is fetching, writing, and reporting. The emitter itself stays a
pure function, so the same code runs from a test fixture and, one day, from the
backend building a wheel.

Two refusals are deliberate:

- **Nothing is written unless every fetch succeeded.** A package that imports
  but silently omits an object type fails later as a missing attribute rather
  than as the authentication error it really was.
- **An `--out` directory that exists without a `_meta.py` is left alone**, so a
  mistyped path cannot overwrite unrelated source.
"""

from __future__ import annotations

import argparse
import ast
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from ..config import Context, session
from ..errors import BknError
from ..schema import KnSchema, fetch_schema, fingerprint
from .diff import Delta, PackageView, compare, view_of_schema
from .emit import FORMAT_VERSION, GenOptions, generate

__all__ = ["main"]

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_DRIFT = 2

#: Written by the generator into every package it owns. Its presence is what
#: makes an existing directory safe to overwrite.
MARKER = "_meta.py"


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "generate":
            return _generate(args)
        return _check(args)
    except BknError as error:
        # The platform's own message, not a paraphrase of it: an AppKey 401 says
        # to re-issue the key, and that instruction should survive to the shell.
        print(f"error: {error}", file=sys.stderr)
        return EXIT_ERROR


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="bkn-osdk", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    platform = _platform_options()

    generate = commands.add_parser(
        "generate",
        parents=[platform],
        help="generate a package for a knowledge network",
    )
    generate.add_argument("kn_id", help="knowledge network id")
    generate.add_argument("--out", type=Path, required=True, help="directory to write")
    generate.add_argument("--branch", default="main")
    generate.add_argument(
        "--package",
        help=(
            "import name to assert; defaults to the --out directory's name, which is "
            "what Python will import it as"
        ),
    )
    generate.add_argument(
        "--runtime-requirement",
        default=">=0.1,<0.2",
        help="version range of bkn-osdk the emitted package will declare",
    )

    check = commands.add_parser(
        "check",
        parents=[platform],
        help="compare a generated package against live schema",
    )
    check.add_argument("package_dir", type=Path, help="directory of a generated package")
    return parser


def _platform_options() -> argparse.ArgumentParser:
    """Which platform to talk to, and as whom.

    Without these the only ways in are the environment and the `~/.bkn` store,
    which is fine on a laptop and wrong everywhere else: a CI job, a Makefile
    generating two packages from two deploys, or anything that would otherwise
    have to mutate the environment around the call.

    These win over both, matching the library's own order — an argument beats a
    variable beats the store.
    """
    options = argparse.ArgumentParser(add_help=False)
    options.add_argument("--base-url", help="platform base URL; overrides BKN_BASE_URL")
    credential = options.add_mutually_exclusive_group()
    credential.add_argument(
        "--token",
        help=(
            "access token or AppKey; overrides BKN_TOKEN. Visible in `ps` and in shell "
            "history — prefer --token-file outside a local shell"
        ),
    )
    credential.add_argument(
        "--token-file",
        type=Path,
        help="read the token from this file, or from stdin when given as -",
    )
    options.add_argument("--user", help="user id to read from the ~/.bkn store")
    options.add_argument(
        "--insecure",
        action="store_true",
        default=None,
        help="skip TLS verification, for a deploy with a self-signed certificate",
    )
    return options


@contextmanager
def _platform(args: argparse.Namespace) -> Iterator[Context]:
    """The scope these arguments ask for — the library's own level 1."""
    token = args.token
    if args.token_file is not None:
        raw = sys.stdin.read() if str(args.token_file) == "-" else _read_token(args.token_file)
        token = raw.strip()
        if not token:
            raise BknError(f"{args.token_file} is empty, so there is no token to use.")
    with session(
        base_url=args.base_url, token=token, user=args.user, insecure=args.insecure
    ) as scoped:
        yield scoped


def _read_token(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        raise BknError(f"Could not read the token from {path}: {error}") from None


# ---- generate ---------------------------------------------------------------


def _generate(args: argparse.Namespace) -> int:
    out: Path = args.out
    package = _package_name(out, args.package)
    _refuse_foreign_directory(out)

    # Credentials resolve, and the schema is fetched, before a single file is
    # opened for writing.
    with _platform(args) as scoped:
        schema = fetch_schema(scoped, args.kn_id, args.branch)
    _refuse_empty(schema, args.kn_id, args.branch)

    files = generate(
        schema,
        GenOptions(
            package=package,
            generated_by=f"bkn-osdk {_runtime_version()}",
            requires_runtime=args.runtime_requirement,
        ),
    )

    out.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (out / name).write_text(content, encoding="utf-8")

    print(
        f"{package}: {len(schema.object_types)} object types, "
        f"{len(schema.relation_types)} relation types -> {out}"
    )
    print(f"fingerprint {fingerprint(schema)}")
    return EXIT_OK


def _package_name(out: Path, asserted: str | None) -> str:
    """The import name, which is the output directory's own name.

    Python imports a package by its directory name, so `--package` asserts that
    name rather than setting it — a mismatch is a mistake worth catching before
    anything is written. Non-ASCII names are fine (PEP 3131); only a
    *distribution* name has to be ASCII, and that constrains packaging metadata
    rather than the import.
    """
    name = out.resolve().name
    if not name.isidentifier():
        raise BknError(
            f"'{name}' is not a valid Python package name, so nothing could import it. "
            "Point --out at a directory whose name is an identifier."
        )
    if asserted is not None and asserted != name:
        raise BknError(
            f"--package {asserted} does not match the output directory '{name}'; Python "
            f"would import it as '{name}'. Point --out at a directory called '{asserted}'."
        )
    return name


def _refuse_foreign_directory(out: Path) -> None:
    if not out.exists():
        return
    if not out.is_dir():
        raise BknError(f"{out} exists and is not a directory.")
    if any(out.iterdir()) and not (out / MARKER).exists():
        raise BknError(
            f"{out} is not empty and was not produced by this generator (no {MARKER}). "
            "Point --out at a new directory, or delete that one first."
        )


def _refuse_empty(schema: KnSchema, kn_id: str, branch: str) -> None:
    if not schema.kn_id:
        raise BknError(f"No knowledge network '{kn_id}' on branch '{branch}'.")
    if not schema.object_types:
        raise BknError(
            f"'{kn_id}' has no object types on branch '{branch}'. Generating an empty "
            "package would hide that rather than report it."
        )


# ---- check ------------------------------------------------------------------


def _check(args: argparse.Namespace) -> int:
    package_dir: Path = args.package_dir
    meta = _read_meta(package_dir)

    with _platform(args) as scoped:
        live = fetch_schema(scoped, meta["KN_ID"], meta["BRANCH"])
    live_fingerprint = fingerprint(live)

    from ..meta import SUPPORTED_FORMAT_VERSIONS

    refused = meta["FORMAT_VERSION"] not in SUPPORTED_FORMAT_VERSIONS
    if meta["FORMAT_VERSION"] != FORMAT_VERSION:
        print(
            f"format: package is {meta['FORMAT_VERSION']}, this generator writes "
            f"{FORMAT_VERSION} — regenerate.",
        )

    if live_fingerprint == meta["SCHEMA_FINGERPRINT"]:
        print(f"{package_dir}: up to date ({live_fingerprint[:12]}…)")
        # A format this runtime refuses to import is not "up to date": leaving
        # CI green here would defer the failure to the first `import bkn` in
        # production, which is the one place it helps nobody.
        return EXIT_DRIFT if refused else EXIT_OK

    delta = compare(_installed_view(package_dir), view_of_schema(live))
    _report(package_dir, meta["SCHEMA_FINGERPRINT"], live_fingerprint, delta, meta["KN_ID"])
    return EXIT_DRIFT


def _report(package_dir: Path, was: str, now: str, delta: Delta, kn_id: str) -> None:
    verdict = "breaking" if delta.breaking else "additive"
    print(f"{package_dir}: schema drift ({verdict})")
    print(f"  fingerprint {was[:12]}… -> {now[:12]}…")
    for line in delta.breaking:
        print(f"  ! {line}")
    for line in delta.additive:
        print(f"  + {line}")
    if not delta:
        # The fingerprint covers things the emitted view does not, such as a
        # `string` property becoming `text`. Say so rather than print nothing.
        print("  (no change to class or property names — a declared type moved underneath)")
    print(f"  regenerate: bkn-osdk generate {kn_id} --out {package_dir}")


def _read_meta(package_dir: Path) -> dict[str, Any]:
    """Read `_meta.py`'s constants without importing — or executing — it.

    Importing would run `validate_package`, which is exactly the check that
    might be failing, and `check` has to report that rather than die of it.
    Parsing rather than `exec`ing also means pointing `check` at the wrong
    directory cannot run whatever is in it.
    """
    path = package_dir / MARKER
    if not path.exists():
        raise BknError(f"{package_dir} is not a generated package (no {MARKER}).")
    namespace: dict[str, Any] = {}
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if isinstance(target, ast.Name) and isinstance(node.value, ast.Constant):
            namespace[target.id] = node.value.value
    missing = [
        key
        for key in ("KN_ID", "BRANCH", "SCHEMA_FINGERPRINT", "FORMAT_VERSION")
        if key not in namespace
    ]
    if missing:
        raise BknError(f"{path} is missing {', '.join(missing)}. Regenerate the package.")
    return namespace


def _installed_view(package_dir: Path) -> PackageView:
    """The package's own view of the schema, read from its source.

    Parsed rather than imported for the same reason as `_meta.py`: `check` must
    work on a package this runtime refuses to import.
    """
    path = package_dir / "object_types.py"
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as error:
        raise BknError(
            f"{path} could not be read ({error.strerror or error}), so this package cannot "
            "be compared against the live schema. Regenerate it with `bkn-osdk generate`."
        ) from None
    object_types: dict[str, dict[str, str]] = {}
    primary_keys: dict[str, tuple[str, ...]] = {}

    for node in ast.parse(source).body:
        if not isinstance(node, ast.ClassDef):
            continue
        properties: dict[str, str] = {}
        for statement in node.body:
            if not isinstance(statement, ast.Assign) or len(statement.targets) != 1:
                continue
            target = statement.targets[0]
            if not isinstance(target, ast.Name):
                continue
            if target.id == "__primary_key__":
                primary_keys[node.name] = _string_tuple(statement.value)
            annotation = _property_annotation(statement.value)
            if annotation is not None:
                properties[target.id] = annotation
        object_types[node.name] = properties

    return PackageView(object_types=object_types, primary_keys=primary_keys)


def _property_annotation(value: ast.expr) -> str | None:
    """`Property[Decimal]("total_amount")` -> `"Decimal"`."""
    if not isinstance(value, ast.Call) or not isinstance(value.func, ast.Subscript):
        return None
    subscript = value.func
    if not isinstance(subscript.value, ast.Name) or subscript.value.id != "Property":
        return None
    return ast.unparse(subscript.slice)


def _string_tuple(value: ast.expr) -> tuple[str, ...]:
    if not isinstance(value, ast.Tuple):
        return ()
    return tuple(
        element.value
        for element in value.elts
        if isinstance(element, ast.Constant) and isinstance(element.value, str)
    )


def _runtime_version() -> str:
    from .. import __version__

    return __version__


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
