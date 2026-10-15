# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Aggregation, which lives in metrics rather than over an object set.

    BKN_KN_ID=ecommerce_ops_bkn_public python examples/ontology/metrics.py

There is no `sum()` or `group_by()` on an object set because there is no
endpoint for one — an instance query takes a condition, a sort, a limit, a cursor or offset
and a property selection, and nothing else. Pulling every row back to add it up would
be a lie dressed as an API.

The published Object Metric V1 definition owns fixed qualifiers and grain.
The generated class pins its version and allowed dimensions; a wrong split is
refused here rather than at the platform.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `bootstrap` imports

from bootstrap import kn_id, package

from bkn_osdk import HttpError, InputError


def main() -> None:
    bkn = package()
    metrics = list(bkn.METRICS)
    if not metrics:
        raise SystemExit(f"{kn_id()} has no published Object Metric V1 definition.")

    print(f"{len(metrics)} metrics: {[m.__bkn_id__ for m in metrics]}")
    metric = metrics[0]
    print(f"\n{metric.__name__} ({metric.__bkn_id__})")
    print(
        f"  owner {metric.__object_type__}, version {metric.__version__}, "
        f"dimensions {metric.__dimensions__}"
    )

    # 1. Query a time range in Unix milliseconds.
    now = int(time.time() * 1000)  # metric windows are unix milliseconds
    try:
        result = metric.query(time={"start": now - 86_400_000, "end": now})
        print(f"  result: {result}")
    except HttpError as error:
        print(f"  unavailable: {str(error)[:120]}")

    # 2. Legacy time choices are refused locally.
    try:
        metric.query(time={"instant": True})
    except InputError as error:
        print(f"  legacy instant rejected: {error}")

    # 3. Split by a dimension the metric declares — and only those.
    if metric.__dimensions__:
        object_type, property_name, relation_alias = metric.__dimensions__[0]
        dimension = {"object_type_id": object_type, "property_name": property_name}
        if relation_alias:
            dimension["relation_path_alias"] = relation_alias
        try:
            split = metric.query(
                time={"start": now - 30 * 86_400_000, "end": now},
                analysis_dimensions=[dimension],
            )
            print(f"  split by {dimension}: {str(split)[:160]}")
        except HttpError as error:
            print(f"  split by {dimension} failed: {str(error)[:120]}")

    try:
        metric.query(analysis_dimensions=["not_a_dimension"])
    except InputError as error:
        print(f"  an undeclared dimension: {error}")


if __name__ == "__main__":
    main()
