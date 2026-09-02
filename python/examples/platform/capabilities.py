# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The capability routes as named functions, chained the way real work chains.

    BKN_KN_ID=ecommerce_ops_bkn_public BKN_OBJECT_TYPE=order \\
        python examples/platform/capabilities.py

`bkn_osdk.kn` is generated from foundry's own OpenAPI, so each function takes the
arguments its route declares — including which of them ride in the query string
rather than the body, which is the detail that costs an afternoon when you send
it by hand: `kn_id` in the body of `query_object_instance` answers
`Public.NotFound` ("对象不存在"), and that reads as a missing object type.

Every route here needs a managed turn. It is attached by the runtime, so
`bkn_context` is never an argument — and `kn_id` leads every signature, because
the turn belongs to a network even where the route does not send one (`run_sql`
finds its data through the placeholder in the SQL).

Most of these need an id that only an earlier call produces, which is why this
reads as a chain rather than a list.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `bootstrap` imports

from bootstrap import chosen_object_type, kn_id

import bkn_osdk
from bkn_osdk import HttpError, kn


def attempt(label: str, call):
    """Run one route, and report a platform-side failure rather than dying on it.

    Which routes a deploy can actually serve depends on its data: the world-cup
    network's subgraph fails because a data resource behind it is missing, which
    is worth printing and not worth stopping for.
    """
    try:
        return call()
    except HttpError as error:
        print(f"{label}: platform answered HTTP {error.status} — {str(error.body)[:80]}")
        return None


def flat(payload: object) -> dict:
    """A payload's own fields, whichever envelope this build wraps them in.

    The 0.1.4 line nests some payloads under `result`; the fix rides 0.1.5.
    Payloads are handed back exactly as they arrive, so a caller reading this
    layer directly does the one step itself.
    """
    if isinstance(payload, dict) and isinstance(payload.get("result"), dict):
        return payload["result"]
    return payload if isinstance(payload, dict) else {}


def main() -> None:
    network = kn_id()

    # 1. What is in this network? `detail_level="full"` also brings back the
    #    relation and action types the later steps need ids from — and the object
    #    types, one of which the rest of this script reads.
    detail = flat(kn.get_kn_detail(network, detail_level="full"))
    types = [t.get("id") or t.get("concept_id") for t in (detail.get("object_types") or [])]
    print(f"{detail.get('name')}: {len(types)} object types")
    ot = chosen_object_type([t for t in types if t])
    print(f"reading through: {ot}")

    # 2. Which data resource backs this object type — `run_sql` names tables by
    #    resource id, never by physical table name.
    found = flat(
        attempt("search_schema", lambda: kn.search_schema(network, ot, include_columns=True))
    )
    types = found.get("object_types") or []
    resource = ((types[0].get("data_source") or {}).get("id")) if types else None
    print(f"{ot} is backed by resource: {resource}")

    if resource:
        described = flat(
            attempt("describe_resource", lambda: kn.describe_resource(network, resource))
        )
        if described:
            columns = [c.get("name") for c in (described.get("columns") or [])][:5]
            print(f"  connector {described.get('connector_type')}, columns {columns}")

        # 3. Aggregation lives here: the typed read cannot group, so SUM /
        #    COUNT / GROUP BY is what this route is for.
        counted = flat(
            attempt(
                "run_sql",
                lambda: kn.run_sql(network, "SELECT COUNT(*) AS n FROM {{." + resource + "}}"),
            )
        )
        if counted:
            print(f"  run_sql: {counted.get('entries')}")

    # 4. Instances. `kn_id` and `ot_id` go in the query string here — the
    #    wrapper knows, a hand-built call does not.
    rows = flat(
        attempt(
            "query_object_instance",
            lambda: kn.query_object_instance(network, ot, limit=2, response_format="json"),
        )
    )
    if rows:
        print(f"query_object_instance: {len(rows.get('datas') or [])} rows")

    # 5. Metrics, if this network declares any: their ids come from the object
    #    types they are mounted on.
    metrics = [m.get("concept_id") or m.get("id") for m in (found.get("metric_types") or [])]
    if metrics and metrics[0]:
        measured = flat(attempt("query_metric", lambda: kn.query_metric(network, metrics[0])))
        if measured:
            print(f"query_metric({metrics[0]}): {list(measured)[:3]}")

    # 6. Skills: list, then read one's manifest, then a file out of it.
    skills = flat(attempt("list_skills", lambda: kn.list_skills(network))).get("entries") or []
    if skills:
        skill = skills[0].get("id") or skills[0].get("skill_id")
        content = flat(kn.get_skill_content(network, skill))
        files = [f.get("rel_path") for f in (content.get("files") or [])]
        print(f"skill {skill}: {len(files)} files {files[:3]}")
        if files and files[0]:
            read = flat(kn.read_skill_file(network, skill, files[0]))
            print(f"  {files[0]}: {read.get('mime_type')}, {len(read.get('content') or '')} chars")

    # 7. Actions, where the network has them.
    actions = [a.get("id") or a.get("concept_id") for a in (detail.get("action_types") or [])]
    if actions and actions[0]:
        info = flat(attempt("get_action_info", lambda: kn.get_action_info(network, actions[0])))
        if info:
            print(f"action {actions[0]}: {list(info)[:3]}")
    history = flat(
        attempt("list_action_executions", lambda: kn.list_action_executions(network, limit=1))
    )
    print(f"action executions: {len(history.get('entries') or [])}")

    # 8. Discovery over the graph: no path given, the engine spreads from a
    #    starting type. `query_instance_subgraph` is the other one — a path you
    #    can already name.
    walked = flat(
        attempt("explore_subgraph", lambda: kn.explore_subgraph(network, ot, "forward", 1, limit=1))
    )
    if walked:
        print(f"explore_subgraph: {len(walked.get('relation_paths') or [])} paths")

    # Everything above ran on one turn per call. To put them all on *one* turn —
    # so the evidence chain reads as a single piece of work — wrap the lot:
    #
    #     with bkn_osdk.session(traced=True):
    #         kn.list_resources(network)
    #         kn.run_sql(network, ...)
    with bkn_osdk.session(traced=True):
        kn.list_resources(network)
        kn.list_skills(network)
    print("two calls in one traced scope: the same turn carried both")


if __name__ == "__main__":
    main()
