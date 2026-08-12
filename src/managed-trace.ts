// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { randomUUID } from "node:crypto";
import type {
  InteractionCompletionInput,
  ManagedConversation,
  ManagedInteraction,
  ManagedOperation,
  OperationReceipt,
  PayloadEnvelope,
  TraceLifecycleApi,
} from "./api/trace-lifecycle.js";
import { InputError } from "./utils/errors.js";

const FORBIDDEN_INPUT_FIELDS = ["generation", "on_behalf_of", "onBehalfOf"] as const;

class CompletionMissingError extends InputError {}
class OperationFailedError extends InputError {}
class OperationPendingError extends InputError {}

export type ConversationStrategy =
  | { mode: "resume_by_id"; conversationId: string }
  | { mode: "ensure_current"; externalConversationKey: string }
  | { mode: "one_shot"; externalConversationKey?: string }
  | { mode: "create_new_generation"; externalConversationKey: string };

export type ManagedCompletionInput = Omit<
  InteractionCompletionInput,
  "terminal_idempotency_key" | "lease_token" | "lease_epoch"
>;

export interface BknBusinessContext {
  bkn_context: {
    conversation_id: string;
    interaction_id: string;
    operation_key: string;
    parent_operation_id?: string;
    causation_event_ids?: string[];
  };
}

export interface SupportCandidate {
  ref: string;
  state: "observed";
  adopted: false;
}

export interface ManagedInteractionScope {
  conversation: ManagedConversation;
  interaction: ManagedInteraction;
  bknContext(
    operationKey: string,
    parentOperationId?: string,
    causationEventIds?: string[],
  ): BknBusinessContext;
  recordReceipt(receipt: OperationReceipt): void;
  supportCandidates(): SupportCandidate[];
  runOperation<T>(
    input: ManagedOperationInput,
    execute: (call: ManagedOperationCall) => Promise<T>,
  ): Promise<ManagedOperationResult<T>>;
  cancel(reason: string): Promise<ManagedInteraction>;
  handoff(reason: string): Promise<ManagedInteraction>;
}

export interface ManagedOperationInput {
  operationKey?: string;
  toolName: string;
  input: unknown;
  parentOperationId?: string;
  causationEventIds?: string[];
  required?: boolean;
  /** Maximum authoritative attempt ordinal, including the current attempt. */
  maxAttempts?: number;
}

export interface ManagedOperationCall {
  context: BknBusinessContext;
  operation: ManagedOperation;
  receipt: OperationReceipt;
}

export type ManagedOperationResult<T> =
  | { value: T; receipt: OperationReceipt; recovered: false }
  | { value: undefined; receipt: OperationReceipt; recovered: true };

export interface ManagedTraceOptions {
  idFactory?: () => string;
  /** Report Trace persistence failures without replacing the business result/error. */
  onTraceError?: (
    error: unknown,
    context: { operationId: string; attempt: number; phase: "complete" | "fail" },
  ) => void;
}

export class ManagedTrace {
  private readonly idFactory: () => string;
  private readonly onTraceError?: ManagedTraceOptions["onTraceError"];
  private readonly pendingConversations = new Map<string, Promise<ManagedConversation>>();
  private readonly activeConversationIds = new Set<string>();

  constructor(
    private readonly api: TraceLifecycleApi,
    options: ManagedTraceOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.onTraceError = options.onTraceError;
  }

  async withInteraction(
    strategy: ConversationStrategy,
    callback: (scope: ManagedInteractionScope) => Promise<ManagedCompletionInput>,
  ): Promise<ManagedInteraction> {
    assertSafeStrategy(strategy);
    const conversation = await this.resolveConversation(strategy);
    if (this.activeConversationIds.has(conversation.conversation_id)) {
      throw new InputError(
        `Conversation "${conversation.conversation_id}" already has an active interaction`,
      );
    }
    this.activeConversationIds.add(conversation.conversation_id);
    try {
      const interaction = await this.api.startInteraction(conversation.conversation_id, {
        idempotency_key: this.idFactory(),
      });
      const receipts = new Map<string, OperationReceipt>();
      let terminal: ManagedInteraction | undefined;
      let terminalAction: Promise<ManagedInteraction> | undefined;

      const terminalInput = (reason: string): InteractionCompletionInput => ({
        terminal_idempotency_key: this.idFactory(),
        lease_token: interaction.lease_token,
        lease_epoch: interaction.lease_epoch,
        completion_manifest_version: "3.0.0",
        completion_reason: reason,
        claims: [],
        expected_operations: expectedOperations(receipts.values()),
        expected_receipts: expectedReceipts(receipts.values()),
      });

      const scope: ManagedInteractionScope = {
        conversation,
        interaction,
        bknContext: (operationKey, parentOperationId, causationEventIds) => ({
          bkn_context: {
            conversation_id: conversation.conversation_id,
            interaction_id: interaction.interaction_id,
            operation_key: operationKey,
            ...(parentOperationId ? { parent_operation_id: parentOperationId } : {}),
            ...(causationEventIds?.length ? { causation_event_ids: causationEventIds } : {}),
          },
        }),
        recordReceipt: (receipt) => {
          if (
            receipt.conversation_id !== conversation.conversation_id ||
            receipt.interaction_id !== interaction.interaction_id
          ) {
            throw new InputError("Receipt does not belong to the active managed interaction");
          }
          receipts.set(receipt.receipt_id, receipt);
        },
        supportCandidates: () =>
          [...receipts.values()].flatMap((receipt) =>
            receipt.observed_evidence_refs.map((ref) => ({
              ref,
              state: "observed" as const,
              adopted: false as const,
            })),
          ),
        runOperation: async <T>(
          input: ManagedOperationInput,
          execute: (call: ManagedOperationCall) => Promise<T>,
        ) =>
          this.runOperation(
            conversation,
            interaction,
            input,
            execute,
            scope.bknContext,
            scope.recordReceipt,
          ),
        cancel: async (reason) => {
          terminalAction ??= this.api.cancelInteraction(
            interaction.interaction_id,
            terminalInput(reason),
          );
          terminal = await terminalAction;
          return terminal;
        },
        handoff: async (reason) => {
          terminalAction ??= this.api.handoffInteraction(
            interaction.interaction_id,
            terminalInput(reason),
          );
          terminal = await terminalAction;
          return terminal;
        },
      };

      let completion: ManagedCompletionInput;
      try {
        completion = await callback(scope);
        if (terminalAction) return await terminalAction;
        if (terminal) return terminal;
        if (!completion || typeof completion !== "object") {
          throw new CompletionMissingError(
            "Interaction callback must return a completion manifest",
          );
        }
      } catch (error) {
        if (!terminalAction && !terminal) {
          try {
            terminal = await this.api.failInteraction(
              interaction.interaction_id,
              terminalInput(
                error instanceof CompletionMissingError ? "completion_missing" : "callback_failed",
              ),
            );
          } catch {
            // Preserve the application error; server-side lease recovery handles unfinished interactions.
          }
        }
        throw error;
      }

      const completionInput: InteractionCompletionInput = {
        ...completion,
        terminal_idempotency_key: this.idFactory(),
        lease_token: interaction.lease_token,
        lease_epoch: interaction.lease_epoch,
        expected_operations:
          completion.expected_operations ?? expectedOperations(receipts.values()),
        expected_receipts: completion.expected_receipts ?? expectedReceipts(receipts.values()),
      };
      try {
        return await this.api.completeInteraction(interaction.interaction_id, completionInput);
      } catch (completeError) {
        let current: ManagedInteraction;
        try {
          current = await this.api.getInteraction(interaction.interaction_id);
        } catch {
          throw completeError;
        }
        if (current.execution_status === "completed") return current;
        if (current.execution_status !== "active") {
          throw new InputError(
            `Interaction terminal state "${current.execution_status}" conflicts with complete`,
          );
        }
        return await this.api.completeInteraction(interaction.interaction_id, completionInput);
      }
    } finally {
      this.activeConversationIds.delete(conversation.conversation_id);
    }
  }

  private async resolveConversation(strategy: ConversationStrategy): Promise<ManagedConversation> {
    switch (strategy.mode) {
      case "resume_by_id":
        return await this.api.resumeConversation({ conversation_id: strategy.conversationId });
      case "create_new_generation":
        return await this.api.createNewConversationGeneration({
          external_conversation_key: strategy.externalConversationKey,
          idempotency_key: this.idFactory(),
        });
      case "one_shot":
        return await this.api.ensureConversation({
          external_conversation_key:
            strategy.externalConversationKey ?? `one-shot-${this.idFactory()}`,
          idempotency_key: this.idFactory(),
          one_shot: true,
        });
      case "ensure_current":
        return await this.ensureCurrent(strategy.externalConversationKey);
    }
  }

  private async ensureCurrent(externalConversationKey: string): Promise<ManagedConversation> {
    const pending = this.pendingConversations.get(externalConversationKey);
    if (pending) return await pending;

    const request = this.api.ensureConversation({
      external_conversation_key: externalConversationKey,
      idempotency_key: this.idFactory(),
    });
    this.pendingConversations.set(externalConversationKey, request);
    try {
      return await request;
    } finally {
      if (this.pendingConversations.get(externalConversationKey) === request) {
        this.pendingConversations.delete(externalConversationKey);
      }
    }
  }

  private async runOperation<T>(
    conversation: ManagedConversation,
    interaction: ManagedInteraction,
    input: ManagedOperationInput,
    execute: (call: ManagedOperationCall) => Promise<T>,
    bknContext: ManagedInteractionScope["bknContext"],
    recordReceipt: ManagedInteractionScope["recordReceipt"],
  ): Promise<ManagedOperationResult<T>> {
    const operationKey = input.operationKey ?? this.idFactory();
    const maxAttempts = input.maxAttempts ?? 2;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw new InputError("maxAttempts must be an integer between 1 and 10");
    }
    const ensureInput = {
      operation_key: operationKey,
      tool_name: input.toolName,
      protocol: "sdk" as const,
      source_module: "managed-trace-sdk",
      input: payloadEnvelope(input.input),
      parent_operation_id: input.parentOperationId,
      causation_event_ids: input.causationEventIds,
      required: input.required ?? true,
      lease_token: interaction.lease_token,
      lease_epoch: interaction.lease_epoch,
    };
    let current = await this.api.ensureOperation(
      conversation.conversation_id,
      interaction.interaction_id,
      ensureInput,
    );

    while (true) {
      if (isCompletedReceipt(current.receipt)) {
        recordReceipt(current.receipt);
        return { value: undefined, receipt: current.receipt, recovered: true };
      }
      if (isFailedReceipt(current.receipt)) {
        recordReceipt(current.receipt);
        if (!current.operation.retryable) {
          throw new OperationFailedError(
            `Operation "${current.operation.operation_id}" failed and is not retryable`,
          );
        }
        if (current.operation.attempt >= maxAttempts) {
          throw new OperationFailedError(
            `Operation "${current.operation.operation_id}" reached maximum attempt count ${maxAttempts}`,
          );
        }
        await this.api.retryOperationAttempt(current.operation.operation_id, {
          lease_token: interaction.lease_token,
          lease_epoch: interaction.lease_epoch,
        });
        const previousAttempt = current.operation.attempt;
        current = await this.api.ensureOperation(
          conversation.conversation_id,
          interaction.interaction_id,
          ensureInput,
        );
        if (current.operation.attempt <= previousAttempt) {
          throw new OperationFailedError(
            `Operation "${current.operation.operation_id}" did not advance beyond attempt ${previousAttempt}`,
          );
        }
        continue;
      }
      if (!current.execute) {
        throw new OperationPendingError(
          `Operation "${current.operation.operation_id}" is pending and is not authorized for execution`,
        );
      }

      let value: T;
      try {
        value = await execute({
          context: bknContext(operationKey, input.parentOperationId, input.causationEventIds),
          operation: current.operation,
          receipt: current.receipt,
        });
      } catch (executeError) {
        const retryable = isExplicitlyRetryable(executeError);
        try {
          const failed = await this.api.failOperationAttempt(
            current.operation.operation_id,
            current.operation.attempt,
            {
              receipt_id: current.receipt.receipt_id,
              error: payloadEnvelope(operationError(executeError)),
              evidence_durability: "durable",
              retryable,
            },
          );
          recordReceipt(failed.receipt);
        } catch (traceError) {
          this.reportTraceError(traceError, current.operation, "fail");
          recordReceipt(current.receipt);
          throw executeError;
        }
        if (!retryable || current.operation.attempt >= maxAttempts) {
          throw executeError;
        }
        await this.api.retryOperationAttempt(current.operation.operation_id, {
          lease_token: interaction.lease_token,
          lease_epoch: interaction.lease_epoch,
        });
        const previousAttempt = current.operation.attempt;
        current = await this.api.ensureOperation(
          conversation.conversation_id,
          interaction.interaction_id,
          ensureInput,
        );
        if (current.operation.attempt <= previousAttempt) {
          throw new OperationFailedError(
            `Operation "${current.operation.operation_id}" did not advance beyond attempt ${previousAttempt}`,
          );
        }
        continue;
      }

      try {
        const completed = await this.api.completeOperationAttempt(
          current.operation.operation_id,
          current.operation.attempt,
          {
            receipt_id: current.receipt.receipt_id,
            output: payloadEnvelope(value),
            evidence_durability: "durable",
            retryable: false,
          },
        );
        recordReceipt(completed.receipt);
        return { value, receipt: completed.receipt, recovered: false };
      } catch (traceError) {
        // The business call already completed. Trace terminal persistence must
        // not replace or hide the application result.
        this.reportTraceError(traceError, current.operation, "complete");
        recordReceipt(current.receipt);
        return { value, receipt: current.receipt, recovered: false };
      }
    }
  }

  private reportTraceError(
    error: unknown,
    operation: ManagedOperation,
    phase: "complete" | "fail",
  ): void {
    try {
      this.onTraceError?.(error, {
        operationId: operation.operation_id,
        attempt: operation.attempt,
        phase,
      });
    } catch {
      // Observability reporting must not alter the application result or error.
    }
  }
}

function assertSafeStrategy(strategy: ConversationStrategy): void {
  if (!strategy || typeof strategy !== "object") {
    throw new InputError("A conversation strategy is required");
  }
  for (const field of FORBIDDEN_INPUT_FIELDS) {
    if (field in strategy) throw new InputError(`Lifecycle input field "${field}" is not allowed`);
  }
}

function expectedOperations(receipts: Iterable<OperationReceipt>) {
  const operations = new Map<string, boolean>();
  for (const receipt of receipts) {
    operations.set(
      receipt.operation_id,
      (operations.get(receipt.operation_id) ?? false) || receipt.required,
    );
  }
  return [...operations].map(([operation_id, required]) => ({ operation_id, required }));
}

function expectedReceipts(receipts: Iterable<OperationReceipt>) {
  return [...receipts].map((receipt) => ({
    receipt_id: receipt.receipt_id,
    required: receipt.required,
  }));
}

function isCompletedReceipt(receipt: OperationReceipt): boolean {
  return receipt.receipt_status === "completed";
}

function isFailedReceipt(receipt: OperationReceipt): boolean {
  return receipt.receipt_status === "failed";
}

const MAX_INLINE_PAYLOAD_BYTES = 1 << 20;

function payloadEnvelope(value: unknown): PayloadEnvelope {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return {
        mode: "omitted",
        media_type: "application/json",
        byte_length: 0,
        omitted_reason: "serialization_failed",
      };
    }
    const byteLength = Buffer.byteLength(serialized);
    if (byteLength > MAX_INLINE_PAYLOAD_BYTES) {
      return {
        mode: "omitted",
        media_type: "application/json",
        byte_length: byteLength,
        omitted_reason: "payload_too_large",
      };
    }
    return { mode: "inline", media_type: "application/json", inline: JSON.parse(serialized) };
  } catch {
    return {
      mode: "omitted",
      media_type: "application/json",
      byte_length: 0,
      omitted_reason: "serialization_failed",
    };
  }
}

function operationError(error: unknown): Record<string, unknown> {
  const retryable = isExplicitlyRetryable(error);
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      name: error.name,
      message: error.message,
      ...(typeof code === "string" && code
        ? { code }
        : { code: error.name || "sdk_operation_error" }),
      stage: "sdk_execution",
      retryable,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return {
    name: "NonErrorThrown",
    message: String(error),
    code: "sdk_operation_error",
    stage: "sdk_execution",
    retryable,
  };
}

function isExplicitlyRetryable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    (error as { retryable?: unknown }).retryable === true
  );
}
