# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Multi-hop traversal over the REST subgraph endpoint.

Recorded from `https://10.211.55.4` on 2026-08-29: the seed-based request shape
answers with a pool of objects keyed by instance id — properties nested one level
down — plus every path it walked, each naming the relation ids in order. That
last part is what lets a specific chain be selected out of a breadth-first walk.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from bkn_osdk import InputError, session
from bkn_osdk import http as http_module
from bkn_osdk.subgraph import RelationPath
from bkn_osdk.types import ObjectType, Property, Relation

KN = "worldcup_vega_catalog_bkn"
PLATFORM = "https://platform.example"


class Confederations(ObjectType):
    __kn_id__ = KN
    __bkn_id__ = "confederations"
    __primary_key__ = ("key_id",)

    key_id = Property[str]("key_id")
    confederation_name = Property[str]("confederation_name")


class Teams(ObjectType):
    __kn_id__ = KN
    __bkn_id__ = "teams"
    __primary_key__ = ("key_id",)

    key_id = Property[str]("key_id")

    confederation = Relation["Confederations"](
        "rel_teams_confederation",
        target="confederations",
        join=(("confederation_id", "confederation_id"),),
    )


class AwardWinners(ObjectType):
    __kn_id__ = KN
    __bkn_id__ = "award_winners"
    __primary_key__ = ("key_id",)

    key_id = Property[str]("key_id")
    team_id = Property[str]("team_id")

    team = Relation["Teams"](
        "rel_award_winners_team", target="teams", join=(("team_id", "team_id"),)
    )
    tournament = Relation["Confederations"](
        "rel_award_winners_tournament", target="confederations", join=(("t_id", "t_id"),)
    )


def walked(*relation_ids: str, target: str) -> dict[str, Any]:
    """One path the server reports, as a sequence of relation hops."""
    return {
        "length": len(relation_ids),
        "relations": [
            {"relation_type_id": rid, "source_object_id": "x", "target_object_id": target}
            for rid in relation_ids
        ],
    }


def obj(instance_id: str, object_type: str, **properties: Any) -> dict[str, Any]:
    return {
        "_instance_id": instance_id,
        "_instance_identity": {"key_id": instance_id.rsplit("-", 1)[-1]},
        "_display": properties.get("confederation_name"),
        "object_type_id": object_type,
        "properties": {"key_id": instance_id.rsplit("-", 1)[-1], **properties},
    }


SUBGRAPH = {
    "objects": {
        "confederations-4": obj("confederations-4", "confederations", confederation_name="UEFA"),
        "confederations-9": obj("confederations-9", "confederations", confederation_name="AFC"),
        "teams-3": obj("teams-3", "teams"),
    },
    "relation_paths": [
        # The chain we asked for.
        walked("rel_award_winners_team", "rel_teams_confederation", target="confederations-4"),
        # Same far object by another route — it must come back once.
        walked("rel_award_winners_team", "rel_teams_confederation", target="confederations-4"),
        # A different chain of the same length, and a shorter one: both ignored.
        walked("rel_award_winners_tournament", "rel_x", target="confederations-9"),
        walked("rel_award_winners_team", target="teams-3"),
    ],
    "current_path_number": 4,
}


class Deploy:
    def __init__(self, payload: dict[str, Any] | None = None) -> None:
        self.payload = SUBGRAPH if payload is None else payload
        self.paths: list[str] = []
        self.bodies: list[dict[str, Any]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        self.bodies.append(json.loads(request.read()))
        return httpx.Response(200, json=self.payload)


@pytest.fixture
def deploy(monkeypatch: pytest.MonkeyPatch) -> Deploy:
    stub = Deploy()
    client = httpx.Client(transport=httpx.MockTransport(stub.handle))
    monkeypatch.setattr(http_module, "_client", lambda _ctx: client)
    monkeypatch.setenv("BKN_BASE_URL", PLATFORM)
    monkeypatch.setenv("BKN_TOKEN", "t-1")
    return stub


def seed() -> AwardWinners:
    return AwardWinners(
        {
            "key_id": "1",
            "team_id": "T-36",
            "_instance_id": "award_winners-1",
            "_instance_identity": {"key_id": "1"},
        }
    )


# ---- building the path -------------------------------------------------------


def test_chaining_two_relations_makes_a_path() -> None:
    path = AwardWinners.team.then(Teams.confederation)

    assert isinstance(path, RelationPath)
    assert [step.bkn_id for step in path.steps] == [
        "rel_award_winners_team",
        "rel_teams_confederation",
    ]


def test_one_hop_stays_a_filter_and_never_reaches_this_module() -> None:
    """A single hop is an ordinary query on the target; no walk, no filtering."""
    from bkn_osdk.query import ObjectSet

    assert isinstance(seed().team, ObjectSet)


def test_a_path_with_no_hops_is_refused() -> None:
    with pytest.raises(InputError, match="at least one hop"):
        RelationPath(()).of(seed())


def test_a_path_longer_than_the_endpoint_walks_is_refused() -> None:
    """The backend answers "路径长度必须在 1 到 3 之间"; say so before the round trip."""
    path = AwardWinners.team.then(Teams.confederation).then(AwardWinners.team)
    path = path.then(AwardWinners.team)

    with pytest.raises(InputError, match="at most 3 hops"):
        path.of(seed())


# ---- the request -------------------------------------------------------------


def test_the_walk_goes_to_the_rest_subgraph_endpoint(deploy: Deploy) -> None:
    AwardWinners.team.then(Teams.confederation).of(seed())

    assert deploy.paths == [f"/api/ontology-query/v1/knowledge-networks/{KN}/subgraph"]


def test_the_walk_is_seeded_on_the_starting_instance(deploy: Deploy) -> None:
    AwardWinners.team.then(Teams.confederation).of(seed())

    body = deploy.bodies[0]
    assert body["source_object_type_id"] == "award_winners"
    assert body["condition"] == {
        "operation": "==",
        "field": "key_id",
        "value": "1",
        "value_from": "const",
    }
    # One seed: the condition already pins it, and a larger cap only widens the walk.
    assert body["limit"] == 1


def test_the_path_length_is_the_number_of_hops(deploy: Deploy) -> None:
    AwardWinners.team.then(Teams.confederation).of(seed())

    assert deploy.bodies[0]["path_length"] == 2
    assert deploy.bodies[0]["direction"] == "forward"


def test_json_is_asked_for(deploy: Deploy) -> None:
    AwardWinners.team.then(Teams.confederation).of(seed())

    assert deploy.bodies[0]["response_format"] == "json"


def test_no_managed_session_is_opened_for_a_walk(deploy: Deploy) -> None:
    """The whole point of moving off the MCP tool: a walk is an ordinary read."""
    AwardWinners.team.then(Teams.confederation).of(seed())

    assert len(deploy.bodies) == 1
    assert "bkn_context" not in deploy.bodies[0]


def test_a_traced_scope_does_not_change_the_transport(deploy: Deploy) -> None:
    with session(traced=True):
        AwardWinners.team.then(Teams.confederation).of(seed())

    assert deploy.paths[0].endswith("/subgraph")


def test_an_instance_without_an_identity_cannot_start_a_path(deploy: Deploy) -> None:
    handmade = AwardWinners({"key_id": "1"})

    with pytest.raises(InputError, match="no identity"):
        AwardWinners.team.then(Teams.confederation).of(handmade)


# ---- the response ------------------------------------------------------------


def test_only_the_requested_chain_comes_back(deploy: Deploy) -> None:
    """The seed-based walk explores every relation; the chain is selected here."""
    far = AwardWinners.team.then(Teams.confederation).of(seed())

    assert [row.__instance_id__ for row in far] == ["confederations-4"]


def test_the_far_end_is_typed_and_flattened(deploy: Deploy) -> None:
    """A subgraph object nests its properties; an instance query does not."""
    far = AwardWinners.team.then(Teams.confederation).of(seed())

    assert isinstance(far[0], Confederations)
    assert far[0].confederation_name == "UEFA"
    assert far[0].__identity__ == {"key_id": "4"}


def test_an_object_reached_by_several_paths_appears_once(deploy: Deploy) -> None:
    far = AwardWinners.team.then(Teams.confederation).of(seed())

    assert len(far) == 1


def test_a_shorter_or_different_chain_is_ignored(deploy: Deploy) -> None:
    """Paths of the right length but the wrong relations must not leak in."""
    far = AwardWinners.team.then(Teams.confederation).of(seed())

    assert all(row.__instance_id__ != "confederations-9" for row in far)


def test_step_limit_caps_what_comes_back(deploy: Deploy) -> None:
    payload = {
        "objects": {
            "confederations-4": obj(
                "confederations-4", "confederations", confederation_name="UEFA"
            ),
            "confederations-5": obj("confederations-5", "confederations", confederation_name="CAF"),
        },
        "relation_paths": [
            walked("rel_award_winners_team", "rel_teams_confederation", target="confederations-4"),
            walked("rel_award_winners_team", "rel_teams_confederation", target="confederations-5"),
        ],
    }
    deploy.payload = payload

    far = AwardWinners.team.then(Teams.confederation).of(seed(), step_limit=1)

    assert len(far) == 1


def test_a_far_end_filter_is_applied_locally(deploy: Deploy) -> None:
    """The endpoint filters only its starting type, so `where` is honoured here."""
    payload = {
        "objects": {
            "confederations-4": obj(
                "confederations-4", "confederations", confederation_name="UEFA"
            ),
            "confederations-5": obj("confederations-5", "confederations", confederation_name="CAF"),
        },
        "relation_paths": [
            walked("rel_award_winners_team", "rel_teams_confederation", target="confederations-4"),
            walked("rel_award_winners_team", "rel_teams_confederation", target="confederations-5"),
        ],
    }
    deploy.payload = payload

    far = (
        AwardWinners.team.then(Teams.confederation)
        .where(Confederations.confederation_name == "CAF")
        .of(seed())
    )

    assert [row.confederation_name for row in far] == ["CAF"]


def test_a_filter_that_cannot_be_evaluated_locally_says_so(deploy: Deploy) -> None:
    """Silently dropping rows would be worse than refusing the filter."""
    with pytest.raises(InputError, match="cannot be evaluated on a walked path"):
        (
            AwardWinners.team.then(Teams.confederation)
            .where(Confederations.confederation_name.like("UE"))
            .of(seed())
        )


def test_an_empty_walk_is_an_empty_list(deploy: Deploy) -> None:
    deploy.payload = {"objects": {}, "relation_paths": []}

    assert AwardWinners.team.then(Teams.confederation).of(seed()) == []
