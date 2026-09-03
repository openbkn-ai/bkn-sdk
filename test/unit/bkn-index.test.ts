import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectIndexTargets, parseObjectTypeIndex } from "../../src/utils/bkn-index.js";

const temps: string[] = [];
function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bkn-idx-"));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

// English dialect (world-cup style) + a Property Overrides table marking a vector field.
const EN = `---
type: object_type
id: players
name: Players
---

### Data Properties

| Name | Display Name | Type | Description | Mapped Field |
|------|--------------|------|-------------|--------------|
| player_id | Player Id | string | pk | player_id |
| full_name | Full Name | string | name | player_name |

### Property Overrides

| Name | Index Config |
|------|--------------|
| full_name | fulltext + vector |

### Keys

Primary Keys: player_id
Display Key: full_name
Incremental Key: updated_at

### Data Source

| Type | ID | Name |
|------|-----|------|
| resource | res_players | wc_players |
`;

// Chinese dialect with an inline 主键 and a vector(model) override.
const ZH = `---
type: object_type
id: pods
name: Pods
---

### 数据来源

| 类型 | ID | 名称 |
|------|-----|------|
| resource | res_pods | pods_view |

> **主键**: \`id\` | **显示属性**: \`pod_name\`

### 属性覆盖

| 属性名 | 索引配置 |
|--------|----------|
| pod_status | fulltext + vector(bge-m3) |
`;

describe("parseObjectTypeIndex", () => {
  it("extracts resource, mapped embedding field, and separate key groups", () => {
    const t = parseObjectTypeIndex(EN);
    expect(t).not.toBeNull();
    expect(t?.resourceId).toBe("res_players");
    expect(t?.embeddingFields).toEqual(["player_name"]); // mapped field, not property name
    expect(t?.primaryKeyFields).toEqual(["player_id"]);
    expect(t?.incrementalFields).toEqual(["updated_at"]);
    expect(t?.objectType).toBe("players");
  });

  it("handles Chinese headers, inline primary key, and pinned model", () => {
    const t = parseObjectTypeIndex(ZH);
    expect(t?.resourceId).toBe("res_pods");
    expect(t?.embeddingFields).toEqual(["pod_status"]);
    expect(t?.primaryKeyFields).toEqual(["id"]);
    expect(t?.incrementalFields).toEqual([]);
    expect(t?.embeddingModel).toBe("bge-m3");
  });

  it("does not fall back to the primary key when the incremental key is blank", () => {
    const blankIncr = EN.replace("Incremental Key: updated_at", "Incremental Key:");
    const t = parseObjectTypeIndex(blankIncr);
    expect(t?.primaryKeyFields).toEqual(["player_id"]);
    expect(t?.incrementalFields).toEqual([]);
  });

  it("preserves composite key ordering", () => {
    const t = parseObjectTypeIndex(
      EN.replace("Primary Keys: player_id", "Primary Keys: tenant_id, player_id").replace(
        "Incremental Key: updated_at",
        "Incremental Key: updated_at, player_id",
      ),
    );
    expect(t?.primaryKeyFields).toEqual(["tenant_id", "player_id"]);
    expect(t?.incrementalFields).toEqual(["updated_at", "player_id"]);
  });

  it("maps declared keys to their resource fields", () => {
    const t = parseObjectTypeIndex(
      EN.replace("Primary Keys: player_id", "Primary Keys: full_name").replace(
        "Incremental Key: updated_at",
        "Incremental Key: full_name",
      ),
    );
    expect(t?.primaryKeyFields).toEqual(["player_name"]);
    expect(t?.incrementalFields).toEqual(["player_name"]);
  });

  it("returns null when no field is marked for a vector index", () => {
    const noVector = EN.replace("fulltext + vector", "keyword");
    expect(parseObjectTypeIndex(noVector)).toBeNull();
  });

  it("returns null when the resource binding is an unrendered placeholder", () => {
    const placeholder = EN.replace("res_players", "{{PLAYERS_RES_ID}}");
    expect(parseObjectTypeIndex(placeholder)).toBeNull();
  });

  it("returns null when there is no resource data source", () => {
    const noSource = EN.replace(/### Data Source[\s\S]*$/, "");
    expect(parseObjectTypeIndex(noSource)).toBeNull();
  });
});

describe("collectIndexTargets", () => {
  it("collects only object types with both a binding and a vector field", () => {
    const dir = dirWith({
      "object_types/players.bkn": EN,
      "object_types/pods.bkn": ZH,
      "object_types/plain.bkn": EN.replace("fulltext + vector", "keyword"),
    });
    const targets = collectIndexTargets(dir);
    expect(targets.map((t) => t.resourceId).sort()).toEqual(["res_players", "res_pods"]);
  });

  it("returns [] when there is no object_types directory", () => {
    expect(collectIndexTargets(dirWith({ "network.bkn": "x" }))).toEqual([]);
  });
});
