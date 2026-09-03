// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * `bkn create-from-catalog` orchestration. Build a knowledge network from a
 * Vega catalog's tables:
 *   1. list catalog tables (scan/discover once if empty) + introspect columns
 *   2. resolve a single PK per table (override → schema → sample cardinality);
 *      fail-fast rather than silently pick a wrong key (legacy #97)
 *   3. reuse the discovered vega table resources (physical resources are not
 *      created through REST anymore)
 *   4. create the KN, then batch-create object types (all-or-nothing)
 *   5. optional build: one Vega BuildTask per resource (index build lives on the
 *      catalog/resource now — there is no KN-level build)
 * Any failure after the KN is created rolls it back (cascades to OTs) unless
 * `noRollback` is set.
 */
import {
  createKnowledgeNetwork,
  createObjectTypes,
  deleteKnowledgeNetwork,
} from "../api/knowledge-networks.js";
import { resolveSmallModelName } from "../api/models.js";
import {
  configureResourceIndex,
  firstResource,
  getResource,
  listResources,
  queryResource,
} from "../api/resources.js";
import { discoverCatalog, getDiscoverTask } from "../api/vega-discovery.js";
import { createBuildTask, firstCatalog, getCatalog } from "../api/vega.js";
import type { RequestContext } from "../types.js";
import { HttpError, InputError, NonJsonResponseError, formatError } from "../utils/errors.js";
import {
  type TableColumn,
  type TableInfo,
  detectDisplayKey,
  formatPkDetectionError,
  resolvePrimaryKey,
} from "../utils/pk-detection.js";

export interface CreateFromCatalogOptions {
  catalogId: string;
  name: string;
  tables?: string[];
  /**
   * What an unmatched `tables` entry means. `error` (the default) suits a
   * user-typed `--tables`; `skip` suits a list this SDK derived itself, where a
   * missing table means catalog discovery lagged rather than a wrong name.
   *
   * The names skipped this way also become the only `pkMap` / `embeddingFields`
   * keys allowed to be dropped — every other unresolvable key stays fatal, so a
   * typo can never quietly turn a PK override back into a guess.
   */
  missingTables?: "error" | "skip";
  /**
   * Table names the caller knows are absent from the catalog for a reason it
   * already reported — a CSV whose import failed.
   *
   * Unlike `missingTables`, these are forgiven regardless of that setting: an
   * entry naming one is dropped from `tables`, `pkMap` and `embeddingFields`
   * alike, even when `tables` was typed by hand. Failing on a name this run
   * just reported would strand whatever it did manage to write.
   */
  absentTables?: string[];
  pkMap?: Record<string, string>;
  build?: boolean;
  /** Per-table resource columns to vectorize (sets resource schema index features). */
  embeddingFields?: Record<string, string[]>;
  embeddingModel?: string;
  noRollback?: boolean;
  /** Pre-fetched row samples per table (e.g. from a CSV import) for PK detection. */
  sampleRows?: Record<string, Array<Record<string, string | null>>>;
  onProgress?: (msg: string) => void;
}

const DISCOVER_TASK_TIMEOUT_MS = 120_000;
const DISCOVER_TASK_POLL_INTERVAL_MS = 2_000;

/** Chunk a list so a fan-out reads a bounded number of resources at a time. */
function splitBatches<T>(rows: T[], batchSize: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) out.push(rows.slice(i, i + batchSize));
  return out;
}

async function discoverCatalogAndWait(ctx: RequestContext, catalogId: string): Promise<void> {
  const { id: taskId } = await discoverCatalog(ctx, catalogId);
  const deadline = Date.now() + DISCOVER_TASK_TIMEOUT_MS;
  for (;;) {
    const task = await getDiscoverTask(ctx, taskId);
    if (task.status === "completed") return;
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(
        `Catalog discovery task ${taskId} ${task.status}${task.message ? `: ${task.message}` : ""}.`,
      );
    }
    if (task.status !== "pending" && task.status !== "running") {
      throw new Error(
        `Catalog discovery task ${taskId} ended in unexpected status "${task.status}".`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(`Catalog discovery task ${taskId} did not complete within 120 seconds.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, DISCOVER_TASK_POLL_INTERVAL_MS));
  }
}

/**
 * Stamped onto the error `createFromCatalog` throws when the run left a
 * knowledge network behind — either because `noRollback` was set or because the
 * rollback delete was refused for a reason that leaves it standing.
 *
 * Absent means no *network* was left, and only that: every input check runs
 * before the network is created, so most failures create nothing at all. It
 * says nothing about the `build` loop, whose per-table index config and build
 * tasks live on Vega resources outside the network and are never rolled back.
 *
 * Part of what this function throws, so callers may read it to tell the user
 * what to clean up. Deliberately a plain property rather
 * than a new error class: it is one fact about one call, and wrapping the error
 * would cost its type — an `HttpError` here still has to arrive as one.
 */
export interface PartialKnMarked {
  partialKnId?: string;
}

interface ResourceDetail {
  id?: string;
  name?: string;
  source_metadata?: { columns?: Array<Record<string, unknown>> };
  schema_definition?: Array<{ name?: unknown }>;
  primary_keys?: unknown;
}

/**
 * Property names a resource's index features may reference.
 *
 * Deliberately read off `schema_definition`, not `source_metadata.columns`:
 * those are two different lists, and `ensureFeature` matches against the former.
 * Validating against the latter would pass names the write then rejects.
 */
function featureFields(detail: ResourceDetail): string[] {
  return (detail.schema_definition ?? [])
    .map((p) => String(p?.name ?? ""))
    .filter((n) => n.length > 0);
}

function columnIsPk(col: Record<string, unknown>): boolean {
  if (col.is_primary_key === true) return true;
  return typeof col.column_key === "string" && col.column_key.toUpperCase() === "PRI";
}

function toTableInfo(detail: ResourceDetail): TableInfo {
  const raw = detail.source_metadata?.columns ?? [];
  const tablePks = Array.isArray(detail.primary_keys)
    ? (detail.primary_keys.filter((x) => typeof x === "string") as string[])
    : [];
  const columns: TableColumn[] = raw.map((c) => {
    const name = String(c.name ?? c.field_name ?? "");
    const flagged = columnIsPk(c) || tablePks.includes(name);
    return {
      name,
      type: String(c.type ?? c.field_type ?? "varchar"),
      ...(flagged ? { isPrimaryKey: true } : {}),
    };
  });
  const pks =
    tablePks.length > 0 ? tablePks : columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  return {
    name: String(detail.name ?? ""),
    columns,
    ...(pks.length > 0 ? { primaryKeys: pks } : {}),
  };
}

/**
 * Resource details read at once. Matches the backend's own default page size —
 * the bound this fan-out used to inherit from it, before the listing started
 * asking for every table.
 */
const DETAIL_READ_BATCH = 20;

const bareName = (n: string) => n.slice(n.lastIndexOf(".") + 1);
const sameTable = (a: string, b: string) => bareName(a).toLowerCase() === bareName(b).toLowerCase();

/**
 * Why a table key did not resolve. Only `unknown` is ever forgiven: an absent
 * name can be one the run already reported, but a name matching two catalog
 * entries is a condition no retry or re-discover clears, and dropping it would
 * silently leave a table out of the network.
 *
 * An `InputError` because that is what it is — the user's flag naming something
 * that is not there — which also gives it the exit code every other bad-input
 * failure on this path uses.
 */
class TableKeyError extends InputError {
  readonly kind: "unknown" | "ambiguous" | "duplicate";

  constructor(kind: "unknown" | "ambiguous" | "duplicate", message: string) {
    super(message);
    this.name = "TableKeyError";
    this.kind = kind;
  }
}

/**
 * Canonical catalog table name for a user-supplied key, or a throw naming the
 * tables that actually exist. Vega may list a bare table name or a
 * schema-qualified one, and users copy whichever their database shows them
 * (`yanfeng_kb.document` vs `document`), so match on the bare name in both
 * directions — case-insensitively, since PG/Oracle fold identifiers on
 * read-back. An exact hit always wins, and an ambiguous loose hit is reported
 * rather than picked. Never fail with an "unknown table" that lists no known
 * tables.
 */
function resolveTableKey(names: string[], key: string, flag: string, catalog?: string[]): string {
  const exact = names.filter((n) => n === key);
  if (exact.length === 1) return exact[0] as string;
  const hits = exact.length > 0 ? exact : names.filter((n) => sameTable(n, key));
  if (hits.length === 1) return hits[0] as string;
  if (hits.length > 1) {
    throw new TableKeyError(
      "ambiguous",
      `${flag} '${key}' matches several tables (${hits.join(", ")}). Use the exact name.`,
    );
  }
  // When the run is narrower than the catalog, say so: naming only the selected
  // tables reads as "your table does not exist" for one that plainly does.
  const unselected = (catalog ?? []).filter((n) => !names.includes(n));
  const also = unselected.length
    ? ` The catalog also has ${unselected.join(", ")} — add it with --tables to use it here.`
    : "";
  throw new TableKeyError(
    "unknown",
    `${flag} references unknown table '${key}'. Tables in this run: ${names.join(", ") || "(none)"}.${also}`,
  );
}

/**
 * Re-key a per-table option map onto canonical table names. Two keys that
 * normalize to the same table are reported, not silently collapsed — last-write
 * wins would drop a value the caller can see no trace of.
 *
 * `skippable` names the keys allowed to be dropped (through `onSkip`) instead
 * of throwing — the tables a caller-derived list knows were imported but not
 * yet registered. Everything else still fails the run: a misspelled
 * `--pk-map documnet:id` must not quietly become "no override", or PK detection
 * goes back to guessing the key it exists to never guess (see pk-detection).
 * `"any"` is for genuinely best-effort maps, where a miss costs a fallback.
 */
function canonicalizeTableMap<T>(
  map: Record<string, T> | undefined,
  names: string[],
  flag: string,
  opts: {
    skippable?: string[] | "any";
    catalog?: string[];
    onSkip?: (key: string, reason: string) => void;
  } = {},
): Record<string, T> {
  const skippable = opts.skippable;
  const maySkip = (key: string, e: unknown) => {
    if (skippable === "any") return true;
    // A name the run already reported may be dropped; ambiguity and duplicates
    // are conditions the caller must resolve, whatever the table's state.
    if (!(e instanceof TableKeyError) || e.kind !== "unknown") return false;
    return (skippable ?? []).some((n) => sameTable(n, key));
  };
  const out: Record<string, T> = {};
  const origin: Record<string, string> = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    let canonical: string;
    try {
      canonical = resolveTableKey(names, key, flag, opts.catalog);
      const prev = origin[canonical];
      if (prev !== undefined && prev !== key) {
        throw new TableKeyError(
          "duplicate",
          `${flag} has two entries for table '${canonical}' ('${prev}' and '${key}') — keep one.`,
        );
      }
    } catch (e) {
      if (!maySkip(key, e)) throw e;
      opts.onSkip?.(key, e instanceof Error ? e.message : String(e));
      continue;
    }
    origin[canonical] = key;
    out[canonical] = value;
  }
  return out;
}

/** Best-effort row sample for cardinality-based PK detection. */
async function sampleRows(
  ctx: RequestContext,
  resourceId: string,
): Promise<Array<Record<string, string | null>>> {
  try {
    const res = await queryResource(ctx, resourceId, { limit: 100 });
    return Array.isArray(res.entries) ? (res.entries as Array<Record<string, string | null>>) : [];
  } catch {
    return [];
  }
}

export async function createFromCatalog(
  ctx: RequestContext,
  opts: CreateFromCatalogOptions,
): Promise<unknown> {
  const log = opts.onProgress ?? (() => {});
  // Validate the embedding model before anything is written. Resolution lives
  // inside `configureResourceIndex`, i.e. step 5 — after the KN and its object
  // types exist — so a bad id used to cost the whole run plus a rollback. Doing
  // it here also means the build loop resolves once rather than once per table
  // (a resolved name is not numeric, so the inner call short-circuits).
  const embeddingModel =
    opts.build && opts.embeddingModel
      ? await resolveSmallModelName(ctx, opts.embeddingModel)
      : opts.embeddingModel;

  // 1. List catalog tables, scanning once if the catalog is empty.
  //    `limit: -1` (NO_LIMIT), not the backend's default page: this list
  //    decides which tables become object types AND is the source of every
  //    "tables in this run" message below, so a truncated page would drop the
  //    21st table from the network without a word and then deny it exists.
  const listTables = () =>
    listResources(ctx, { catalogId: opts.catalogId, category: "table", limit: -1 }).then(
      (result) => result.entries,
    );
  let summaries = await listTables();
  if (summaries.length === 0) {
    log("No tables found; scanning catalog metadata...");
    await discoverCatalogAndWait(ctx, opts.catalogId);
    summaries = await listTables();
  }
  if (summaries.length === 0) throw new Error("No tables available in catalog after scan.");

  // Resolve full column metadata per summary. The detail response carries the
  // same `{entries:[…]}` envelope as the list — unwrap it, or every table ends
  // up nameless and column-less and only fails much later, in PK detection.
  //
  // In batches, not one `Promise.all` over the catalog: the default page
  // dropped above was also what kept this fan-out small, and a few hundred
  // simultaneous reads earn a rate-limit or a pool timeout whose message says
  // nothing about how many tables were asked for at once.
  const readDetail = async (s: unknown) => {
    const summary = s as { id?: string; name?: string };
    const detail = summary.id
      ? firstResource<ResourceDetail>(await getResource(ctx, summary.id))
      : (summary as ResourceDetail);
    const info = toTableInfo(detail);
    return {
      ...info,
      name: info.name || String(summary.name ?? ""),
      resourceId: summary.id,
      featureFields: featureFields(detail),
    };
  };
  const details: Array<Awaited<ReturnType<typeof readDetail>>> = [];
  for (const batch of splitBatches(summaries, DETAIL_READ_BATCH)) {
    details.push(...(await Promise.all(batch.map(readDetail))));
  }
  const allNames = details.map((table) => table.name);

  // Filter to --tables if given; accept schema-qualified names. Two kinds of
  // miss are forgiven: any miss under a caller-derived list (the CSV path,
  // where a table the catalog has not registered yet is a lagging scan rather
  // than a typo), and — even for a hand-typed --tables — a name this run has
  // already reported as absent, since failing on it would strand rows already
  // written over something the user was told about. Ambiguity is never
  // forgiven: no retry clears it, and dropping it loses a table in silence.
  const absent = opts.absentTables ?? [];
  const missing: string[] = [];
  const selected = new Set<string>();
  for (const key of opts.tables ?? []) {
    try {
      selected.add(resolveTableKey(allNames, key, "--tables", undefined));
    } catch (e) {
      const forgivable =
        e instanceof TableKeyError &&
        e.kind === "unknown" &&
        (opts.missingTables === "skip" || absent.some((n) => sameTable(n, key)));
      if (!forgivable) throw e;
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    log(`Skipping ${missing.length} table(s) not in the catalog: ${missing.join(", ")}.`);
  }
  const targets = opts.tables?.length ? details.filter((t) => selected.has(t.name)) : details;
  if (targets.length === 0) {
    throw new Error(
      `No matching tables to build from.${missing.length ? ` Not in the catalog: ${missing.join(", ")}.` : ""}`,
    );
  }
  const targetNames = targets.map((t) => t.name);

  // Validate --pk-map / --embedding-fields references BEFORE any side effect.
  // Only the names already skipped above may be dropped here: those tables are
  // imported-but-not-yet-registered, and failing on them would strand rows
  // already written. A key naming anything else is a typo and stays fatal —
  // silently dropping a PK override hands the key back to detection, which is
  // the guess this whole path exists to avoid.
  const dropKey = (flag: string) => (key: string, reason: string) =>
    log(`Dropping ${flag} entry '${key}': ${reason}`);
  const skippable = [...missing, ...absent];
  const pkMap = canonicalizeTableMap(opts.pkMap, targetNames, "--pk-map", {
    skippable,
    catalog: allNames,
    onSkip: dropKey("--pk-map"),
  });
  const embeddingFields = canonicalizeTableMap(
    opts.embeddingFields,
    targetNames,
    "--embedding-fields",
    { skippable, catalog: allNames, onSkip: dropKey("--embedding-fields") },
  );
  // Its column names too: `ensureFeature` is the only thing that checks them,
  // and it runs in step 5 — so a typo used to surface after the import, the KN
  // and its object types, with the earlier tables' writes already landed and
  // not rolled back. Compare against `schema_definition`, which is what
  // `ensureFeature` matches; `columns` is a different list.
  if (opts.build) {
    for (const t of targets) {
      const fields = embeddingFields[t.name];
      if (!fields?.length || t.featureFields.length === 0) continue;
      const unknown = fields.filter((f) => !t.featureFields.includes(f));
      if (unknown.length > 0) {
        throw new InputError(
          [
            `--embedding-fields names ${unknown.join(", ")} on table '${t.name}',`,
            "which its Vega resource does not expose.",
            `Indexable fields: ${t.featureFields.join(", ")}.`,
          ].join(" "),
        );
      }
    }
  }
  // Always best-effort: a sample keyed off a name the catalog does not use
  // falls back to a live query rather than failing the run.
  const providedSamples = canonicalizeTableMap(opts.sampleRows, targetNames, "sampleRows", {
    skippable: "any",
  });
  // Keyed by resource id, not name: two schemas may hold the same table name,
  // and a name-keyed map would hand the second table the first one's key.
  const tablePk = new Map<string, string>();
  for (const t of targets) {
    // No columns means the resource carries no introspected schema — say that,
    // rather than letting detection report it as a sampling problem.
    if (t.columns.length === 0) {
      throw new Error(
        [
          `Table '${t.name}' has no column metadata on its Vega resource (${t.resourceId ?? "?"}).`,
          "Re-run `openbkn vega catalog discover` for this catalog and retry.",
        ].join(" "),
      );
    }
    const override = pkMap[t.name];
    if (override && !t.columns.some((c) => c.name === override)) {
      throw new InputError(
        `--pk-map '${override}' for table '${t.name}' is not a column. ` +
          `Columns: ${t.columns.map((c) => c.name).join(", ")}`,
      );
    }
    // Prefer caller-supplied samples (CSV import) for cardinality detection.
    let res = resolvePrimaryKey(t, providedSamples[t.name], override);
    if (res.pk === null && res.source === "sample") {
      // Fall back to a live row sample.
      const rows = t.resourceId ? await sampleRows(ctx, t.resourceId) : [];
      res = resolvePrimaryKey(t, rows, override);
    }
    if (res.source === "ambiguous") {
      throw new InputError(
        `Table '${t.name}' has a composite primary key (${(res.ambiguous ?? []).join(", ")}). ` +
          `BKN object types take one key — pick with --pk-map ${t.name}:<column>.`,
      );
    }
    if (!res.pk) {
      throw new Error(
        formatPkDetectionError(t.name, {
          candidates: res.candidates ?? [],
          sampleSize: res.sampleSize ?? 0,
        }),
      );
    }
    tablePk.set(t.resourceId ?? t.name, res.pk);
  }

  // 2. Bind each table to the vega resource it was listed from (physical
  //    resources are not created through REST anymore). Read the id off the
  //    table itself, never through a name-keyed map: two schemas may hold the
  //    same table name, and one binding would then silently serve both.
  log(`Resolving discovered resources for ${targets.length} table(s)...`);
  for (const t of targets) {
    if (!t.resourceId) {
      throw new Error(
        `Table '${t.name}' has no discovered Vega resource. Run catalog discover and retry.`,
      );
    }
  }

  // 3. Create the KN. Roll it back on any later failure.
  const knCreated = (await createKnowledgeNetwork(ctx, { name: opts.name })) as
    | { id?: string }
    | Array<{ id?: string }>;
  const knItem = Array.isArray(knCreated) ? knCreated[0] : knCreated;
  const knId = String(knItem?.id ?? "");
  log(`Knowledge network created: ${knId}`);

  let rollbackKn: string | undefined = knId;
  try {
    // 4. Batch-create object types (all-or-nothing).
    const entries = targets.map((t) => {
      const pk = tablePk.get(t.resourceId ?? t.name) as string;
      return {
        branch: "main",
        name: t.name,
        data_source: { type: "resource", id: t.resourceId },
        primary_keys: [pk],
        display_key: detectDisplayKey(t, pk),
        data_properties: t.columns.map((c) => ({
          name: c.name,
          display_name: c.name,
          type: "string",
          mapped_field: { name: c.name, type: c.type || "varchar" },
        })),
      };
    });
    log(`Creating ${entries.length} object type(s)...`);
    await createObjectTypes(ctx, knId, entries);

    // 5. Build each resource's index via a Vega BuildTask (no KN-level build).
    const builds: Array<{ table: string; taskId: string }> = [];
    if (opts.build) {
      log("Submitting build tasks...");
      for (const t of targets) {
        const embedding = embeddingFields[t.name];
        const primaryKey = tablePk.get(t.resourceId ?? t.name) as string;
        await configureResourceIndex(ctx, t.resourceId as string, {
          primaryKeyFields: [primaryKey],
          incrementalFields: [primaryKey],
          ...(embedding && embedding.length > 0 ? { embeddingFields: embedding } : {}),
          ...(embeddingModel ? { embeddingModel } : {}),
        });
        const task = (await createBuildTask(ctx, {
          resource_id: t.resourceId as string,
          mode: "batch",
        })) as { id?: string };
        builds.push({ table: t.name, taskId: String(task.id ?? "") });
      }
    }

    rollbackKn = undefined; // success — keep the KN
    return {
      kn_id: knId,
      kn_name: opts.name,
      object_types: targets.map((t) => ({ name: t.name, pk: tablePk.get(t.resourceId ?? t.name) })),
      build_tasks: builds,
    };
  } catch (e) {
    // Roll back here rather than in a `finally`, so the outcome is known before
    // the error leaves: a rollback that fails leaves the network behind just as
    // surely as `--no-rollback` does, and the caller is told which happened
    // instead of inferring it from the flag. With every input check now ahead
    // of the KN, most failures never create one at all.
    let leftBehind: string | undefined = rollbackKn;
    if (rollbackKn !== undefined) {
      if (opts.noRollback) {
        log(`Leaving partial KN ${rollbackKn} in place (--no-rollback).`);
      } else {
        log(`Rolling back KN ${rollbackKn}...`);
        try {
          await deleteKnowledgeNetwork(ctx, rollbackKn);
          leftBehind = undefined;
        } catch (rollbackError) {
          // Surface the original error, not this one — but a bare `catch {}`
          // throws away the two things that decide what to say next.
          //
          // A plain 404 means the network is not there, so there is nothing to
          // report cleaning up (the same reading of a bare-vs-gateway 404 this
          // path already applies to model ids). Any other reason leaves it
          // standing, and which reason it was decides what the user can do —
          // 403 says the key cannot delete it either, 5xx says try later — so
          // log that rather than drop it. Explaining the rollback and
          // preserving the original failure are not in conflict.
          // A 2xx that simply was not JSON (`200 text/plain "OK"` is a common
          // way to answer a DELETE) means the delete went through: this path
          // raises `NonJsonResponseError` for it, and reading that as "still
          // there" would send the user after a network that is gone. Same
          // caveat as the 404 above, and for the same reason: a proxy's 200
          // login page never reached the service, so the network is still
          // standing — and staying quiet about that is worse than fussing.
          const gone =
            (rollbackError instanceof HttpError &&
              rollbackError.status === 404 &&
              !rollbackError.gateway) ||
            (rollbackError instanceof NonJsonResponseError &&
              rollbackError.status < 300 &&
              !rollbackError.gateway);
          if (gone) {
            leftBehind = undefined;
          } else {
            log(
              `Rollback of KN ${rollbackKn} failed (${formatError(rollbackError)}); it is still there.`,
            );
          }
        }
      }
    }
    if (leftBehind !== undefined && e && typeof e === "object") {
      (e as PartialKnMarked).partialKnId = leftBehind;
    }
    throw e;
  }
}
