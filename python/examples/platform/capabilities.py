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
the turn belongs to a network even where the route does not send one.

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

BASE = "/api/bkn-backend/v1/knowledge-networks"


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

    # 2. Aggregation lives here: the typed read cannot group, so COUNT /
    #    SUM / GROUP BY goes through Cypher, which respects the network's
    #    property-level rules.
    counted = flat(
        attempt(
            "run_cypher",
            lambda: kn.run_cypher(network, f"MATCH (o:{ot}) RETURN count(*) AS n"),
        )
    )
    if counted:
        print(f"  run_cypher: {counted.get('entries') or counted.get('rows')}")

    # 3. Instances. `kn_id` and `ot_id` go in the query string here — the
    #    wrapper knows, a hand-built call does not.
    rows = flat(
        attempt(
            "query_object_instance",
            lambda: kn.query_object_instance(network, ot, limit=2, response_format="json"),
        )
    )
    if rows:
        print(f"query_object_instance: {len(rows.get('datas') or [])} rows")

    # 4. Published Object Metric V1 ids and immutable versions.
    metrics = (
        flat(
            attempt(
                "list_object_metrics",
                lambda: bkn_osdk.call(
                    f"{BASE}/{network}/object-metrics",
                    query={"status": "published", "limit": 3},
                ),
            )
        ).get("entries")
        or []
    )
    if metrics:
        definition = metrics[0].get("definition") or {}
        metric_id, version = definition.get("id"), definition.get("version")
        if (
            isinstance(metric_id, str)
            and isinstance(version, int)
            and not isinstance(version, bool)
        ):
            measured = flat(
                attempt("query_metric", lambda: kn.query_metric(network, metric_id, version))
            )
            if measured:
                print(f"query_metric({metric_id}, v{version}): {list(measured)[:3]}")

    # 5. Skills: list, then read one's manifest, then a file out of it.
    skills = flat(attempt("list_skills", lambda: kn.list_skills(network))).get("entries") or []
    if skills:
        skill = skills[0].get("id") or skills[0].get("skill_id")
        content = flat(kn.get_skill_content(network, skill))
        files = [f.get("rel_path") for f in (content.get("files") or [])]
        print(f"skill {skill}: {len(files)} files {files[:3]}")
        if files and files[0]:
            read = flat(kn.read_skill_file(network, skill, files[0]))
            print(f"  {files[0]}: {read.get('mime_type')}, {len(read.get('content') or '')} chars")

    # 6. Actions, where the network has them.
    actions = [a.get("id") or a.get("concept_id") for a in (detail.get("action_types") or [])]
    if actions and actions[0]:
        info = flat(attempt("get_action_info", lambda: kn.get_action_info(network, actions[0])))
        if info:
            print(f"action {actions[0]}: {list(info)[:3]}")
    history = flat(
        attempt("list_action_executions", lambda: kn.list_action_executions(network, limit=1))
    )
    print(f"action executions: {len(history.get('entries') or [])}")

    # 7. Discovery over the graph: no path given, the engine spreads from a
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
    #         kn.run_cypher(network, ...)
    #         kn.list_skills(network)
    with bkn_osdk.session(traced=True):
        kn.list_skills(network)
        kn.list_action_executions(network, limit=1)
    print("two calls in one traced scope: the same turn carried both")


if __name__ == "__main__":
    main()
