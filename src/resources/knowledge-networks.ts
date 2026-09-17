// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  type ActionScheduleListOptions,
  type BknImportOptions,
  type BknResourceListOptions,
  type CapabilityAttachEntry,
  type CapabilityListOptions,
  type ConceptGroupGetOptions,
  type ConceptGroupListOptions,
  addConceptGroupMembers,
  attachCapabilities,
  createActionSchedule,
  createConceptGroup,
  deleteActionSchedules,
  deleteConceptGroup,
  detachCapabilities,
  downloadBkn,
  getActionSchedule,
  getConceptGroup,
  listActionSchedules,
  listBknResources,
  listCapabilities,
  listConceptGroups,
  relationTypePaths,
  removeConceptGroupMembers,
  runCypherQuery,
  setActionScheduleStatus,
  updateActionSchedule,
  updateConceptGroup,
  uploadBkn,
} from "../api/bkn-backend.js";
/** Knowledge-network resource surface (the exported SDK API). */
import {
  type ActionLogGetOptions,
  type ActionLogListOptions,
  type ActionTypeQueryOptions,
  type CreateKnOptions,
  type DeleteSchemaItemOptions,
  type GetKnOptions,
  type ListActionTypesOptions,
  type ListKnOptions,
  type ListMetricsOptions,
  type ListObjectTypesOptions,
  type ListRelationTypesOptions,
  type MetricReadOptions,
  type ObjectQueryOptions,
  type SearchInstanceOptions,
  type SubgraphQueryOptions,
  type UpdateSchemaItemOptions,
  cancelActionLog,
  createKnowledgeNetwork,
  createMetric,
  createSchemaItem,
  deleteKnowledgeNetwork,
  deleteMetric,
  deleteSchemaItem,
  dryRunMetric,
  executeActionType,
  getActionExecution,
  getActionLog,
  getKnowledgeNetwork,
  getMetric,
  getSchemaItem,
  listActionLogs,
  listActionTypes,
  listKnowledgeNetworks,
  listMetrics,
  listObjectTypes,
  listRelationTypes,
  queryActionType,
  queryMetricData,
  queryObjectTypeInstances,
  querySubgraph,
  searchInstance,
  updateKnowledgeNetwork,
  updateMetric,
  updateSchemaItem,
  validateMetric,
} from "../api/knowledge-networks.js";
import type { RequestContext } from "../types.js";
import { validateBknDirectory } from "../utils/bkn-validate.js";
import { InputError } from "../utils/errors.js";
import { extractTarToDirectory, packDirectoryToTar } from "../utils/tar.js";
import { type CreateFromCatalogOptions, createFromCatalog } from "./bkn-create.js";

export function kn(ctx: RequestContext) {
  return {
    list: (opts?: ListKnOptions) => listKnowledgeNetworks(ctx, opts),
    get: (knId: string, opts?: GetKnOptions) => getKnowledgeNetwork(ctx, knId, opts),
    search: (knId: string, query: string, opts?: SearchInstanceOptions) =>
      searchInstance(ctx, knId, query, opts),
    create: (opts: CreateKnOptions) => createKnowledgeNetwork(ctx, opts),
    update: (knId: string, body: unknown) => updateKnowledgeNetwork(ctx, knId, body),
    delete: (knId: string) => deleteKnowledgeNetwork(ctx, knId),
    subgraph: (knId: string, body: unknown, opts?: SubgraphQueryOptions) =>
      querySubgraph(ctx, knId, body, opts),
    actionLogs: (knId: string, opts?: ActionLogListOptions) => listActionLogs(ctx, knId, opts),
    actionLog: (knId: string, logId: string, opts?: ActionLogGetOptions) =>
      getActionLog(ctx, knId, logId, opts),
    cancelActionLog: (knId: string, logId: string, opts?: { reason?: string }) =>
      cancelActionLog(ctx, knId, logId, opts),
    actionExecution: (knId: string, executionId: string) =>
      getActionExecution(ctx, knId, executionId),
    metricQuery: (knId: string, metricId: string, body: unknown, opts?: MetricReadOptions) =>
      queryMetricData(ctx, knId, metricId, body, opts),
    metricDryRun: (knId: string, body: unknown, opts?: MetricReadOptions) =>
      dryRunMetric(ctx, knId, body, opts),
    metricList: (knId: string, opts?: ListMetricsOptions) => listMetrics(ctx, knId, opts),
    metricGet: (knId: string, metricId: string) => getMetric(ctx, knId, metricId),
    metricCreate: (knId: string, body: unknown, opts?: { branch?: string }) =>
      createMetric(ctx, knId, body, opts),
    metricUpdate: (knId: string, metricId: string, body: unknown) =>
      updateMetric(ctx, knId, metricId, body),
    metricDelete: (knId: string, metricId: string) => deleteMetric(ctx, knId, metricId),
    metricValidate: (knId: string, body: unknown) => validateMetric(ctx, knId, body),
    objectTypes: (knId: string, opts?: ListObjectTypesOptions) => listObjectTypes(ctx, knId, opts),
    objectTypeQuery: (knId: string, otId: string, body: unknown, opts?: ObjectQueryOptions) =>
      queryObjectTypeInstances(ctx, knId, otId, body, opts),
    objectTypeGet: (knId: string, id: string, opts?: { branch?: string }) =>
      getSchemaItem(ctx, knId, "object-types", id, opts),
    objectTypeCreate: (knId: string, body: unknown, opts?: { branch?: string }) =>
      createSchemaItem(ctx, knId, "object-types", body, opts),
    objectTypeUpdate: (knId: string, id: string, body: unknown, opts?: UpdateSchemaItemOptions) =>
      updateSchemaItem(ctx, knId, "object-types", id, body, opts),
    objectTypeDelete: (knId: string, id: string, opts?: DeleteSchemaItemOptions) =>
      deleteSchemaItem(ctx, knId, "object-types", id, opts),
    relationTypes: (knId: string, opts?: ListRelationTypesOptions) =>
      listRelationTypes(ctx, knId, opts),
    relationTypeGet: (knId: string, id: string, opts?: { branch?: string }) =>
      getSchemaItem(ctx, knId, "relation-types", id, opts),
    relationTypeCreate: (knId: string, body: unknown, opts?: { branch?: string }) =>
      createSchemaItem(ctx, knId, "relation-types", body, opts),
    relationTypeUpdate: (knId: string, id: string, body: unknown, opts?: UpdateSchemaItemOptions) =>
      updateSchemaItem(ctx, knId, "relation-types", id, body, opts),
    relationTypeDelete: (knId: string, id: string, opts?: DeleteSchemaItemOptions) =>
      deleteSchemaItem(ctx, knId, "relation-types", id, opts),
    actionTypes: (knId: string, opts?: ListActionTypesOptions) => listActionTypes(ctx, knId, opts),
    actionTypeQuery: (knId: string, atId: string, body: unknown, opts?: ActionTypeQueryOptions) =>
      queryActionType(ctx, knId, atId, body, opts),
    actionTypeExecute: (knId: string, atId: string, body: unknown, opts?: { branch?: string }) =>
      executeActionType(ctx, knId, atId, body, opts),
    actionTypeGet: (knId: string, id: string, opts?: { branch?: string }) =>
      getSchemaItem(ctx, knId, "action-types", id, opts),
    conceptGroups: (knId: string, opts?: ConceptGroupListOptions) =>
      listConceptGroups(ctx, knId, opts),
    conceptGroup: (knId: string, cgId: string, opts?: ConceptGroupGetOptions) =>
      getConceptGroup(ctx, knId, cgId, opts),
    conceptGroupCreate: (knId: string, body: unknown) => createConceptGroup(ctx, knId, body),
    conceptGroupUpdate: (knId: string, cgId: string, body: unknown) =>
      updateConceptGroup(ctx, knId, cgId, body),
    conceptGroupDelete: (knId: string, cgId: string) => deleteConceptGroup(ctx, knId, cgId),
    conceptGroupAddMembers: (knId: string, cgId: string, body: unknown) =>
      addConceptGroupMembers(ctx, knId, cgId, body),
    conceptGroupRemoveMembers: (knId: string, cgId: string, otIds: string | string[]) =>
      removeConceptGroupMembers(ctx, knId, cgId, otIds),
    actionSchedules: (knId: string, opts?: ActionScheduleListOptions) =>
      listActionSchedules(ctx, knId, opts),
    actionSchedule: (knId: string, scheduleId: string) => getActionSchedule(ctx, knId, scheduleId),
    actionScheduleCreate: (knId: string, body: unknown) => createActionSchedule(ctx, knId, body),
    actionScheduleUpdate: (knId: string, scheduleId: string, body: unknown) =>
      updateActionSchedule(ctx, knId, scheduleId, body),
    actionScheduleSetStatus: (knId: string, scheduleId: string, body: unknown) =>
      setActionScheduleStatus(ctx, knId, scheduleId, body),
    actionScheduleDelete: (knId: string, ids: string | string[]) =>
      deleteActionSchedules(ctx, knId, ids),
    relationTypePaths: (knId: string, body: unknown) => relationTypePaths(ctx, knId, body),
    capabilityList: (knId: string, opts?: CapabilityListOptions) =>
      listCapabilities(ctx, knId, opts),
    capabilityAttach: (
      knId: string,
      entries: CapabilityAttachEntry[],
      opts?: { branch?: string },
    ) => attachCapabilities(ctx, knId, entries, opts?.branch),
    capabilityDetach: (knId: string, bindingIds: string[], opts?: { branch?: string }) =>
      detachCapabilities(ctx, knId, bindingIds, opts?.branch),
    // Straight to the compiler, outside any Trace session; `context.runCypher` is the
    // same query recorded as part of a conversation.
    cypher: (
      knId: string,
      query: string,
      opts?: { branch?: string; parameters?: Record<string, unknown> },
    ) => runCypherQuery(ctx, knId, { query, parameters: opts?.parameters }, opts?.branch),
    bknResources: (opts?: BknResourceListOptions) => listBknResources(ctx, opts),
    createFromCatalog: (opts: CreateFromCatalogOptions) => createFromCatalog(ctx, opts),
    /** Pack a local BKN directory and upload it as a knowledge network. */
    push: async (dir: string, opts?: BknImportOptions) => {
      const validation = validateBknDirectory(dir);
      if (!validation.valid) {
        throw new InputError(`BKN validation failed:\n${validation.errors.join("\n")}`);
      }
      return uploadBkn(ctx, packDirectoryToTar(dir), opts);
    },
    /** Download a knowledge network and extract it into a local directory. */
    pull: async (knId: string, dir: string, opts?: { branch?: string }) => {
      const tar = await downloadBkn(ctx, knId, opts);
      mkdirSync(resolve(dir), { recursive: true });
      extractTarToDirectory(tar, dir);
      return { knId, dir: resolve(dir), bytes: tar.length };
    },
  };
}
