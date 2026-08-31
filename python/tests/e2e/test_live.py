# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""What only a live platform can answer.

The unit suite pins the wire shapes against recorded payloads; this one checks
that the platform still speaks them. Every test here costs a round trip, so each
covers a contract that has actually moved or could: route names, the lifecycle
middleware, the metric time rules, the evidence receipt.

Run it against both a development VM and a staging deploy — the two have
disagreed, and finding that out is the point::

    BKN_E2E=1 BKN_E2E_KN=ecommerce_ops_bkn_public BKN_BASE_URL=https://14.103.77.23 \
      pytest tests/e2e -q
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

import bkn_osdk
from bkn_osdk import Context, HttpError, InputError, SchemaDriftError, call
from bkn_osdk.codegen.emit import GenOptions, generate
from bkn_osdk.lifecycle import _catalog, current_interaction, with_context_retry
from bkn_osdk.mcp import call_tool, tool_catalog
from bkn_osdk.schema import KnSchema, fingerprint

# ---- credentials and the escape hatch ----------------------------------------


def test_credentials_resolve_without_being_handed_a_token(context: Context) -> None:
    """The store `openbkn auth login` writes is enough — no token in the code."""
    assert context.base_url
    assert context.token


def test_the_escape_hatch_reaches_the_backend(context: Context) -> None:
    """`call()` is the way out for anything with no typed wrapper."""
    listing = call("/api/bkn-backend/v1/knowledge-networks", query={"limit": 1})

    assert isinstance(listing.get("total_count"), int)


def test_a_rejected_request_arrives_as_a_structured_error() -> None:
    with pytest.raises(HttpError) as excinfo:
        call(
            "/api/bkn-backend/v1/knowledge-networks/__no_such_network__/object-types",
            query={"branch": "main", "limit": -1},
        )

    assert excinfo.value.status >= 400
    assert excinfo.value.payload is not None


# ---- schema and generation ----------------------------------------------------


def test_the_network_parses_into_a_schema(schema: KnSchema) -> None:
    assert schema.object_types
    assert len(fingerprint(schema)) == 64


def test_generating_twice_produces_the_same_bytes(schema: KnSchema) -> None:
    """The generator is a pure function of the schema; a rerun must be a no-op diff."""
    options = GenOptions(package="live_bkn")

    assert generate(schema, options) == generate(schema, options)


def test_the_cli_generates_and_then_reports_no_drift(kn_id: str, tmp_path: Path) -> None:
    """`generate` then `check` against the live network: exit 0 twice."""
    out = tmp_path / "cli_pkg"
    generated = subprocess.run(
        [sys.executable, "-m", "bkn_osdk.codegen.cli", "generate", kn_id, "--out", str(out)],
        capture_output=True,
        text=True,
    )
    checked = subprocess.run(
        [sys.executable, "-m", "bkn_osdk.codegen.cli", "check", str(out)],
        capture_output=True,
        text=True,
    )

    assert generated.returncode == 0, generated.stderr
    assert checked.returncode == 0, checked.stdout + checked.stderr


def test_the_generated_package_type_checks_strictly(package_dir: Path) -> None:
    """Generated code is code someone will read in a diff — it holds to the same bar."""
    result = subprocess.run(
        [sys.executable, "-m", "mypy", "--strict", "--no-incremental", str(package_dir)],
        capture_output=True,
        text=True,
        cwd=package_dir.parent,
    )

    assert result.returncode == 0, result.stdout


def test_the_generated_package_imports_and_exposes_its_network(package: Any, kn_id: str) -> None:
    assert kn_id == package.KN_ID
    assert package.OBJECT_TYPES


# ---- reading instances --------------------------------------------------------


def test_counting_returns_a_number(object_type: Any) -> None:
    assert object_type.count() >= 0


def test_a_filter_and_its_negation_partition_the_rows(object_type: Any) -> None:
    """`~` rewrites to the opposite operator rather than wrapping in `not`, so the
    two halves must still add up to the whole."""
    key = getattr(object_type, object_type.__primary_key__[0])

    present = object_type.where(key.exists()).count()
    absent = object_type.where(~key.exists()).count()

    assert present + absent == object_type.count()


def test_sorting_selecting_and_taking_compose(object_type: Any) -> None:
    prop = next(
        p for p in object_type.__properties__() if p.bkn_id == object_type.__primary_key__[0]
    )
    key = getattr(object_type, prop.attribute)

    rows = object_type.where(key.exists()).order_by(key.desc()).select(key).take(3)

    assert len(rows) <= 3
    assert all(getattr(row, prop.attribute) is not None for row in rows)


def test_a_page_carries_its_offset_and_total(object_type: Any) -> None:
    page = object_type.objects().page(limit=2, offset=1, need_total=True)

    assert len(page.rows) <= 2
    assert page.total is None or page.total >= len(page.rows)


def test_iterating_walks_past_the_first_page(object_type: Any) -> None:
    """Paging is the SDK's job, not the caller's — three-row pages, seven rows asked for."""
    if object_type.count() < 7:
        pytest.skip("too few rows to cross a page boundary")

    walked = sum(1 for _ in zip(object_type.iterate(page_size=3), range(7), strict=False))

    assert walked == 7


def test_fetching_by_primary_key_returns_that_row(object_type: Any, seed: Any) -> None:
    identity = [seed.__identity__[column] for column in object_type.__primary_key__]

    assert object_type.get(*identity).__identity__ == seed.__identity__


def test_a_key_that_does_not_exist_reads_as_none(object_type: Any, seed: Any) -> None:
    """The absent value has to keep the key's own type: a string where the platform
    expects an integer is a 500 from the backend, not a miss."""
    absent = [_impossible(seed.__identity__[c]) for c in object_type.__primary_key__]

    assert object_type.get(*absent) is None


def _impossible(value: Any) -> Any:
    """A key of the same type that no row can hold."""
    if isinstance(value, bool) or not isinstance(value, int):
        return "__no_such_key__"
    return -abs(value) - 999_999_999


def test_raw_passes_a_query_through_untouched(object_type: Any) -> None:
    assert object_type.raw({"limit": 1, "need_total": True}).total is not None


def test_a_limit_outside_the_backend_range_is_refused_locally(object_type: Any) -> None:
    """Refused here rather than spent on a round trip that can only fail."""
    with pytest.raises(InputError):
        object_type.objects().page(limit=0)


# ---- decoding ------------------------------------------------------------------


def test_values_arrive_as_python_types(seed: Any) -> None:
    """A decimal that came back as a string is the case worth catching."""
    decoded: dict[str, int] = {}
    for prop in type(seed).__properties__():
        try:
            value = getattr(seed, prop.attribute)
        except SchemaDriftError:
            continue
        if value is not None:
            decoded[type(value).__name__] = decoded.get(type(value).__name__, 0) + 1

    assert decoded


def test_a_property_the_query_did_not_return_raises(object_type: Any) -> None:
    """Silently reading `None` would turn a stale package into a wrong answer."""
    prop = next(iter(object_type.__properties__()))

    with pytest.raises(SchemaDriftError):
        getattr(object_type({"__unrelated__": 1}), prop.attribute)


# ---- traversal ------------------------------------------------------------------


def test_one_hop_reads_the_target_type(package: Any, seed: Any) -> None:
    relation = next(
        (name for name, value in vars(type(seed)).items() if type(value).__name__ == "Relation"),
        None,
    )
    if relation is None:
        pytest.skip(f"{type(seed).__bkn_id__} has no outgoing relations")

    rows = getattr(seed, relation).take(2)

    assert isinstance(rows, list)  # an empty result is a data fact, not a failure


def test_two_hops_go_through_the_subgraph_route(package: Any) -> None:
    """Multi-hop is the one read with no join grammar of its own on the REST query
    route, so it goes to `subgraph` — worth proving end to end, not just in shape."""
    chain = _two_hop_chain(package)
    if chain is None:
        pytest.skip("this network has no two-hop chain with a populated start")
    start, first, second = chain

    try:
        far = first.then(second).of(start, step_limit=3)
    except HttpError as error:
        # Seeding the walk on the platform's own identity column is a by-id view
        # read, and on a catalog-backed network whose resource is missing that
        # read is a 500 no client can route around: the identity is the only
        # thing that pins the starting instance. Skipped rather than swallowed,
        # so it shows up as the deploy's gap and not as a passing test.
        if "VegaBackend.Resource.NotFound" not in (error.body or ""):
            raise
        pytest.skip(f"{package.KN_ID}: the subgraph route cannot read its own seed here")

    assert isinstance(far, list)


def _two_hop_chain(package: Any) -> tuple[Any, Any, Any] | None:
    """A start row and two relations whose whole path is actually readable.

    Object types can outlive the data resource behind them — one live network has
    a `players` type that answers every read with `VegaBackend.Resource.NotFound`
    — and a chain through one of those tests the platform's data, not this SDK.
    """
    by_id = {cls.__bkn_id__: cls for cls in package.OBJECT_TYPES}
    for one in package.RELATION_TYPES:
        for two in package.RELATION_TYPES:
            if two.source != one.target or two.target == one.source:
                continue
            source, middle, far = (by_id.get(name) for name in (one.source, one.target, two.target))
            if source is None or middle is None or far is None:
                continue
            first, second = _relation(source, one.bkn_id), _relation(middle, two.bkn_id)
            if not (first and second and _readable(middle) and _readable(far)):
                continue
            rows = source.take(1)
            if rows:
                return rows[0], first, second
    return None


def _readable(cls: Any) -> bool:
    try:
        return bool(cls.count() >= 0)
    except HttpError:
        return False


def _relation(cls: Any, bkn_id: str) -> Any:
    return next((v for v in vars(cls).values() if getattr(v, "bkn_id", None) == bkn_id), None)


# ---- metrics ---------------------------------------------------------------------


def test_a_metric_answers_for_an_instant(package: Any) -> None:
    if not package.METRICS:
        pytest.skip("this network declares no metrics")

    assert package.METRICS[0].query(time={"instant": True}) is not None


def test_a_range_without_a_step_is_refused_locally(package: Any) -> None:
    """The backend's own rule, enforced before the round trip."""
    if not package.METRICS:
        pytest.skip("this network declares no metrics")

    with pytest.raises(InputError):
        package.METRICS[0].query(time={"start": 1, "end": 2})


# ---- search ----------------------------------------------------------------------


def test_search_reaches_the_tool_the_typescript_sdk_calls(package: Any) -> None:
    """`semantic-search` was withdrawn between two deploys; `search_schema` is what
    both SDKs call, and this is the test that would have caught the withdrawal."""
    result = package.search("orders", max_concepts=1)

    assert isinstance(result, dict)
    assert "object_types" in result


def test_instance_search_answers_with_rows_or_says_it_found_none(package: Any) -> None:
    """Recall depends on which properties carry a `match`/`knn` index, so an empty
    result is a fact about the network, not a failure. What is being tested is
    that the call is accepted and shaped as the platform documents."""
    result = package.search_instances("Lionel Messi", max_instances_per_type=2)

    assert isinstance(result, dict)
    assert "nodes" in result or "message" in result


def test_the_deploy_publishes_its_tool_catalog(context: Context) -> None:
    catalog = tool_catalog(context)

    assert catalog.get("tools")


# ---- the managed lifecycle and the evidence chain -----------------------------------


def test_a_traced_read_earns_a_receipt(kn_id: str, object_type: Any) -> None:
    """The reason the MCP path exists: REST records the read server-side but hands
    back nothing to prove it."""
    with bkn_osdk.session(traced=True) as scoped:
        interaction = current_interaction(scoped, kn_id)
        page = object_type.objects().with_context(scoped).page(limit=1)

    assert interaction.interaction_id
    assert page.receipt is not None
    assert page.receipt.get("operation_id")


def test_one_scope_is_one_interaction(kn_id: str, object_type: Any) -> None:
    """Two reads in a scope are two operations on one turn, not two turns."""
    with bkn_osdk.session(traced=True) as scoped:
        object_type.objects().with_context(scoped).page(limit=1)
        object_type.objects().with_context(scoped).page(limit=1)
        interaction = current_interaction(scoped, kn_id)

    assert len(interaction.receipts) == 2
    assert len({receipt["operation_id"] for receipt in interaction.receipts}) == 2


def test_the_platform_validates_the_two_ids_it_was_given(kn_id: str, object_type: Any) -> None:
    """`bkn_context` is exactly two ids — and they must be ids the platform issued,
    which is what makes attaching one meaningful rather than decorative."""
    arguments = {
        "kn_id": kn_id,
        "ot_id": object_type.__bkn_id__,
        "limit": 1,
        "response_format": "json",
    }
    with bkn_osdk.session(traced=True) as scoped:
        real = call_tool(
            scoped,
            kn_id,
            "query_object_instance",
            {**arguments, "bkn_context": current_interaction(scoped, kn_id).bkn_context},
        )
        with pytest.raises(Exception):  # noqa: B017 — the refusal's type is the deploy's choice
            call_tool(
                scoped,
                kn_id,
                "query_object_instance",
                {
                    **arguments,
                    "bkn_context": {
                        "conversation_id": "conv_fabricated",
                        "interaction_id": "int_fabricated",
                    },
                },
            )

    assert real.value.get("datas") is not None


def test_a_host_turn_in_the_environment_is_joined_rather_than_replaced(
    kn_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """How the sandbox propagates its turn: two environment variables, no argument
    passing. A read made under them lands on the caller's interaction."""
    with bkn_osdk.session(traced=True) as scoped:
        host = current_interaction(scoped, kn_id)
        conversation_id, interaction_id = host.conversation_id, host.interaction_id

    monkeypatch.setenv("BKN_CONVERSATION_ID", conversation_id)
    monkeypatch.setenv("BKN_INTERACTION_ID", interaction_id)
    context = bkn_osdk.resolve_context()
    sent: dict[str, Any] = {}

    def send(bkn_context: dict[str, str] | None) -> Any:
        sent["context"] = bkn_context
        return call_tool(
            context,
            kn_id,
            "get_kn_detail",
            {"kn_id": kn_id, **({"bkn_context": bkn_context} if bkn_context else {})},
        )

    with_context_retry(context, kn_id, send)

    assert context.traced is False  # nothing asked for a trace; the turn was inherited
    assert sent["context"] == {
        "conversation_id": conversation_id,
        "interaction_id": interaction_id,
    }


def test_the_catalog_says_which_lifecycle_contract_this_deploy_speaks(context: Context) -> None:
    """`conversation_mode` is declared by one contract and absent in the other, so
    it is read from the catalog rather than guessed."""
    catalog = _catalog(context)

    assert "bkn_start_interaction" in catalog.tools
    assert isinstance(catalog.declares_conversation_mode, bool)


# ---- the drift gate ----------------------------------------------------------------


@pytest.mark.usefixtures("clean_registry")
def test_a_package_that_no_longer_matches_the_network_is_caught(
    kn_id: str, object_type: Any, context: Context
) -> None:
    """Opt-in, one round trip per process, and it fires on a fingerprint that moved."""
    from bkn_osdk import meta as meta_module

    meta_module.validate_package(
        "live_bkn", 1, ">=0.1,<0.2", kn_id=kn_id, branch="main", fingerprint="0" * 64
    )

    with pytest.raises(SchemaDriftError):
        object_type.objects().with_context(replace(context, check_schema=True)).take(1)
