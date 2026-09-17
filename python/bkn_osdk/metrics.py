# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Metrics — the platform's aggregation surface, and the only one it has.

An instance query cannot aggregate: `query_object_instance` takes a condition, a
sort, a limit, a cursor or offset and a property selection, and nothing else. `need_total` gives a
row count. So `sum`, `avg` and `group_by` over an object set have no endpoint to
reach, and are not offered here rather than being faked by pulling every row back
to the client.

What the platform does have is richer than that would have been. A metric is a
schema artifact with its own query::

    from bkn.metrics import Gmv

    Gmv.query(
        time={"start": 1751328000000, "end": 1753920000000, "step": "day"},
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
from urllib.parse import quote

from .config import Context, resolve_context
from .errors import InputError
from .http import QueryValue
from .query import QUERY_BASE, Filter, Sort, branch_param, to_condition

__all__ = ["Metric", "TimeWindow"]

#: `step` values the endpoint's descriptions use. Documentation, not a gate: the
#: published schema declares `time.step` a free string, so any non-empty value
#: is sent and the platform decides.
STEPS = frozenset({"day", "week", "month", "quarter", "year"})

#: 1e12 ms is 2001-09-09. Any real window is later, and any value in seconds
#: (ten digits) is far below it — so this separates the two units cleanly.
MIN_EPOCH_MS = 1_000_000_000_000

TimeWindow = dict[str, Any]


class Metric:
    """Base of every generated metric class. Declarations only, like an object type."""

    __kn_id__: ClassVar[str] = ""
    __bkn_id__: ClassVar[str] = ""
    #: The branch the package was generated from, sent as `branch` on the read.
    __branch__: ClassVar[str] = "main"
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
        fill_null: bool = False,
        context: Context | None = None,
    ) -> Any:
        """Compute the metric, returning the platform's rows unchanged.

        The time rules are checked here rather than left to a backend error,
        because they are stated precisely enough to enforce: `instant=True` takes
        a point, a series needs a `step`, and `start`/`end` come as a pair.

        `metrics` passes through the period-over-period / share block verbatim:
        its grammar belongs to the metric definition, not to this signature.

        `fill_null=True` aligns a series to every bucket of `[start, end]`,
        filling missing buckets with null. It is a query-string flag and only
        applies to a series, not to `instant=True`.
        """
        from .http import request
        from .lifecycle import with_context_retry

        ctx = context or resolve_context()
        # `MetricQueryRequestBody` defines no `response_format`: REST answers JSON.
        arguments: dict[str, Any] = {}
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
            if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
                raise InputError(f"limit must be a positive integer, got {limit!r}.")
            arguments["limit"] = limit
        if metrics is not None:
            arguments["metrics"] = metrics

        path = (
            f"{QUERY_BASE}/{quote(cls.__kn_id__, safe='')}"
            f"/metrics/{quote(cls.__bkn_id__, safe='')}/data"
        )

        query: dict[str, QueryValue] = {
            "branch": branch_param(cls.__branch__),
            "fill_null": fill_null or None,
        }

        def send(bkn_context: dict[str, str] | None) -> Any:
            body = arguments if bkn_context is None else {**arguments, "bkn_context": bkn_context}
            return request(ctx, path, body=body, query=query)

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

    `start` and `end` are **unix milliseconds** — the endpoint's own example is
    `1735689600000`. A value in seconds is ten digits and would be read as a
    moment in January 1970, answering an empty window rather than an error, so
    anything below `MIN_EPOCH_MS` (2001-09-09) is refused here.
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
    if step is not None and (not isinstance(step, str) or not step.strip()):
        raise InputError(
            f"`step` must be a non-empty string such as {', '.join(sorted(STEPS))}; got {step!r}."
        )
    for name, value in (("start", start), ("end", end)):
        if isinstance(value, int | float) and not isinstance(value, bool) and value < MIN_EPOCH_MS:
            raise InputError(
                f"`{name}` is {value}, which is not a unix timestamp in milliseconds. "
                "Metric windows take milliseconds (e.g. 1735689600000); multiply seconds by 1000."
            )
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
