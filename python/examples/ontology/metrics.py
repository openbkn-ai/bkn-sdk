# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Aggregation, which lives in metrics rather than over an object set.

    BKN_KN_ID=ecommerce_ops_bkn_public python examples/ontology/metrics.py

There is no `sum()` or `group_by()` on an object set because there is no
endpoint for one — an instance query takes a condition, a limit, an offset and a
property selection, and nothing else. Pulling every row back to add it up would
be a lie dressed as an API.

What the platform has instead is richer: a metric is a definition the network
owns, and querying it takes dimensions to split by, a filter on the aggregate,
an ordering and a time window. The generated class carries the dimensions the
metric allows, so a wrong one is refused here rather than at the platform.
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
        raise SystemExit(
            f"{kn_id()} 没有挂在对象类上的指标。\n"
            "网络可能定义了指标却没挂载 —— examples/platform/networks.py 会把两个数都打出来。"
        )

    print(f"{len(metrics)} 个指标: {[m.__bkn_id__ for m in metrics]}")
    metric = metrics[0]
    print(f"\n{metric.__name__} ({metric.__bkn_id__})")
    print(f"  挂在 {metric.__object_type__} 上, 允许的维度 {metric.__dimensions__}")

    # 1. A point in time. `instant=True` is a different shape from a series, and
    #    the rule is checked before the round trip.
    now = int(time.time())
    try:
        instant = metric.query(time={"time": now, "instant": True})
        print(f"  当前值: {instant}")
    except HttpError as error:
        print(f"  取不到: {str(error)[:120]}")

    # 2. A series needs a step; a range needs both ends. Getting either wrong is
    #    an `InputError` here, not a 400 from the platform.
    try:
        metric.query(time={"start": now - 86400 * 30, "end": now})
    except InputError as error:
        print(f"  没给 step: {error}")

    # 3. Split by a dimension the metric declares — and only those.
    if metric.__dimensions__:
        dimension = metric.__dimensions__[0]
        try:
            split = metric.query(
                time={"start": now - 86400 * 30, "end": now, "step": "day"},
                analysis_dimensions=[dimension],
            )
            print(f"  按 {dimension} 拆分: {str(split)[:160]}")
        except HttpError as error:
            print(f"  按 {dimension} 拆分失败: {str(error)[:120]}")

    try:
        metric.query(time={"time": now, "instant": True}, analysis_dimensions=["not_a_dimension"])
    except InputError as error:
        print(f"  维度写错: {error}")


if __name__ == "__main__":
    main()
