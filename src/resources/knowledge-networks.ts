import {
  addConceptGroupMembers,
  createActionSchedule,
  createConceptGroup,
  deleteActionSchedules,
  deleteConceptGroup,
  deleteJobs,
  getActionSchedule,
  getConceptGroup,
  getJob,
  getJobTasks,
  listActionSchedules,
  listConceptGroups,
  listJobs,
  removeConceptGroupMembers,
  setActionScheduleStatus,
  updateActionSchedule,
  updateConceptGroup,
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
    conceptGroupCreate: (knId: string, body: unknown) => createConceptGroup(ctx, knId, body),
    conceptGroupUpdate: (knId: string, cgId: string, body: unknown) =>
      updateConceptGroup(ctx, knId, cgId, body),
    conceptGroupDelete: (knId: string, cgId: string) => deleteConceptGroup(ctx, knId, cgId),
    conceptGroupAddMembers: (knId: string, cgId: string, body: unknown) =>
      addConceptGroupMembers(ctx, knId, cgId, body),
    conceptGroupRemoveMembers: (knId: string, cgId: string, otIds: string) =>
      removeConceptGroupMembers(ctx, knId, cgId, otIds),
    actionSchedules: (knId: string) => listActionSchedules(ctx, knId),
    actionSchedule: (knId: string, scheduleId: string) => getActionSchedule(ctx, knId, scheduleId),
    actionScheduleCreate: (knId: string, body: unknown) => createActionSchedule(ctx, knId, body),
    actionScheduleUpdate: (knId: string, scheduleId: string, body: unknown) =>
      updateActionSchedule(ctx, knId, scheduleId, body),
    actionScheduleSetStatus: (knId: string, scheduleId: string, body: unknown) =>
      setActionScheduleStatus(ctx, knId, scheduleId, body),
    actionScheduleDelete: (knId: string, ids: string) => deleteActionSchedules(ctx, knId, ids),
    jobs: (knId: string) => listJobs(ctx, knId),
    job: (knId: string, jobId: string) => getJob(ctx, knId, jobId),
    jobTasks: (knId: string, jobId: string) => getJobTasks(ctx, knId, jobId),
    jobDelete: (knId: string, ids: string) => deleteJobs(ctx, knId, ids),
  };
}
