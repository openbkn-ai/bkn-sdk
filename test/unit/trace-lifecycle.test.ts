import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type InteractionCompletionInput,
  type LifecycleErrorCode,
  type ManagedConversation,
  type ManagedInteraction,
  type ManagedOperation,
  type OperationReceipt,
  type TraceLifecycleApi,
  traceLifecycleApi,
} from "../../src/api/trace-lifecycle.js";
import type { RequestContext } from "../../src/types.js";
import { HttpError } from "../../src/utils/errors.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "token",
  businessDomain: "bd_supply_chain",
  insecure: false,
};

type CallArgs = [string, RequestInit];

function mockFetch(bodies: unknown[] = [{}]): typeof fetch {
  let index = 0;
  const fn = vi.fn(async () => {
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}

function calls(fetchMock: typeof fetch): CallArgs[] {
  return (fetchMock as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
}

function jsonBody(call: CallArgs): unknown {
  return JSON.parse(call[1].body as string);
}

afterEach(() => vi.unstubAllGlobals());

describe("traceLifecycleApi conversations", () => {
  it("lists authorized conversations with the registered limit query", async () => {
    const fetchMock = mockFetch([{ entries: [] }]);

    await traceLifecycleApi(ctx).listConversations({ limit: 30 });

    const call = calls(fetchMock)[0];
    if (!call) throw new Error("missing lifecycle call");
    const url = new URL(call[0]);
    expect(url.pathname).toBe("/api/agent-observability/v1/conversations");
    expect(url.searchParams.get("limit")).toBe("30");
    expect(call[1].method).toBe("GET");
  });

  it("does not serialize a non-finite conversation limit", async () => {
    const fetchMock = mockFetch([{ entries: [] }]);

    await traceLifecycleApi(ctx).listConversations({ limit: Number.NaN });

    const call = calls(fetchMock)[0];
    if (!call) throw new Error("missing lifecycle call");
    expect(new URL(call[0]).search).toBe("");
  });

  it("uses the registered conversation lifecycle paths and exact wire bodies", async () => {
    const fetchMock = mockFetch();
    const api: TraceLifecycleApi = traceLifecycleApi(ctx);

    await api.ensureConversation({
      external_conversation_key: "external-1",
      idempotency_key: "ensure-1",
      one_shot: true,
    });
    await api.createNewConversationGeneration({
      external_conversation_key: "external-1",
      idempotency_key: "generation-2",
    });
    await api.resumeConversation({ conversation_id: "conversation-1" });
    await api.getConversation("conversation-1");
    await api.closeConversation("conversation-1", { idempotency_key: "close-1" });

    const [ensure, createGeneration, resume, get, close] = calls(fetchMock);
    if (!ensure || !createGeneration || !resume || !get || !close) {
      throw new Error("missing lifecycle calls");
    }
    expect(new URL(ensure[0]).pathname).toBe(
      "/api/agent-observability/v1/conversations:ensure-current",
    );
    expect(new URL(createGeneration[0]).pathname).toBe(
      "/api/agent-observability/v1/conversations:create-new-generation",
    );
    expect(new URL(resume[0]).pathname).toBe(
      "/api/agent-observability/v1/conversations:resume-by-id",
    );
    expect(new URL(get[0]).pathname).toBe(
      "/api/agent-observability/v1/conversations/conversation-1",
    );
    expect(new URL(close[0]).pathname).toBe(
      "/api/agent-observability/v1/conversations/conversation-1/close",
    );
    expect(jsonBody(ensure)).toEqual({
      external_conversation_key: "external-1",
      idempotency_key: "ensure-1",
      one_shot: true,
    });
    expect(jsonBody(createGeneration)).toEqual({
      external_conversation_key: "external-1",
      idempotency_key: "generation-2",
    });
    expect(jsonBody(resume)).toEqual({ conversation_id: "conversation-1" });
    expect(get[1].body).toBeUndefined();
    expect(jsonBody(close)).toEqual({ idempotency_key: "close-1" });
    expect(ensure[1].method).toBe("POST");
    expect(get[1].method).toBe("GET");

    const headers = new Headers(ensure[1].headers);
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("x-business-domain")).toBe("bd_supply_chain");
    expect(headers.get("content-type")).toBe("application/json");
  });
});

describe("traceLifecycleApi interactions", () => {
  it("starts, reads, and terminates interactions through registered actions", async () => {
    const fetchMock = mockFetch();
    const api = traceLifecycleApi(ctx);
    const completion: InteractionCompletionInput = {
      terminal_idempotency_key: "terminal-1",
      lease_token: "lease-1",
      lease_epoch: 3,
      completion_manifest_version: "3.0.0",
      answer_artifact_ref: "artifact:answer-1",
      claims: [
        {
          claim_id: "claim-1",
          claim_type: "answer",
          materiality: "material",
          claim_status: "asserted",
          content_artifact_ref: "artifact:answer-1",
          required_support_roles: ["calculation_input"],
          supports: [
            {
              target_ref: "artifact:result-1#summary",
              target_type: "artifact_fragment",
              source_interaction_id: "interaction-1",
              source_revision_id: "revision-1",
              source_operation_id: "operation-1",
              version: "1",
              content_hash: "sha256:evidence",
              fragment_selector: "$.summary",
              role: "calculation_input",
              status: "adopted",
            },
          ],
        },
      ],
      expected_operations: [{ operation_id: "operation-1", required: true }],
      expected_receipts: [{ receipt_id: "receipt-1", required: true }],
      assembler_deadline: "2026-08-01T12:00:00Z",
      completion_reason: "answer_completed",
    };

    await api.startInteraction("conversation-1", {
      idempotency_key: "interaction-1",
      lease_seconds: 60,
    });
    await api.getInteraction("interaction-1");
    await api.completeInteraction("interaction-1", completion);
    await api.failInteraction("interaction-1", completion);
    await api.cancelInteraction("interaction-1", completion);
    await api.handoffInteraction("interaction-1", completion);

    const interactionCalls = calls(fetchMock);
    expect(interactionCalls.map((call) => new URL(call[0]).pathname)).toEqual([
      "/api/agent-observability/v1/conversations/conversation-1/interactions",
      "/api/agent-observability/v1/interactions/interaction-1",
      "/api/agent-observability/v1/interactions/interaction-1/complete",
      "/api/agent-observability/v1/interactions/interaction-1/fail",
      "/api/agent-observability/v1/interactions/interaction-1/cancel",
      "/api/agent-observability/v1/interactions/interaction-1/handoff",
    ]);
    expect(jsonBody(interactionCalls[0]!)).toEqual({
      idempotency_key: "interaction-1",
      lease_seconds: 60,
    });
    for (const call of interactionCalls.slice(2)) {
      expect(jsonBody(call)).toEqual(completion);
    }
  });
});

describe("traceLifecycleApi operations and receipts", () => {
  it("uses the registered operation attempt and receipt paths", async () => {
    const fetchMock = mockFetch();
    const api = traceLifecycleApi(ctx);

    await api.ensureOperation("conversation-1", "interaction-1", {
      operation_key: "operation-key-1",
      tool_name: "vega.run_sql",
      normalized_input_hash: "sha256:input",
      parent_operation_id: "operation-parent",
      causation_event_ids: ["event-1"],
      required: true,
      lease_token: "lease-1",
      lease_epoch: 3,
    });
    await api.getOperation("operation-1");
    await api.retryOperationAttempt("operation-1", {
      lease_token: "lease-1",
      lease_epoch: 3,
    });
    const finishInput = {
      receipt_id: "receipt-1",
      payload_hash: "sha256:payload",
      evidence_durability: "durable" as const,
      retryable: false,
      request_id: "request-1",
      trace_id: "trace-1",
      observed_evidence_refs: [
        {
          evidence_ref: "event:event-1",
          ref_type: "event" as const,
          source_interaction_id: "interaction-1",
          source_revision_id: "revision-1",
          source_operation_id: "operation-1",
          version: "1",
          content_hash: "sha256:evidence",
        },
      ],
      business_refs: [
        {
          ref_type: "object",
          ref_id: "purchase-order-1",
          business_domain_id: "bd_supply_chain",
          version: "7",
          as_of: "2026-08-01T10:00:00Z",
          display_hint: "PO-1",
        },
      ],
      artifact_refs: ["artifact:result-1"],
      partial_reasons: [],
    };
    await api.completeOperationAttempt("operation-1", 1, finishInput);
    await api.failOperationAttempt("operation-1", 2, finishInput);
    await api.getReceipt("receipt-1");

    const operationCalls = calls(fetchMock);
    expect(operationCalls.map((call) => new URL(call[0]).pathname)).toEqual([
      "/api/agent-observability/v1/conversations/conversation-1/interactions/interaction-1/operations:ensure",
      "/api/agent-observability/v1/operations/operation-1",
      "/api/agent-observability/v1/operations/operation-1/attempts",
      "/api/agent-observability/v1/operations/operation-1/attempts/1:complete",
      "/api/agent-observability/v1/operations/operation-1/attempts/2:fail",
      "/api/agent-observability/v1/receipts/receipt-1",
    ]);
    expect(jsonBody(operationCalls[0]!)).toEqual({
      operation_key: "operation-key-1",
      tool_name: "vega.run_sql",
      normalized_input_hash: "sha256:input",
      parent_operation_id: "operation-parent",
      causation_event_ids: ["event-1"],
      required: true,
      lease_token: "lease-1",
      lease_epoch: 3,
    });
    expect(jsonBody(operationCalls[2]!)).toEqual({
      lease_token: "lease-1",
      lease_epoch: 3,
    });
    expect(jsonBody(operationCalls[3]!)).toEqual(finishInput);
    expect(jsonBody(operationCalls[4]!)).toEqual(finishInput);
  });
});

describe("trace lifecycle contract boundaries", () => {
  it.each([
    "generation",
    "on_behalf_of",
    "onBehalfOf",
    "tenant_id",
    "application_principal_id",
    "effective_subject_id",
    "delegation_id",
  ])("rejects forbidden input field %s before fetch", async (field) => {
    const fetchMock = mockFetch();
    const api = traceLifecycleApi(ctx);
    const input = { external_conversation_key: "external-1", [field]: "forbidden" };

    await expect(api.ensureConversation(input)).rejects.toThrow(field);
    expect(calls(fetchMock)).toHaveLength(0);
  });

  it("propagates the existing HttpError with the lifecycle envelope untouched", async () => {
    const envelope = {
      error: {
        code: "receipt_pending",
        message: "receipt is pending",
        retryable: true,
        required_action: "poll_receipt",
        request_id: "request-1",
        retry_after_ms: 100,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(envelope), {
            status: 409,
            statusText: "Conflict",
          }),
      ),
    );

    const error = await traceLifecycleApi(ctx)
      .getReceipt("receipt-1")
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(409);
    expect(JSON.parse((error as HttpError).body)).toEqual(envelope);
  });

  it("exports the required response and error contract names", () => {
    const conversation = {} as ManagedConversation;
    const interaction = {} as ManagedInteraction;
    const operation = {} as ManagedOperation;
    const receipt = {} as OperationReceipt;
    const code: LifecycleErrorCode = "resource_not_disclosed";
    // @ts-expect-error operation_not_found is not registered by the lifecycle error contract.
    const unregisteredCode: LifecycleErrorCode = "operation_not_found";
    // @ts-expect-error internal_error is not registered by the lifecycle error contract.
    const internalError: LifecycleErrorCode = "internal_error";
    type ReceiptHasContent = "content" extends keyof OperationReceipt ? true : false;
    const receiptHasContent: ReceiptHasContent = false;

    expect([
      conversation,
      interaction,
      operation,
      receipt,
      code,
      unregisteredCode,
      internalError,
      receiptHasContent,
    ]).toHaveLength(8);
  });
});
