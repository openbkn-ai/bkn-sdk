# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Metrics — the platform's aggregation surface, and the only one it has.

An instance query cannot aggregate: `query_object_instance` takes a condition, a
limit, an offset and a property selection, and nothing else. `need_total` gives a
row count. So `sum`, `avg` and `group_by` over an object set have no endpoint to
reach, and are not offered here rather than being faked by pulling every row back
to the client.

What the platform does have is richer than that would have been. A metric is a
schema artifact with its own query::

    from bkn.metrics import Gmv

    Gmv.query(
        time={"start": 1751328000, "end": 1753920000, "step": "day"},
        analysis_dimensions=["channel_id"],
        order_by=[("gmv", "desc")],
    )

`condition` uses the same grammar as an instance query, `having` filters the
aggregated result, and `order_by` is the only sorting anywhere in the read
surface besides REST's `sort`.

The transport is `POST …/metrics/{metric_id}/data`, the same REST layer as every
other read. The MCP `query_metric` tool takes the same arguments and needs a
managed session on top, so it buys nothing here — and the REST body has one
field the tool never exposed: `metrics`, for period-over-period and share.

Conditions **merge rather than override**: the platform ANDs the metric
definition's own condition, the one passed here, and the time range.
"""

from __future__ import annotations

from typing import Any, ClassVar

from .config import Context, resolve_context
from .errors import InputError
from .query import QUERY_BASE, Filter, Sort, to_condition

__all__ = ["Metric", "TimeWindow"]

#: `step` values the endpoint documents. Case-insensitive on the wire.
STEPS = frozenset({"day", "week", "month", "quarter", "year"})

TimeWindow = dict[str, Any]


class Metric:
    """Base of every generated metric class. Declarations only, like an object type."""

    __kn_id__: ClassVar[str] = ""
    __bkn_id__: ClassVar[str] = ""
    #: The object type this metric is mounted on, for the error messages.
    __object_type__: ClassVar[str] = ""
    #: The only dimensions the tool accepts: "取值必须来自 related_metrics[].analysis_dimensions".
    __dimensions__: ClassVar[tuple[str, ...]] = ()

    @classmethod
    def query(
        cls,
        *,
        time: TimeWindow | None = None,
        analysis_dimensions: list[str] | None = None,
        condition: Filter | None = None,
        having: dict[str, Any] | None = None,
        order_by: list[Sort] | list[tuple[str, str]] | None = None,
        limit: int | None = None,
        metrics: Any = None,
        context: Context | None = None,
    ) -> Any:
        """Compute the metric, returning the platform's rows unchanged.

        The time rules are checked here rather than left to a backend error,
        because they are stated precisely enough to enforce: `instant=True` takes
        a point, a series needs a `step`, and `start`/`end` come as a pair.

        `metrics` passes through the period-over-period / share block verbatim:
        its grammar belongs to the metric definition, not to this signature.
        """
        from .http import request
        from .lifecycle import with_context_retry

        ctx = context or resolve_context()
        arguments: dict[str, Any] = {"response_format": "json"}
        if time is not None:
            arguments["time"] = _checked_time(time)
        if analysis_dimensions:
            arguments["analysis_dimensions"] = cls._checked_dimensions(analysis_dimensions)
        if condition is not None:
            arguments["condition"] = to_condition(condition)
        if having is not None:
            arguments["having"] = having
        if order_by:
            arguments["order_by"] = _order_by(order_by)
        if limit is not None:
            arguments["limit"] = limit
        if metrics is not None:
            arguments["metrics"] = metrics

        path = f"{QUERY_BASE}/{cls.__kn_id__}/metrics/{cls.__bkn_id__}/data"

        def send(bkn_context: dict[str, str] | None) -> Any:
            body = arguments if bkn_context is None else {**arguments, "bkn_context": bkn_context}
            return request(ctx, path, body=body)

        response = with_context_retry(ctx, cls.__kn_id__, send)
        value = response if isinstance(response, dict) else {}
        return value.get("datas", value)

    @classmethod
    def _checked_dimensions(cls, requested: list[str]) -> list[str]:
        unknown = [name for name in requested if name not in cls.__dimensions__]
        if unknown and cls.__dimensions__:
            raise InputError(
                f"{cls.__name__} can only be split by {', '.join(cls.__dimensions__)}; "
                f"got {', '.join(unknown)}."
            )
        return list(requested)


def _checked_time(time: TimeWindow) -> TimeWindow:
    """The tool's own rules, enforced before the round trip.

    Timestamps are **unix seconds** here. The same metric mounted on an object
    type documents milliseconds for its logic-property parameters — a different
    call path with a different unit, and an easy thing to carry across by mistake.
    """
    instant = bool(time.get("instant"))
    start, end = time.get("start"), time.get("end")
    step = time.get("step")

    if (start is None) != (end is None):
        raise InputError("A metric time window needs both `start` and `end`, or neither.")
    if not instant and step is None:
        raise InputError(
            "A series query needs a `step` (day, week, month, quarter, year). Pass "
            "`instant=True` for a single point instead."
        )
    if instant and step is not None:
        raise InputError("`instant=True` takes a point, so it cannot also take a `step`.")
    if step is not None and str(step).lower() not in STEPS:
        raise InputError(f"`step` must be one of {', '.join(sorted(STEPS))}; got {step!r}.")
    return dict(time)


def _order_by(order_by: list[Sort] | list[tuple[str, str]]) -> list[dict[str, str]]:
    """`Sort` objects or plain pairs — a metric spells the key `property`, not the
    `field` an instance sort uses."""
    rows: list[dict[str, str]] = []
    for term in order_by:
        if isinstance(term, Sort):
            rows.append({"property": term.field, "direction": term.direction})
        else:
            field, direction = term
            rows.append({"property": field, "direction": direction})
    return rows
