# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Walking relations: one hop, then several.

    BKN_KN_ID=ecommerce_ops_bkn_public python examples/ontology/traverse.py

One hop is a filter on the target object type, built from the join columns the
schema declares — no session, no second grammar, and the result is an ordinary
object set that pages and orders like any other.

Several hops cannot be that: the intermediate rows would have to come back to
the client to be joined. They ride the subgraph endpoint instead, which walks
server-side, and the difference shows up in the API — `of(instance)` takes the
starting row rather than hanging off it.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `bootstrap` imports

from bootstrap import package, readable_object_type

from bkn_osdk import HttpError, InputError
from bkn_osdk.types import Relation


def relations_of(cls: type) -> list[tuple[str, Relation]]:
    return [
        (name, getattr(cls, name))
        for name in dir(cls)
        if isinstance(getattr(cls, name, None), Relation)
    ]


def main() -> None:
    bkn = package()
    start = readable_object_type(bkn, with_relations=True)
    hops = relations_of(start)
    print(f"{start.__name__}: {len(hops)} relations {[name for name, _ in hops][:5]}")
    if not hops:
        raise SystemExit(f"{start.__bkn_id__} has no relation to walk.")

    rows = start.take(1)
    if not rows:
        raise SystemExit(f"{start.__bkn_id__} has no row to start from.")
    row = rows[0]

    # ---- one hop -------------------------------------------------------------
    #
    # `row.buyer` is `User.where(User.user_id == row.user_id)` — the join columns
    # come from the schema, so the filter is built rather than written.
    name, relation = hops[0]
    try:
        hop = getattr(row, name)
    except Exception as error:
        raise SystemExit(f"{name} cannot be walked: {error}") from None

    print(f"\n{name} -> {hop.object_type.__name__}")
    print(f"  filter: {hop.filter}")
    landed = hop.take(3)
    print(f"  {len(landed)} rows")

    # It is an ordinary set, so everything else already works on it.
    target = hop.object_type
    ordered = getattr(target, target.__primary_key__[0])
    print(f"  ordered, one row: {len(hop.order_by(ordered.desc()).take(1))}")

    # ---- several hops --------------------------------------------------------
    #
    # Server-side, and the far end is what comes back. `step_limit` caps the
    # rows returned, not the paths walked.
    second = relations_of(target)
    if not second:
        print(f"\n{target.__name__} has no next hop; one hop is the end of it")
        return

    next_name, next_relation = second[0]
    print(f"\nmulti-hop: {start.__name__}.{name}.then({target.__name__}.{next_name})")
    try:
        walked = relation.then(next_relation).of(row, step_limit=5)
        print(f"  {len(walked)} rows {[r.__instance_id__ for r in walked][:3]}")
    except (HttpError, InputError) as error:
        # The subgraph endpoint depends on the data resources behind every type
        # on the path; one missing anywhere fails the walk.
        print(f"  cannot be walked: {str(error)[:140]}")

    # A filter belongs to the end it was written against, so extending past one
    # is refused rather than dropped — the rows would look filtered and not be.
    try:
        relation.where(getattr(target, target.__primary_key__[0]) == "x").then(next_relation)
    except InputError as error:
        print(f"\nfiltering an intermediate hop is refused: {str(error)[:90]}")
    except AttributeError:
        pass  # `where` lives on the path, not on a bare relation


if __name__ == "__main__":
    main()
