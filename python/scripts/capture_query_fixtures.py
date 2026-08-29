# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Record instance-query exchanges as fixtures for the query layer's tests.

Each fixture is `{request, response}` — the body sent and the body received —
so a test can assert both what the runtime asks for and what it makes of the
answer::

    openbkn auth login
    python scripts/capture_query_fixtures.py ecommerce_ops_bkn_public order

Re-record when the read contract moves; the diff is then the record of it.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from bkn_osdk import http, resolve_context

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "query"

PENDING = {
    "operation": "==",
    "field": "order_status",
    "value": "pending_payment",
    "value_from": "const",
}


def cases(object_type: str) -> dict[str, dict[str, Any]]:
    """One entry per behaviour the query layer has to get right."""
    return {
        "unfiltered_page": {"limit": 2},
        "flat_condition": {"limit": 2, "condition": PENDING},
        "nested_and_or": {
            "limit": 2,
            "condition": {
                "operation": "and",
                "sub_conditions": [
                    PENDING,
                    {
                        "operation": "or",
                        "sub_conditions": [
                            # Decimals travel as strings, the way the platform
                            # sends them back. `10000`, `10000.0`, `"10000"` and
                            # `"10000.00"` all matched the same 12283 rows here,
                            # so the exact form is the one worth sending.
                            {
                                "operation": ">",
                                "field": "total_amount",
                                "value": "10000",
                                "value_from": "const",
                            },
                            {
                                "operation": "<",
                                "field": "total_amount",
                                "value": "100",
                                "value_from": "const",
                            },
                        ],
                    },
                ],
            },
        },
        "in_operator": {
            "limit": 3,
            "condition": {
                "operation": "in",
                "field": "channel_id",
                "value": [1, 3],
                "value_from": "const",
            },
        },
        "property_selection": {"limit": 2, "properties": ["order_id", "order_no"]},
        "offset_paging": {"limit": 2, "offset": 2},
        "sorted_desc": {"limit": 2, "sort": [{"field": "order_id", "direction": "desc"}]},
        "count_unfiltered": {"limit": 1, "need_total": True},
        "count_filtered": {"limit": 1, "need_total": True, "condition": PENDING},
        "get_by_primary_key": {
            "limit": 1,
            "condition": {
                "operation": "==",
                "field": "order_id",
                "value": 10357,
                "value_from": "const",
            },
        },
        "no_match": {
            "limit": 2,
            "condition": {
                "operation": "==",
                "field": "order_status",
                "value": "no_such_status",
                "value_from": "const",
            },
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kn_id")
    parser.add_argument("object_type")
    parser.add_argument("--out", type=Path, default=FIXTURE_DIR)
    args = parser.parse_args(argv)

    ctx = resolve_context()
    path = f"/api/ontology-query/v1/knowledge-networks/{args.kn_id}/object-types/{args.object_type}"

    out: Path = args.out / args.kn_id / args.object_type
    out.mkdir(parents=True, exist_ok=True)
    for name, body in cases(args.object_type).items():
        request = {"response_format": "json", **body}
        response = http.request(ctx, path, body=request, method_override="GET")
        (out / f"{name}.json").write_text(
            json.dumps(
                {"path": path, "request": request, "response": response},
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        rows = len(response.get("datas") or [])
        print(f"{name}: {rows} rows, total_count={response.get('total_count')}", file=sys.stderr)

    print(f"captured from {ctx.base_url}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
