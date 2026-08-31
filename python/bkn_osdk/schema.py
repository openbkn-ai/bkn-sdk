# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The generator's input: a knowledge network's schema, and its fingerprint.

These dataclasses are the boundary between fetching and emitting. The generator
core takes a `KnSchema` and nothing else — no client, no credentials — which is
what lets the same emitter run from the CLI, from a test fixture, and one day
from the backend.

Schema comes from **bkn-backend REST**, the authoritative schema layer, rather
than from the MCP `get_kn_detail` tool: that one is the agent-facing
progressive-disclosure surface, subject to dedup and the lifecycle contract, and
is the wrong source of truth for codegen.

The canonical prefix is `/api/bkn-backend/v1`. `/api/ontology-manager/v1` still
answers on the deploys reachable so far, but foundry's API README documents it
as a monorepo-refactor alias kept only until external callers move off it.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .config import Context
from .http import QueryValue, request

__all__ = [
    "FINGERPRINT_ALGORITHM",
    "KnSchema",
    "MetricDef",
    "ObjectTypeDef",
    "PropertyDef",
    "RelationTypeDef",
    "fetch_schema",
    "fingerprint",
    "parse_schema",
]

FINGERPRINT_ALGORITHM = "sha256"


@dataclass(frozen=True)
class PropertyDef:
    """One property of an object type.

    `condition_operations` is deliberately absent: it is advisory, not a
    whitelist. `order.order_id` declares none yet filters correctly with `>`, and
    the lists contain `range` / `out_range` / `regex`, which the query tool's own
    `operation` enum does not accept. Permitted operators are derived from that
    enum plus the property's Python type instead.
    """

    bkn_id: str
    type: str
    display_name: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class MetricDef:
    """A metric mounted on an object type.

    Metrics reach the schema as `logic_properties` of type `metric`: the mount
    names the metric's real id in `data_source.id` and lists the dimensions the
    query may split by. A standalone `listMetrics` route exists too, but no
    network reachable from here has an entry in it, so its shape stays
    unmodelled rather than guessed.
    """

    bkn_id: str
    object_type: str
    #: The only values `analysis_dimensions` accepts for this metric.
    dimensions: tuple[str, ...] = ()
    display_name: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class ObjectTypeDef:
    bkn_id: str
    properties: tuple[PropertyDef, ...]
    primary_key: tuple[str, ...] = ()
    display_key: str | None = None
    display_name: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class RelationTypeDef:
    """A directed relation between two object types.

    `source`/`target` are object-type ids as the platform reports them; the
    generator turns them into class names and never reverses the mapping.
    """

    bkn_id: str
    source: str
    target: str
    #: `(source property, target property)` pairs the join is made on. Traversal
    #: needs them, so they are part of the generated shape and of the fingerprint.
    mapping_rules: tuple[tuple[str, str], ...] = ()
    display_name: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class KnSchema:
    kn_id: str
    branch: str = "main"
    display_name: str | None = None
    object_types: tuple[ObjectTypeDef, ...] = field(default_factory=tuple)
    relation_types: tuple[RelationTypeDef, ...] = field(default_factory=tuple)
    metrics: tuple[MetricDef, ...] = field(default_factory=tuple)


def fingerprint(schema: KnSchema) -> str:
    """A stable hash over everything a generated package's shape depends on.

    Covers object/relation type ids, property names, property types, primary and
    display keys — everything that decides what the generator emits — and nothing
    else, so editing a description does not force a regeneration.

    The rule to hold when extending this: anything the emitter writes into a file
    belongs here. A field the emitter uses but the fingerprint ignores makes
    `bkn-osdk check` report "no drift" while a regeneration would produce a diff.

    Iteration is sorted at every level: the hash must not depend on the order the
    platform happened to list things in, or `bkn-osdk check` would report drift
    for an unchanged schema.
    """
    digest = hashlib.sha256()
    digest.update(f"kn:{schema.kn_id}\nbranch:{schema.branch}\n".encode())

    for object_type in sorted(schema.object_types, key=lambda o: o.bkn_id):
        digest.update(f"ot:{object_type.bkn_id}\n".encode())
        # In declared order, not sorted: `get(*values)` maps positional values
        # onto the key parts in order, so a reordered composite key reads a
        # different row. Sorting here would hide that from both drift gates —
        # and `diff.compare` already calls it breaking.
        digest.update(f"pk:{','.join(object_type.primary_key)}\n".encode())
        digest.update(f"dk:{object_type.display_key or ''}\n".encode())
        for prop in sorted(object_type.properties, key=lambda p: p.bkn_id):
            digest.update(f"prop:{prop.bkn_id}:{prop.type}\n".encode())

    for metric in sorted(schema.metrics, key=lambda m: (m.bkn_id, m.object_type)):
        digest.update(f"metric:{metric.bkn_id}:{metric.object_type}\n".encode())
        digest.update(f"dims:{','.join(sorted(metric.dimensions))}\n".encode())

    for relation in sorted(schema.relation_types, key=lambda r: r.bkn_id):
        digest.update(f"rt:{relation.bkn_id}:{relation.source}:{relation.target}\n".encode())
        for source_property, target_property in sorted(relation.mapping_rules):
            digest.update(f"map:{source_property}:{target_property}\n".encode())

    return digest.hexdigest()


# ---- fetching and parsing ---------------------------------------------------

ONTOLOGY_BASE = "/api/bkn-backend/v1/knowledge-networks"


def fetch_schema(ctx: Context, kn_id: str, branch: str = "main") -> KnSchema:
    """Read a network's schema from bkn-backend REST.

    Two list calls plus the network itself, all with `limit=-1` (the backend's
    "everything"). Everything is fetched before anything is parsed, so a failure
    half-way cannot produce a schema that silently omits an object type.
    """
    base = f"{ONTOLOGY_BASE}/{kn_id}"
    listing: dict[str, QueryValue] = {"branch": branch, "limit": -1}
    network = request(ctx, base, query={"branch": branch})
    object_types = request(ctx, f"{base}/object-types", query=listing)
    relation_types = request(ctx, f"{base}/relation-types", query=listing)
    return parse_schema(network, object_types, relation_types)


def parse_schema(network: Any, object_types: Any, relation_types: Any) -> KnSchema:
    """Turn the three REST payloads into the generator's input. No IO."""
    network = network if isinstance(network, Mapping) else {}
    return KnSchema(
        kn_id=_text(network.get("id")) or "",
        branch=_text(network.get("branch")) or "main",
        display_name=_text(network.get("name")),
        object_types=tuple(_object_type(entry) for entry in _entries(object_types)),
        relation_types=tuple(_relation_type(entry) for entry in _entries(relation_types)),
        metrics=tuple(metric for entry in _entries(object_types) for metric in _metrics_of(entry)),
    )


def _entries(payload: Any) -> list[Mapping[str, Any]]:
    """`{entries: [...], total_count: n}` is the list envelope on every schema route."""
    items = payload.get("entries") if isinstance(payload, Mapping) else payload
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, Mapping)]


def _object_type(entry: Mapping[str, Any]) -> ObjectTypeDef:
    """One object type, from its `data_properties` only.

    `logic_properties` — tool- and metric-backed computed properties — are
    deliberately skipped: a live instance query returns none of them, so
    generating attributes for them would produce names that always raise.
    """
    return ObjectTypeDef(
        bkn_id=_text(entry.get("id")) or "",
        properties=tuple(
            _property(prop)
            for prop in entry.get("data_properties", [])
            if isinstance(prop, Mapping) and prop.get("name")
        ),
        primary_key=tuple(_text(key) or "" for key in entry.get("primary_keys", []) if _text(key)),
        display_key=_text(entry.get("display_key")),
        display_name=_text(entry.get("name")),
        description=_text(entry.get("comment")),
    )


def _metrics_of(entry: Mapping[str, Any]) -> list[MetricDef]:
    """The metrics mounted on one object type.

    Only `logic_properties` whose `type` is `metric` count. The tool-backed ones
    beside them compute a value per instance and belong to a different call path.
    """
    object_type = _text(entry.get("id")) or ""
    metrics: list[MetricDef] = []
    for prop in entry.get("logic_properties", []):
        if not isinstance(prop, Mapping) or prop.get("type") != "metric":
            continue
        source = prop.get("data_source")
        if not isinstance(source, Mapping):
            continue
        metric_id = _text(source.get("id"))
        if not metric_id:
            continue
        metrics.append(
            MetricDef(
                bkn_id=metric_id,
                object_type=object_type,
                dimensions=tuple(
                    _text(dimension.get("name")) or ""
                    for dimension in prop.get("analysis_dimensions", [])
                    if isinstance(dimension, Mapping) and _text(dimension.get("name"))
                ),
                display_name=_text(source.get("name")),
                description=_text(prop.get("comment")),
            )
        )
    return metrics


def _property(prop: Mapping[str, Any]) -> PropertyDef:
    return PropertyDef(
        bkn_id=_text(prop.get("name")) or "",
        type=_text(prop.get("type")) or "",
        display_name=_text(prop.get("display_name")),
        description=_text(prop.get("comment")),
    )


def _relation_type(entry: Mapping[str, Any]) -> RelationTypeDef:
    return RelationTypeDef(
        bkn_id=_text(entry.get("id")) or "",
        source=_text(entry.get("source_object_type_id")) or "",
        target=_text(entry.get("target_object_type_id")) or "",
        mapping_rules=tuple(
            (
                _text(_nested(rule, "source_property", "name")) or "",
                _text(_nested(rule, "target_property", "name")) or "",
            )
            for rule in entry.get("mapping_rules", [])
            if isinstance(rule, Mapping)
        ),
        display_name=_text(entry.get("name")),
        description=_text(entry.get("comment")),
    )


def _nested(payload: Mapping[str, Any], *keys: str) -> Any:
    current: Any = payload
    for key in keys:
        if not isinstance(current, Mapping):
            return None
        current = current.get(key)
    return current


def _text(value: Any) -> str | None:
    """A non-empty string, or None — the platform writes `""` where it means absent."""
    return value if isinstance(value, str) and value else None
