# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Version-pinned Object Metric V1 queries.

Generated metric classes carry a published definition version and its allowed
analysis dimensions. The runtime forwards only V1 query choices; fixed business
qualifiers and statistical grain stay in the immutable server-side definition.
"""

from __future__ import annotations

from typing import Any, ClassVar
from urllib.parse import quote

from .config import Context, resolve_context
from .errors import InputError
from .http import QueryValue
from .query import QUERY_BASE, branch_param

__all__ = ["Metric", "TimeWindow"]

TimeWindow = dict[str, Any]
MIN_EPOCH_MS = 1_000_000_000_000


class Metric:
    """Base of a generated, version-pinned Object Metric V1 class."""

    __kn_id__: ClassVar[str] = ""
    __bkn_id__: ClassVar[str] = ""
    __version__: ClassVar[int] = 0
    #: The branch the package was generated from, sent on the read.
    __branch__: ClassVar[str] = "main"
    __object_type__: ClassVar[str] = ""
    #: (object type, property, relation-path alias) refs in the published definition.
    __dimensions__: ClassVar[tuple[tuple[str, str, str], ...]] = ()

    @classmethod
    def query(
        cls,
        *,
        time: TimeWindow | None = None,
        group_by: list[str | dict[str, str]] | None = None,
        analysis_dimensions: list[str | dict[str, str]] | None = None,
        filter: dict[str, Any] | None = None,
        having: dict[str, Any] | None = None,
        order_by: list[dict[str, Any]] | None = None,
        page_size: int | None = None,
        cursor: str | None = None,
        bucket_selection: dict[str, Any] | None = None,
        context: Context | None = None,
    ) -> Any:
        """Query the generated immutable version and return the V1 result envelope.

        ``analysis_dimensions`` remains a compatibility alias for ``group_by``;
        both select from the published ``query_capabilities.analysis_dimensions``.
        """
        from .http import request
        from .lifecycle import with_context_retry

        if (
            isinstance(cls.__version__, bool)
            or not isinstance(cls.__version__, int)
            or cls.__version__ < 1
        ):
            raise InputError(
                f"{cls.__name__} has no published Object Metric V1 version; regenerate the package."
            )
        ctx = context or resolve_context()
        arguments: dict[str, Any] = {}
        if time is not None:
            arguments["time"] = _checked_time(time)
        if group_by is not None and analysis_dimensions is not None:
            raise InputError("Pass either group_by or analysis_dimensions, not both.")
        requested_dimensions = group_by if group_by is not None else analysis_dimensions
        if requested_dimensions is not None:
            arguments["group_by"] = cls._checked_dimensions(requested_dimensions)
        if filter is not None:
            if not isinstance(filter, dict):
                raise InputError("filter must be an Object Metric V1 condition AST object.")
            arguments["filter"] = filter
        if having is not None:
            if not isinstance(having, dict):
                raise InputError("having must be an Object Metric V1 result predicate object.")
            arguments["having"] = having
        if order_by is not None:
            if not isinstance(order_by, list) or any(
                not isinstance(item, dict) for item in order_by
            ):
                raise InputError("order_by must be a list of Object Metric V1 ordering objects.")
            arguments["order_by"] = order_by
        if page_size is not None:
            if (
                isinstance(page_size, bool)
                or not isinstance(page_size, int)
                or not 1 <= page_size <= 1000
            ):
                raise InputError("page_size must be an integer from 1 to 1000.")
            arguments["page_size"] = page_size
        if cursor is not None:
            if not isinstance(cursor, str) or not cursor:
                raise InputError("cursor must be a non-empty string.")
            if page_size is None:
                raise InputError("cursor requires page_size.")
            arguments["cursor"] = cursor
        if bucket_selection is not None:
            if not isinstance(bucket_selection, dict):
                raise InputError("bucket_selection must be an Object Metric V1 selection object.")
            arguments["bucket_selection"] = bucket_selection

        path = (
            f"{QUERY_BASE}/{quote(cls.__kn_id__, safe='')}"
            f"/object-metrics/{quote(cls.__bkn_id__, safe='')}/data"
        )

        query: dict[str, QueryValue] = {
            "branch": branch_param(cls.__branch__),
            "version": cls.__version__,
        }

        def send(bkn_context: dict[str, str] | None) -> Any:
            body = arguments if bkn_context is None else {**arguments, "bkn_context": bkn_context}
            return request(ctx, path, body=body, query=query)

        response = with_context_retry(ctx, cls.__kn_id__, send)
        return response

    @classmethod
    def _checked_dimensions(cls, requested: list[str | dict[str, str]]) -> list[dict[str, str]]:
        result: list[dict[str, str]] = []
        for item in requested:
            if isinstance(item, str):
                matches = [ref for ref in cls.__dimensions__ if ref[1] == item]
                if len(matches) != 1:
                    raise InputError(
                        f"{cls.__name__} cannot resolve analysis dimension {item!r} uniquely."
                    )
                ref = matches[0]
            elif isinstance(item, dict):
                if any(not isinstance(value, str) for value in item.values()):
                    raise InputError("group_by property refs must contain strings.")
                ref = (
                    item.get("object_type_id", ""),
                    item.get("property_name", ""),
                    item.get("relation_path_alias", ""),
                )
                if (
                    set(item) - {"object_type_id", "property_name", "relation_path_alias"}
                    or ref not in cls.__dimensions__
                ):
                    raise InputError(
                        f"{cls.__name__} does not declare analysis dimension {item!r}."
                    )
            else:
                raise InputError("group_by entries must be property names or V1 property refs.")
            value = {"object_type_id": ref[0], "property_name": ref[1]}
            if ref[2]:
                value["relation_path_alias"] = ref[2]
            if value not in result:
                result.append(value)
        return result


def _checked_time(time: TimeWindow) -> TimeWindow:
    """Require the V1 millisecond start/end pair without legacy step/instant fields."""
    if not isinstance(time, dict) or set(time) != {"start", "end"}:
        raise InputError(
            "Object Metric V1 time requires only `start` and `end` in Unix milliseconds."
        )
    start, end = time.get("start"), time.get("end")
    if (
        isinstance(start, bool)
        or not isinstance(start, int)
        or isinstance(end, bool)
        or not isinstance(end, int)
    ):
        raise InputError("Object Metric V1 time values must be integer Unix milliseconds.")
    if start < MIN_EPOCH_MS or end < MIN_EPOCH_MS:
        raise InputError("Object Metric V1 time values must be Unix milliseconds, not seconds.")
    if start > end:
        raise InputError("Object Metric V1 time.start must be <= time.end.")
    return {"start": start, "end": end}
