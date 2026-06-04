/**
 * `bkn create-from-catalog` orchestration. Build a knowledge network from a
 * Vega catalog's tables:
 *   1. list catalog tables (scan/discover once if empty) + introspect columns
 *   2. resolve a single PK per table (override → schema → sample cardinality);
 *      fail-fast rather than silently pick a wrong key (kweaver-sdk #97)
 *   3. create a vega resource per table (idempotent via findResource)
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
import {
  createResource,
  findResource,
  getResource,
  listResources,
  queryResource,
} from "../api/resources.js";
import { createBuildTask, discoverCatalog } from "../api/vega.js";
import type { RequestContext } from "../types.js";
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
  pkMap?: Record<string, string>;
  build?: boolean;
  noRollback?: boolean;
  onProgress?: (msg: string) => void;
}

interface ResourceDetail {
  id?: string;
  name?: string;
  source_metadata?: { columns?: Array<Record<string, unknown>> };
  primary_keys?: unknown;
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

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.entries)) return o.entries;
    if (Array.isArray(o.data)) return o.data;
  }
  return [];
}

/** Best-effort row sample for cardinality-based PK detection. */
async function sampleRows(
  ctx: RequestContext,
  resourceId: string,
): Promise<Array<Record<string, string | null>>> {
  try {
    const res = await queryResource(ctx, resourceId, { limit: 100 });
    return asArray(res) as Array<Record<string, string | null>>;
  } catch {
    return [];
  }
}

export async function createFromCatalog(
  ctx: RequestContext,
  opts: CreateFromCatalogOptions,
): Promise<unknown> {
  const log = opts.onProgress ?? (() => {});
  const pkMap = opts.pkMap ?? {};

  // 1. List catalog tables, scanning once if the catalog is empty.
  const listTables = () =>
    listResources(ctx, { datasourceId: opts.catalogId, category: "table" }).then(asArray);
  let summaries = await listTables();
  if (summaries.length === 0) {
    log("No tables found; scanning catalog metadata...");
    await discoverCatalog(ctx, opts.catalogId, true);
    summaries = await listTables();
  }
  if (summaries.length === 0) throw new Error("No tables available in catalog after scan.");

  // Resolve full column metadata per summary; filter to --tables if given.
  const details = await Promise.all(
    summaries.map(async (s) => {
      const id = (s as { id?: string }).id;
      const detail = id ? await getResource(ctx, id) : s;
      return toTableInfo(detail as ResourceDetail);
    }),
  );
  const targets =
    opts.tables && opts.tables.length > 0
      ? details.filter((t) => opts.tables?.includes(t.name))
      : details;
  if (targets.length === 0) throw new Error("No matching tables to build from.");

  // Validate --pk-map references and resolve a PK per table BEFORE side effects.
  for (const name of Object.keys(pkMap)) {
    if (!targets.some((t) => t.name === name)) {
      throw new Error(`--pk-map references unknown table '${name}'.`);
    }
  }
  const tablePk: Record<string, string> = {};
  for (const t of targets) {
    const override = pkMap[t.name];
    if (override && !t.columns.some((c) => c.name === override)) {
      throw new Error(
        `--pk-map '${override}' for table '${t.name}' is not a column. ` +
          `Columns: ${t.columns.map((c) => c.name).join(", ")}`,
      );
    }
    let res = resolvePrimaryKey(t, undefined, override);
    if (res.pk === null && res.source === "sample") {
      // Fall back to a live row sample for cardinality detection.
      const summary = summaries.find((s) => (s as { name?: string }).name === t.name) as
        | { id?: string }
        | undefined;
      const rows = summary?.id ? await sampleRows(ctx, summary.id) : [];
      res = resolvePrimaryKey(t, rows, override);
    }
    if (res.source === "ambiguous") {
      throw new Error(
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
    tablePk[t.name] = res.pk;
  }

  // 2. Create a vega resource per table (idempotent).
  log(`Creating resources for ${targets.length} table(s)...`);
  const viewMap: Record<string, string> = {};
  for (const t of targets) {
    const found = asArray(
      await findResource(ctx, t.name, { datasourceId: opts.catalogId, exact: true }),
    );
    const existingId = (found[0] as { id?: string } | undefined)?.id;
    if (existingId) {
      viewMap[t.name] = existingId;
    } else {
      const created = (await createResource(ctx, {
        name: t.name,
        catalogId: opts.catalogId,
        sourceIdentifier: t.name,
        fields: t.columns.map((c) => ({ name: c.name, type: c.type })),
      })) as { id?: string };
      viewMap[t.name] = String(created.id ?? "");
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
      const pk = tablePk[t.name] as string;
      return {
        branch: "main",
        name: t.name,
        data_source: { type: "resource", id: viewMap[t.name] },
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
        const task = (await createBuildTask(ctx, {
          resource_id: viewMap[t.name] as string,
          mode: "batch",
          build_key_fields: [tablePk[t.name] as string],
        })) as { id?: string };
        builds.push({ table: t.name, taskId: String(task.id ?? "") });
      }
    }

    rollbackKn = undefined; // success — keep the KN
    return {
      kn_id: knId,
      kn_name: opts.name,
      object_types: targets.map((t) => ({ name: t.name, pk: tablePk[t.name] })),
      build_tasks: builds,
    };
  } finally {
    if (rollbackKn !== undefined) {
      if (opts.noRollback) {
        log(`Leaving partial KN ${rollbackKn} in place (--no-rollback).`);
      } else {
        log(`Rolling back KN ${rollbackKn}...`);
        try {
          await deleteKnowledgeNetwork(ctx, rollbackKn);
        } catch {
          /* surface the original error, not the rollback failure */
        }
      }
    }
  }
}
