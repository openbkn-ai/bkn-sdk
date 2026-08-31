import { describe, expect, it, vi } from "vitest";
import type {
  InteractionCompletionInput,
  ManagedConversation,
  ManagedInteraction,
  ManagedOperation,
  OperationReceipt,
  TraceLifecycleApi,
} from "../../src/api/trace-lifecycle.js";
import { ManagedTrace } from "../../src/managed-trace.js";
import { InputError } from "../../src/utils/errors.js";

function conversation(id = "conversation-1"): ManagedConversation {
  return {
    conversation_id: id,
    owner: {
      application_principal_id: "app-1",
      effective_subject_type: "user",
      effective_subject_id: "user-1",
    },
    external_conversation_key: `external-${id}`,
    generation: 1,
    status: "active",
    one_shot: false,
    row_version: 1,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
  };
}

function interaction(id = "interaction-1", conversationId = "conversation-1"): ManagedInteraction {
  return {
    interaction_id: id,
    conversation_id: conversationId,
    ordinal: 1,
    execution_status: "active",
    evidence_status: "assembling",
    lease_token: `lease-${id}`,
    lease_epoch: 1,
    lease_version: 1,
    lease_expires_at: "2026-07-31T01:00:00Z",
    row_version: 1,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
  };
}

function receipt(id = "receipt-1", operationId = "operation-1"): OperationReceipt {
  return {
    receipt_id: id,
    schema_version: "3.0.0",
    owner: conversation().owner,
    conversation_id: "conversation-1",
    interaction_id: "interaction-1",
    operation_id: operationId,
    attempt: 1,
    operation_key: "operation-key-1",
    tool_name: "run_sql",
    receipt_status: "completed",
    evidence_durability: "durable",
    required: true,
    request_id: "request-1",
    trace_id: "4b3d59daeff5bfbb23d46c47a5051ec9",
    causation_event_ids: [],
    observed_evidence_refs: ["event:observed-1"],
    business_refs: [],
    artifact_refs: [],
    partial_reasons: [],
    row_version: 2,
    issued_at: "2026-07-31T00:00:00Z",
  };
}

function operation(id = "operation-1"): ManagedOperation {
  return {
    operation_id: id,
    conversation_id: "conversation-1",
    interaction_id: "interaction-1",
    operation_key: "operation-key-1",
    tool_name: "run_sql",
    attempt: 1,
    attempt_status: "pending",
    retryable: false,
    row_version: 1,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
  };
}

function lifecycleApi() {
  let interactionOrdinal = 0;
  const api = {
    listConversations: vi.fn(),
    ensureConversation: vi.fn(async () => conversation()),
    createNewConversationGeneration: vi.fn(async () => ({ ...conversation(), generation: 2 })),
    resumeConversation: vi.fn(async ({ conversation_id }) => conversation(conversation_id)),
    getConversation: vi.fn(),
    closeConversation: vi.fn(),
    startInteraction: vi.fn(async (conversationId) => {
      interactionOrdinal += 1;
      return interaction(`interaction-${interactionOrdinal}`, conversationId);
    }),
    getInteraction: vi.fn(),
    completeInteraction: vi.fn(async (id, _input) => ({
      ...interaction(id),
      execution_status: "completed" as const,
    })),
    failInteraction: vi.fn(async (id, _input) => ({
      ...interaction(id),
      execution_status: "failed" as const,
    })),
    cancelInteraction: vi.fn(async (id, _input) => ({
      ...interaction(id),
      execution_status: "canceled" as const,
    })),
    handoffInteraction: vi.fn(async (id, _input) => ({
      ...interaction(id),
      execution_status: "handed_off" as const,
    })),
    ensureOperation: vi.fn<TraceLifecycleApi["ensureOperation"]>(async () => ({
      operation: operation(),
      receipt: {
        ...receipt(),
        receipt_status: "pending" as const,
        evidence_durability: "pending" as const,
      },
      created: true,
      execute: true,
    })),
    getOperation: vi.fn<TraceLifecycleApi["getOperation"]>(),
    getOperationAttempt: vi.fn<TraceLifecycleApi["getOperationAttempt"]>(),
    listInteractionOperations: vi.fn<TraceLifecycleApi["listInteractionOperations"]>(),
    retryOperationAttempt: vi.fn<TraceLifecycleApi["retryOperationAttempt"]>(),
    completeOperationAttempt: vi.fn<TraceLifecycleApi["completeOperationAttempt"]>(async () => ({
      operation: { ...operation(), attempt_status: "completed" as const },
      receipt: receipt(),
      created: false,
      execute: false,
    })),
    failOperationAttempt: vi.fn<TraceLifecycleApi["failOperationAttempt"]>(async () => ({
      operation: { ...operation(), attempt_status: "failed" as const },
      receipt: {
        ...receipt(),
        receipt_status: "failed" as const,
        evidence_durability: "durable" as const,
      },
      created: false,
      execute: false,
    })),
    getReceipt: vi.fn(),
  } satisfies TraceLifecycleApi;
  return api;
}

function completion(reason = "answer_completed") {
  return {
    completion_manifest_version: "3.0.0",
    completion_reason: reason,
    claims: [
      {
        claim_id: "claim-1",
        claim_type: "answer",
        materiality: "material" as const,
        claim_status: "asserted" as const,
        content_artifact_ref: "artifact:answer-1",
        required_support_roles: ["calculation_input"],
        supports: [],
      },
    ],
  };
}

describe("ManagedTrace conversation ownership", () => {
  it("coalesces concurrent ensure_current and rejects a second active interaction", async () => {
    const api = lifecycleApi();
    let release: (() => void) | undefined;
    let releaseInteraction: (() => void) | undefined;
    api.ensureConversation.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(conversation());
        }),
    );
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });

    const first = managed.withInteraction(
      { mode: "ensure_current", externalConversationKey: "thread-1" },
      async () => {
        await new Promise<void>((resolve) => {
          releaseInteraction = resolve;
        });
        return completion();
      },
    );
    const second = managed.withInteraction(
      { mode: "ensure_current", externalConversationKey: "thread-1" },
      async () => completion(),
    );
    await vi.waitFor(() => expect(api.ensureConversation).toHaveBeenCalledOnce());
    release?.();
    await expect(second).rejects.toThrow("already has an active interaction");
    releaseInteraction?.();
    await first;

    expect(api.ensureConversation).toHaveBeenCalledWith(
      expect.not.objectContaining({ generation: expect.anything() }),
    );
    expect(api.startInteraction).toHaveBeenCalledOnce();
  });

  it.each([
    [{ mode: "resume_by_id", conversationId: "conversation-existing" }, "resumeConversation"],
    [{ mode: "one_shot" }, "ensureConversation"],
    [
      { mode: "create_new_generation", externalConversationKey: "thread-1" },
      "createNewConversationGeneration",
    ],
  ] as const)("uses the explicit %o strategy", async (strategy, method) => {
    const api = lifecycleApi();
    const managed = new ManagedTrace(api, { idFactory: () => "generated-id" });

    await managed.withInteraction(strategy, async () => completion());

    expect(api[method]).toHaveBeenCalledOnce();
  });

  it.each(["generation", "on_behalf_of", "onBehalfOf"])(
    "rejects caller-owned identity field %s",
    async (field) => {
      const api = lifecycleApi();
      const managed = new ManagedTrace(api);
      const strategy = { mode: "ensure_current", externalConversationKey: "thread-1", [field]: 2 };

      await expect(
        managed.withInteraction(strategy as never, async () => completion()),
      ).rejects.toThrow(field);
      expect(api.ensureConversation).not.toHaveBeenCalled();
    },
  );
});

describe("ManagedTrace interaction lifecycle", () => {
  it("completes exactly once and freezes recorded receipts into the manifest", async () => {
    const api = lifecycleApi();
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });
    const recorded = receipt();

    await managed.withInteraction(
      { mode: "resume_by_id", conversationId: "conversation-1" },
      async (scope) => {
        scope.recordReceipt(recorded);
        expect(scope.bknContext("operation-key-1")).toEqual({
          bkn_context: {
            conversation_id: "conversation-1",
            interaction_id: "interaction-1",
            operation_key: "operation-key-1",
          },
        });
        return completion();
      },
    );

    expect(api.completeInteraction).toHaveBeenCalledOnce();
    const body = api.completeInteraction.mock.calls[0]?.[1] as InteractionCompletionInput;
    expect(body.expected_operations).toEqual([{ operation_id: "operation-1", required: true }]);
    expect(body.expected_receipts).toEqual([{ receipt_id: "receipt-1", required: true }]);
    expect(api.failInteraction).not.toHaveBeenCalled();
  });

  it("fails on callback error without leaking the error as evidence", async () => {
    const api = lifecycleApi();
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });

    await expect(
      managed.withInteraction(
        { mode: "resume_by_id", conversationId: "conversation-1" },
        async () => {
          throw new Error("secret customer value");
        },
      ),
    ).rejects.toThrow("secret customer value");

    expect(api.failInteraction).toHaveBeenCalledOnce();
    expect(JSON.stringify(api.failInteraction.mock.calls[0]?.[1])).not.toContain("secret customer");
  });

  it("does not misclassify an application InputError as a missing completion", async () => {
    const api = lifecycleApi();
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });

    await expect(
      managed.withInteraction(
        { mode: "resume_by_id", conversationId: "conversation-1" },
        async () => {
          throw new InputError("invalid business request");
        },
      ),
    ).rejects.toThrow("invalid business request");

    expect(api.failInteraction.mock.calls[0]?.[1].completion_reason).toBe("callback_failed");
  });

  it("does not complete after an explicit cancel", async () => {
    const api = lifecycleApi();
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });

    await managed.withInteraction(
      { mode: "resume_by_id", conversationId: "conversation-1" },
      async (scope) => {
        await scope.cancel("user_canceled");
        return completion();
      },
    );

    expect(api.cancelInteraction).toHaveBeenCalledOnce();
    expect(api.completeInteraction).not.toHaveBeenCalled();
    expect(api.failInteraction).not.toHaveBeenCalled();
  });

  it("coalesces concurrent terminal actions into one request", async () => {
    const api = lifecycleApi();
    let releaseCancel: (() => void) | undefined;
    api.cancelInteraction.mockImplementation(
      (id) =>
        new Promise((resolve) => {
          releaseCancel = () =>
            resolve({ ...interaction(id), execution_status: "canceled" as const });
        }),
    );
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });

    const run = managed.withInteraction(
      { mode: "resume_by_id", conversationId: "conversation-1" },
      async (scope) => {
        const first = scope.cancel("user_canceled");
        const second = scope.handoff("operator_requested");
        await vi.waitFor(() => expect(api.cancelInteraction).toHaveBeenCalledOnce());
        releaseCancel?.();
        await Promise.all([first, second]);
        return completion();
      },
    );

    await run;
    expect(api.cancelInteraction).toHaveBeenCalledOnce();
    expect(api.handoffInteraction).not.toHaveBeenCalled();
    expect(api.completeInteraction).not.toHaveBeenCalled();
  });

  it("does not auto-adopt observed evidence", async () => {
    const api = lifecycleApi();
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });

    await managed.withInteraction(
      { mode: "resume_by_id", conversationId: "conversation-1" },
      async (scope) => {
        scope.recordReceipt(receipt());
        expect(scope.supportCandidates()).toEqual([
          {
            ref: "event:observed-1",
            state: "observed",
            adopted: false,
          },
        ]);
        return { ...completion(), claims: [] };
      },
    );

    expect(api.completeInteraction.mock.calls[0]?.[1].claims).toEqual([]);
  });

  it("recovers a committed complete response without sending fail", async () => {
    const api = lifecycleApi();
    api.completeInteraction.mockRejectedValue(new Error("response lost after commit"));
    api.getInteraction.mockResolvedValue({
      ...interaction(),
      execution_status: "completed",
    });
    const managed = new ManagedTrace(api, { idFactory: () => "terminal-key" });

    const result = await managed.withInteraction(
      { mode: "resume_by_id", conversationId: "conversation-1" },
      async () => completion(),
    );

    expect(result.execution_status).toBe("completed");
    expect(api.getInteraction).toHaveBeenCalledWith("interaction-1");
    expect(api.failInteraction).not.toHaveBeenCalled();
  });

  it("replays complete once with the same terminal key when Core is still active", async () => {
    const api = lifecycleApi();
    api.completeInteraction
      .mockRejectedValueOnce(new Error("response lost before commit"))
      .mockResolvedValueOnce({ ...interaction(), execution_status: "completed" });
    api.getInteraction.mockResolvedValue(interaction());
    const managed = new ManagedTrace(api, { idFactory: () => "terminal-key" });

    await managed.withInteraction(
      { mode: "resume_by_id", conversationId: "conversation-1" },
      async () => completion(),
    );

    expect(api.completeInteraction).toHaveBeenCalledTimes(2);
    expect(api.completeInteraction.mock.calls[0]?.[1].terminal_idempotency_key).toBe(
      "terminal-key",
    );
    expect(api.completeInteraction.mock.calls[1]?.[1]).toEqual(
      api.completeInteraction.mock.calls[0]?.[1],
    );
    expect(api.failInteraction).not.toHaveBeenCalled();
  });

  it("rejects a conflicting terminal state while recovering complete", async () => {
    const api = lifecycleApi();
    api.completeInteraction.mockRejectedValue(new Error("response lost"));
    api.getInteraction.mockResolvedValue({ ...interaction(), execution_status: "failed" });
    const managed = new ManagedTrace(api, { idFactory: () => "terminal-key" });

    await expect(
      managed.withInteraction(
        { mode: "resume_by_id", conversationId: "conversation-1" },
        async () => completion(),
      ),
    ).rejects.toThrow("conflicts with complete");
    expect(api.failInteraction).not.toHaveBeenCalled();
  });
});

describe("ManagedTrace operation lifecycle", () => {
  it("registers the operation before one business execution and records its receipt", async () => {
    const api = lifecycleApi();
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });
    const businessResult = { rows: 3, entries: [{ purchase_order_number: "PO-240801" }] };
    const execute = vi.fn(async () => businessResult);

    await managed.withInteraction(
      { mode: "resume_by_id", conversationId: "conversation-1" },
      async (scope) => {
        const result = await scope.runOperation(
          {
            operationKey: "operation-key-1",
            toolName: "run_sql",
            input: {
              sql: "SELECT purchase_order_number FROM {{.purchase_orders}} LIMIT 20",
            },
            required: true,
          },
          execute,
        );
        expect(result).toEqual({ value: businessResult, receipt: receipt(), recovered: false });
        return completion();
      },
    );

    expect(api.ensureOperation).toHaveBeenCalledOnce();
    expect(api.ensureOperation.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        input: {
          mode: "inline",
          inline: {
            sql: "SELECT purchase_order_number FROM {{.purchase_orders}} LIMIT 20",
          },
          media_type: "application/json",
        },
      }),
    );
    expect(api.ensureOperation.mock.calls[0]?.[2]).not.toHaveProperty("normalized_input_hash");
    expect(execute).toHaveBeenCalledOnce();
    expect(api.completeOperationAttempt).toHaveBeenCalledWith(
      "operation-1",
      1,
      expect.objectContaining({
        receipt_id: "receipt-1",
        output: {
          mode: "inline",
          inline: businessResult,
          media_type: "application/json",
        },
      }),
    );
    expect(api.completeInteraction.mock.calls[0]?.[1].expected_receipts).toEqual([
      { receipt_id: "receipt-1", required: true },
    ]);
  });

  it("preserves bigint values in inline operation evidence", async () => {
    const api = lifecycleApi();
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });
    const input = { id_card: 110101199001152345n };
    const output = { entries: [{ id_card: 110101199001152345n }] };

    await managed.withInteraction(
      { mode: "resume_by_id", conversationId: "conversation-1" },
      async (scope) => {
        await scope.runOperation({ toolName: "run_sql", input }, async () => output);
        return completion();
      },
    );

    expect(api.ensureOperation.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({ mode: "inline", inline: input }),
      }),
    );
    expect(api.completeOperationAttempt.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        output: expect.objectContaining({ mode: "inline", inline: output }),
      }),
    );
  });

  it("records the actual exception and rethrows the same error object", async () => {
    const api = lifecycleApi();
    api.failOperationAttempt.mockRejectedValue(new Error("Trace Core unavailable"));
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });
    const businessError = Object.assign(new Error("Vega query failed"), {
      name: "BackendError",
      code: "VEGA_QUERY_FAILED",
    });
    let caught: unknown;

    try {
      await managed.withInteraction(
        { mode: "resume_by_id", conversationId: "conversation-1" },
        async (scope) => {
          await scope.runOperation(
            {
              operationKey: "operation-key-1",
              toolName: "run_sql",
              input: { sql: "SELECT * FROM {{.missing_resource}}" },
            },
            async () => {
              throw businessError;
            },
          );
          return completion();
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(businessError);
    expect(api.failOperationAttempt).toHaveBeenCalledWith(
      "operation-1",
      1,
      expect.objectContaining({
        receipt_id: "receipt-1",
        retryable: false,
        error: expect.objectContaining({
          mode: "inline",
          inline: expect.objectContaining({
            name: "BackendError",
            message: "Vega query failed",
            code: "VEGA_QUERY_FAILED",
            stage: "sdk_execution",
            retryable: false,
          }),
        }),
      }),
    );
  });

  it("preserves the business result when terminal Trace persistence fails", async () => {
    const api = lifecycleApi();
    api.completeOperationAttempt.mockRejectedValue(new Error("Trace Core unavailable"));
    const onTraceError = vi.fn();
    const managed = new ManagedTrace(api, { idFactory: () => "id-1", onTraceError });
    const businessResult = { total_count: 1 };
    const execute = vi.fn(async () => businessResult);

    await managed.withInteraction(
      { mode: "resume_by_id", conversationId: "conversation-1" },
      async (scope) => {
        const result = await scope.runOperation(
          {
            operationKey: "operation-key-1",
            toolName: "run_sql",
            input: { sql: "SELECT COUNT(*) FROM {{.purchase_orders}}" },
          },
          execute,
        );
        expect(result).toEqual({
          value: businessResult,
          receipt: expect.objectContaining({ receipt_status: "pending" }),
          recovered: false,
        });
        return completion();
      },
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(onTraceError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Trace Core unavailable" }),
      expect.objectContaining({ operationId: "operation-1", attempt: 1, phase: "complete" }),
    );
  });

  it.each(["pending", "failed"] as const)(
    "does not replay a completed side effect when evidence durability is %s",
    async (evidenceDurability) => {
      const api = lifecycleApi();
      api.ensureOperation.mockResolvedValue({
        operation: { ...operation(), attempt_status: "completed" },
        receipt: {
          ...receipt(),
          receipt_status: "completed",
          evidence_durability: evidenceDurability,
        },
        created: false,
        execute: false,
      });
      const managed = new ManagedTrace(api, { idFactory: () => "id-1" });
      const execute = vi.fn();

      await managed.withInteraction(
        { mode: "resume_by_id", conversationId: "conversation-1" },
        async (scope) => {
          const result = await scope.runOperation(
            {
              operationKey: "operation-key-1",
              toolName: "run_sql",
              input: { sql: "SELECT * FROM {{.purchase_orders}}" },
            },
            execute,
          );
          expect(result.recovered).toBe(true);
          return completion();
        },
      );

      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("does not replay a pending attempt that Core has not authorized for execution", async () => {
    const api = lifecycleApi();
    api.ensureOperation.mockResolvedValue({
      operation: { ...operation(), attempt_status: "pending" },
      receipt: {
        ...receipt(),
        receipt_status: "pending",
        evidence_durability: "pending",
      },
      created: false,
      execute: false,
    });
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });
    const execute = vi.fn();

    await expect(
      managed.withInteraction(
        { mode: "resume_by_id", conversationId: "conversation-1" },
        async (scope) => {
          await scope.runOperation(
            {
              operationKey: "operation-key-1",
              toolName: "execute_action",
              input: { action: "release_purchase_order" },
            },
            execute,
          );
          return completion();
        },
      ),
    ).rejects.toThrow("is pending and is not authorized for execution");
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails the interaction when the authoritative receipt is not retryable", async () => {
    const api = lifecycleApi();
    api.ensureOperation.mockResolvedValue({
      operation: { ...operation(), attempt_status: "failed", retryable: false },
      receipt: {
        ...receipt(),
        receipt_status: "failed",
        evidence_durability: "failed",
      },
      created: false,
      execute: false,
    });
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });
    const execute = vi.fn();

    await expect(
      managed.withInteraction(
        { mode: "resume_by_id", conversationId: "conversation-1" },
        async (scope) => {
          await scope.runOperation(
            {
              operationKey: "operation-key-1",
              toolName: "run_sql",
              input: { sql: "SELECT * FROM {{.purchase_orders}}" },
            },
            execute,
          );
          return completion();
        },
      ),
    ).rejects.toThrow("failed and is not retryable");
    expect(execute).not.toHaveBeenCalled();
    expect(api.failInteraction).toHaveBeenCalledOnce();
  });

  it("creates one authoritative retry attempt before replaying a failed operation", async () => {
    const api = lifecycleApi();
    const failedReceipt = {
      ...receipt(),
      receipt_status: "failed" as const,
      evidence_durability: "failed" as const,
    };
    api.ensureOperation.mockResolvedValueOnce({
      operation: { ...operation(), attempt_status: "failed", retryable: true },
      receipt: failedReceipt,
      created: false,
      execute: false,
    });
    const retryReceipt = {
      ...receipt("receipt-2"),
      attempt: 2,
      receipt_status: "pending" as const,
      evidence_durability: "pending" as const,
    };
    api.retryOperationAttempt.mockResolvedValue({
      operation: { ...operation(), attempt: 2, attempt_status: "ready", retryable: false },
      receipt: retryReceipt,
      created: false,
      execute: false,
    });
    api.ensureOperation.mockResolvedValueOnce({
      operation: { ...operation(), attempt: 2, attempt_status: "pending", retryable: false },
      receipt: retryReceipt,
      created: false,
      execute: true,
    });
    const completedRetry = {
      ...retryReceipt,
      receipt_status: "completed" as const,
      evidence_durability: "durable" as const,
    };
    api.completeOperationAttempt.mockResolvedValue({
      operation: { ...operation(), attempt: 2, attempt_status: "completed" },
      receipt: completedRetry,
      created: false,
      execute: false,
    });
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });
    const execute = vi.fn(async () => "ok");

    await managed.withInteraction(
      { mode: "resume_by_id", conversationId: "conversation-1" },
      async (scope) => {
        const result = await scope.runOperation(
          {
            operationKey: "operation-key-1",
            toolName: "run_sql",
            input: { sql: "SELECT * FROM {{.purchase_orders}}" },
          },
          execute,
        );
        expect(result).toEqual({ value: "ok", receipt: completedRetry, recovered: false });
        return completion();
      },
    );

    expect(api.retryOperationAttempt).toHaveBeenCalledOnce();
    expect(api.ensureOperation).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("stops when the server does not advance the authoritative retry attempt", async () => {
    const api = lifecycleApi();
    const failedReceipt = {
      ...receipt(),
      receipt_status: "failed" as const,
      evidence_durability: "failed" as const,
    };
    api.ensureOperation.mockResolvedValue({
      operation: { ...operation(), attempt: 1, attempt_status: "failed", retryable: true },
      receipt: failedReceipt,
      created: false,
      execute: false,
    });
    api.retryOperationAttempt.mockResolvedValue({
      operation: { ...operation(), attempt: 2, attempt_status: "ready", retryable: false },
      receipt: { ...receipt("receipt-2"), attempt: 2 },
      created: false,
      execute: false,
    });
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });

    await expect(
      managed.withInteraction(
        { mode: "resume_by_id", conversationId: "conversation-1" },
        async (scope) => {
          await scope.runOperation(
            {
              operationKey: "operation-key-1",
              toolName: "run_sql",
              input: { sql: "SELECT 1" },
            },
            async () => "never",
          );
          return completion();
        },
      ),
    ).rejects.toThrow("did not advance beyond attempt 1");
    expect(api.retryOperationAttempt).toHaveBeenCalledOnce();
    expect(api.ensureOperation).toHaveBeenCalledTimes(2);
  });

  it("keeps the business error when Trace cannot advance a retry attempt", async () => {
    const api = lifecycleApi();
    api.ensureOperation.mockResolvedValue({
      operation: { ...operation(), attempt: 1, attempt_status: "pending", retryable: false },
      receipt: {
        ...receipt(),
        receipt_status: "pending" as const,
        evidence_durability: "pending" as const,
      },
      created: true,
      execute: true,
    });
    api.failOperationAttempt.mockResolvedValue({
      operation: { ...operation(), attempt: 1, attempt_status: "failed", retryable: true },
      receipt: {
        ...receipt(),
        receipt_status: "failed" as const,
        evidence_durability: "failed" as const,
      },
      created: false,
      execute: false,
    });
    const businessError = Object.assign(new Error("temporary business failure"), {
      retryable: true,
    });
    const onTraceError = vi.fn();
    const managed = new ManagedTrace(api, { idFactory: () => "id-1", onTraceError });

    await expect(
      managed.withInteraction(
        { mode: "resume_by_id", conversationId: "conversation-1" },
        async (scope) => {
          await scope.runOperation({ toolName: "run_sql", input: { sql: "SELECT 1" } }, async () =>
            Promise.reject(businessError),
          );
          return completion();
        },
      ),
    ).rejects.toBe(businessError);
    expect(onTraceError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operationId: "operation-1", attempt: 1, phase: "fail" }),
    );
  });

  it("retries an execution error only when the error explicitly declares retryable", async () => {
    const api = lifecycleApi();
    const firstReceipt = {
      ...receipt(),
      receipt_status: "pending" as const,
      evidence_durability: "pending" as const,
    };
    const retryReceipt = {
      ...receipt("receipt-2"),
      attempt: 2,
      receipt_status: "pending" as const,
      evidence_durability: "pending" as const,
    };
    api.ensureOperation.mockResolvedValueOnce({
      operation: { ...operation(), attempt: 1, attempt_status: "pending", retryable: false },
      receipt: firstReceipt,
      created: true,
      execute: true,
    });
    api.failOperationAttempt.mockResolvedValue({
      operation: { ...operation(), attempt: 1, attempt_status: "failed", retryable: true },
      receipt: {
        ...firstReceipt,
        receipt_status: "failed" as const,
        evidence_durability: "failed" as const,
      },
      created: false,
      execute: false,
    });
    api.retryOperationAttempt.mockResolvedValue({
      operation: { ...operation(), attempt: 2, attempt_status: "ready", retryable: false },
      receipt: retryReceipt,
      created: false,
      execute: false,
    });
    api.ensureOperation.mockResolvedValueOnce({
      operation: { ...operation(), attempt: 2, attempt_status: "pending", retryable: false },
      receipt: retryReceipt,
      created: false,
      execute: true,
    });
    const completedRetry = {
      ...retryReceipt,
      receipt_status: "completed" as const,
      evidence_durability: "durable" as const,
    };
    api.completeOperationAttempt.mockResolvedValue({
      operation: { ...operation(), attempt: 2, attempt_status: "completed" },
      receipt: completedRetry,
      created: false,
      execute: false,
    });
    const transient = Object.assign(new Error("temporary Vega outage"), {
      code: "VEGA_TEMPORARY_UNAVAILABLE",
      retryable: true,
    });
    const execute = vi.fn().mockRejectedValueOnce(transient).mockResolvedValueOnce("ok");
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });

    await managed.withInteraction(
      { mode: "resume_by_id", conversationId: "conversation-1" },
      async (scope) => {
        await expect(
          scope.runOperation(
            {
              operationKey: "operation-key-1",
              toolName: "run_sql",
              input: { sql: "SELECT * FROM {{.purchase_orders}}" },
            },
            execute,
          ),
        ).resolves.toEqual({ value: "ok", receipt: completedRetry, recovered: false });
        return completion();
      },
    );

    expect(api.failOperationAttempt).toHaveBeenCalledWith(
      "operation-1",
      1,
      expect.objectContaining({ retryable: true }),
    );
    expect(api.retryOperationAttempt).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("honors a caller-configured maximum attempt count", async () => {
    const api = lifecycleApi();
    api.ensureOperation.mockResolvedValue({
      operation: { ...operation(), attempt_status: "failed", retryable: true },
      receipt: {
        ...receipt(),
        receipt_status: "failed",
        evidence_durability: "failed",
      },
      created: false,
      execute: false,
    });
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });

    await expect(
      managed.withInteraction(
        { mode: "resume_by_id", conversationId: "conversation-1" },
        async (scope) => {
          await scope.runOperation(
            {
              operationKey: "operation-key-1",
              toolName: "run_sql",
              input: { sql: "SELECT * FROM {{.purchase_orders}}" },
              maxAttempts: 1,
            },
            vi.fn(),
          );
          return completion();
        },
      ),
    ).rejects.toThrow("maximum attempt count 1");
    expect(api.retryOperationAttempt).not.toHaveBeenCalled();
  });

  it("rejects an invalid maximum attempt count before creating an operation", async () => {
    const api = lifecycleApi();
    const managed = new ManagedTrace(api, { idFactory: () => "id-1" });

    await expect(
      managed.withInteraction(
        { mode: "resume_by_id", conversationId: "conversation-1" },
        async (scope) => {
          await scope.runOperation(
            {
              operationKey: "operation-key-1",
              toolName: "run_sql",
              input: { sql: "SELECT * FROM {{.purchase_orders}}" },
              maxAttempts: 0,
            },
            vi.fn(),
          );
          return completion();
        },
      ),
    ).rejects.toThrow("maxAttempts must be an integer between 1 and 10");
    expect(api.ensureOperation).not.toHaveBeenCalled();
  });
});
