import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFieldMappings,
  buildImportDag,
  buildTableName,
  parseCsvFile,
  splitBatches,
} from "../../src/utils/csv-import.js";

const temps: string[] = [];
function tmpCsv(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
  temps.push(dir);
  const p = join(dir, "data.csv");
  writeFileSync(p, content);
  return p;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("csv-import helpers", () => {
  it("parses CSV with BOM and empty→null", async () => {
    const { headers, rows } = await parseCsvFile(tmpCsv("﻿id,name\n1,alice\n2,\n"));
    expect(headers).toEqual(["id", "name"]);
    expect(rows).toEqual([
      { id: "1", name: "alice" },
      { id: "2", name: null },
    ]);
  });

  it("buildTableName sanitizes + prefixes", () => {
    expect(buildTableName("/a/b/World Cup-2022.csv", "raw_")).toBe("raw_World_Cup_2022");
    expect(buildTableName("/a/1players.csv", "")).toBe("_1players");
  });

  it("splitBatches chunks", () => {
    expect(splitBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("buildFieldMappings defaults to VARCHAR(512)", () => {
    expect(buildFieldMappings(["a"])).toEqual([
      { source: { name: "a" }, target: { name: "a", data_type: "VARCHAR(512)" } },
    ]);
  });

  it("buildImportDag carries datasource_type + table_exist + data", () => {
    const dag = buildImportDag({
      catalogId: "cat1",
      datasourceType: "mysql",
      tableName: "players",
      tableExist: false,
      data: [{ id: "1" }],
      fieldMappings: buildFieldMappings(["id"]),
    }) as { steps: Array<{ operator: string; parameters: Record<string, unknown> }> };
    const write = dag.steps.find((s) => s.operator === "@internal/database/write");
    expect(write?.parameters).toMatchObject({
      datasource_type: "mysql",
      datasource_id: "cat1",
      table_name: "players",
      table_exist: false,
      operate_type: "append",
    });
  });
});
