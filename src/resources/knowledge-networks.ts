import {
  getActionSchedule,
  getConceptGroup,
  getJob,
  getJobTasks,
  listActionSchedules,
  listConceptGroups,
  listJobs,
} from "../api/bkn-backend.js";
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
  createSchemaItem,
  deleteKnowledgeNetwork,
  deleteSchemaItem,
  dryRunMetric,
  executeActionType,
  getActionExecution,
  getActionLog,
  getKnowledgeNetwork,
  getObjectTypeProperties,
  getSchemaItem,
  listActionLogs,
  listActionTypes,
  listKnowledgeNetworks,
  listObjectTypes,
  listRelationTypes,
  queryActionType,
  queryMetricData,
  queryObjectTypeInstances,
  querySubgraph,
  semanticSearch,
  updateKnowledgeNetwork,
  updateSchemaItem,
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
    objectTypeGet: (knId: string, id: string) => getSchemaItem(ctx, knId, "object-types", id),
    objectTypeCreate: (knId: string, body: unknown) =>
      createSchemaItem(ctx, knId, "object-types", body),
    objectTypeUpdate: (knId: string, id: string, body: unknown) =>
      updateSchemaItem(ctx, knId, "object-types", id, body),
    objectTypeDelete: (knId: string, id: string) => deleteSchemaItem(ctx, knId, "object-types", id),
    relationTypes: (knId: string, opts?: ListSchemaOptions) => listRelationTypes(ctx, knId, opts),
    relationTypeGet: (knId: string, id: string) => getSchemaItem(ctx, knId, "relation-types", id),
    relationTypeCreate: (knId: string, body: unknown) =>
      createSchemaItem(ctx, knId, "relation-types", body),
    relationTypeUpdate: (knId: string, id: string, body: unknown) =>
      updateSchemaItem(ctx, knId, "relation-types", id, body),
    relationTypeDelete: (knId: string, id: string) =>
      deleteSchemaItem(ctx, knId, "relation-types", id),
    actionTypes: (knId: string, opts?: ListSchemaOptions) => listActionTypes(ctx, knId, opts),
    actionTypeQuery: (knId: string, atId: string, body: unknown) =>
      queryActionType(ctx, knId, atId, body),
    actionTypeExecute: (knId: string, atId: string, body: unknown) =>
      executeActionType(ctx, knId, atId, body),
    conceptGroups: (knId: string) => listConceptGroups(ctx, knId),
    conceptGroup: (knId: string, cgId: string) => getConceptGroup(ctx, knId, cgId),
    actionSchedules: (knId: string) => listActionSchedules(ctx, knId),
    actionSchedule: (knId: string, scheduleId: string) => getActionSchedule(ctx, knId, scheduleId),
    jobs: (knId: string) => listJobs(ctx, knId),
    job: (knId: string, jobId: string) => getJob(ctx, knId, jobId),
    jobTasks: (knId: string, jobId: string) => getJobTasks(ctx, knId, jobId),
  };
}
