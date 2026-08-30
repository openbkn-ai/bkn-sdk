# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Multi-hop traversal, over the REST subgraph endpoint.

One hop is a filter on the target object type and needs nothing from this
module — see `Relation`. Several hops are a different question: the join has to
happen server-side, because the intermediate rows are not something a client
should page through to reach the far end.

    Order.items.then(OrderItem.sku).of(order).take(20)

The transport is `POST …/knowledge-networks/{kn}/subgraph`, the same REST layer
every other read uses — no MCP tool, and therefore no managed session unless the
deploy demands one for REST as a whole.

**Why the walk is filtered client-side.** The endpoint offers two request
shapes. The path-precise one (`relation_type_paths`, the same grammar the MCP
tool takes) is in the published spec but the deploy this was built against
rejects it and asks for the other: a seed object type, a direction, and a
maximum path length. That form explores *every* relation up to `path_length`
hops, so the requested chain is selected from the `relation_paths` the response
reports — each carries the exact sequence of relation ids it walked. Over-fetch
is bounded by seeding a single instance, and the alternative would be sending a
request shape the backend answers with an error.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Any

from .config import Context, resolve_context
from .errors import InputError
from .query import QUERY_BASE, Comparison, Filter, to_condition

if TYPE_CHECKING:
    from .types import ObjectType, Relation

__all__ = ["RelationPath"]

#: The endpoint's own bound: "路径长度必须在 1 到 3 之间".
MAX_PATH_LENGTH = 3
DEFAULT_STEP_LIMIT = 50


@dataclass(frozen=True)
class RelationPath:
    """A chain of relations, not yet bound to a starting instance."""

    steps: tuple[Relation[Any], ...]
    #: A filter on the object type the chain currently ends at.
    end_condition: Filter | None = None

    def then(self, relation: Relation[Any]) -> RelationPath:
        """Extend the chain by one hop."""
        return replace(self, steps=(*self.steps, relation), end_condition=None)

    def where(self, condition: Filter) -> RelationPath:
        """Narrow the far end. Applied after the walk, since the endpoint's
        seed-based form filters only the starting object type."""
        combined = condition if self.end_condition is None else self.end_condition & condition
        return replace(self, end_condition=combined)

    def of(
        self,
        instance: ObjectType,
        *,
        step_limit: int = DEFAULT_STEP_LIMIT,
        context: Context | None = None,
    ) -> list[Any]:
        """Walk the chain from one instance, returning the far end's instances.

        Duplicates are dropped: several paths through the graph commonly land on
        the same object, and a caller asking for "the SKUs of this order" wants
        each SKU once.
        """
        from .http import request
        from .lifecycle import with_context_retry

        if not self.steps:
            raise InputError("A relation path needs at least one hop.")
        if len(self.steps) > MAX_PATH_LENGTH:
            raise InputError(
                f"The subgraph endpoint walks at most {MAX_PATH_LENGTH} hops; this path has "
                f"{len(self.steps)}. Split it, or query the intermediate type directly."
            )

        ctx = context or resolve_context()
        kn_id = type(instance).__kn_id__
        target = self.steps[-1]._target_class()
        path = f"{QUERY_BASE}/{kn_id}/subgraph"

        body: dict[str, Any] = {
            "source_object_type_id": type(instance).__bkn_id__,
            "condition": to_condition(_identity_filter(instance)),
            "direction": "forward",
            "path_length": len(self.steps),
            # One seed instance: the condition already pins it, and a larger cap
            # would only widen the walk.
            "limit": 1,
            "response_format": "json",
        }

        def send(bkn_context: dict[str, str] | None) -> Any:
            payload = body if bkn_context is None else {**body, "bkn_context": bkn_context}
            return request(ctx, path, body=payload, method_override="GET")

        response = with_context_retry(ctx, kn_id, send)
        return self._decode(response, target, step_limit)

    # ---- response ----

    def _decode(self, response: Any, target: type[ObjectType], step_limit: int) -> list[Any]:
        """Keep the paths that walked *this* chain, and decode where they ended."""
        payload = response if isinstance(response, dict) else {}
        objects = payload.get("objects")
        objects = objects if isinstance(objects, dict) else {}
        wanted = [step.bkn_id for step in self.steps]

        found: dict[str, ObjectType] = {}
        for walked in payload.get("relation_paths") or []:
            relations = walked.get("relations") if isinstance(walked, dict) else None
            if not relations or [hop.get("relation_type_id") for hop in relations] != wanted:
                continue
            instance_id = relations[-1].get("target_object_id")
            if not isinstance(instance_id, str) or instance_id in found:
                continue
            payload_for = objects.get(instance_id)
            if not isinstance(payload_for, dict):
                continue
            if payload_for.get("object_type_id") != target.__bkn_id__:
                continue
            found[instance_id] = target(_flatten(payload_for))
            if len(found) >= step_limit:
                break

        rows = list(found.values())
        if self.end_condition is None:
            return rows
        return [row for row in rows if _matches(row, self.end_condition)]


def _flatten(payload: dict[str, Any]) -> dict[str, Any]:
    """A subgraph object nests its properties; an instance query does not."""
    properties = payload.get("properties")
    flat: dict[str, Any] = dict(properties) if isinstance(properties, dict) else {}
    for key in ("_instance_id", "_instance_identity", "_display"):
        if key in payload:
            flat[key] = payload[key]
    return flat


def _matches(row: ObjectType, condition: Filter) -> bool:
    """Apply a far-end filter locally.

    The seed-based request shape filters only the starting object type, so a
    `where()` on the far end is honoured here rather than silently ignored.
    Only the operators whose meaning is unambiguous client-side are evaluated;
    anything else raises rather than quietly dropping rows.
    """
    from .query import Composite

    if isinstance(condition, Composite):
        results = [_matches(row, node) for node in condition.sub_conditions]
        return all(results) if condition.operation == "and" else any(results)
    if not isinstance(condition, Comparison):
        raise InputError(f"{type(condition).__name__} cannot be evaluated on a walked path.")

    value = row.__data__.get(condition.field)
    operation = condition.operation
    if operation == "exist":
        return condition.field in row.__data__ and value is not None
    if operation == "not_exist":
        return value is None
    if operation == "==":
        return bool(value == condition.value)
    if operation == "!=":
        return bool(value != condition.value)
    if operation == "in":
        return value in (condition.value or [])
    if operation == "not_in":
        return value not in (condition.value or [])
    raise InputError(
        f"`{operation}` cannot be evaluated on a walked path — the subgraph endpoint filters "
        "only its starting object type. Query the target object type directly instead."
    )


def _identity_filter(instance: ObjectType) -> Filter:
    """Pin the walk's starting point to this one instance."""
    identity = instance.__identity__
    if not identity:
        raise InputError(
            f"{type(instance).__name__} has no identity, so a path cannot start from it. "
            "Fetch it with a query rather than constructing it by hand."
        )
    combined: Filter | None = None
    for field, value in identity.items():
        node = Comparison("==", field, value)
        combined = node if combined is None else combined & node
    if combined is None:  # pragma: no cover — an identity is never empty here
        raise InputError("The starting instance has an empty identity.")
    return combined
