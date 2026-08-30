# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The console script: what it writes, what it refuses, and what it exits with.

Schema fetching is replaced with the fixture schema, so these tests exercise the
shell — the part that touches the filesystem and the exit code — without a
platform.
"""

from __future__ import annotations

import io
import re
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from schema_fixtures import DEMO_SCHEMA

from bkn_osdk.codegen import cli
from bkn_osdk.schema import KnSchema, ObjectTypeDef, PropertyDef, fingerprint

GENERATED_FILES = {
    "__init__.py",
    "_meta.py",
    "metrics.py",
    "object_types.py",
    "relation_types.py",
    "py.typed",
}


@pytest.fixture(autouse=True)
def offline(monkeypatch: pytest.MonkeyPatch) -> list[KnSchema]:
    """Serve the fixture schema, with credentials the scope can actually resolve."""
    served = [DEMO_SCHEMA]
    monkeypatch.setenv("BKN_BASE_URL", "https://platform.example")
    monkeypatch.setenv("BKN_TOKEN", "t-1")
    monkeypatch.setattr(cli, "fetch_schema", lambda _ctx, _kn, _branch: served[0])
    return served


def contexts(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Record the context each command resolved, so its credentials can be asserted."""
    seen: list[Any] = []

    def fetch(ctx: Any, _kn: str, _branch: str) -> KnSchema:
        seen.append(ctx)
        return DEMO_SCHEMA

    monkeypatch.setattr(cli, "fetch_schema", fetch)
    return seen


def generate(out: Path, *extra: str) -> int:
    return cli.main(["generate", "ecommerce_ops_bkn_public", "--out", str(out), *extra])


# ---- which platform, and as whom -------------------------------------------


def test_arguments_beat_the_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A CI job generating from two deploys should not have to mutate its own
    environment between the two calls."""
    seen = contexts(monkeypatch)

    generate(tmp_path / "bkn", "--base-url", "https://other.example", "--token", "t-2")

    assert seen[0].base_url == "https://other.example"
    assert seen[0].token == "t-2"


def test_the_environment_still_answers_when_nothing_is_passed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = contexts(monkeypatch)

    generate(tmp_path / "bkn")

    assert seen[0].base_url == "https://platform.example"
    assert seen[0].token == "t-1"


def test_a_token_can_come_from_a_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The form CI wants: a mounted secret, not an argument visible in `ps`."""
    seen = contexts(monkeypatch)
    secret = tmp_path / "token"
    secret.write_text("t-from-file\n", encoding="utf-8")

    generate(tmp_path / "bkn", "--token-file", str(secret))

    assert seen[0].token == "t-from-file"  # the trailing newline is not part of it


def test_a_token_can_come_from_stdin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    seen = contexts(monkeypatch)
    monkeypatch.setattr("sys.stdin", io.StringIO("t-piped\n"))

    generate(tmp_path / "bkn", "--token-file", "-")

    assert seen[0].token == "t-piped"


def test_an_empty_token_file_is_refused(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """Empty means the secret did not mount, which is worth saying rather than
    falling back to whatever the environment happens to hold."""
    empty = tmp_path / "token"
    empty.write_text("   \n", encoding="utf-8")

    assert generate(tmp_path / "bkn", "--token-file", str(empty)) == cli.EXIT_ERROR
    assert "empty" in capsys.readouterr().err


def test_the_two_token_forms_cannot_both_be_given(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        generate(tmp_path / "bkn", "--token", "t", "--token-file", "/dev/null")


def test_check_takes_the_same_platform_options(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Generating and checking against one deploy is one flag in each command."""
    package = package_at(tmp_path)
    seen = contexts(monkeypatch)

    cli.main(["check", str(package), "--base-url", "https://other.example", "--token", "t-2"])

    assert seen[0].base_url == "https://other.example"


def package_at(tmp_path: Path, name: str = "bkn") -> Path:
    out = tmp_path / name
    assert generate(out) == cli.EXIT_OK
    return out


# ---- generate ---------------------------------------------------------------


def test_generate_writes_the_whole_package(tmp_path: Path) -> None:
    out = tmp_path / "bkn"

    assert generate(out) == cli.EXIT_OK
    assert {path.name for path in out.iterdir()} == GENERATED_FILES


def test_generate_reports_what_it_wrote(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    generate(tmp_path / "bkn")

    printed = capsys.readouterr().out
    assert "3 object types, 2 relation types" in printed
    assert fingerprint(DEMO_SCHEMA) in printed


def test_the_import_name_comes_from_the_output_directory(tmp_path: Path) -> None:
    out = package_at(tmp_path, "shop")

    assert 'PACKAGE = "shop"' in (out / "_meta.py").read_text(encoding="utf-8")


def test_a_package_assertion_that_contradicts_the_directory_is_refused(tmp_path: Path) -> None:
    """Python imports by directory name, so `--package` asserts rather than sets."""
    out = tmp_path / "bkn"

    assert generate(out, "--package", "something_else") == cli.EXIT_ERROR
    assert not out.exists()


def test_a_matching_package_assertion_passes(tmp_path: Path) -> None:
    assert generate(tmp_path / "bkn", "--package", "bkn") == cli.EXIT_OK


def test_a_directory_name_that_cannot_be_imported_is_refused(tmp_path: Path) -> None:
    out = tmp_path / "my-package"

    assert generate(out) == cli.EXIT_ERROR
    assert not out.exists()


def test_a_non_ascii_package_name_is_allowed(tmp_path: Path) -> None:
    """PEP 3131 permits it; only a *distribution* name has to be ASCII."""
    assert generate(tmp_path / "报名") == cli.EXIT_OK


def test_regenerating_over_its_own_output_is_fine(tmp_path: Path) -> None:
    out = package_at(tmp_path)
    before = (out / "object_types.py").read_text(encoding="utf-8")

    assert generate(out) == cli.EXIT_OK
    assert (out / "object_types.py").read_text(encoding="utf-8") == before


def test_a_directory_this_generator_did_not_write_is_left_alone(tmp_path: Path) -> None:
    """A mistyped --out must not overwrite unrelated source."""
    out = tmp_path / "bkn"
    out.mkdir()
    (out / "important.py").write_text("# someone's code\n", encoding="utf-8")

    assert generate(out) == cli.EXIT_ERROR
    assert (out / "important.py").read_text(encoding="utf-8") == "# someone's code\n"
    assert not (out / "_meta.py").exists()


def test_an_empty_directory_is_acceptable(tmp_path: Path) -> None:
    out = tmp_path / "bkn"
    out.mkdir()

    assert generate(out) == cli.EXIT_OK


def test_a_network_with_no_object_types_is_reported_not_written(
    tmp_path: Path, offline: list[KnSchema], capsys: pytest.CaptureFixture[str]
) -> None:
    """An empty package would surface later as a missing attribute instead."""
    offline[0] = KnSchema(kn_id="ecommerce_ops_bkn_public")
    out = tmp_path / "bkn"

    assert generate(out) == cli.EXIT_ERROR
    assert "no object types" in capsys.readouterr().err
    assert not out.exists()


def test_a_missing_network_is_reported(
    tmp_path: Path, offline: list[KnSchema], capsys: pytest.CaptureFixture[str]
) -> None:
    offline[0] = KnSchema(kn_id="")

    assert generate(tmp_path / "bkn") == cli.EXIT_ERROR
    assert "No knowledge network" in capsys.readouterr().err


def test_a_failing_fetch_writes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """An AppKey 401 must reach the shell as the platform's own instruction."""
    from bkn_osdk.errors import HttpError, hint_for

    def refuse(*_args: Any) -> KnSchema:
        body = '{"description":"认证失败"}'
        raise HttpError(401, "Unauthorized", body, hint_for("bak_live_1", 401, body))

    monkeypatch.setattr(cli, "fetch_schema", refuse)
    out = tmp_path / "bkn"

    assert generate(out) == cli.EXIT_ERROR
    assert "re-issue" in capsys.readouterr().err
    assert not out.exists()


# ---- check ------------------------------------------------------------------


def check(package_dir: Path) -> int:
    return cli.main(["check", str(package_dir)])


def test_check_passes_on_an_unchanged_schema(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = package_at(tmp_path)

    assert check(out) == cli.EXIT_OK
    assert "up to date" in capsys.readouterr().out


def test_check_calls_an_added_property_additive(
    tmp_path: Path, offline: list[KnSchema], capsys: pytest.CaptureFixture[str]
) -> None:
    out = package_at(tmp_path)
    people = next(o for o in DEMO_SCHEMA.object_types if o.bkn_id == "people")
    grown = replace(people, properties=(*people.properties, PropertyDef("nickname", "string")))
    offline[0] = replace(
        DEMO_SCHEMA,
        object_types=tuple(grown if o.bkn_id == "people" else o for o in DEMO_SCHEMA.object_types),
    )

    assert check(out) == cli.EXIT_DRIFT

    printed = capsys.readouterr().out
    assert "additive" in printed
    assert "+ property added: People.nickname" in printed


def test_check_calls_a_removed_property_breaking(
    tmp_path: Path, offline: list[KnSchema], capsys: pytest.CaptureFixture[str]
) -> None:
    out = package_at(tmp_path)
    people = next(o for o in DEMO_SCHEMA.object_types if o.bkn_id == "people")
    trimmed = replace(people, properties=people.properties[:-1])
    offline[0] = replace(
        DEMO_SCHEMA,
        object_types=tuple(
            trimmed if o.bkn_id == "people" else o for o in DEMO_SCHEMA.object_types
        ),
    )

    assert check(out) == cli.EXIT_DRIFT

    printed = capsys.readouterr().out
    assert "breaking" in printed
    assert "! property removed: People." in printed


def test_check_calls_a_retyped_property_breaking(
    tmp_path: Path, offline: list[KnSchema], capsys: pytest.CaptureFixture[str]
) -> None:
    """A retype breaks at the call site or in mypy, so it is not additive."""
    out = package_at(tmp_path)
    people = next(o for o in DEMO_SCHEMA.object_types if o.bkn_id == "people")
    retyped = replace(
        people,
        properties=tuple(
            PropertyDef(p.bkn_id, "string") if p.bkn_id == "age" else p for p in people.properties
        ),
    )
    offline[0] = replace(
        DEMO_SCHEMA,
        object_types=tuple(
            retyped if o.bkn_id == "people" else o for o in DEMO_SCHEMA.object_types
        ),
    )

    assert check(out) == cli.EXIT_DRIFT
    assert "! property retyped: People.age: int -> str" in capsys.readouterr().out


def test_check_reports_a_removed_object_type(
    tmp_path: Path, offline: list[KnSchema], capsys: pytest.CaptureFixture[str]
) -> None:
    out = package_at(tmp_path)
    offline[0] = replace(
        DEMO_SCHEMA,
        object_types=tuple(o for o in DEMO_SCHEMA.object_types if o.bkn_id != "people"),
    )

    assert check(out) == cli.EXIT_DRIFT
    assert "! object type removed: People" in capsys.readouterr().out


def test_check_reports_an_added_object_type(
    tmp_path: Path, offline: list[KnSchema], capsys: pytest.CaptureFixture[str]
) -> None:
    out = package_at(tmp_path)
    offline[0] = replace(
        DEMO_SCHEMA,
        object_types=(
            *DEMO_SCHEMA.object_types,
            ObjectTypeDef("team", (PropertyDef("team_id", "string"),), primary_key=("team_id",)),
        ),
    )

    assert check(out) == cli.EXIT_DRIFT
    assert "+ object type added: Team" in capsys.readouterr().out


def test_check_reports_a_changed_primary_key(
    tmp_path: Path, offline: list[KnSchema], capsys: pytest.CaptureFixture[str]
) -> None:
    out = package_at(tmp_path)
    people = next(o for o in DEMO_SCHEMA.object_types if o.bkn_id == "people")
    rekeyed = replace(people, primary_key=("person_id", "name"))
    offline[0] = replace(
        DEMO_SCHEMA,
        object_types=tuple(
            rekeyed if o.bkn_id == "people" else o for o in DEMO_SCHEMA.object_types
        ),
    )

    assert check(out) == cli.EXIT_DRIFT
    assert "! primary key changed: People" in capsys.readouterr().out


def test_check_names_the_command_that_fixes_the_drift(
    tmp_path: Path, offline: list[KnSchema], capsys: pytest.CaptureFixture[str]
) -> None:
    out = package_at(tmp_path)
    offline[0] = replace(DEMO_SCHEMA, object_types=DEMO_SCHEMA.object_types[:1])

    check(out)

    assert f"bkn-osdk generate ecommerce_ops_bkn_public --out {out}" in capsys.readouterr().out


def test_check_explains_a_fingerprint_move_that_the_classes_do_not_show(
    tmp_path: Path, offline: list[KnSchema], capsys: pytest.CaptureFixture[str]
) -> None:
    """`string` -> `text` moves the hash but nothing a caller can observe."""
    out = package_at(tmp_path)
    people = next(o for o in DEMO_SCHEMA.object_types if o.bkn_id == "people")
    retyped = replace(
        people,
        properties=tuple(
            PropertyDef(p.bkn_id, "text") if p.bkn_id == "name" else p for p in people.properties
        ),
    )
    offline[0] = replace(
        DEMO_SCHEMA,
        object_types=tuple(
            retyped if o.bkn_id == "people" else o for o in DEMO_SCHEMA.object_types
        ),
    )

    assert check(out) == cli.EXIT_DRIFT
    assert "declared type moved underneath" in capsys.readouterr().out


def test_check_refuses_a_directory_that_is_not_a_generated_package(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert check(tmp_path) == cli.EXIT_ERROR
    assert "not a generated package" in capsys.readouterr().err


def test_check_reports_a_stale_emitted_format(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A package from an older generator still gets checked — and told to regenerate."""
    out = package_at(tmp_path)
    meta = out / "_meta.py"
    meta.write_text(
        meta.read_text(encoding="utf-8").replace("FORMAT_VERSION = 1", "FORMAT_VERSION = 0"),
        encoding="utf-8",
    )

    check(out)

    assert "format: package is 0" in capsys.readouterr().out


def test_check_fails_a_package_this_runtime_would_refuse_to_import(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """An unimportable package is not "up to date". Passing here would defer the
    failure to the first `import bkn` in production."""
    package = package_at(tmp_path)
    meta = package / "_meta.py"
    meta.write_text(
        meta.read_text(encoding="utf-8").replace("FORMAT_VERSION = 1", "FORMAT_VERSION = 99"),
        encoding="utf-8",
    )

    assert cli.main(["check", str(package)]) == cli.EXIT_DRIFT
    assert "regenerate" in capsys.readouterr().out


def test_check_says_what_is_missing_rather_than_tracing_back(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A half-written package is a thing that happens; a traceback is not an answer."""
    package = package_at(tmp_path)
    meta = package / "_meta.py"
    meta.write_text(
        re.sub(r'SCHEMA_FINGERPRINT = "\w+"', 'SCHEMA_FINGERPRINT = "moved"', meta.read_text()),
        encoding="utf-8",
    )
    (package / "object_types.py").unlink()

    assert cli.main(["check", str(package)]) == cli.EXIT_ERROR
    assert "bkn-osdk generate" in capsys.readouterr().err
