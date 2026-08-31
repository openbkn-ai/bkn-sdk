# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Generate a package, import it, and use it — the loop a consumer actually runs.

The golden tests pin the bytes; this pins that those bytes are a working Python
package against the current runtime. They fail for different reasons, which is
why both exist.
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from types import ModuleType

import pytest
from schema_fixtures import DEMO_SCHEMA

from bkn_osdk.codegen.emit import GenOptions, generate
from bkn_osdk.query import Comparison
from bkn_osdk.types import ObjectType, PropertyRef

PACKAGE = "generated_demo"

ORDER_ROW = {
    "order_id": 10357,
    "order_no": "2026070720DC7170D9C74799",
    "total_amount": "14485.37",
    "created_at": "2026-07-07T21:14:17.891674+08:00",
    "_instance_id": "order-10357",
    "_instance_identity": {"order_id": 10357},
    "_display": "2026070720DC7170D9C74799",
}


@pytest.fixture(scope="module")
def generated(tmp_path_factory: pytest.TempPathFactory) -> ModuleType:
    """Write the generated package to disk and import it, as a consumer would."""
    root = tmp_path_factory.mktemp("consumer")
    package_dir = root / PACKAGE
    package_dir.mkdir()
    for name, content in generate(DEMO_SCHEMA, GenOptions(package=PACKAGE)).items():
        (package_dir / name).write_text(content, encoding="utf-8")

    sys.path.insert(0, str(root))
    try:
        module = __import__(PACKAGE)
    finally:
        sys.path.remove(str(root))
    return module


def test_the_package_imports_and_enumerates_its_object_types(generated: ModuleType) -> None:
    assert generated.KN_ID == "ecommerce_ops_bkn_public"
    assert generated.BRANCH == "main"
    assert [cls.__name__ for cls in generated.OBJECT_TYPES] == ["Order", "OrderLine", "People"]
    assert all(issubclass(cls, ObjectType) for cls in generated.OBJECT_TYPES)


def test_the_generated_class_carries_its_ids(generated: ModuleType) -> None:
    order = generated.Order

    assert order.__kn_id__ == "ecommerce_ops_bkn_public"
    assert order.__bkn_id__ == "order"
    assert order.__primary_key__ == ("order_id",)
    assert order.__display_key__ == "order_no"


def test_class_access_filters_and_instance_access_reads(generated: ModuleType) -> None:
    order_type = generated.Order

    assert isinstance(order_type.order_no, PropertyRef)
    assert (order_type.order_id > 30) == Comparison(">", "order_id", 30)

    order = order_type(ORDER_ROW)
    assert order.order_no == "2026070720DC7170D9C74799"
    assert order.total_amount == Decimal("14485.37")
    assert isinstance(order.created_at, datetime)


def test_the_relation_registry_is_importable(generated: ModuleType) -> None:
    assert {relation.bkn_id for relation in generated.RELATION_TYPES} == {
        "order_to_buyer",
        "order_to_line",
    }
    assert generated.ORDER_TO_LINE.target == "order_line"


def test_a_network_with_no_metrics_still_exports_an_empty_registry(
    generated: ModuleType,
) -> None:
    """`for m in bkn.METRICS` must not depend on whether this network has any."""
    assert generated.METRICS == ()


def test_the_fingerprint_is_recorded_in_the_package(generated: ModuleType) -> None:
    from bkn_osdk.schema import fingerprint

    assert fingerprint(DEMO_SCHEMA) == generated.SCHEMA_FINGERPRINT


def test_mypy_strict_accepts_the_generated_package(generated: ModuleType) -> None:
    """The point of generating types is that a consumer's type checker believes them."""
    package_dir = Path(generated.__file__ or "").parent
    result = _mypy(package_dir)

    assert result.returncode == 0, result.stdout


def test_the_declared_types_reach_the_consumers_type_checker(
    generated: ModuleType, tmp_path: Path
) -> None:
    """`People.age > 30` checks; `People.name > 30` does not — that is the deliverable."""
    package_dir = Path(generated.__file__ or "").parent
    caller = tmp_path / "caller.py"
    caller.write_text(
        f"from {PACKAGE}.object_types import Order, People\n"
        "\n"
        "ok_int = People.age > 30\n"
        "ok_value: str = Order(dict(order_no='x')).order_no\n"
        "bad_compare = People.name > 30\n"
        "bad_value: int = Order(dict(order_no='x')).order_no\n",
        encoding="utf-8",
    )

    result = _mypy(caller, mypy_path=package_dir.parent)
    errors = result.stdout

    assert "caller.py:5" in errors, errors  # comparing a str property to an int
    assert "caller.py:6" in errors, errors  # assigning a str property to an int
    assert "caller.py:3" not in errors
    assert "caller.py:4" not in errors


def _mypy(target: Path, mypy_path: Path | None = None) -> subprocess.CompletedProcess[str]:
    """Type-check outside this project, so its own mypy settings cannot flatter the result."""
    env = dict(os.environ)
    if mypy_path is not None:
        env["MYPYPATH"] = str(mypy_path)
    return subprocess.run(
        [sys.executable, "-m", "mypy", "--strict", "--no-incremental", str(target)],
        capture_output=True,
        text=True,
        cwd=target.parent,
        env=env,
    )
