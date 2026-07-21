import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateFixturePath } from "../../src/bkn-trace/fixture-validate.js";

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bkn-trace-fixture-"));
  temps.push(dir);
  return dir;
}

function writeFixture(name: string, fixture: unknown): string {
  const dir = tempDir();
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(fixture, null, 2));
  return file;
}

function baseFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const fixture = {
    "bkn.trace.schema.version": "1.0.0",
    fixture_id: "fixture_positive",
    fixture_type: "positive",
    scenario: "minimal",
    expected_result: "pass",
    trace: {
      trace_id: "11111111111111111111111111111111",
      "bkn.request.id": "req_fixture_001",
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
    },
    spans: [
      {
        span_id: "2222222222222222",
        parent_span_id: null,
        name: "sdk-cli.request",
        "bkn.module.name": "sdk-cli",
        "bkn.operation.name": "sdk.request",
        "bkn.status": "ok",
        "bkn.timestamp": "2026-07-21T07:00:00.000000000Z",
      },
    ],
    logs: [
      {
        level: "info",
        message: "request completed",
        trace_id: "11111111111111111111111111111111",
        span_id: "2222222222222222",
        "bkn.request.id": "req_fixture_001",
        "bkn.module.name": "sdk-cli",
        "bkn.operation.name": "sdk.request",
        "bkn.status": "ok",
        "bkn.timestamp": "2026-07-21T07:00:00.001000000Z",
        "bkn.trace.schema.version": "1.0.0",
      },
    ],
    events: [],
    baggage: { "bkn.account.type": "app" },
  };
  return { ...fixture, ...overrides };
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("validateFixturePath", () => {
  it("passes a positive fixture when the actual validation passes", () => {
    const file = writeFixture("positive.json", baseFixture());
    const result = validateFixturePath(file);
    expect(result.ok).toBe(true);
    expect(result.results[0]).toMatchObject({ fixtureId: "fixture_positive", result: "pass" });
  });

  it("passes a negative fixture when the actual validation fails", () => {
    const file = writeFixture(
      "negative.json",
      baseFixture({
        fixture_id: "fixture_negative_baggage",
        fixture_type: "negative",
        expected_result: "fail",
        baggage: { "bkn.account.id": "forbidden" },
      }),
    );
    const result = validateFixturePath(file);
    expect(result.ok).toBe(true);
    expect(result.results[0]?.result).toBe("fail");
    expect(result.results[0]?.errors[0]?.code).toBe("BKN_TRACE_BAGGAGE_FORBIDDEN_FIELD");
  });

  it("fails the command result when a negative fixture unexpectedly passes", () => {
    const file = writeFixture(
      "negative.json",
      baseFixture({
        fixture_id: "fixture_negative_wrong",
        fixture_type: "negative",
        expected_result: "fail",
      }),
    );
    const result = validateFixturePath(file);
    expect(result.ok).toBe(false);
    expect(result.results[0]?.expectationMatched).toBe(false);
  });

  it("validates every JSON fixture in a directory", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.json"), JSON.stringify(baseFixture()));
    writeFileSync(
      join(dir, "b.json"),
      JSON.stringify(
        baseFixture({
          fixture_id: "fixture_sensitive",
          fixture_type: "negative",
          expected_result: "fail",
          logs: [
            {
              ...(baseFixture().logs as Record<string, unknown>[])[0],
              message: "executed select token from secret_table",
            },
          ],
        }),
      ),
    );
    const result = validateFixturePath(dir);
    expect(result.ok).toBe(true);
    expect(result.results.map((r) => r.fixtureId).sort()).toEqual([
      "fixture_positive",
      "fixture_sensitive",
    ]);
  });
});
