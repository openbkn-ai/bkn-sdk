# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Reading under a managed turn, so the reads land in the evidence chain.

    BKN_KN_ID=ecommerce_ops_bkn_public BKN_OBJECT_TYPE=order python examples/traced.py

A turn is one agent question: opened once, reused by every read inside the
scope, finished on exit. Each read comes back with a receipt — the operation id,
the normalised input hash, and the business refs down to property granularity.

If the process already sits inside someone else's turn — the sandbox passes
`BKN_CONVERSATION_ID` and `BKN_INTERACTION_ID` per execution — that turn is
joined instead, and never finished here, because it is not ours to finish.
"""

from __future__ import annotations

import os

from bootstrap import kn_id, object_type, package

import bkn_osdk
from bkn_osdk.lifecycle import current_interaction


def main() -> None:
    bkn = package()
    Order = object_type(bkn, os.environ.get("BKN_OBJECT_TYPE", "order"))

    with bkn_osdk.session(traced=True) as scoped:
        turn = current_interaction(scoped, kn_id())
        print(f"turn {turn.conversation_id} / {turn.interaction_id}")

        page = Order.objects().with_context(scoped).page(limit=2)
        receipt = page.receipt or {}
        print(f"读回执 {receipt.get('operation_id')}")
        print(f"  引用 {[ref['ref_id'] for ref in receipt.get('business_refs', [])][:3]}")

        # The receipt rides on each row too, so citing one instance does not mean
        # threading the page around.
        if page.rows:
            print(f"  行上也有: {bool(page.rows[0].__receipt__)}")

        # A search inside the same scope joins the same turn rather than opening
        # a second one, so the question and the rows it led to stay together.
        bkn.search("orders")
        print(f"这一轮累计 {len(turn.receipts)} 条回执")

        # `count()` and `order_by` need keys the MCP tool ignores, so they take
        # the REST path — still carrying this turn, so they are still recorded.
        print(f"count() 在 traced 里也是真数: {Order.count()}")


if __name__ == "__main__":
    main()
