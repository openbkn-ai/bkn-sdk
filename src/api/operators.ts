// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Operator client (agent-operator-integration, `/operator`).
 *
 * An operator is a registered, versioned capability — the thing a sandbox
 * function becomes once it is worth keeping. The Studio calls this surface
 * 函数集. It is one level below a tool: `convertOperatorToTool` puts a copy of
 * an operator into a toolbox, and agents call the tool, not the operator.
 */
import type { RequestContext } from "../types.js";
import {
  type DependencyInfo,
  type FunctionDefinition,
  type ParameterDef,
  functionInputBody,
} from "./functions.js";

export type { ParameterDef };
import { request } from "./http.js";

const PATH = "/api/agent-operator-integration/v1/operator";

/** `unpublish` never shipped, `published` is live, `offline` was withdrawn. */
export type OperatorStatus = "unpublish" | "published" | "offline" | "editing";
export type OperatorMetadataType = "openapi" | "function";

export interface ListOperatorsOptions {
  page?: number;
  pageSize?: number;
  name?: string;
  status?: OperatorStatus;
  category?: string;
  createUser?: string;
  operatorType?: "basic" | "composite";
  isDataSource?: boolean;
  all?: boolean;
  sortBy?: string;
  sortOrder?: string;
}

function listQuery(
  opts: ListOperatorsOptions,
): Record<string, string | number | boolean | undefined> {
  return {
    page: opts.page,
    page_size: opts.pageSize,
    name: opts.name,
    status: opts.status,
    category: opts.category,
    create_user: opts.createUser,
    operator_type: opts.operatorType,
    is_data_source: opts.isDataSource,
    all: opts.all ? true : undefined,
    sort_by: opts.sortBy,
    sort_order: opts.sortOrder,
  };
}

/** Every operator in the workspace, published or not. Answers `{data, total, …}`. */
export function listOperators(
  ctx: RequestContext,
  opts: ListOperatorsOptions = {},
): Promise<unknown> {
  return request(ctx, `${PATH}/info/list`, { query: listQuery(opts) });
}

/**
 * The market view: only `published` and `offline` exist here. Asking it for
 * `unpublish` or `editing` is a 400, which is the difference from `info/list`.
 */
export function listOperatorMarket(
  ctx: RequestContext,
  opts: ListOperatorsOptions = {},
): Promise<unknown> {
  return request(ctx, `${PATH}/market`, { query: listQuery(opts) });
}

export function getOperator(ctx: RequestContext, operatorId: string): Promise<unknown> {
  return request(ctx, `${PATH}/info/${encodeURIComponent(operatorId)}`);
}

export function getOperatorMarketDetail(ctx: RequestContext, operatorId: string): Promise<unknown> {
  return request(ctx, `${PATH}/market/${encodeURIComponent(operatorId)}`);
}

/** Versions this operator has published. */
export function listOperatorHistory(ctx: RequestContext, operatorId: string): Promise<unknown> {
  return request(ctx, `${PATH}/history/${encodeURIComponent(operatorId)}`);
}

export function getOperatorHistoryDetail(
  ctx: RequestContext,
  operatorId: string,
  version: string,
): Promise<unknown> {
  return request(
    ctx,
    `${PATH}/history/${encodeURIComponent(operatorId)}/${encodeURIComponent(version)}`,
  );
}

/**
 * Ids to names. Ids that do not exist are dropped silently rather than reported,
 * so a caller who needs to know which ones missed has to compare the two lists.
 */
export function getOperatorNames(ctx: RequestContext, ids: string[]): Promise<unknown> {
  return request(ctx, `${PATH}/names`, { method: "POST", body: { ids } });
}

/** The categories `register --category` and `list --category` accept. */
export function listOperatorCategories(ctx: RequestContext): Promise<unknown> {
  return request(ctx, `${PATH}/category`);
}

export interface RegisterOperatorOptions {
  metadataType: OperatorMetadataType;
  description?: string;
  category?: string;
  operatorType?: "basic" | "composite";
  executionMode?: "sync" | "async" | "stream";
  isDataSource?: boolean;
  /** Milliseconds, unlike the sandbox's seconds. */
  timeout?: number;
  /** Required for `function`: the code and the contract around it. */
  function?: FunctionDefinition;
  /** Required for `openapi`: the specification, as text. */
  data?: string;
  /** Register and publish in one step instead of registering into `unpublish`. */
  directPublish?: boolean;
}

function registerBody(opts: RegisterOperatorOptions): Record<string, unknown> {
  return {
    operator_metadata_type: opts.metadataType,
    ...(opts.description ? { description: opts.description } : {}),
    operator_info: {
      operator_type: opts.operatorType ?? "basic",
      execution_mode: opts.executionMode ?? "sync",
      category: opts.category ?? "other_category",
      ...(opts.isDataSource !== undefined ? { is_data_source: opts.isDataSource } : {}),
    },
    ...(opts.timeout !== undefined ? { operator_execute_control: { timeout: opts.timeout } } : {}),
    ...(opts.function ? { function_input: functionInputBody(opts.function) } : {}),
    ...(opts.data ? { data: opts.data } : {}),
    ...(opts.directPublish ? { direct_publish: true } : {}),
  };
}

export function registerOperator(
  ctx: RequestContext,
  opts: RegisterOperatorOptions,
): Promise<unknown> {
  return request(ctx, `${PATH}/register`, { method: "POST", body: registerBody(opts) });
}

/** Replace an operator's definition wholesale — the register body plus an id. */
export function updateOperator(
  ctx: RequestContext,
  operatorId: string,
  opts: RegisterOperatorOptions,
): Promise<unknown> {
  return request(ctx, `${PATH}/info/update`, {
    method: "POST",
    body: { operator_id: operatorId, ...registerBody(opts) },
  });
}

/** Publish (`published`) or withdraw from the market (`offline`), in bulk. */
export function setOperatorStatus(
  ctx: RequestContext,
  ids: string[],
  status: OperatorStatus,
): Promise<unknown> {
  return request(ctx, `${PATH}/status`, {
    method: "POST",
    body: ids.map((operator_id) => ({ operator_id, status })),
  });
}

/** DELETE carrying a body, and an array at that — not a path parameter. */
export function deleteOperators(ctx: RequestContext, ids: string[]): Promise<unknown> {
  return request(ctx, `${PATH}/delete`, {
    method: "DELETE",
    body: ids.map((operator_id) => ({ operator_id })),
  });
}

export interface DebugOperatorOptions {
  /** Required: debug runs a named version, never "the current one". */
  version: string;
  header?: Record<string, unknown>;
  query?: Record<string, unknown>;
  path?: Record<string, unknown>;
  body?: unknown;
  timeout?: number;
}

/** Run one version and see the request and response. Function operators use `body`. */
export function debugOperator(
  ctx: RequestContext,
  operatorId: string,
  opts: DebugOperatorOptions,
): Promise<unknown> {
  return request(ctx, `${PATH}/debug`, {
    method: "POST",
    timeoutMs: Math.max(60_000, (opts.timeout ?? 0) * 1000 + 30_000),
    body: {
      operator_id: operatorId,
      version: opts.version,
      ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
      header: opts.header ?? {},
      query: opts.query ?? {},
      path: opts.path ?? {},
      body: opts.body ?? {},
    },
  });
}

/**
 * Copy an operator into a toolbox as a tool, keeping the lineage between them.
 * The path sits under `/operator/` but what it produces is a tool.
 */
export function convertOperatorToTool(
  ctx: RequestContext,
  operatorId: string,
  boxId: string,
  opts: { useRule?: string } = {},
): Promise<unknown> {
  return request(ctx, "/api/agent-operator-integration/v1/operator/convert/tool", {
    method: "POST",
    body: {
      operator_id: operatorId,
      box_id: boxId,
      ...(opts.useRule ? { use_rule: opts.useRule } : {}),
    },
  });
}
