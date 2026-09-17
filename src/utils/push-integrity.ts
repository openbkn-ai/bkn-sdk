// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Read only the index/binding details that a BKN push can silently lose. */
import { InputError } from "./errors.js";

interface ObjectTypeSnapshot {
  id: string;
  dataSourceId?: string;
  properties: Map<string, Set<string>>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse the platform's full object-type list, rejecting an unreadable shape. */
export function snapshotObjectTypes(value: unknown): Map<string, ObjectTypeSnapshot> {
  if (!record(value) || !Array.isArray(value.entries)) {
    throw new InputError(
      "Cannot verify BKN push integrity: object-type list has no entries array.",
    );
  }
  const out = new Map<string, ObjectTypeSnapshot>();
  for (const entry of value.entries) {
    if (!record(entry) || typeof entry.id !== "string" || !entry.id) {
      throw new InputError("Cannot verify BKN push integrity: object-type list has an invalid id.");
    }
    if (out.has(entry.id)) {
      throw new InputError(
        `Cannot verify BKN push integrity: duplicate object-type id '${entry.id}'.`,
      );
    }
    const properties = new Map<string, Set<string>>();
    // bkn-backend serializes data_properties with `omitempty`: an object type
    // with no data properties omits the key, which means an empty list.
    const dataProperties = Object.hasOwn(entry, "data_properties") ? entry.data_properties : [];
    if (!Array.isArray(dataProperties)) {
      throw new InputError(
        `Cannot verify BKN push integrity: object type '${entry.id}' has invalid data_properties.`,
      );
    }
    for (const property of dataProperties) {
      if (!record(property) || typeof property.name !== "string" || !property.name) {
        throw new InputError(
          `Cannot verify BKN push integrity: object type '${entry.id}' has an invalid property.`,
        );
      }
      if (
        property.condition_operations !== undefined &&
        (!Array.isArray(property.condition_operations) ||
          !property.condition_operations.every((op: unknown) => typeof op === "string"))
      ) {
        throw new InputError(
          `Cannot verify BKN push integrity: object type '${entry.id}' property '${property.name}' has invalid condition_operations.`,
        );
      }
      properties.set(
        property.name,
        new Set((property.condition_operations as string[] | undefined) ?? []),
      );
    }
    if (!Object.hasOwn(entry, "data_source")) {
      throw new InputError(
        `Cannot verify BKN push integrity: object type '${entry.id}' has invalid data_source.`,
      );
    }
    const source = entry.data_source;
    if (source !== null && (!record(source) || typeof source.id !== "string" || !source.id)) {
      throw new InputError(
        `Cannot verify BKN push integrity: object type '${entry.id}' has invalid data_source.`,
      );
    }
    out.set(entry.id, {
      id: entry.id,
      dataSourceId: record(source) ? (source.id as string) : undefined,
      properties,
    });
  }
  return out;
}

/**
 * One warning per lost binding or property, naming the object type and operator.
 * With `bindingPolicy: "detach"` a dropped binding and its operators are expected.
 */
export function lostIndexWarnings(
  before: Map<string, ObjectTypeSnapshot>,
  after: Map<string, ObjectTypeSnapshot>,
  opts: { bindingPolicy?: "preserve" | "detach" } = {},
): string[] {
  // `--binding-policy detach` asks the import to drop environment-local
  // bindings, so a binding that is gone afterwards — and the index operators
  // that went with it — is the requested outcome, not a loss to report.
  const detach = opts.bindingPolicy === "detach";
  const warnings: string[] = [];
  for (const [id, earlier] of before) {
    const later = after.get(id);
    if (!later) {
      if (earlier.dataSourceId || [...earlier.properties.values()].some((ops) => ops.size > 0)) {
        warnings.push(
          `Object type '${id}' disappeared after push; its binding/index state was not preserved.`,
        );
      }
      continue;
    }
    const detached = detach && earlier.dataSourceId !== undefined && !later.dataSourceId;
    if (detached) continue;
    if (earlier.dataSourceId && !later.dataSourceId) {
      warnings.push(`Object type '${id}' lost its data_source binding after push.`);
    } else if (
      earlier.dataSourceId &&
      later.dataSourceId &&
      earlier.dataSourceId !== later.dataSourceId
    ) {
      warnings.push(
        `Object type '${id}' changed its data_source binding after push: ${earlier.dataSourceId} -> ${later.dataSourceId}.`,
      );
    }
    for (const [name, ops] of earlier.properties) {
      const newOps = later.properties.get(name) ?? new Set<string>();
      const lost = [...ops].filter((op) => !newOps.has(op));
      if (lost.length > 0) {
        warnings.push(
          `Object type '${id}' property '${name}' lost condition_operations after push: ${lost.join(", ")}.`,
        );
      }
    }
  }
  return warnings;
}
