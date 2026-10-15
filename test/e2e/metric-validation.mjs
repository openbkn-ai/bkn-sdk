// Read-only validation of an existing Object Metric V1 definition.
// BKN_BASE_URL, BKN_KN_ID, and BKN_METRIC_ID are required; stored auth is supported.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../../dist/index.js";

const baseUrl = process.env.BKN_BASE_URL;
const knId = process.env.BKN_KN_ID;
const metricId = process.env.BKN_METRIC_ID;
assert(baseUrl && knId && metricId, "Set BKN_BASE_URL, BKN_KN_ID, and BKN_METRIC_ID");
const skipVersionCheck = process.env.BKN_SKIP_VERSION_CHECK === "1";
const insecure = process.env.BKN_INSECURE === "1";
const client = createClient({ baseUrl, skipVersionCheck, insecure });
const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "bkn-object-metric-validation-"));
const report = { baseUrl, knId, metricId, checks: [] };

try {
  const record = await client.kn.objectMetricGet(knId, metricId);
  assert(record?.definition, "Existing Object Metric V1 definition was not returned");
  const source = record.definition;
  const probe = {
    ...source,
    id: undefined,
    version: undefined,
    code: `sdk_validation_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
  };
  const missingOwner = `sdk_missing_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const before = await client.kn.objectMetricList(knId, { status: "published", limit: 500 });

  for (const [label, definition, valid] of [
    ["valid", probe, true],
    ["missing-owner", { ...probe, owner_object_type_id: missingOwner }, false],
  ]) {
    const sdk = await client.kn.objectMetricValidate(knId, definition);
    assert.equal(sdk.valid, valid, `${label}: SDK validation result`);
    const bodyFile = join(dir, `${label}.json`);
    writeFileSync(bodyFile, JSON.stringify(definition), { mode: 0o600 });
    const args = [join(root, "dist/cli.js"), "--base-url", baseUrl, "--json"];
    if (skipVersionCheck) args.push("--skip-version-check");
    if (insecure) args.push("--insecure");
    args.push("bkn", "object-metric", "validate", knId, "--body-file", bodyFile);
    const cli = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 40_000 });
    assert.ifError(cli.error);
    assert.equal(cli.status, valid ? 0 : 1, `${label}: CLI exit status`);
    assert.equal(JSON.parse(cli.stdout).valid, valid);
    report.checks.push({ label, sdk, cliExitCode: cli.status });
  }

  const after = await client.kn.objectMetricList(knId, { status: "published", limit: 500 });
  assert.deepEqual(
    after.entries.map((record) => record.definition.id).sort(),
    before.entries.map((record) => record.definition.id).sort(),
    "Validation must not persist a metric",
  );
  report.checks.push({ label: "no-metric-persisted", count: after.entries.length });
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
