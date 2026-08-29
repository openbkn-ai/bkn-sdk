# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The fingerprint: what it must notice, and what it must not."""

from __future__ import annotations

from dataclasses import replace

from bkn_osdk.schema import KnSchema, ObjectTypeDef, PropertyDef, RelationTypeDef, fingerprint


def people() -> ObjectTypeDef:
    return ObjectTypeDef(
        bkn_id="people",
        properties=(
            PropertyDef(bkn_id="person_id", type="string"),
            PropertyDef(bkn_id="name", type="string"),
            PropertyDef(bkn_id="age", type="integer"),
        ),
        primary_key=("person_id",),
        display_key="name",
    )


def schema(**fields: object) -> KnSchema:
    base = KnSchema(
        kn_id="kn-a3f9",
        branch="main",
        object_types=(people(),),
        relation_types=(RelationTypeDef(bkn_id="reports_to", source="people", target="people"),),
    )
    return replace(base, **fields)  # type: ignore[arg-type]


def test_fingerprint_is_stable_across_calls() -> None:
    assert fingerprint(schema()) == fingerprint(schema())


def test_fingerprint_ignores_declaration_order() -> None:
    """Order comes from whatever the platform listed first — it must not move the hash."""
    reordered = replace(
        people(),
        properties=tuple(reversed(people().properties)),
    )

    assert fingerprint(schema(object_types=(reordered,))) == fingerprint(schema())


def test_fingerprint_ignores_prose() -> None:
    described = replace(people(), description="Staff directory", display_name="人员")

    assert fingerprint(schema(object_types=(described,))) == fingerprint(schema())


def test_a_retyped_property_moves_the_fingerprint() -> None:
    retyped = replace(
        people(),
        properties=(
            PropertyDef(bkn_id="person_id", type="string"),
            PropertyDef(bkn_id="name", type="string"),
            PropertyDef(bkn_id="age", type="string"),  # was integer
        ),
    )

    assert fingerprint(schema(object_types=(retyped,))) != fingerprint(schema())


def test_a_removed_property_moves_the_fingerprint() -> None:
    trimmed = replace(people(), properties=people().properties[:2])

    assert fingerprint(schema(object_types=(trimmed,))) != fingerprint(schema())


def test_a_changed_primary_key_moves_the_fingerprint() -> None:
    recomposed = replace(people(), primary_key=("person_id", "name"))

    assert fingerprint(schema(object_types=(recomposed,))) != fingerprint(schema())


def test_a_changed_display_key_moves_the_fingerprint() -> None:
    """The display key reaches the emitted code, so the check gate has to see it move."""
    redisplayed = replace(people(), display_key="person_id")

    assert fingerprint(schema(object_types=(redisplayed,))) != fingerprint(schema())


def test_a_changed_relation_endpoint_moves_the_fingerprint() -> None:
    rehomed = (RelationTypeDef(bkn_id="reports_to", source="people", target="team"),)

    assert fingerprint(schema(relation_types=rehomed)) != fingerprint(schema())


def test_the_branch_is_part_of_the_identity() -> None:
    assert fingerprint(schema(branch="dev")) != fingerprint(schema())


def test_two_object_types_cannot_swap_their_properties_unnoticed() -> None:
    """Properties are hashed under their owner, not into one flat set."""
    a = ObjectTypeDef(bkn_id="a", properties=(PropertyDef(bkn_id="x", type="string"),))
    b = ObjectTypeDef(bkn_id="b", properties=(PropertyDef(bkn_id="y", type="integer"),))
    swapped_a = replace(a, properties=b.properties)
    swapped_b = replace(b, properties=a.properties)

    assert fingerprint(schema(object_types=(a, b))) != fingerprint(
        schema(object_types=(swapped_a, swapped_b))
    )
