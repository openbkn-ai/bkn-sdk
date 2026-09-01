# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Reading one object type: filters, ordering, paging, traversal.

    BKN_KN_ID=ecommerce_ops_bkn_public BKN_OBJECT_TYPE=order python examples/ontology/query.py

Everything here is a class-level call on a generated class, so the property
names are the network's own and a typo is a type error rather than an empty
result set.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `bootstrap` imports

from bootstrap import package, readable_object_type

from bkn_osdk.types import Relation


def main() -> None:
    bkn = package()
    Order = readable_object_type(bkn)

    # Whatever this network calls its properties; the first two are enough to
    # show filtering and ordering without pinning the example to one schema.
    properties = [prop.bkn_id for prop in Order.__properties__()]
    key, *rest = properties
    print(f"{Order.__name__}: {Order.count()} 行, 属性 {properties[:6]}")

    # A filter is an expression on the class, not a dict of strings.
    some = Order.take(3)
    if some:
        # A property whose value is null on this row cannot be filtered by
        # equality — absence has its own operator — so filter on one that has a
        # value, which is also what a reader would write.
        with_value = [name for name in properties if getattr(some[0], name, None) is not None]
        key = with_value[0] if with_value else key
        sample = getattr(some[0], key)
        narrowed = Order.where(getattr(Order, key) == sample)
        print(f"{key} == {sample!r}: {narrowed.count()} 行")

        # `~` rewrites to the opposite operator rather than wrapping in a `not`
        # the backend does not have.
        print(f"取反后: {Order.where(~(getattr(Order, key) == sample)).count()} 行")

    # Ordering, a property subset, and paging with a total.
    if rest:
        page = (
            Order.objects()
            .order_by(getattr(Order, key).desc())
            .select(key, rest[0])
            .page(limit=2, need_total=True)
        )
        print(f"page: 拿到 {len(page.rows)} 行, 总数 {page.total}")
        for row in page.rows:
            print(f"  {getattr(row, key)}")

    # `iterate` pages until the network runs out; `get` reads one row by key.
    first = next(iter(Order.objects().iterate(page_size=2)), None)
    if first is not None and len(Order.__primary_key__) == 1:
        one = Order.get(getattr(first, Order.__primary_key__[0]))
        print(f"get(主键): {one.__instance_id__ if one else '未命中'}")

    # A relation is a filter on the target type, so the hop is an ordinary set —
    # it pages and orders like any other, and reads from the same platform.
    hops = [name for name in dir(Order) if isinstance(getattr(Order, name, None), Relation)]
    if hops and some:
        hop = getattr(some[0], hops[0])
        print(f"{hops[0]}: {len(hop.take(2))} 行 (目标 {hop.object_type.__name__})")


if __name__ == "__main__":
    main()
