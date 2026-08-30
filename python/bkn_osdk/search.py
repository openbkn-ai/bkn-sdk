# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Searching a knowledge network by natural language.

Search is **network-level, not object-type-level**: its request carries a
network and a query and no object-type dimension at all. So it belongs on the
generated package rather than on a class::

    import bkn
    bkn.search("who owns supply chain")           # which types answer this
    bkn.search_instances("Lionel Messi")          # which rows answer this

The two are different questions. `search` maps a question onto the ontology and
is where a caller starts when they do not know the type names; `search_instances`
goes straight to rows, across whichever types have a searchable index, and is
where a caller starts when they do not know which type holds the answer either.
Once both are known, a typed query is cheaper and exact.

The tool is `search_schema`, which answers with the object, relation, action and
metric types a question touches. It is called the way the TypeScript SDK calls
it — as an MCP tool, not over the REST capability route — so the two clients
share one contract, and so the read lands in the evidence chain with a receipt.
The older `semantic-search` route is gone: it 404s on a 0.1.5 deploy while an
older one still answers, which is exactly the drift a shared contract avoids.

The platform's own result is returned unchanged: whether a hit can be resolved
back into a typed instance depends on a response shape that has not been
captured, and inventing one would be worse than handing back what came.
"""

from __future__ import annotations

from typing import Any

from .config import Context, resolve_context

__all__ = ["INSTANCE_SEARCH_TOOL", "SEARCH_TOOL", "search", "search_instances"]

SEARCH_TOOL = "search_schema"
INSTANCE_SEARCH_TOOL = "search_instance"


def search(
    kn_id: str,
    query: str,
    *,
    max_concepts: int | None = None,
    search_scope: dict[str, Any] | None = None,
    include_columns: bool | None = None,
    context: Context | None = None,
) -> Any:
    """Search one network, returning the platform's result verbatim.

    A turn already in scope is attached, so the search is recorded beside the
    reads it led to; outside a traced scope the call goes bare, and only a
    deploy that refuses it gets a short-lived turn opened for the retry.
    """
    from .lifecycle import interaction_scope, with_context_retry
    from .mcp import call_tool

    ctx = context or resolve_context()
    arguments: dict[str, Any] = {"query": query, "response_format": "json"}
    if max_concepts is not None:
        arguments["max_concepts"] = max_concepts
    if search_scope is not None:
        arguments["search_scope"] = search_scope
    if include_columns is not None:
        arguments["include_columns"] = include_columns

    def send(bkn_context: dict[str, str] | None) -> Any:
        payload = arguments if bkn_context is None else {**arguments, "bkn_context": bkn_context}
        result = call_tool(ctx, kn_id, SEARCH_TOOL, payload)
        scope = interaction_scope().get()
        if result.receipt is not None and scope is not None and kn_id in scope:
            scope[kn_id].receipts.append(result.receipt)
        return result.value

    return with_context_retry(ctx, kn_id, send)


def search_instances(
    kn_id: str,
    query: str,
    *,
    object_types: list[str] | None = None,
    exclude_object_types: list[str] | None = None,
    max_object_types: int | None = None,
    max_instances_per_type: int | None = None,
    rerank: bool | None = None,
    include_object_types: bool | None = None,
    context: Context | None = None,
) -> Any:
    """Recall rows by natural language, without naming a type or a field first.

    Two channels run concurrently — vector and full text — and their ranks are
    fused, so only properties whose `condition_operations` include `match` or
    `knn` take part: a type with no index contributes nothing. `rerank=True`
    adds a cross-encoder pass that tells apart what rank fusion cannot, at the
    cost of a model call.

    The result is the platform's own, rows and the trimmed type definitions
    beside them. Turning a row into a typed instance means one more query: the
    type ids come back with it, so `ObjectSet.where` is a step away.

    Unlike the rest of the read surface, this tool requires a `bkn_context` —
    the catalog says so — so a turn is opened when the caller has none, rather
    than spending a first attempt learning what the schema already states.
    """
    from .lifecycle import borrowed_interaction
    from .mcp import call_tool

    ctx = context or resolve_context()
    arguments: dict[str, Any] = {"kn_id": kn_id, "query": query, "response_format": "json"}
    for name, value in (
        ("object_types", object_types),
        ("exclude_object_types", exclude_object_types),
        ("max_object_types", max_object_types),
        ("max_instances_per_type", max_instances_per_type),
        ("rerank", rerank),
        ("include_object_types", include_object_types),
    ):
        if value is not None:
            arguments[name] = value

    with borrowed_interaction(ctx, kn_id) as interaction:
        result = call_tool(
            ctx,
            kn_id,
            INSTANCE_SEARCH_TOOL,
            {**arguments, "bkn_context": interaction.bkn_context},
        )
        if result.receipt is not None:
            interaction.receipts.append(result.receipt)
        return result.value
