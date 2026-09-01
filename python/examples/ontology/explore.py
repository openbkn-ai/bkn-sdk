# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""From a question to rows, without knowing the network's names first.

    BKN_KN_ID=ecommerce_ops_bkn_public python examples/ontology/explore.py "最近的大额订单"

Three steps, each answering a different question:

1. `search` — which object types does this question touch?
2. `search_instances` — which rows answer it, across whichever types are indexed?
3. the generated class — the exact, cheap query, now that the names are known.

Steps 1 and 2 are where you start when you do not know the schema. Step 3 is
where you stay once you do.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `bootstrap` imports

from bootstrap import object_type, package


def main(question: str) -> None:
    bkn = package()

    # 1. Which types is this question about?
    schema_hits = bkn.search(question, max_concepts=5)
    types = [entry.get("concept_id") or entry.get("id") for entry in schema_hits["object_types"]]
    print(f"相关对象类: {types[:6]}")

    # 2. Which rows? Only properties whose `condition_operations` include
    #    `match` or `knn` take part, so an unindexed type contributes nothing.
    recall = bkn.search_instances(question, max_instances_per_type=2)
    nodes = recall.get("nodes") or []
    for node in nodes[:4]:
        properties = node["properties"]
        display = properties.get("_display") or properties.get("_instance_id")
        print(f"  召回 {node['object_type_id']:24} {display}")
    if not nodes:
        # Only properties whose `condition_operations` include `match` or `knn`
        # take part, so a network with nothing indexed recalls nothing — which is
        # an answer about the network, not a failure of the call.
        print(f"  没有召回到实例: {recall.get('message', '该网络可能没有可检索的属性')}")

    if not types or not types[0]:
        return

    # 3. Now the names are known, ask exactly.
    cls = object_type(bkn, str(types[0]))
    print(f"\n{cls.__name__}: {cls.count()} 行")
    for row in cls.take(3):
        print(f"  {row.__instance_id__:24} {row.__display__}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "订单")
