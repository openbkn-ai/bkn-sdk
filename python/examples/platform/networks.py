# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Knowledge networks as the platform stores them, before any generation.

    BKN_KN_ID=ecommerce_ops_bkn_public python examples/platform/networks.py

`bkn-backend` owns the definitions: which networks exist, and what each declares
— object types with their properties, relation types with their join columns,
metrics, action types, concept groups. The ontology layer is generated *from*
exactly these reads, so this is the same data one layer down, with no package to
build first.

Reach for this when the answer is about the ontology itself rather than about
rows: which networks are on this deploy, whether a property exists yet, what a
metric is defined as. When the answer is about rows, generate the package and
let the classes do it.

The platform layer answers this two ways, and the difference is worth seeing
side by side:

* `bkn_osdk.kn.*` — named functions, generated from the context-loader contract.
  Typed arguments, and a managed turn attached for you, so the read lands in the
  evidence chain. This is the agent-facing shape.
* `bkn_osdk.call(path)` — any REST route by path. `bkn-backend` owns definitions
  that context-loader does not expose at all — metrics, action types, concept
  groups — and needs no turn to read them.

Same ontology, two doors. Use the named function where one exists; `call` is
what covers the rest of the platform.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `bootstrap` imports

from bootstrap import kn_id

import bkn_osdk
from bkn_osdk import kn

BASE = "/api/bkn-backend/v1/knowledge-networks"


def entries(payload: Any) -> list[dict[str, Any]]:
    return (payload or {}).get("entries") or []


def flat(payload: Any) -> dict[str, Any]:
    """A payload's own fields, whichever envelope this build wraps them in."""
    if isinstance(payload, dict) and isinstance(payload.get("result"), dict):
        return payload["result"]
    return payload if isinstance(payload, dict) else {}


def main() -> None:
    network = kn_id()

    # 1. What is on this deploy at all. The generated package pins one network;
    #    this is how you find the others.
    #
    #    `kn.list_knowledge_networks` answers the same question through
    #    context-loader — note that it takes a network anyway, because the turn
    #    it runs on belongs to one. The REST route needs no turn, which is why
    #    it is the one to reach for when you do not have a network yet.
    listed = bkn_osdk.call(BASE, query={"limit": 100})
    print(f"部署上有 {listed.get('total_count')} 个知识网络, 前几个:")
    for entry in entries(listed)[:5]:
        print(f"    {entry['id']:32} {entry.get('name')}")

    #    The two doors do not always agree, and that is the point of asking both.
    #    On one deploy `bkn-backend` lists 28 and context-loader 20: the extras
    #    are archived or `module-test-*` networks, so the agent-facing surface
    #    appears to filter to what an agent should be offered. Which door you
    #    pick changes the answer, so pick the one that matches the question.
    through_kn = flat(kn.list_knowledge_networks(network))
    by_rest = {entry["id"] for entry in entries(listed)}
    by_loader = {e.get("id") or e.get("kn_id") for e in entries(through_kn)}
    print(f"    走 kn.list_knowledge_networks: {through_kn.get('total_count')} 个")
    hidden = sorted(by_rest - by_loader)
    if hidden:
        print(f"    只有 REST 看得到: {hidden[:4]}")

    # 2. One network's own record, through the named function.
    detail = flat(kn.get_kn_detail(network, detail_level="summary"))
    print(f"\n{network}: {detail.get('name')} | 对象类 {len(detail.get('object_types') or [])} 个")

    # 3. Object types, with the properties the generator turns into descriptors.
    #    `kn.get_object_types` gives the agent-facing view of named types; the
    #    REST listing pages through all of them, which is what the generator does.
    types = bkn_osdk.call(f"{BASE}/{network}/object-types", query={"limit": 3})
    print(f"\n对象类 {types.get('total_count')} 个:")
    for entry in entries(types):
        properties = [p.get("name") for p in (entry.get("data_properties") or [])]
        print(f"    {entry['id']:22} 主键 {entry.get('primary_keys')} 属性 {len(properties)} 个")
        print(f"      {properties[:6]}")

    # 4. Relation types carry the join columns a hop is built from — the
    #    `mapping_rules` are what `order.buyer` compiles into a filter.
    relations = bkn_osdk.call(f"{BASE}/{network}/relation-types", query={"limit": 3})
    print(f"\n关系类 {relations.get('total_count')} 个:")
    for entry in entries(relations):
        joins = [
            (rule["source_property"]["name"], rule["target_property"]["name"])
            for rule in (entry.get("mapping_rules") or [])
            if isinstance(rule.get("source_property"), dict)
        ]
        print(
            f"    {entry['id']:24} {entry.get('source_object_type_id')}"
            f" -> {entry.get('target_object_type_id')}  join {joins}"
        )

    # 5. Metric definitions. The ontology layer generates a class per metric;
    #    this is the definition behind it, including the dimensions it allows.
    # Note the count against the generated package's: this endpoint lists every
    # metric the network defines, while the ontology layer generates a class only
    # for those mounted on an object type as a `metric` logic property. A metric
    # here with no class there is defined but not mounted.
    # No `kn.*` for these three: context-loader does not expose the metric,
    # action-type or concept-group definitions at all. This is the half of the
    # platform layer that only `call` reaches.
    metrics = bkn_osdk.call(f"{BASE}/{network}/metrics", query={"limit": 3})
    print(f"\n指标 {metrics.get('total_count')} 个, 定义口径:")
    for entry in entries(metrics):
        print(
            f"    {entry.get('id'):22} {entry.get('name')}  维度 {entry.get('analysis_dimensions')}"
        )

    # 6. Action types are the write surface — the ontology layer is read-only, so
    #    they appear here and nowhere in a generated package.
    actions = bkn_osdk.call(f"{BASE}/{network}/action-types", query={"limit": 3})
    print(f"\n行动类 {actions.get('total_count')} 个: {[e.get('id') for e in entries(actions)]}")

    # 7. Concept groups: how the network organises its own types, which is what
    #    `search_scope` narrows against.
    groups = bkn_osdk.call(f"{BASE}/{network}/concept-groups", query={"limit": 3})
    print(f"概念组 {groups.get('total_count')} 个: {[e.get('name') for e in entries(groups)]}")

    # 8. Searching the same definitions by natural language, rather than paging
    #    them. `search_schema` maps a question onto the types; `search_instance`
    #    goes straight to rows across whichever types are indexed. Both are
    #    capability routes, so both ride a managed turn — attached for you.
    asked = "订单和它的买家"
    hit = kn.search_schema(network, asked, max_concepts=3)
    hit = hit.get("result") or hit

    def ids(key: str) -> list[str]:
        return [t.get("concept_id") or t.get("id") for t in (hit.get(key) or [])]

    print(f"\nsearch_schema({asked!r}):")
    print(f"    对象类 {ids('object_types')}")
    print(f"    关系类 {ids('relation_types')[:4]}")

    recalled = kn.search_instance(network, asked, max_instances_per_type=1)
    recalled = recalled.get("result") or recalled
    nodes = recalled.get("nodes") or []
    if nodes:
        print(f"search_instance: 命中 {sorted({n['object_type_id'] for n in nodes})}")
    else:
        # Only properties whose `condition_operations` include `match` or `knn`
        # take part, so a network with nothing indexed recalls nothing.
        print(f"search_instance: {recalled.get('message', '没有召回到实例')}")

    # The same two reads the generator makes, and the fingerprint it derives —
    # `bkn-osdk check` compares exactly this against a package's `_meta.py`.
    from bkn_osdk.schema import fetch_schema, fingerprint

    schema = fetch_schema(bkn_osdk.resolve_context(), network)
    print(
        f"\n生成器看到的: {len(schema.object_types)} 类 / {len(schema.relation_types)} 关系"
        f" / {len(schema.metrics)} 指标 (挂在对象类上的), 指纹 {fingerprint(schema)[:12]}…"
    )


if __name__ == "__main__":
    main()
