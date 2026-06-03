/** Knowledge-network resource surface (the exported SDK API). */
import {
  type ActionLogListOptions,
  type CreateKnOptions,
  type GetKnOptions,
  type ListKnOptions,
  type ListSchemaOptions,
  type SemanticSearchOptions,
  cancelActionLog,
  createKnowledgeNetwork,
  deleteKnowledgeNetwork,
  dryRunMetric,
  getActionExecution,
  getActionLog,
  getKnowledgeNetwork,
  getObjectTypeProperties,
  listActionLogs,
  listActionTypes,
  listKnowledgeNetworks,
  listObjectTypes,
  listRelationTypes,
  queryMetricData,
  queryObjectTypeInstances,
  querySubgraph,
  semanticSearch,
  updateKnowledgeNetwork,
} from "../api/knowledge-networks.js";
import type { RequestContext } from "../types.js";

export function kn(ctx: RequestContext) {
  return {
    list: (opts?: ListKnOptions) => listKnowledgeNetworks(ctx, opts),
    get: (knId: string, opts?: GetKnOptions) => getKnowledgeNetwork(ctx, knId, opts),
    search: (knId: string, query: string, opts?: SemanticSearchOptions) =>
      semanticSearch(ctx, knId, query, opts),
    create: (opts: CreateKnOptions) => createKnowledgeNetwork(ctx, opts),
    update: (knId: string, body: unknown) => updateKnowledgeNetwork(ctx, knId, body),
    delete: (knId: string) => deleteKnowledgeNetwork(ctx, knId),
    subgraph: (knId: string, body: unknown) => querySubgraph(ctx, knId, body),
    actionLogs: (knId: string, opts?: ActionLogListOptions) => listActionLogs(ctx, knId, opts),
    actionLog: (knId: string, logId: string) => getActionLog(ctx, knId, logId),
    cancelActionLog: (knId: string, logId: string) => cancelActionLog(ctx, knId, logId),
    actionExecution: (knId: string, executionId: string) =>
      getActionExecution(ctx, knId, executionId),
    metricQuery: (knId: string, metricId: string, body: unknown) =>
      queryMetricData(ctx, knId, metricId, body),
    metricDryRun: (knId: string, body: unknown) => dryRunMetric(ctx, knId, body),
    objectTypes: (knId: string, opts?: ListSchemaOptions) => listObjectTypes(ctx, knId, opts),
    objectTypeQuery: (knId: string, otId: string, body: unknown) =>
      queryObjectTypeInstances(ctx, knId, otId, body),
    objectTypeProperties: (knId: string, otId: string) => getObjectTypeProperties(ctx, knId, otId),
    relationTypes: (knId: string, opts?: ListSchemaOptions) => listRelationTypes(ctx, knId, opts),
    actionTypes: (knId: string, opts?: ListSchemaOptions) => listActionTypes(ctx, knId, opts),
  };
}
