# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Filter nodes — the tree a `where(...)` expression builds.

The platform takes a single recursive `condition` object, the same grammar on
both read paths::

    {"operation": "and", "sub_conditions": [
      {"operation": "==", "field": "order_status", "value": "pending_payment",
       "value_from": "const"}]}

These classes are that tree in Python form. Serialising them and executing the
query is the next layer's job; keeping the nodes separate is what lets the
runtime change transports without touching the expression API.
"""

from __future__ import annotations

import operator
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, time
from decimal import Decimal
from functools import reduce
from typing import TYPE_CHECKING, Any, Generic, TypeVar
from urllib.parse import quote

from .config import Context, resolve_context
from .errors import BknError, InputError
from .http import request

if TYPE_CHECKING:
    from .types import ObjectType, PropertyRef

__all__ = [
    "Comparison",
    "Composite",
    "Filter",
    "ObjectSet",
    "Page",
    "Sort",
    "to_condition",
]

#: Operators the platform's `operation` enum accepts. `condition_operations` on
#: a property is advisory and neither necessary nor sufficient — `order.order_id`
#: declares none yet filters with `>`, and the lists name `range` / `out_range` /
#: `regex`, which the enum rejects. So permitted operators come from here plus
#: the property's Python type.
OPERATORS = frozenset(
    {
        "and",
        "or",
        "==",
        "!=",
        ">",
        ">=",
        "<",
        "<=",
        "in",
        "not_in",
        "like",
        "not_like",
        "exist",
        "not_exist",
        "match",
        "knn",
    }
)


class Filter:
    """One node of a condition tree.

    `&` and `|` compose, and composing two nodes of the same operator flattens
    rather than nesting, so `(a & b) & c` sends one three-child `and` instead of
    a tree the backend has to walk twice.
    """

    def __and__(self, other: Filter) -> Filter:
        return _combine("and", self, other)

    def __or__(self, other: Filter) -> Filter:
        return _combine("or", self, other)

    def __invert__(self) -> Filter:
        """`~` negates, where the platform has an operator that can express it.

        There is no `not` in the `operation` enum — only paired negatives
        (`not_in`, `not_like`, `not_exist`) and the comparison operators, which
        invert into each other. So a leaf negates by swapping its operator, and
        `and`/`or` negate by De Morgan, which only works if every leaf beneath
        can. A leaf that cannot raises rather than silently returning something
        that is not the negation.
        """
        raise InputError(f"{type(self).__name__} cannot be negated.")


@dataclass(frozen=True)
class Comparison(Filter):
    """A leaf: one property against one value."""

    operation: str
    field: str
    value: Any = None
    #: `knn` carries its neighbour count beside the vector, as `limit_key: "k"`.
    limit_key: str | None = None
    limit_value: int | None = None

    def __invert__(self) -> Filter:
        opposite = _OPPOSITE.get(self.operation)
        if opposite is None:
            raise InputError(
                f"`{self.operation}` has no negation in the platform's operator set, so "
                "`~` cannot express it. Write the complementary filter yourself."
            )
        return replace(self, operation=opposite)


@dataclass(frozen=True)
class Composite(Filter):
    """An `and` / `or` over two or more sub-conditions."""

    operation: str
    sub_conditions: tuple[Filter, ...]

    def __invert__(self) -> Filter:
        """De Morgan: the platform has no `not`, so the negation is pushed down."""
        flipped = "or" if self.operation == "and" else "and"
        return Composite(flipped, tuple(~node for node in self.sub_conditions))


@dataclass(frozen=True)
class Sort:
    """One ordering term.

    Only the REST read path orders at all, and only under the key `sort` — two
    plausible spellings were probed against the live platform and **silently
    ignored**, so a wrong key yields unsorted results with no error. The runtime
    therefore emits `sort` and never forwards a caller-supplied ordering dict.
    """

    field: str
    direction: str = "asc"


#: Operators that invert into each other. `match` and `knn` are absent because
#: the enum offers no `not_match` / `not_knn` — a negation there would have to be
#: invented, and an invented filter returns wrong rows rather than an error.
_OPPOSITE = {
    "==": "!=",
    "!=": "==",
    ">": "<=",
    "<=": ">",
    "<": ">=",
    ">=": "<",
    "in": "not_in",
    "not_in": "in",
    "like": "not_like",
    "not_like": "like",
    "exist": "not_exist",
    "not_exist": "exist",
}


def _combine(operation: str, left: Filter, right: Filter) -> Filter:
    return Composite(operation, (*_parts(operation, left), *_parts(operation, right)))


def _parts(operation: str, node: Filter) -> tuple[Filter, ...]:
    if isinstance(node, Composite) and node.operation == operation:
        return node.sub_conditions
    return (node,)


# ---- serialisation ----------------------------------------------------------

#: Operators that take no operand. Sending `value: null` for them works, but
#: omitting it is what the grammar describes.
_VALUELESS = frozenset({"exist", "not_exist"})


def to_condition(node: Filter) -> dict[str, Any]:
    """Render a filter tree as the platform's `condition` object."""
    if isinstance(node, Composite):
        return {
            "operation": node.operation,
            "sub_conditions": [to_condition(child) for child in node.sub_conditions],
        }
    if isinstance(node, Comparison):
        condition: dict[str, Any] = {"operation": node.operation, "field": node.field}
        if node.operation not in _VALUELESS:
            condition["value"] = _encode(node.value)
            # Every leaf compares against a literal. `value_from` also admits
            # other sources server-side; the OSDK only builds constants.
            condition["value_from"] = "const"
        if node.limit_key is not None:
            condition["limit_key"] = node.limit_key
            condition["limit_value"] = node.limit_value
        return condition
    raise InputError(f"{type(node).__name__} is not a filter this runtime can send.")


def _encode(value: Any) -> Any:
    """Put a Python value into the JSON shape the platform reads.

    A `Decimal` goes over as a string, which is also how the platform sends one
    back. `10000`, `10000.0`, `"10000"` and `"10000.00"` were all probed against
    the live platform and returned the same 12283 matches, so the choice is free
    — and the string is the one that cannot lose a digit on the way.

    `date`/`time`/`datetime` go as ISO 8601, matching what a row carries.
    """
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, list | tuple):
        return [_encode(item) for item in value]
    return value


# ---- execution --------------------------------------------------------------

QUERY_BASE = "/api/ontology-query/v1/knowledge-networks"

#: The backend's own bounds — "limit可选值 1-10000". Checked here so a mistake
#: reads as a Python error at the call site rather than as an HTTP 400.
MIN_LIMIT = 1
MAX_LIMIT = 10_000

#: Matches the TypeScript SDK's DEFAULT_QUERY_LIMIT, so both clients page alike.
DEFAULT_TAKE = 50
#: Bigger for `iterate()`, which is paging on the caller's behalf and pays a
#: round trip per page.
DEFAULT_PAGE_SIZE = 500

#: Keys the REST read understands and the MCP tool does not. `sort` and
#: `need_total` are the capabilities the traced path gives up; sending them
#: anyway would be ignored in silence, which is worse than dropping them here.
#: `cursor` is REST's paging token — the tool pages by `offset` / `search_after`
#: instead, so a cursor handed to it would restart at the first page.
_REST_ONLY_ARGUMENTS = frozenset({"sort", "need_total", "cursor"})

OT = TypeVar("OT", bound="ObjectType")


@dataclass(frozen=True)
class Page(Generic[OT]):
    """One page of results, plus what the envelope said about it."""

    rows: list[OT]
    #: `total_count`, present only when `need_total` was asked for — and absent
    #: even then when nothing matched, so `count()` reads `None` as zero.
    total: int | None = None
    #: Deprecated. The backend's hint that an index served the query, returned by
    #: deploys that predate cursor paging and absent from the current contract,
    #: where it reads False. Paging decisions follow `next_cursor`, not this.
    search_from_index: bool = False
    #: Present on a traced read: the evidence-chain entry for the operation.
    receipt: dict[str, Any] | None = None
    #: The opaque cursor for the page after this one — `paging.next_cursor` on
    #: the REST read, or its compatibility twin `cursor`. `None` means this is
    #: the last page. Pass it back as `page(cursor=...)`. Always `None` on a
    #: traced read, whose MCP tool pages by `offset` instead.
    next_cursor: str | None = None


@dataclass(frozen=True)
class ObjectSet(Generic[OT]):
    """A query under construction: immutable, so every step returns a new set."""

    object_type: type[OT]
    filter: Filter | None = None
    sorts: tuple[Sort, ...] = ()
    properties: tuple[str, ...] | None = None
    context: Context | None = None

    # ---- refinement ----

    def where(self, *filters: Filter) -> ObjectSet[OT]:
        """Narrow the set. Several arguments, or several calls, compose with `and`."""
        combined = self.filter
        for node in filters:
            combined = node if combined is None else combined & node
        return replace(self, filter=combined)

    def order_by(self, *sorts: Sort) -> ObjectSet[OT]:
        return replace(self, sorts=(*self.sorts, *sorts))

    def select(self, *properties: PropertyRef[Any] | str) -> ObjectSet[OT]:
        """Fetch only these properties.

        The request key is `properties`. Four other plausible spellings were
        probed against the live platform and every one was **silently ignored**,
        returning the full row — which is why the caller names properties and
        never hands over a request key.
        """
        names = tuple(p if isinstance(p, str) else p.bkn_id for p in properties)
        return replace(self, properties=(*(self.properties or ()), *names))

    def with_context(self, context: Context) -> ObjectSet[OT]:
        """Pin credentials explicitly, for callers who prefer no ambient state."""
        return replace(self, context=context)

    # ---- execution ----

    def take(self, limit: int = DEFAULT_TAKE) -> list[OT]:
        return self.page(limit=limit).rows

    def count(self) -> int:
        """Rows matching the filter.

        Only the REST path can answer this, and only via `need_total` — the MCP
        tool accepts the key and returns no total under any argument. The
        smallest legal `limit` is 1, so one row comes back and is discarded.
        """
        return self.page(limit=MIN_LIMIT, need_total=True).total or 0

    def iterate(self, page_size: int = DEFAULT_PAGE_SIZE) -> Iterator[OT]:
        """Every match, paged the way the deploy answering pages.

        The current ontology-query contract takes a first query, then `{cursor}`
        turns of the same query, and answers `paging.next_cursor` — `null` on the
        last page. Where the first response carries `paging` (or the compatibility
        `cursor`), the walk follows that cursor until it is null: a short page is
        then not proof of the end, nor a full one proof of more.

        Deploys built before cursor paging (0.1.5 releases in the field) answer
        with neither field but honour `offset`, and the traced MCP tool documents
        `offset` too. There the walk falls back to `limit`/`offset`, advancing by
        the page length and stopping on the first short page.
        """
        context = self.context or resolve_context()
        pinned = replace(self, context=context)

        page, cursor_paged = pinned._fetch(limit=page_size)
        yield from page.rows

        if not cursor_paged:
            offset = len(page.rows)
            while len(page.rows) == page_size:
                page, _ = pinned._fetch(limit=page_size, offset=offset)
                yield from page.rows
                offset += len(page.rows)
            return

        cursor: str | None = None
        while page.next_cursor is not None:
            if page.next_cursor == cursor:
                raise BknError(
                    "The platform returned the same cursor it was sent, so paging would "
                    "never advance. Stopping rather than looping."
                )
            cursor = page.next_cursor
            page, _ = pinned._fetch(limit=page_size, cursor=cursor)
            yield from page.rows

    def get(self, *values: Any, **named: Any) -> OT | None:
        """One instance by primary key, or None.

        A single-part key takes the value positionally; a composite key takes
        one keyword argument per part.
        """
        rows = self.where(self._primary_key_filter(*values, **named)).page(limit=1).rows
        return rows[0] if rows else None

    def raw(self, arguments: dict[str, Any]) -> Page[OT]:
        """Send an argument map verbatim.

        A permanent escape hatch — not because the grammar is unknown, but
        because the backend can grow fields faster than this runtime models
        them. Over REST nothing is merged in; a traced read adds only
        `response_format: "json"`, which the MCP tool needs and REST does not
        define.
        """
        context = self.context or resolve_context()
        return self._decode(self._send(dict(arguments), context), context)

    def page(
        self,
        *,
        limit: int = DEFAULT_TAKE,
        offset: int = 0,
        need_total: bool = False,
        cursor: str | None = None,
    ) -> Page[OT]:
        """One page.

        The first page takes no `cursor`; each later one takes the previous
        page's `next_cursor`, with the same filter, ordering and limit.

        `offset` is still sent as before: deploys that predate cursor paging
        honour it, as does the traced MCP tool. The current contract pages by
        `cursor` instead, so prefer `next_cursor` where a deploy returns one.
        Passing both raises.
        """
        return self._fetch(limit=limit, offset=offset, need_total=need_total, cursor=cursor)[0]

    def _fetch(
        self,
        *,
        limit: int,
        offset: int = 0,
        need_total: bool = False,
        cursor: str | None = None,
    ) -> tuple[Page[OT], bool]:
        """The page, and whether the response speaks cursor paging (`paging` or `cursor`).

        The single place a request body is assembled.
        """
        if not MIN_LIMIT <= limit <= MAX_LIMIT:
            raise InputError(f"limit must be between {MIN_LIMIT} and {MAX_LIMIT}, got {limit}.")
        if offset < 0:
            raise InputError(f"offset must not be negative, got {offset}.")
        if offset and cursor is not None:
            raise InputError("Pass `cursor` or `offset`, not both.")

        body: dict[str, Any] = {"limit": limit}
        if cursor is not None:
            body["cursor"] = cursor
        if self.filter is not None:
            body["condition"] = to_condition(self.filter)
        if self.sorts:
            # `sort`, and only `sort`. `order_by` and `orders` are accepted and
            # silently ignored, so a wrong spelling returns unsorted rows with
            # no error at all.
            body["sort"] = [{"field": s.field, "direction": s.direction} for s in self.sorts]
        if self.properties:
            body["properties"] = list(dict.fromkeys(self.properties))
        if need_total:
            body["need_total"] = True
        context = self.context or resolve_context()
        if offset:
            body["offset"] = offset
        sent = self._send(body, context)
        response = sent[0]
        paged = isinstance(response, dict) and ("paging" in response or "cursor" in response)
        return self._decode(sent, context), paged

    # ---- internals ----

    @staticmethod
    def _via_tool(context: Context, keys: Any) -> bool:
        """Whether a body with these keys goes to the traced MCP tool rather than REST."""
        return context.traced and not _REST_ONLY_ARGUMENTS & set(keys)

    def _send(self, body: dict[str, Any], context: Context) -> Any:
        from .meta import ensure_schema_checked

        # A no-op unless `configure(check_schema=True)` asked for it, and then
        # exactly once per network per process.
        ensure_schema_checked(context, self.object_type.__kn_id__)
        if self._via_tool(context, body.keys()):
            # The tool accepts `sort` and `need_total` and honours neither, so a
            # query needing either goes over REST even inside a traced scope —
            # carrying the scope's turn, so the read is still recorded. Handing
            # back an unsorted page, or a count of zero for a set with matches,
            # would be a wrong answer bought with a receipt.
            return self._send_traced(context, body)
        from .lifecycle import with_context_retry

        path = (
            f"{QUERY_BASE}/{quote(self.object_type.__kn_id__, safe='')}"
            f"/object-types/{quote(self.object_type.__bkn_id__, safe='')}"
        )

        def send(bkn_context: dict[str, str] | None) -> Any:
            payload = body if bkn_context is None else {**body, "bkn_context": bkn_context}
            # A read, semantically — the body is what makes it a POST.
            return request(context, path, body=payload, method_override="GET")

        # Deploys differ on whether the REST surface enforces the lifecycle
        # contract; the first attempt finds out, and a session is opened only
        # where one is actually demanded.
        return with_context_retry(context, self.object_type.__kn_id__, send), None

    def _send_traced(self, context: Context, body: dict[str, Any]) -> tuple[Any, Any]:
        """The same query through MCP, inside the scope's managed interaction.

        Slower — a transport session plus a tool call — and it can neither sort
        nor total, because the tool accepts neither key and ignores them in
        silence. What it buys is the receipt: the operation, its normalised
        inputs, and the properties it touched, landed in the evidence chain.
        """
        from .lifecycle import current_interaction
        from .mcp import call_tool

        interaction = current_interaction(context, self.object_type.__kn_id__)
        result = call_tool(
            context,
            self.object_type.__kn_id__,
            "query_object_instance",
            {
                # The MCP tool answers `toon` unless told otherwise; the REST
                # read defines no such field, so only this path asks for JSON.
                "response_format": "json",
                **{k: v for k, v in body.items() if k not in _REST_ONLY_ARGUMENTS},
                "kn_id": self.object_type.__kn_id__,
                "ot_id": self.object_type.__bkn_id__,
                "bkn_context": interaction.bkn_context,
            },
        )
        if result.receipt is not None:
            interaction.receipts.append(result.receipt)
        return result.value, result.receipt

    def _decode(self, sent: tuple[Any, Any], context: Context | None = None) -> Page[OT]:
        response, receipt = sent
        payload = response if isinstance(response, dict) else {}
        rows = payload.get("datas") or []
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                # Dropping it would shorten the page, and `iterate` reads a short
                # page as the last one — so one malformed row would silently
                # truncate the whole walk. Better to say which row it was.
                raise BknError(
                    f"Row {index} of this page is a {type(row).__name__}, not an object: "
                    f"{str(row)[:80]}. The platform's response does not match the read "
                    "contract, so the page is not decoded rather than decoded short."
                )
        instances = [self.object_type(row) for row in rows]
        for instance in instances:
            # The receipt travels with the rows it accounts for, so a caller can
            # cite a specific instance without threading the page around.
            instance.__receipt__ = receipt
            instance.__context__ = context
        total = payload.get("total_count")
        return Page(
            rows=instances,
            total=total if isinstance(total, int) else None,
            search_from_index=bool(payload.get("search_from_index")),
            receipt=receipt,
            next_cursor=_next_cursor(payload),
        )

    def _primary_key_filter(self, *values: Any, **named: Any) -> Filter:
        key = self.object_type.__primary_key__
        if not key:
            raise InputError(
                f"{self.object_type.__name__} declares no primary key, so it cannot be fetched "
                "by one. Use where(...) instead."
            )
        if values and named:
            raise InputError("Pass the primary key positionally or by name, not both.")
        if named:
            missing = [part for part in key if part not in named]
            unexpected = [part for part in named if part not in key]
            if missing or unexpected:
                raise InputError(
                    f"{self.object_type.__name__}'s primary key is {', '.join(key)}. "
                    f"Got {', '.join(named) or '(nothing)'}."
                )
            parts: Sequence[Any] = [named[part] for part in key]
        else:
            if len(values) != len(key):
                raise InputError(
                    f"{self.object_type.__name__}'s primary key has {len(key)} part(s) "
                    f"({', '.join(key)}); got {len(values)}."
                )
            parts = values
        equalities = [Comparison("==", part, value) for part, value in zip(key, parts, strict=True)]
        return reduce(operator.and_, equalities)


def _next_cursor(payload: dict[str, Any]) -> str | None:
    """`paging.next_cursor`, falling back to the compatibility `cursor` field.

    The contract makes `paging.next_cursor` authoritative — `null` at the end —
    and `cursor` its deprecated copy, read only where `paging` is missing.
    """
    paging = payload.get("paging")
    if isinstance(paging, dict) and "next_cursor" in paging:
        cursor = paging.get("next_cursor")
    else:
        cursor = payload.get("cursor")
    return cursor if isinstance(cursor, str) and cursor else None
