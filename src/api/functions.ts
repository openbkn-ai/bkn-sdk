// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Sandbox function client (agent-operator-integration, `/function` + `/template`).
 *
 * This is the layer below an operator: code runs here without being registered
 * as anything, which is what makes it the place to iterate. The entry point is
 * always a function named `handler`, and the response is 200 even when the code
 * throws — `exit_code` decides, not the HTTP status.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";
import { sandboxBudgetMs } from "./sandbox-budget.js";

const PATH = "/api/agent-operator-integration/v1";

/** A third-party package to install in the sandbox before running. */
export interface DependencyInfo {
  name: string;
  version?: string;
}

/** One parameter of a function, as the model will see it. */
export interface ParameterDef {
  name: string;
  /** `integer` is not one of them — the service rejects it with a 400. */
  type?: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  example?: unknown;
  sub_parameters?: ParameterDef[];
}

/**
 * A function with a contract around it. The same shape registers an operator
 * and creates a function tool inside a toolbox, so it is defined once.
 */
export interface FunctionDefinition {
  name: string;
  description?: string;
  scriptType?: string;
  code: string;
  inputs?: ParameterDef[];
  outputs?: ParameterDef[];
  dependencies?: DependencyInfo[];
  dependenciesUrl?: string;
}

/** `FunctionDefinition` as the service spells it. */
export function functionInputBody(def: FunctionDefinition): Record<string, unknown> {
  return {
    name: def.name,
    description: def.description ?? "",
    script_type: def.scriptType ?? "python",
    code: def.code,
    inputs: def.inputs ?? [],
    outputs: def.outputs ?? [],
    ...(def.dependencies?.length ? { dependencies: def.dependencies } : {}),
    ...(def.dependenciesUrl ? { dependencies_url: def.dependenciesUrl } : {}),
  };
}

export interface ExecuteFunctionOptions {
  /** Code exporting `handler(event) -> Any`. Skeleton: `functionTemplate`. */
  code: string;
  /** The single argument `handler` receives. `{}` when there is none. */
  event?: Record<string, unknown>;
  language?: string;
  /** Seconds — the internal `function/exec/{version}` face uses milliseconds. */
  timeout?: number;
  /** Installed before the run, so the first call with one is noticeably slower. */
  dependencies?: DependencyInfo[];
  /** Package index; point it at a mirror on a network that cannot reach PyPI. */
  dependenciesUrl?: string;
  /** Tracing marks written into the sandbox environment, not arguments. */
  source?: string;
  taskId?: string;
  /**
   * The caller's credential, placed in the sandbox's `BKN_TOKEN` so code using
   * `sandbox_sdk.bkn` reaches BKN as the caller. Nothing else fills it — the
   * request's own `authorization` header does not reach the sandbox, verified
   * on a live deploy — and nothing needs it unless the code calls back into
   * BKN, so a caller opts in rather than handing a bearer to every run.
   */
  bknToken?: string;
  /** Hangs the sandbox's own BKN calls under this conversation / interaction. */
  conversationId?: string;
  interactionId?: string;
}

export interface FunctionExecuteResult {
  stdout?: string;
  stderr?: string;
  result?: unknown;
  /** 0 is success. A raised exception still answers HTTP 200 with a non-zero code. */
  exit_code?: number;
  error_message?: string;
  execution_time_ms?: number;
  session_id?: string;
  artifacts?: unknown;
  metrics?: Record<string, number | null>;
}

export function executeFunction(
  ctx: RequestContext,
  opts: ExecuteFunctionOptions,
): Promise<FunctionExecuteResult> {
  return request<FunctionExecuteResult>(ctx, `${PATH}/function/execute`, {
    method: "POST",
    // The sandbox has to boot, install, and run before it answers, and it sends
    // no header until it does — so the abort budget and undici's 300s header
    // deadline both have to move, or a long run dies at 300s regardless.
    timeoutMs: sandboxBudgetMs(opts.timeout),
    headersTimeoutMs: sandboxBudgetMs(opts.timeout),
    body: {
      code: opts.code,
      event: opts.event ?? {},
      ...(opts.language ? { language: opts.language } : {}),
      ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
      ...(opts.dependencies?.length ? { dependencies: opts.dependencies } : {}),
      ...(opts.dependenciesUrl ? { dependencies_url: opts.dependenciesUrl } : {}),
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.taskId ? { task_id: opts.taskId } : {}),
      ...(opts.bknToken ? { bkn_token: opts.bknToken } : {}),
      ...(opts.conversationId ? { bkn_conversation_id: opts.conversationId } : {}),
      ...(opts.interactionId ? { bkn_interaction_id: opts.interactionId } : {}),
    },
  });
}

/**
 * Derive a tool contract from `@tool`-decorated code. Runs the code to do it,
 * so it needs the same rights as executing. Code without `@tool` is not an
 * error: the answer is 200 with `supported: false`.
 */
export function inferFunctionSchema(ctx: RequestContext, code: string): Promise<unknown> {
  return request(ctx, `${PATH}/function/infer-schema`, {
    method: "POST",
    // Deriving a schema runs the code, so it is a sandbox run like any other.
    timeoutMs: sandboxBudgetMs(undefined),
    headersTimeoutMs: sandboxBudgetMs(undefined),
    body: { code },
  });
}

/** Libraries already installed in the sandbox — importable without declaring them. */
export function listFunctionDependencies(ctx: RequestContext): Promise<unknown> {
  return request(ctx, `${PATH}/function/dependencies`);
}

/** Versions of one package, asked of the index live, so an unreachable index fails. */
export function listDependencyVersions(
  ctx: RequestContext,
  packageName: string,
  opts: { pypiRepoUrl?: string; pythonVersion?: string } = {},
): Promise<unknown> {
  return request(ctx, `${PATH}/function/dependency-versions/${encodeURIComponent(packageName)}`, {
    query: {
      pypi_repo_url: opts.pypiRepoUrl,
      python_version: opts.pythonVersion,
    },
  });
}

/** The fill-in-the-blanks skeleton for a language. Only `python` today. */
export function functionTemplate(ctx: RequestContext, templateType = "python"): Promise<unknown> {
  return request(ctx, `${PATH}/template/${encodeURIComponent(templateType)}`);
}
