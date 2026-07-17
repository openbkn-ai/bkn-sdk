// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { executeDataflow } from "../api/dataflow.js";
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
import {
  configureResourceIndex,
  findResource,
  getResource,
  listResources,
  queryResource,
} from "../api/resources.js";
import { createBuildTask, discoverCatalog, getCatalog } from "../api/vega.js";
import type { RequestContext } from "../types.js";
import {
  buildFieldMappings,
  buildImportDag,
  buildTableName,
  parseCsvFile,
  resolveFiles,
  splitBatches,
} from "../utils/csv-import.js";
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
  /** Per-table resource columns to vectorize (sets resource schema index features). */
  embeddingFields?: Record<string, string[]>;
  embeddingModel?: string;
  noRollback?: boolean;
  /** Pre-fetched row samples per table (e.g. from a CSV import) for PK detection. */
  sampleRows?: Record<string, Array<Record<string, string | null>>>;
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
    // Prefer caller-supplied samples (CSV import) for cardinality detection.
    let res = resolvePrimaryKey(t, opts.sampleRows?.[t.name], override);
    if (res.pk === null && res.source === "sample") {
      // Fall back to a live row sample.
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
  log(`Resolving discovered resources for ${targets.length} table(s)...`);
  const viewMap: Record<string, string> = {};
  for (const t of targets) {
    const found = asArray(
      await findResource(ctx, t.name, { datasourceId: opts.catalogId, exact: true }),
    );
    const existingId = (found[0] as { id?: string } | undefined)?.id;
    if (existingId) {
      viewMap[t.name] = existingId;
    } else {
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
        const embedding = opts.embeddingFields?.[t.name];
        await configureResourceIndex(ctx, viewMap[t.name] as string, {
          buildKeyFields: [tablePk[t.name] as string],
          ...(embedding && embedding.length > 0 ? { embeddingFields: embedding } : {}),
          ...(opts.embeddingModel ? { embeddingModel: opts.embeddingModel } : {}),
        });
        const task = (await createBuildTask(ctx, {
          resource_id: viewMap[t.name] as string,
          mode: "batch",
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

export interface ImportCsvResult {
  tables: string[];
  failed: string[];
  sampleRows: Record<string, Array<Record<string, string | null>>>;
}

/**
 * Import CSV files into a Vega catalog as tables. Each file becomes a table
 * (first batch creates it, later batches append) via a one-shot dataflow DAG.
 * Returns the imported table names and a per-table row sample (≤100 rows) for
 * downstream PK detection.
 */
export async function importCsvToCatalog(
  ctx: RequestContext,
  opts: {
    catalogId: string;
    files: string;
    tablePrefix?: string;
    batchSize?: number;
    onProgress?: (msg: string) => void;
  },
): Promise<ImportCsvResult> {
  const log = opts.onProgress ?? (() => {});
  const batchSize = opts.batchSize ?? 500;
  const paths = await resolveFiles(opts.files);

  // The database-write step needs the catalog's connector type.
  const catalog = (await getCatalog(ctx, opts.catalogId)) as {
    connector_type?: string;
    type?: string;
  };
  const datasourceType = catalog.connector_type ?? catalog.type ?? "";

  const tables: string[] = [];
  const failed: string[] = [];
  const sampleRows: Record<string, Array<Record<string, string | null>>> = {};

  for (const path of paths) {
    const tableName = buildTableName(path, opts.tablePrefix ?? "");
    const { headers, rows } = await parseCsvFile(path);
    if (headers.length === 0 || rows.length === 0) {
      log(`Skipping ${tableName} (no headers/rows).`);
      failed.push(tableName);
      continue;
    }
    const fieldMappings = buildFieldMappings(headers);
    const batches = splitBatches(rows, batchSize);
    try {
      for (let i = 0; i < batches.length; i += 1) {
        log(`[${tableName}] batch ${i + 1}/${batches.length} (${batches[i]?.length} rows)...`);
        await executeDataflow(
          ctx,
          buildImportDag({
            catalogId: opts.catalogId,
            datasourceType,
            tableName,
            tableExist: i > 0,
            data: batches[i] as Array<Record<string, string | null>>,
            fieldMappings,
          }),
        );
      }
      tables.push(tableName);
      sampleRows[tableName] = rows.slice(0, 100);
    } catch (e) {
      log(`[${tableName}] import failed: ${e instanceof Error ? e.message : String(e)}`);
      failed.push(tableName);
    }
  }
  // Best-effort: refresh catalog metadata so the new tables are visible.
  await discoverCatalog(ctx, opts.catalogId, true).catch(() => {});
  return { tables, failed, sampleRows };
}

export interface CreateFromCsvOptions {
  catalogId: string;
  name: string;
  files: string;
  tablePrefix?: string;
  batchSize?: number;
  tables?: string[];
  pkMap?: Record<string, string>;
  build?: boolean;
  embeddingFields?: Record<string, string[]>;
  embeddingModel?: string;
  noRollback?: boolean;
  onProgress?: (msg: string) => void;
}

/** Import CSVs into a catalog, then build a KN from the imported tables. */
export async function createFromCsv(
  ctx: RequestContext,
  opts: CreateFromCsvOptions,
): Promise<unknown> {
  const log = opts.onProgress ?? (() => {});
  log("Phase 1: importing CSVs...");
  const imported = await importCsvToCatalog(ctx, {
    catalogId: opts.catalogId,
    files: opts.files,
    tablePrefix: opts.tablePrefix,
    batchSize: opts.batchSize,
    onProgress: log,
  });
  if (imported.tables.length === 0) {
    throw new Error(`No tables imported (failed: ${imported.failed.join(", ") || "none"}).`);
  }
  log(`Phase 2: building KN from ${imported.tables.length} table(s)...`);
  const result = await createFromCatalog(ctx, {
    catalogId: opts.catalogId,
    name: opts.name,
    tables: opts.tables && opts.tables.length > 0 ? opts.tables : imported.tables,
    pkMap: opts.pkMap,
    build: opts.build,
    embeddingFields: opts.embeddingFields,
    embeddingModel: opts.embeddingModel,
    noRollback: opts.noRollback,
    sampleRows: imported.sampleRows,
    onProgress: log,
  });
  return {
    imported_tables: imported.tables,
    failed_imports: imported.failed,
    ...(result as object),
  };
}
