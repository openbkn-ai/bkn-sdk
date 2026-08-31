# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Classifying schema drift, so `check` says more than "different".

The fingerprint answers *whether* a schema moved. This answers *how*, in the
terms a caller feels it:

- **Additive** — a new object type, a new property. Existing code keeps working.
- **Breaking** — a property removed or retyped, an object type removed, a
  primary key changed. Existing code breaks at the attribute or in `mypy`.

Comparison happens on the emitted view (Python names and annotations), not on
the raw schema, because that is the surface user code actually touches:
`string` becoming `text` moves the fingerprint but changes nothing a caller can
observe, and reporting it as a break would train people to ignore the gate.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..schema import KnSchema
from .emit import TYPE_MAP, class_name, property_name

__all__ = ["Delta", "PackageView", "compare", "view_of_schema"]


@dataclass(frozen=True)
class PackageView:
    """What a generated package exposes: class name -> (annotation by attribute, key)."""

    object_types: dict[str, dict[str, str]] = field(default_factory=dict)
    primary_keys: dict[str, tuple[str, ...]] = field(default_factory=dict)


@dataclass(frozen=True)
class Delta:
    added_object_types: tuple[str, ...] = ()
    removed_object_types: tuple[str, ...] = ()
    added_properties: tuple[str, ...] = ()
    removed_properties: tuple[str, ...] = ()
    retyped_properties: tuple[str, ...] = ()
    changed_primary_keys: tuple[str, ...] = ()

    @property
    def breaking(self) -> tuple[str, ...]:
        """Everything that breaks code already written against the old package."""
        return (
            *(f"object type removed: {name}" for name in self.removed_object_types),
            *(f"property removed: {name}" for name in self.removed_properties),
            *(f"property retyped: {name}" for name in self.retyped_properties),
            *(f"primary key changed: {name}" for name in self.changed_primary_keys),
        )

    @property
    def additive(self) -> tuple[str, ...]:
        return (
            *(f"object type added: {name}" for name in self.added_object_types),
            *(f"property added: {name}" for name in self.added_properties),
        )

    def __bool__(self) -> bool:
        return bool(self.breaking or self.additive)


def view_of_schema(schema: KnSchema) -> PackageView:
    """What the generator *would* emit for this schema, without emitting it."""
    object_types: dict[str, dict[str, str]] = {}
    primary_keys: dict[str, tuple[str, ...]] = {}
    for object_type in schema.object_types:
        name = class_name(object_type.bkn_id)
        object_types[name] = {
            property_name(prop.bkn_id, object_type.bkn_id): TYPE_MAP.get(prop.type, "Any")
            for prop in object_type.properties
        }
        primary_keys[name] = object_type.primary_key
    return PackageView(object_types=object_types, primary_keys=primary_keys)


def compare(installed: PackageView, live: PackageView) -> Delta:
    """What moved between the generated package and the live schema."""
    installed_names = set(installed.object_types)
    live_names = set(live.object_types)

    added_properties: list[str] = []
    removed_properties: list[str] = []
    retyped_properties: list[str] = []
    changed_keys: list[str] = []

    for name in sorted(installed_names & live_names):
        before, after = installed.object_types[name], live.object_types[name]
        added_properties += [f"{name}.{attr}" for attr in sorted(set(after) - set(before))]
        removed_properties += [f"{name}.{attr}" for attr in sorted(set(before) - set(after))]
        retyped_properties += [
            f"{name}.{attr}: {before[attr]} -> {after[attr]}"
            for attr in sorted(set(before) & set(after))
            if before[attr] != after[attr]
        ]
        if installed.primary_keys.get(name, ()) != live.primary_keys.get(name, ()):
            changed_keys.append(name)

    return Delta(
        added_object_types=tuple(sorted(live_names - installed_names)),
        removed_object_types=tuple(sorted(installed_names - live_names)),
        added_properties=tuple(added_properties),
        removed_properties=tuple(removed_properties),
        retyped_properties=tuple(retyped_properties),
        changed_primary_keys=tuple(changed_keys),
    )
