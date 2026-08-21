import { describe, expect, it, vi } from "vitest";
import type { EvidenceIngestRequest, EvidenceIngestResponse } from "../../src/api/trace.js";
import { TraceSession } from "../../src/trace-session.js";

const NOW = "2026-07-25T08:00:00.000000000Z";

function session(overrides: Partial<ConstructorParameters<typeof TraceSession>[0]> = {}) {
  const ids = [
    "evt_interaction",
    "op_data",
    "evt_data",
    "evt_claim",
    "op_action",
    "action_1",
    "evt_recommended",
    "evt_requested",
    "evt_approved",
    "evt_executed",
    "evt_result",
  ];
  const emit = vi.fn<(body: EvidenceIngestRequest) => Promise<EvidenceIngestResponse>>(
    async (body) => ({
      trace_id: body.trace.trace_id,
      "bkn.request.id": body.trace["bkn.request.id"],
      "bkn.trace.schema.version": body["bkn.trace.schema.version"],
      accepted_event_count: body.events.length,
      claim_count: 1,
      evidence_ref_count: 0,
      business_ref_count: 0,
    }),
  );
  return {
    emit,
    value: new TraceSession({
      trace: {
        trace_id: "11111111111111111111111111111111",
        traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
        "bkn.request.id": "req_session_001",
        business_domain: "bd_test",
        "bkn.account.id": "account_1",
        "bkn.account.type": "app",
      },
      producerModule: "third-party-agent",
      spanId: "2222222222222222",
      interactionId: "int_session_001",
      idFactory: () => ids.shift() ?? "id_exhausted",
      now: () => NOW,
      emit,
      ...overrides,
    }),
  };
}

describe("TraceSession", () => {
  it("clones bigint evidence payloads without throwing or losing precision", () => {
    const { value } = session();
    const interaction = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });
    const event = value.observeOperation("data.query.observed", {
      operationName: "data.query",
      causationEventId: interaction.event_id,
      payload: {
        query_hash: `sha256:${"1".repeat(64)}`,
        query_type: "aggregate",
        row_count: 9223372036854775807n as unknown as number,
      },
    });

    expect(event.payload.row_count).toBe(9223372036854775807n);
    expect(value.pendingEvents().at(-1)?.payload.row_count).toBe(9223372036854775807n);
  });

  it("preserves a caller-owned conversation across the evidence interaction", async () => {
    const { value, emit } = session({ conversationId: "conversation_supply_chain" });
    value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });

    await value.flush();

    expect(emit.mock.calls[0]?.[0].trace["bkn.conversation.id"]).toBe("conversation_supply_chain");
  });

  it("builds a 2.2 session only from already-persisted artifact references", async () => {
    const { value, emit } = session({ contractVersion: "2.2.0" });

    expect(() =>
      value.startInteraction({
        operationName: "agent.run",
        intentHash: `sha256:${"1".repeat(64)}`,
        mode: "task",
        agentId: "agent_1",
      }),
    ).toThrow(/question_artifact_ref/);

    const interaction = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
      questionArtifactRef: "artifact:art_question_001",
    });
    const data = value.observeOperation("data.query.observed", {
      operationName: "data.query",
      causationEventId: interaction.event_id,
      payload: {
        query_artifact_ref: "artifact:art_query_001",
        query_hash: `sha256:${"2".repeat(64)}`,
        query_type: "aggregate",
        result_artifact_ref: "artifact:art_data_result_001",
        row_count: 2,
      },
    });
    value.createClaim({
      operationName: "agent.claim.create",
      causationEventId: data.event_id,
      claimId: "claim_1",
      claimType: "answer",
      claimHash: `sha256:${"3".repeat(64)}`,
      operationIds: [data.operation_id as string],
      resultArtifactRef: "artifact:art_result_001",
      sourceEventIds: [data.event_id],
    });

    await value.flush();

    const request = emit.mock.calls[0]?.[0];
    expect(request?.["bkn.trace.schema.version"]).toBe("2.2.0");
    expect(request?.events[0]?.payload.question_artifact_ref).toBe("artifact:art_question_001");
    expect(request?.events.at(-1)?.payload.result_artifact_ref).toBe("artifact:art_result_001");
  });

  it("records a 2.2 action result using only its persisted result artifact", () => {
    const { value } = session({ contractVersion: "2.2.0" });
    const interaction = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
      questionArtifactRef: "artifact:art_question_001",
    });
    const data = value.observeOperation("data.query.observed", {
      operationName: "data.query",
      causationEventId: interaction.event_id,
      payload: {
        query_artifact_ref: "artifact:art_query_001",
        query_hash: `sha256:${"2".repeat(64)}`,
        query_type: "aggregate",
        result_artifact_ref: "artifact:art_data_result_001",
        row_count: 1,
      },
    });
    value.createClaim({
      operationName: "agent.claim.create",
      causationEventId: data.event_id,
      claimId: "claim_1",
      claimType: "recommendation",
      claimHash: `sha256:${"3".repeat(64)}`,
      operationIds: [data.operation_id as string],
      resultArtifactRef: "artifact:art_result_001",
      sourceEventIds: [data.event_id],
    });
    const action = value.recommendAction({
      operationName: "action.recommend",
      claimId: "claim_1",
      actionType: "create_forecast_monitor",
      targetRefs: ["object:supplychain:material"],
      reasonHash: `sha256:${"4".repeat(64)}`,
      inputArtifactRef: "artifact:art_action_input_001",
    });
    value.requestActionApproval(action, { policyRef: "policy:e2e" });
    value.approveAction(action, {
      actorRef: "account:account_1",
      policyDecisionRef: "decision:allow",
    });
    value.executeAction(action, { status: "ok", invocationRef: "tool:monitor" });

    const result = value.recordActionResult(action, {
      status: "created",
      resultHash: `sha256:${"5".repeat(64)}`,
      resultArtifactRef: "artifact:art_action_result_001",
    });

    expect(result.payload).toMatchObject({
      result_artifact_ref: "artifact:art_action_result_001",
      status: "created",
    });
    expect(result.payload).not.toHaveProperty("artifact_ref");
    expect(result.payload).not.toHaveProperty("task_ref");
  });

  it("builds a causal interaction, operation, and claim without raw JSON", async () => {
    const { value, emit } = session();
    const interaction = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });
    const data = value.observeOperation("data.query.observed", {
      operationName: "data.query",
      causationEventId: interaction.event_id,
      payload: {
        query_hash: `sha256:${"2".repeat(64)}`,
        query_type: "aggregate",
        row_count: 2,
      },
    });
    const claim = value.createClaim({
      operationName: "agent.claim.create",
      causationEventId: data.event_id,
      claimId: "claim_1",
      claimType: "answer",
      claimHash: `sha256:${"3".repeat(64)}`,
      sourceEventIds: [data.event_id],
      operationIds: [data.operation_id as string],
    });

    await value.flush();

    expect(claim.claim_id).toBe("claim_1");
    expect(emit).toHaveBeenCalledOnce();
    const request = emit.mock.calls[0]?.[0];
    expect(request?.["bkn.trace.schema.version"]).toBe("2.1.0");
    expect(request?.events.map((event) => event.event_type)).toEqual([
      "agent.interaction.started",
      "data.query.observed",
      "claim.created",
    ]);
    expect(value.pendingEvents()).toHaveLength(0);
  });

  it("rejects a claim that references an event outside the session", () => {
    const { value } = session();
    expect(() =>
      value.createClaim({
        operationName: "agent.claim.create",
        causationEventId: "evt_missing",
        claimId: "claim_1",
        claimType: "answer",
        claimHash: `sha256:${"3".repeat(64)}`,
        sourceEventIds: ["evt_missing"],
        operationIds: ["op_missing"],
      }),
    ).toThrow(/evt_missing/);
  });

  it("rejects a non-root event without direct causation at runtime", () => {
    const { value } = session();
    const interaction = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });
    const data = value.observeOperation("data.query.observed", {
      operationName: "data.query",
      causationEventId: interaction.event_id,
      payload: {
        query_hash: `sha256:${"2".repeat(64)}`,
        query_type: "aggregate",
        row_count: 1,
      },
    });

    expect(() =>
      value.createClaim({
        operationName: "agent.claim.create",
        claimId: "claim_1",
        claimType: "finding",
        claimHash: `sha256:${"3".repeat(64)}`,
        sourceEventIds: [data.event_id],
        operationIds: [data.operation_id as string],
      } as never),
    ).toThrow(/causation/i);
  });

  it("rejects unregistered or raw sensitive payload fields at runtime", () => {
    const { value } = session();
    const interaction = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });

    expect(() =>
      value.observeOperation("data.query.observed", {
        operationName: "data.query",
        causationEventId: interaction.event_id,
        payload: {
          query_hash: `sha256:${"2".repeat(64)}`,
          query_type: "aggregate",
          row_count: 1,
          sql: "update inventory set available = 0",
        },
      } as never),
    ).toThrow(/sql|payload/i);
  });

  it("records controlled evidence and business references for a known claim", () => {
    const { value } = session();
    const interaction = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });
    const knowledge = value.observeOperation("knowledge.read.observed", {
      operationName: "knowledge.read",
      causationEventId: interaction.event_id,
      payload: {
        kn_id: "supplychain",
        read_kind: "object_relation_schema",
        version_status: "versioned",
        schema_version: "supplychain:v3",
      },
    });
    value.createClaim({
      operationName: "agent.claim.create",
      causationEventId: knowledge.event_id,
      claimId: "claim_1",
      claimType: "finding",
      claimHash: `sha256:${"3".repeat(64)}`,
      sourceEventIds: [knowledge.event_id],
      operationIds: [knowledge.operation_id as string],
    });

    const evidence = value.createEvidenceRefs({
      operationName: "agent.evidence.link",
      claimId: "claim_1",
      refs: [
        {
          refId: "evidence:material-shortage:1",
          refType: "data_resource",
          sourceSystem: "vega",
          validity: "observed",
          versionStatus: "versioned",
          visibility: "visible",
          summaryHash: `sha256:${"4".repeat(64)}`,
        },
      ],
    });
    const business = value.resolveBusinessRefs({
      operationName: "agent.business.resolve",
      claimId: "claim_1",
      causationEventId: evidence.event_id,
      resolverStatus: "resolved",
      refs: [
        {
          refId: "object:supplychain:material",
          refType: "object",
          sourceSystem: "bkn",
          validity: "available",
          versionStatus: "versioned",
          visibility: "visible",
        },
      ],
    });

    expect(evidence.event_type).toBe("evidence.refs.created");
    expect(business.event_type).toBe("business.refs.resolved");
    expect(business.causation_event_id).toBe(evidence.event_id);
    expect(business.payload.business_refs).toEqual([
      expect.objectContaining({ ref_id: "object:supplychain:material", ref_type: "object" }),
    ]);
  });

  it("records an unresolved business resolver outcome without inventing a ref", () => {
    const { value } = session();
    const interaction = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });
    const data = value.observeOperation("data.query.observed", {
      operationName: "data.query",
      causationEventId: interaction.event_id,
      payload: {
        query_hash: `sha256:${"2".repeat(64)}`,
        query_type: "aggregate",
        row_count: 1,
      },
    });
    value.createClaim({
      operationName: "agent.claim.create",
      causationEventId: data.event_id,
      claimId: "claim_1",
      claimType: "finding",
      claimHash: `sha256:${"3".repeat(64)}`,
      sourceEventIds: [data.event_id],
      operationIds: [data.operation_id as string],
    });

    const unresolved = value.resolveBusinessRefs({
      operationName: "agent.business.resolve",
      claimId: "claim_1",
      resolverStatus: "unresolved",
      refs: [],
    });

    expect(unresolved.payload).toMatchObject({
      resolver_status: "unresolved",
      business_refs: [],
    });
  });

  it("keeps queued event content immutable after returning it to the caller", () => {
    const { value } = session();
    const event = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });

    event.payload.mode = "background";

    expect(value.pendingEvents()[0]?.payload.mode).toBe("task");
  });

  it("rejects action recommendations for a claim outside the session", () => {
    const { value } = session();
    expect(() =>
      value.recommendAction({
        operationName: "action.recommend",
        claimId: "claim_missing",
        actionType: "create_forecast_monitor",
        targetRefs: ["object:material:M-1001"],
        reasonHash: `sha256:${"4".repeat(64)}`,
      }),
    ).toThrow(/claim_missing/);
  });

  it("keeps stable queued events when emit fails so flush can retry", async () => {
    const emit = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    const { value } = session({ emit });
    value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });

    await expect(value.flush()).rejects.toThrow("offline");
    const eventId = value.pendingEvents()[0]?.event_id;
    await value.flush();

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0]?.[0].events[0].event_id).toBe(eventId);
    expect(emit.mock.calls[1]?.[0].events[0].event_id).toBe(eventId);
  });

  it("serializes concurrent flushes without resending or dropping queued events", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const batches: EvidenceIngestRequest[] = [];
    const emit = vi.fn(async (body: EvidenceIngestRequest) => {
      batches.push(body);
      if (batches.length === 1) await firstPending;
      return {} as EvidenceIngestResponse;
    });
    const { value } = session({ emit });
    value.startInteraction({
      operationName: "agent.run.first",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });

    const firstFlush = value.flush();
    value.startInteraction({
      operationName: "agent.run.second",
      intentHash: `sha256:${"2".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });
    const secondFlush = value.flush();

    await Promise.resolve();
    expect(emit).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await Promise.all([firstFlush, secondFlush]);

    expect(batches.map((batch) => batch.events.length)).toEqual([1, 1]);
    expect(batches[0]?.events[0]?.event_id).not.toBe(batches[1]?.events[0]?.event_id);
    expect(value.pendingEvents()).toHaveLength(0);
  });

  it("enforces the action lifecycle before submission", () => {
    const { value } = session();
    const interaction = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });
    const data = value.observeOperation("data.query.observed", {
      operationName: "data.query",
      causationEventId: interaction.event_id,
      payload: {
        query_hash: `sha256:${"2".repeat(64)}`,
        query_type: "aggregate",
        row_count: 1,
      },
    });
    value.createClaim({
      operationName: "agent.claim.create",
      causationEventId: data.event_id,
      claimId: "claim_1",
      claimType: "recommendation",
      claimHash: `sha256:${"3".repeat(64)}`,
      sourceEventIds: [data.event_id],
      operationIds: [data.operation_id as string],
    });
    const action = value.recommendAction({
      operationName: "action.recommend",
      claimId: "claim_1",
      actionType: "create_forecast_monitor",
      targetRefs: ["object:supplychain:material"],
      reasonHash: `sha256:${"4".repeat(64)}`,
    });

    expect(() =>
      value.executeAction(action, { status: "ok", invocationRef: "tool:monitor" }),
    ).toThrow(/approval/i);

    value.requestActionApproval(action, { policyRef: "policy:e2e" });
    value.approveAction(action, {
      actorRef: "account:account_1",
      policyDecisionRef: "decision:allow",
    });
    value.executeAction(action, { status: "ok", invocationRef: "tool:monitor" });
    value.recordActionResult(action, {
      status: "created",
      resultHash: `sha256:${"5".repeat(64)}`,
      taskRef: "monitor-task:1",
    });

    expect(
      value
        .pendingEvents()
        .slice(-5)
        .map((event) => event.event_type),
    ).toEqual([
      "action.recommended",
      "action.approval_requested",
      "action.approved",
      "action.executed",
      "action.result_recorded",
    ]);
  });

  it("does not trust caller mutation of an action handle", () => {
    const { value } = session();
    const interaction = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });
    const data = value.observeOperation("data.query.observed", {
      operationName: "data.query",
      causationEventId: interaction.event_id,
      payload: {
        query_hash: `sha256:${"2".repeat(64)}`,
        query_type: "aggregate",
        row_count: 1,
      },
    });
    value.createClaim({
      operationName: "agent.claim.create",
      causationEventId: data.event_id,
      claimId: "claim_1",
      claimType: "recommendation",
      claimHash: `sha256:${"3".repeat(64)}`,
      sourceEventIds: [data.event_id],
      operationIds: [data.operation_id as string],
    });
    const action = value.recommendAction({
      operationName: "action.recommend",
      claimId: "claim_1",
      actionType: "create_forecast_monitor",
      targetRefs: ["object:material:M-1001"],
      reasonHash: `sha256:${"4".repeat(64)}`,
    });

    expect(Reflect.set(action, "state", "approved")).toBe(false);

    expect(() =>
      value.executeAction(action, { status: "ok", invocationRef: "tool:monitor" }),
    ).toThrow(/approval/i);
  });

  it("rejects ambiguous short business and action references", () => {
    const { value } = session();
    const interaction = value.startInteraction({
      operationName: "agent.run",
      intentHash: `sha256:${"1".repeat(64)}`,
      mode: "task",
      agentId: "agent_1",
    });
    const data = value.observeOperation("data.query.observed", {
      operationName: "data.query",
      causationEventId: interaction.event_id,
      payload: { query_hash: `sha256:${"2".repeat(64)}`, query_type: "aggregate", row_count: 1 },
    });
    value.createClaim({
      operationName: "agent.claim.create",
      causationEventId: data.event_id,
      claimId: "claim_1",
      claimType: "recommendation",
      claimHash: `sha256:${"3".repeat(64)}`,
      sourceEventIds: [data.event_id],
      operationIds: [data.operation_id as string],
    });

    expect(() =>
      value.resolveBusinessRefs({
        operationName: "agent.business.resolve",
        claimId: "claim_1",
        resolverStatus: "resolved",
        refs: [
          {
            refId: "object:customer",
            refType: "object",
            sourceSystem: "bkn",
            validity: "available",
            versionStatus: "versioned",
            visibility: "visible",
          },
        ],
      }),
    ).toThrow(/knowledge-network or resource scope/i);

    expect(() =>
      value.recommendAction({
        operationName: "action.recommend",
        claimId: "claim_1",
        actionType: "create_monitor",
        targetRefs: ["object:customer"],
        reasonHash: `sha256:${"4".repeat(64)}`,
      }),
    ).toThrow(/knowledge-network or resource scope/i);
  });
});
