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

function businessFixture(events: Record<string, unknown>[]): Record<string, unknown> {
  const fixture = baseFixture({
    "bkn.trace.schema.version": "2.1.0",
    fixture_id: "fixture_business_2_1",
    scenario: "business_vertical_slice",
    events,
  });
  const logs = fixture.logs as Record<string, unknown>[];
  logs[0]!["bkn.trace.schema.version"] = "2.1.0";
  return fixture;
}

function businessEvent(
  eventType: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    event_id: `evt_${eventType.replaceAll(".", "_")}`,
    event_type: eventType,
    "bkn.trace.schema.version": "2.1.0",
    observed_at: "2026-07-25T08:00:00.000000000Z",
    emitted_at: "2026-07-25T08:00:00.001000000Z",
    producer_module: "third-party-agent",
    trace_id: "11111111111111111111111111111111",
    span_id: "2222222222222222",
    "bkn.request.id": "req_fixture_001",
    "bkn.operation.name": eventType,
    interaction_id: "int_fixture_001",
    operation_id: "op_fixture_001",
    payload: {},
    ...overrides,
  };
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

  it("accepts a 2.1 business interaction with explicit causality", () => {
    const interaction = businessEvent("agent.interaction.started", {
      event_id: "evt_interaction",
      operation_id: undefined,
      payload: {
        intent_hash: `sha256:${"1".repeat(64)}`,
        mode: "task",
        agent_id: "agent_1",
      },
    });
    const data = businessEvent("data.query.observed", {
      event_id: "evt_data",
      causation_event_id: "evt_interaction",
      payload: {
        query_hash: `sha256:${"2".repeat(64)}`,
        query_type: "aggregate",
        row_count: 2,
      },
    });
    const claim = businessEvent("claim.created", {
      event_id: "evt_claim",
      operation_id: undefined,
      causation_event_id: "evt_data",
      claim_id: "claim_1",
      payload: {
        claim_id: "claim_1",
        claim_type: "answer",
        claim_hash: `sha256:${"3".repeat(64)}`,
        source_event_ids: ["evt_data"],
        operation_ids: ["op_fixture_001"],
        visibility: "visible",
        version_status: "versioned",
      },
    });
    const file = writeFixture("business.json", businessFixture([interaction, data, claim]));

    const result = validateFixturePath(file);

    expect(result.ok).toBe(true);
    expect(result.results[0]).toMatchObject({ result: "pass", contractVersion: "2.1.0" });
  });

  it("rejects a 2.1 operation event without operation_id", () => {
    const event = businessEvent("data.query.observed", { operation_id: undefined });
    const fixture = businessFixture([event]);
    fixture.fixture_type = "negative";
    fixture.expected_result = "fail";
    const file = writeFixture("business-negative.json", fixture);

    const result = validateFixturePath(file);

    expect(result.ok).toBe(true);
    expect(result.results[0]?.errors).toContainEqual(
      expect.objectContaining({ code: "BKN_TRACE_REQUIRED_FIELD_MISSING" }),
    );
  });

  it("rejects legacy aliases in a 2.1 knowledge event payload", () => {
    const event = businessEvent("knowledge.read.observed", {
      causation_event_id: "evt_interaction",
      payload: {
        knowledge_network_ref: "kn:supplychain:v3",
        result_count: 3,
      },
    });
    const fixture = businessFixture([event]);
    fixture.fixture_type = "negative";
    fixture.expected_result = "fail";
    const file = writeFixture("business-legacy-alias-negative.json", fixture);

    const result = validateFixturePath(file);

    expect(result.ok).toBe(true);
    expect(result.results[0]?.errors).toContainEqual(
      expect.objectContaining({
        code: "BKN_TRACE_REQUIRED_FIELD_MISSING",
        path: expect.stringContaining("kn_id"),
      }),
    );
  });

  it("rejects private events and raw unregistered payload fields in 2.1", () => {
    const privateEvent = businessEvent("structured_output.validated", {
      causation_event_id: "evt_interaction",
      payload: { status: "ok" },
    });
    const data = businessEvent("data.query.observed", {
      event_id: "evt_data_raw",
      causation_event_id: "evt_interaction",
      payload: {
        query_hash: `sha256:${"2".repeat(64)}`,
        query_type: "aggregate",
        row_count: 1,
        approval_comment: "approved without review",
      },
    });
    const fixture = businessFixture([privateEvent, data]);
    fixture.fixture_type = "negative";
    fixture.expected_result = "fail";
    const file = writeFixture("business-private-payload-negative.json", fixture);

    const result = validateFixturePath(file);

    expect(result.ok).toBe(true);
    expect(result.results[0]?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "BKN_TRACE_EVENT_TYPE_UNSUPPORTED" }),
        expect.objectContaining({ code: "BKN_TRACE_SENSITIVE_VALUE_LEAKED" }),
      ]),
    );
  });

  it("rejects forward causation and event/envelope version mismatch", () => {
    const interaction = businessEvent("agent.interaction.started", {
      event_id: "evt_interaction",
      operation_id: undefined,
      payload: {
        intent_hash: `sha256:${"1".repeat(64)}`,
        mode: "task",
        agent_id: "agent_1",
      },
    });
    const first = businessEvent("data.query.observed", {
      event_id: "evt_data_first",
      causation_event_id: "evt_data_later",
      "bkn.trace.schema.version": "2.0.0",
      payload: {
        query_hash: `sha256:${"2".repeat(64)}`,
        query_type: "aggregate",
        row_count: 1,
      },
    });
    const later = businessEvent("data.query.observed", {
      event_id: "evt_data_later",
      causation_event_id: "evt_interaction",
      payload: {
        query_hash: `sha256:${"3".repeat(64)}`,
        query_type: "aggregate",
        row_count: 1,
      },
    });
    const fixture = businessFixture([interaction, first, later]);
    fixture.fixture_type = "negative";
    fixture.expected_result = "fail";
    const file = writeFixture("business-causation-negative.json", fixture);

    const result = validateFixturePath(file);

    expect(result.ok).toBe(true);
    expect(result.results[0]?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "BKN_TRACE_CAUSATION_INVALID" }),
        expect.objectContaining({ code: "BKN_TRACE_SCHEMA_VERSION_UNSUPPORTED" }),
      ]),
    );
  });

  it("rejects action identity drift even when state order is valid", () => {
    const interaction = businessEvent("agent.interaction.started", {
      event_id: "evt_interaction",
      operation_id: undefined,
      payload: {
        intent_hash: `sha256:${"1".repeat(64)}`,
        mode: "task",
        agent_id: "agent_1",
      },
    });
    const data = businessEvent("data.query.observed", {
      event_id: "evt_data",
      operation_id: "op_data",
      causation_event_id: "evt_interaction",
      payload: {
        query_hash: `sha256:${"2".repeat(64)}`,
        query_type: "aggregate",
        row_count: 1,
      },
    });
    const claim = businessEvent("claim.created", {
      event_id: "evt_claim",
      operation_id: undefined,
      causation_event_id: "evt_data",
      claim_id: "claim_1",
      payload: {
        claim_id: "claim_1",
        claim_type: "recommendation",
        claim_hash: `sha256:${"3".repeat(64)}`,
        source_event_ids: ["evt_data"],
        operation_ids: ["op_data"],
        visibility: "visible",
        version_status: "versioned",
      },
    });
    const recommended = businessEvent("action.recommended", {
      event_id: "evt_recommended",
      operation_id: "op_action",
      causation_event_id: "evt_claim",
      claim_id: "claim_1",
      payload: {
        action_instance_id: "action_1",
        action_type: "create_monitor",
        target_refs: ["object:supplychain:material"],
        reason_hash: `sha256:${"4".repeat(64)}`,
        status: "recommended",
      },
    });
    const requested = businessEvent("action.approval_requested", {
      event_id: "evt_requested",
      operation_id: "op_action",
      causation_event_id: "evt_recommended",
      claim_id: "claim_1",
      payload: {
        action_instance_id: "action_1",
        policy_ref: "policy:monitor",
        status: "approval_requested",
      },
    });
    const approved = businessEvent("action.approved", {
      event_id: "evt_approved",
      operation_id: "op_action_drift",
      causation_event_id: "evt_requested",
      claim_id: "claim_1",
      payload: {
        action_instance_id: "action_1",
        actor_ref: "account:approver",
        policy_decision_ref: "decision:allow",
        status: "approved",
      },
    });
    const fixture = businessFixture([interaction, data, claim, recommended, requested, approved]);
    fixture.fixture_type = "negative";
    fixture.expected_result = "fail";
    const file = writeFixture("action-identity-negative.json", fixture);

    const result = validateFixturePath(file);

    expect(result.ok).toBe(true);
    expect(result.results[0]?.errors).toContainEqual(
      expect.objectContaining({ code: "BKN_TRACE_ACTION_TRANSITION_INVALID" }),
    );
  });

  it("rejects an action execution that skips approval", () => {
    const recommended = businessEvent("action.recommended", {
      event_id: "evt_recommended",
      claim_id: "claim_1",
      payload: { action_instance_id: "action_1", status: "recommended" },
    });
    const executed = businessEvent("action.executed", {
      event_id: "evt_executed",
      causation_event_id: "evt_recommended",
      claim_id: "claim_1",
      payload: { action_instance_id: "action_1", status: "ok" },
    });
    const fixture = businessFixture([recommended, executed]);
    fixture.fixture_type = "negative";
    fixture.expected_result = "fail";
    const file = writeFixture("action-negative.json", fixture);

    const result = validateFixturePath(file);

    expect(result.ok).toBe(true);
    expect(result.results[0]?.errors).toContainEqual(
      expect.objectContaining({ code: "BKN_TRACE_ACTION_TRANSITION_INVALID" }),
    );
  });

  it("rejects ambiguous short business references", () => {
    const fixture = businessFixture([
      businessEvent("business.refs.resolved", {
        claim_id: "claim_1",
        payload: {
          claim_id: "claim_1",
          resolver_status: "resolved",
          business_refs: [
            {
              ref_id: "object:customer",
              ref_type: "object",
              source_system: "bkn",
              validity: "available",
              version_status: "versioned",
              visibility: "visible",
            },
          ],
        },
      }),
    ]);
    fixture.fixture_type = "negative";
    fixture.expected_result = "fail";

    const result = validateFixturePath(writeFixture("short-ref-negative.json", fixture));

    expect(result.ok).toBe(true);
    expect(result.results[0]?.errors).toContainEqual(
      expect.objectContaining({ code: "BKN_TRACE_REFERENCE_ID_INVALID" }),
    );
  });
});
