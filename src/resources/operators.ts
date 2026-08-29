// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Operator surface: register a capability, version it, publish it, make it a tool. */
import {
  type DebugOperatorOptions,
  type ListOperatorsOptions,
  type OperatorStatus,
  type RegisterOperatorOptions,
  convertOperatorToTool,
  debugOperator,
  deleteOperators,
  getOperator,
  getOperatorHistoryDetail,
  getOperatorMarketDetail,
  getOperatorNames,
  listOperatorCategories,
  listOperatorHistory,
  listOperatorMarket,
  listOperators,
  registerOperator,
  setOperatorStatus,
  updateOperator,
} from "../api/operators.js";
import type { RequestContext } from "../types.js";

export function operators(ctx: RequestContext) {
  return {
    list: (opts?: ListOperatorsOptions) => listOperators(ctx, opts),
    get: (operatorId: string) => getOperator(ctx, operatorId),
    names: (ids: string[]) => getOperatorNames(ctx, ids),
    categories: () => listOperatorCategories(ctx),
    history: (operatorId: string, version?: string) =>
      version
        ? getOperatorHistoryDetail(ctx, operatorId, version)
        : listOperatorHistory(ctx, operatorId),
    market: (opts?: ListOperatorsOptions) => listOperatorMarket(ctx, opts),
    marketGet: (operatorId: string) => getOperatorMarketDetail(ctx, operatorId),
    register: (opts: RegisterOperatorOptions) => registerOperator(ctx, opts),
    update: (operatorId: string, opts: RegisterOperatorOptions) =>
      updateOperator(ctx, operatorId, opts),
    publish: (ids: string[]) => setOperatorStatus(ctx, ids, "published"),
    offline: (ids: string[]) => setOperatorStatus(ctx, ids, "offline"),
    setStatus: (ids: string[], status: OperatorStatus) => setOperatorStatus(ctx, ids, status),
    delete: (ids: string[]) => deleteOperators(ctx, ids),
    debug: (operatorId: string, opts: DebugOperatorOptions) => debugOperator(ctx, operatorId, opts),
    convertToTool: (operatorId: string, boxId: string, opts?: { useRule?: string }) =>
      convertOperatorToTool(ctx, operatorId, boxId, opts),
  };
}
