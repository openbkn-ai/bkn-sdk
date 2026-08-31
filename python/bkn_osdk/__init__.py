# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""bkn-osdk — a Python SDK for BKN, in two layers.

**The platform layer** addresses the platform itself: any REST route by path
(`call`, `request`) and any tool the deploy publishes by name (`call_tool`,
`tool_catalog`). Every network, every capability, no generation — at the cost of
shaping arguments yourself against what the catalog declares.

**The ontology layer** addresses one knowledge network's ontology: classes
generated from its schema, where `Order.total_amount` is a property this network
really has and a typo is a type error rather than an empty result set.

The layers are named for what they address, not for how they were built. Both
run through the same credentials, the same transports and the same managed turn,
so a script can drop to the platform layer for one call and come back up with
its evidence still on one chain.

A generated package imports from here and from nothing else, so a fix or a new
operator reaches it through `pip install -U bkn-osdk` with no regeneration.

Import is side-effect free: nothing resolves credentials or touches the network
until a call is made.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _version

from .config import (
    DEFAULT_BUSINESS_DOMAIN,
    DEFAULT_TIMEOUT,
    Context,
    configure,
    resolve_context,
    session,
)
from .errors import (
    BknError,
    FormatVersionError,
    HttpError,
    InputError,
    ObjectNotFound,
    SchemaDriftError,
    ToolError,
)
from .http import call, request
from .mcp import ToolResult, call_tool, tool_catalog
from .metrics import Metric
from .query import Comparison, Composite, Filter, ObjectSet, Page, Sort, to_condition
from .schema import (
    KnSchema,
    MetricDef,
    ObjectTypeDef,
    PropertyDef,
    RelationTypeDef,
    fingerprint,
)

# Rebinds the `search` attribute from the submodule to the function it exports —
# `bkn_osdk.search(kn_id, query)` is the surface, `bkn_osdk.search` the module is
# an implementation detail. `import bkn_osdk.search` still resolves the module.
from .search import search, search_instances
from .subgraph import RelationPath
from .types import ObjectType, Property, PropertyRef, Relation

try:
    __version__ = _version("bkn-osdk")
except PackageNotFoundError:  # running from a source tree that was never installed
    __version__ = "0.0.0.dev0"

__all__ = [
    "DEFAULT_BUSINESS_DOMAIN",
    "DEFAULT_TIMEOUT",
    "BknError",
    "Comparison",
    "Composite",
    "Context",
    "Filter",
    "FormatVersionError",
    "HttpError",
    "InputError",
    "KnSchema",
    "Metric",
    "MetricDef",
    "ObjectNotFound",
    "ObjectSet",
    "ObjectType",
    "ObjectTypeDef",
    "Page",
    "Property",
    "PropertyDef",
    "PropertyRef",
    "Relation",
    "RelationPath",
    "RelationTypeDef",
    "SchemaDriftError",
    "Sort",
    "ToolError",
    "ToolResult",
    "__version__",
    "call",
    "call_tool",
    "configure",
    "fingerprint",
    "request",
    "resolve_context",
    "search",
    "search_instances",
    "session",
    "to_condition",
    "tool_catalog",
]
