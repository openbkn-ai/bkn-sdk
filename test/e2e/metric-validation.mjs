// Validate an existing Metric definition without persisting it.
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
const dir = mkdtempSync(join(tmpdir(), "bkn-metric-validation-"));
const entries = (result) => (Array.isArray(result) ? result : (result.entries ?? []));
const report = { baseUrl, knId, metricId, checks: [] };

try {
  const source = entries(await client.kn.metricGet(knId, metricId)).find((m) => m.id === metricId);
  assert(source, "Existing Metric definition was not returned");
  const fields = [
    "comment",
    "tags",
    "unit_type",
    "unit",
    "metric_type",
    "scope_type",
    "scope_ref",
    "time_dimension",
    "calculation_formula",
    "analysis_dimensions",
  ];
  const probe = {
    ...Object.fromEntries(
      fields.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
    ),
    name: `sdk_validation_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
  };
  assert.equal(probe.scope_type, "object_type", "This probe requires an object-type Metric");
  const missingScope = `sdk_missing_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const types = entries(await client.kn.objectTypes(knId));
  assert(!types.some((type) => type.id === missingScope));
  const before = entries(await client.kn.metricList(knId));

  for (const [label, metric, valid] of [
    ["valid", probe, true],
    ["missing-dependency", { ...probe, scope_ref: missingScope }, false],
  ]) {
    const body = { entries: [metric] };
    let sdk;
    try {
      sdk = await client.kn.metricValidate(knId, body);
      assert.equal(sdk.valid, valid);
    } catch (error) {
      // Older backends report missing dependencies as HTTP 400 instead of valid:false.
      if (valid || error.status !== 400) throw error;
      assert(error.body.includes(missingScope), "HTTP 400 did not identify the missing dependency");
      sdk = { httpStatus: error.status };
    }
    const bodyFile = join(dir, `${label}.json`);
    writeFileSync(bodyFile, JSON.stringify(body), { mode: 0o600 });
    const args = [join(root, "dist/cli.js"), "--base-url", baseUrl, "--json"];
    if (skipVersionCheck) args.push("--skip-version-check");
    if (insecure) args.push("--insecure");
    args.push("bkn", "metric", "validate", knId, "--body-file", bodyFile);
    const cli = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 40_000 });
    assert.ifError(cli.error);
    assert.equal(cli.status, valid ? 0 : 1, `${label}: unexpected CLI exit status`);
    if (valid || sdk.valid === false) {
      assert.equal(JSON.parse(cli.stdout).valid, valid);
    } else {
      assert.match(cli.stderr, /HTTP 400/);
      assert(cli.stderr.includes(missingScope), "CLI error omitted the missing dependency");
    }
    report.checks.push({ label, sdk, cliExitCode: cli.status });
  }

  const after = entries(await client.kn.metricList(knId));
  assert(!after.some((metric) => metric.name === probe.name), "Validation persisted a Metric");
  assert.deepEqual(after.map((m) => m.id).sort(), before.map((m) => m.id).sort());
  report.checks.push({
    label: "no-metric-persisted",
    countBefore: before.length,
    countAfter: after.length,
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
