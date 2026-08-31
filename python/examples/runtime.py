# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The runtime layer: REST by path, MCP tools by name, no generated package.

    BKN_KN_ID=ecommerce_ops_bkn_public python examples/runtime.py

The generated classes cover reading one network. Everything else on the platform
is reached here — the deploy's whole tool catalog, and any REST route — at the
cost of shaping the arguments yourself against what the catalog declares.

The two layers share a context and a turn, so a script can drop down to this
level for one call and go back up, and the evidence still lands on one chain.
"""

from __future__ import annotations

import json
from typing import Any

from bootstrap import kn_id

import bkn_osdk
from bkn_osdk.lifecycle import borrowed_interaction, current_interaction
from bkn_osdk.mcp import call_tool, tool_catalog


def brief(value: Any, width: int = 88) -> str:
    return json.dumps(value, ensure_ascii=False)[:width]


def payload(value: Any) -> Any:
    """A tool's own fields, whichever envelope this build wraps them in.

    A payload is handed back exactly as the platform sent it, and builds differ:
    the 0.1.4 line nests a tool's fields under `result` beside the receipt, and
    the fix for that (foundry #1171) rides the 0.1.5 line. So a caller reading
    the runtime layer directly does this one step itself.
    """
    if isinstance(value, dict) and isinstance(value.get("result"), dict):
        return value["result"]
    return value


def main() -> None:
    network = kn_id()

    # ---- what this deploy can do -------------------------------------------
    #
    # A plain GET, no session and no network: the catalog is the contract every
    # tool call is shaped against.
    catalog = tool_catalog(bkn_osdk.resolve_context())
    names = sorted(tool["name"] for tool in catalog["tools"])
    print(f"{len(names)} 个工具: {names[:6]} …")

    start = next(t for t in catalog["tools"] if t["name"] == "search_schema")
    declared = list((start.get("input_schema") or {}).get("properties", {}))
    print(f"search_schema 的参数: {declared[:6]}")

    # ---- REST by path -------------------------------------------------------
    #
    # `call` is the same choke point the generated classes read through: same
    # credentials, same 401-refresh, same TLS opt-out.
    networks = bkn_osdk.call("/api/bkn-backend/v1/knowledge-networks", query={"limit": 3})
    print(f"网络列表: {[e['id'] for e in networks.get('entries', [])]}")

    # ---- MCP tools by name --------------------------------------------------
    #
    # The capability surface requires a `bkn_context`: every tool in the catalog
    # but the two lifecycle ones declares it required, and both deploys refuse a
    # call without one. `borrowed_interaction` joins the turn already in scope,
    # or opens a short-lived one and finishes it — so a script does not have to
    # know which situation it is in.
    ctx = bkn_osdk.resolve_context()
    with borrowed_interaction(ctx, network) as turn:
        detail = call_tool(
            ctx,
            network,
            "get_kn_detail",
            {"kn_id": network, "detail_level": "summary", "bkn_context": turn.bkn_context},
        )
        described = payload(detail.value)
        print(f"get_kn_detail: {brief({key: '…' for key in described})}")
        print(f"  回执 {(detail.receipt or {}).get('operation_id')}")

        # Aggregation has no typed form — `query_object_instance` cannot group —
        # so SUM/COUNT/GROUP BY is what `run_sql` is for. The table name is a
        # placeholder filled with the object type's `data_source.id`, which
        # `search_schema` is where you read from.
        found = call_tool(
            ctx,
            network,
            "search_schema",
            {
                "kn_id": network,
                "query": "订单",
                "response_format": "json",
                "include_columns": True,
                "bkn_context": turn.bkn_context,
            },
        ).value
        types = payload(found).get("object_types") or []
        if types:
            resource = (types[0].get("data_source") or {}).get("id")
            print(f"{types[0].get('concept_id')} 的数据资源: {resource}")
            if resource:
                counted = call_tool(
                    ctx,
                    network,
                    "run_sql",
                    {
                        "kn_id": network,
                        "sql": "SELECT COUNT(*) AS n FROM {{." + resource + "}}",
                        "bkn_context": turn.bkn_context,
                    },
                ).value
                print(f"  run_sql: {brief(payload(counted))}")

    # ---- one turn across both layers ---------------------------------------
    with bkn_osdk.session(traced=True) as scoped:
        turn = current_interaction(scoped, network)
        for name in ("list_resources", "list_skills"):
            result = call_tool(
                scoped, network, name, {"kn_id": network, "bkn_context": turn.bkn_context}
            )
            # A raw tool call hands the receipt back rather than filing it: the
            # typed reads keep the scope's list, and a caller at this level
            # decides what its own evidence is worth keeping.
            if result.receipt is not None:
                turn.receipts.append(result.receipt)
        print(f"一个 turn 里两次工具调用, 回执 {len(turn.receipts)} 条")
        print(f"  操作 {[r['operation_id'][:14] for r in turn.receipts]}")


if __name__ == "__main__":
    main()
