// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { z } from "zod";
import type { RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON, stringifyBigIntJSON } from "../utils/json-bigint.js";
import type { EvalOperationBodies } from "./eval-inputs.js";
import { EVAL_OPERATIONS, type EvalOperation } from "./eval-operations.js";
import { type RequestInitEx, request } from "./http.js";

export type EvalRequestOptions = Pick<RequestInitEx, "signal" | "timeoutMs">;
export type EvalQuery = NonNullable<RequestInitEx["query"]>;
type PathParameters<P extends string> = P extends `${string}{${infer Key}}${infer Rest}`
  ? Key | PathParameters<Rest>
  : never;
export type EvalOperationInput<K extends EvalOperation> = {
  query?: EvalQuery;
} & (PathParameters<(typeof EVAL_OPERATIONS)[K]["path"]> extends never
  ? { path?: never }
  : { path: Record<PathParameters<(typeof EVAL_OPERATIONS)[K]["path"]>, string | number> }) &
  (K extends keyof EvalOperationBodies ? { body: EvalOperationBodies[K] } : { body?: never });

function segment(value: string | number): string {
  const text = String(value);
  if (!text.trim() || text === "." || text === "..") {
    throw new InputError("Eval path parameters must be non-empty identifiers.");
  }
  return encodeURIComponent(text);
}

/** Closed management surface. Heterogeneous business payloads remain unknown. */
export function evalRequest<K extends EvalOperation>(
  ctx: RequestContext,
  knId: string,
  operation: K,
  input: EvalOperationInput<K>,
  options: EvalRequestOptions = {},
): Promise<unknown> {
  const route = EVAL_OPERATIONS[operation];
  if (!Object.hasOwn(EVAL_OPERATIONS, operation)) throw new InputError("Unknown Eval operation.");
  const params = input.path as Record<string, string | number> | undefined;
  const path = route.path.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params?.[key];
    if (value === undefined) throw new InputError(`Missing Eval path parameter: ${key}.`);
    return segment(value);
  });
  return request(ctx, `/api/bkn-backend/v1/knowledge-networks/${segment(knId)}/evals${path}`, {
    ...options,
    method: route.method,
    query: input.query,
    body: input.body,
    redirect: "manual",
    responseParser: parseBigIntJSON,
  });
}

const identifier = z.string().min(1).max(128);
const token = z.string().length(64);
const agent = z.object({
  name: identifier,
  model: identifier.optional(),
  client_version: identifier.optional(),
});
const runInput = z.object({ run_id: identifier, run_token: token }).strict();
const startInput = z
  .object({
    suite_id: identifier,
    version: z.number().int().min(1),
    agent: agent.strict(),
    idempotency_key: z.string().min(16).max(128),
    data_baseline_id: identifier.optional(),
  })
  .strict();
const submissionInput = runInput
  .extend({
    case_run_id: identifier,
    task_token: token,
    answer: z
      .string()
      .refine(
        (value) => value.trim().length > 0 && Buffer.byteLength(value) <= 262144,
        "Answer must contain 1..262144 UTF-8 bytes.",
      ),
    structured_output: z
      .record(z.unknown())
      .refine(
        (value) => Buffer.byteLength(stringifyBigIntJSON(value)) <= 262144,
        "Structured output must not exceed 262144 UTF-8 bytes.",
      ),
  })
  .strict();
const runView = z.object({
  run_id: identifier,
  run_token: token.optional(),
  agent,
  execution_status: z.string(),
  planned_cases: z.number().int().nonnegative(),
  completed_cases: z.number().int().nonnegative(),
  case_counts: z.record(z.unknown()).optional(),
});
const suitePage = z.object({
  entries: z.array(
    z.object({
      suite_id: identifier,
      name: z.string(),
      version: z.number().int().min(1),
      case_count: z.number().int().nonnegative(),
      members_sha256: z.string(),
    }),
  ),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(50),
});
const task = z.discriminatedUnion("done", [
  z.object({ run_id: identifier, done: z.literal(true) }),
  z.object({
    run_id: identifier,
    done: z.literal(false),
    case_run_id: identifier,
    case_id: identifier,
    case_version: z.number().int().min(1),
    title: z.string(),
    question: z.string(),
    task_token: token,
    expires_at: z.string().datetime({ offset: true }),
    bkn_context: z.record(z.string()),
    instructions: z.string().optional(),
  }),
]);
export type EvalExternalAgent = z.infer<typeof agent>;
export type EvalExternalStartInput = z.infer<typeof startInput>;
export type EvalExternalRunInput = z.infer<typeof runInput>;
export type EvalExternalSubmission = z.infer<typeof submissionInput>;
export type EvalExternalRun = z.infer<typeof runView>;
export type EvalExternalTask = z.infer<typeof task>;
export type EvalExternalSuitePage = z.infer<typeof suitePage>;

/** Participant-only adapter to the tools assembled into the existing KN MCP. */
export function evalParticipantApi(ctx: RequestContext) {
  const call = async <T>(
    knId: string,
    name: string,
    args: object,
    schema: z.ZodType<T>,
    options: EvalRequestOptions,
  ): Promise<T> => {
    identifier.parse(knId);
    const result = await request(ctx, "/api/bkn-backend/v1/eval-mcp/call", {
      ...options,
      method: "POST",
      body: { name, arguments: { ...args, kn_id: knId } },
      redirect: "manual",
      responseParser: parseBigIntJSON,
    });
    return schema.parse(result);
  };
  return {
    listSuites: async (
      knId: string,
      query: { query?: string; page?: number; limit?: number } = {},
      options: EvalRequestOptions = {},
    ) =>
      call(
        knId,
        "bkn_eval_list_suites",
        z
          .object({
            query: identifier.optional(),
            page: z.number().int().min(1).optional(),
            limit: z.number().int().min(1).max(50).optional(),
          })
          .strict()
          .parse(query),
        suitePage,
        options,
      ),
    startRun: async (
      knId: string,
      input: EvalExternalStartInput,
      options: EvalRequestOptions = {},
    ) =>
      call(
        knId,
        "bkn_eval_start_run",
        startInput.parse(input),
        runView.extend({ run_token: token }),
        options,
      ),
    nextCase: async (knId: string, input: EvalExternalRunInput, options: EvalRequestOptions = {}) =>
      call(knId, "bkn_eval_next_case", runInput.parse(input), task, options),
    submitResult: async (
      knId: string,
      input: EvalExternalSubmission,
      options: EvalRequestOptions = {},
    ) => call(knId, "bkn_eval_submit_result", submissionInput.parse(input), runView, options),
    getProgress: async (
      knId: string,
      input: EvalExternalRunInput,
      options: EvalRequestOptions = {},
    ) => call(knId, "bkn_eval_get_progress", runInput.parse(input), runView, options),
  };
}
