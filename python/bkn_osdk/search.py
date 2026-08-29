# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Semantic search over a knowledge network.

Search is **network-level, not object-type-level**: its request body carries a
`kn_id` and a query and no object-type dimension at all. So it belongs on the
generated package rather than on a class::

    import bkn
    bkn.search("who owns supply chain")

Whether a hit can be resolved back into a typed instance depends on a response
shape that has not been captured, so the platform's own result is returned
unchanged rather than guessed at.
"""

from __future__ import annotations

from typing import Any

from .config import Context, resolve_context
from .http import request

__all__ = ["DEFAULT_MODE", "search"]

SEARCH_PATH = "/api/agent-retrieval/v1/kn/semantic-search"

#: What the TypeScript client sends, and the only mode this SDK has exercised.
DEFAULT_MODE = "keyword_vector_retrieval"


def search(
    kn_id: str,
    query: str,
    *,
    mode: str = DEFAULT_MODE,
    max_concepts: int = 10,
    return_query_understanding: bool = False,
    context: Context | None = None,
) -> Any:
    """Search one network, returning the platform's result verbatim.

    This is the one read with no MCP equivalent, so a deploy that enforces the
    lifecycle contract wants a `bkn_context` in the body. The first attempt goes
    out without one and the requirement is learned from the refusal, so a deploy
    that does not enforce it pays nothing.
    """
    from .lifecycle import with_context_retry

    ctx = context or resolve_context()
    body = {
        "kn_id": kn_id,
        "query": query,
        "mode": mode,
        "max_concepts": max_concepts,
        "return_query_understanding": return_query_understanding,
    }

    def send(bkn_context: dict[str, str] | None) -> Any:
        payload = body if bkn_context is None else {**body, "bkn_context": bkn_context}
        return request(ctx, SEARCH_PATH, body=payload)

    return with_context_retry(ctx, kn_id, send)
