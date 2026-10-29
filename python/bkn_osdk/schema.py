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

The supported prefix is `/api/bkn-backend/v1`; the former
`/api/ontology-manager/v1` compatibility alias has been retired.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

from .config import Context
from .errors import InputError
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
    """One published, immutable Object Metric V1 definition."""

    bkn_id: str
    object_type: str
    version: int
    #: (object type, property, relation-path alias) tuples from the V1 registry.
    dimensions: tuple[tuple[str, str, str], ...] = ()
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
    #: Canonical JSON of an object-shaped `mapping_rules` — an `indirect`
    #: relation's backing resource and its two mapping lists, or a
    #: `filtered_cross_join`'s conditions. Empty for a direct relation, whose
    #: rules are the pairs above. Nothing is emitted from it; it is fingerprinted
    #: so that editing such a relation's rules still reads as drift.
    mapping_detail: str = ""


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
        digest.update(f"metric:{metric.bkn_id}:{metric.version}:{metric.object_type}\n".encode())
        digest.update(
            f"dims:{json.dumps(sorted(metric.dimensions), ensure_ascii=False)}\n".encode()
        )

    for relation in sorted(schema.relation_types, key=lambda r: r.bkn_id):
        digest.update(f"rt:{relation.bkn_id}:{relation.source}:{relation.target}\n".encode())
        for source_property, target_property in sorted(relation.mapping_rules):
            digest.update(f"map:{source_property}:{target_property}\n".encode())
        if relation.mapping_detail:
            # Only where present, so a direct relation's hash is unchanged.
            digest.update(f"mapdetail:{relation.mapping_detail}\n".encode())

    return digest.hexdigest()


# ---- fetching and parsing ---------------------------------------------------

ONTOLOGY_BASE = "/api/bkn-backend/v1/knowledge-networks"


def fetch_schema(ctx: Context, kn_id: str, branch: str = "main") -> KnSchema:
    """Read a network's schema from bkn-backend REST.

    Object summaries are hydrated from public details before parsing.
    Object/relation lists use `limit=-1`; the V1 metric catalogue is paginated.
    Every page is fetched before parsing, so a partial read never silently
    produces an incomplete generated package.
    """
    base = f"{ONTOLOGY_BASE}/{quote(kn_id, safe='')}"
    listing: dict[str, QueryValue] = {"branch": branch, "limit": -1}
    network = request(ctx, base, query={"branch": branch})
    object_types = request(ctx, f"{base}/object-types", query=listing)
    object_types = _object_type_details(ctx, base, branch, object_types)
    relation_types = request(ctx, f"{base}/relation-types", query=listing)
    metric_records: list[Mapping[str, Any]] = []
    offset = 0
    while True:
        page = request(
            ctx,
            f"{base}/object-metrics",
            query={"branch": branch, "status": "published", "offset": offset, "limit": 500},
        )
        if not isinstance(page, Mapping) or not isinstance(page.get("entries"), list):
            raise InputError(
                "Object Metric V1 catalogue returned an invalid page; schema is incomplete."
            )
        entries = _entries(page)
        if len(entries) != len(page["entries"]):
            raise InputError(
                "Object Metric V1 catalogue contains malformed entries; schema is incomplete."
            )
        metric_records.extend(entries)
        offset += len(entries)
        total = page.get("total_count")
        if not isinstance(total, int) or isinstance(total, bool) or total < offset:
            raise InputError(
                "Object Metric V1 catalogue has an invalid total_count; schema is incomplete."
            )
        if len(entries) < 500 or (isinstance(total, int) and offset >= total):
            if offset < total:
                raise InputError(
                    "Object Metric V1 catalogue ended before total_count; schema is incomplete."
                )
            break
    return parse_schema(network, object_types, relation_types, {"entries": metric_records})


def _object_type_details(
    ctx: Context, base: str, branch: str, listing: Any
) -> list[Mapping[str, Any]]:
    """Hydrate summary-only catalogue entries before generating typed properties.

    Public object-type lists omit data_properties and may null primary_keys.
    Fetch details with the same caller context and branch; never mistake that
    summary for a propertyless type or bypass property visibility checks.
    """
    result: list[Mapping[str, Any]] = []
    for entry in _entries(listing):
        if entry.get("data_properties") is not None:
            result.append(entry)
            continue
        type_id = _text(entry.get("id"))
        if not type_id:
            raise InputError("Object-type summary has no id; schema is incomplete.")
        payload = request(
            ctx, f"{base}/object-types/{quote(type_id, safe='')}", query={"branch": branch}
        )
        candidates = (
            [payload]
            if isinstance(payload, Mapping) and payload.get("id") == type_id
            else _entries(payload)
        )
        detail = next((item for item in candidates if item.get("id") == type_id), None)
        if detail is None or "data_properties" not in detail:
            raise InputError("Object-type details are missing or incomplete; schema is incomplete.")
        result.append(detail)
    return result


def parse_schema(
    network: Any, object_types: Any, relation_types: Any, object_metrics: Any = None
) -> KnSchema:
    """Turn V1 REST payloads into the generator's input. No IO."""
    network = network if isinstance(network, Mapping) else {}
    return KnSchema(
        kn_id=_text(network.get("id")) or "",
        branch=_text(network.get("branch")) or "main",
        display_name=_text(network.get("name")),
        object_types=tuple(_object_type(entry) for entry in _entries(object_types)),
        relation_types=tuple(_relation_type(entry) for entry in _entries(relation_types)),
        metrics=tuple(
            metric
            for entry in _entries(object_metrics)
            if (metric := _object_metric(entry)) is not None
        ),
    )


def _entries(payload: Any) -> list[Mapping[str, Any]]:
    """`{entries: [...], total_count: n}` is the list envelope on every schema route."""
    items = payload.get("entries") if isinstance(payload, Mapping) else payload
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, Mapping)]


def _object_type(entry: Mapping[str, Any]) -> ObjectTypeDef:
    """One object type, from its `data_properties` only.

    `logic_properties` — tool-backed computed properties — are
    deliberately skipped: a live instance query returns none of them, so
    generating attributes for them would produce names that always raise.
    """
    return ObjectTypeDef(
        bkn_id=_text(entry.get("id")) or "",
        properties=tuple(
            _property(prop)
            for prop in (entry.get("data_properties") or [])
            if isinstance(prop, Mapping) and prop.get("name")
        ),
        primary_key=tuple(
            _text(key) or "" for key in (entry.get("primary_keys") or []) if _text(key)
        ),
        display_key=_text(entry.get("display_key")),
        display_name=_text(entry.get("name")),
        description=_text(entry.get("comment")),
    )


def _object_metric(entry: Mapping[str, Any]) -> MetricDef | None:
    definition = entry.get("definition")
    if not isinstance(definition, Mapping) or not isinstance(definition.get("version"), int):
        return None
    lifecycle = definition.get("lifecycle")
    if not isinstance(lifecycle, Mapping) or lifecycle.get("status") != "published":
        return None
    metric_id = _text(definition.get("id"))
    owner = _text(definition.get("owner_object_type_id"))
    version = definition["version"]
    if not metric_id or not owner or isinstance(version, bool) or version < 1:
        return None
    capabilities = definition.get("query_capabilities")
    raw_dimensions = (
        capabilities.get("analysis_dimensions", []) if isinstance(capabilities, Mapping) else []
    )
    dimensions: list[tuple[str, str, str]] = []
    if isinstance(raw_dimensions, list):
        for item in raw_dimensions:
            if not isinstance(item, Mapping):
                continue
            object_type = _text(item.get("object_type_id"))
            property_name = _text(item.get("property_name"))
            if object_type and property_name:
                dimensions.append(
                    (object_type, property_name, _text(item.get("relation_path_alias")) or "")
                )
    return MetricDef(
        bkn_id=metric_id,
        object_type=owner,
        version=version,
        dimensions=tuple(dimensions),
        display_name=_text(definition.get("name")),
        description=_text(definition.get("description")),
    )


def _property(prop: Mapping[str, Any]) -> PropertyDef:
    return PropertyDef(
        bkn_id=_text(prop.get("name")) or "",
        type=_text(prop.get("type")) or "",
        display_name=_text(prop.get("display_name")),
        description=_text(prop.get("comment")),
    )


def _relation_type(entry: Mapping[str, Any]) -> RelationTypeDef:
    """One relation type.

    `mapping_rules` is a list of property pairs on a direct relation, and an
    object on `indirect` (a backing resource plus two mapping lists) and
    `filtered_cross_join` (two conditions). Only the list form is a join a hop
    can make; the object form is kept as canonical JSON for the fingerprint.
    A null or missing value is no rules.
    """
    rules = entry.get("mapping_rules")
    pairs: tuple[tuple[str, str], ...] = ()
    detail = ""
    if isinstance(rules, list):
        pairs = tuple(
            (
                _text(_nested(rule, "source_property", "name")) or "",
                _text(_nested(rule, "target_property", "name")) or "",
            )
            for rule in rules
            if isinstance(rule, Mapping)
        )
    elif isinstance(rules, Mapping):
        detail = json.dumps(rules, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return RelationTypeDef(
        bkn_id=_text(entry.get("id")) or "",
        source=_text(entry.get("source_object_type_id")) or "",
        target=_text(entry.get("target_object_type_id")) or "",
        mapping_rules=pairs,
        display_name=_text(entry.get("name")),
        description=_text(entry.get("comment")),
        mapping_detail=detail,
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
