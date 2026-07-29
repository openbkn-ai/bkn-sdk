// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  addConceptGroupMembers,
  createActionSchedule,
  createConceptGroup,
  deleteActionSchedules,
  deleteConceptGroup,
  downloadBkn,
  getActionSchedule,
  getConceptGroup,
  listActionSchedules,
  listBknResources,
  listConceptGroups,
  relationTypePaths,
  removeConceptGroupMembers,
  setActionScheduleStatus,
  updateActionSchedule,
  updateConceptGroup,
  uploadBkn,
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
  createMetric,
  createSchemaItem,
  deleteKnowledgeNetwork,
  deleteMetric,
  deleteSchemaItem,
  dryRunMetric,
  executeActionType,
  getActionExecution,
  getActionLog,
  getActionTypeInputs,
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
  searchMetrics,
  semanticSearch,
  updateKnowledgeNetwork,
  updateMetric,
  updateSchemaItem,
  validateMetric,
} from "../api/knowledge-networks.js";
import { configureResourceIndex } from "../api/resources.js";
import { createBuildTask } from "../api/vega.js";
import type { RequestContext } from "../types.js";
import { collectIndexTargets } from "../utils/bkn-index.js";
import { extractTarToDirectory, packDirectoryToTar } from "../utils/tar.js";
import {
  type CreateFromCatalogOptions,
  type CreateFromCsvOptions,
  createFromCatalog,
  createFromCsv,
} from "./bkn-create.js";

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
    metricList: (knId: string, opts?: ListSchemaOptions) => listMetrics(ctx, knId, opts),
    metricGet: (knId: string, metricId: string) => getMetric(ctx, knId, metricId),
    metricCreate: (knId: string, body: unknown) => createMetric(ctx, knId, body),
    metricUpdate: (knId: string, metricId: string, body: unknown) =>
      updateMetric(ctx, knId, metricId, body),
    metricDelete: (knId: string, metricId: string) => deleteMetric(ctx, knId, metricId),
    metricSearch: (knId: string, body: unknown) => searchMetrics(ctx, knId, body),
    metricValidate: (knId: string, body: unknown) => validateMetric(ctx, knId, body),
    objectTypes: (knId: string, opts?: ListSchemaOptions) => listObjectTypes(ctx, knId, opts),
    objectTypeQuery: (knId: string, otId: string, body: unknown) =>
      queryObjectTypeInstances(ctx, knId, otId, body),
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
    actionTypeInputs: (knId: string, atId: string) => getActionTypeInputs(ctx, knId, atId),
    actionTypeGet: (knId: string, id: string) => getSchemaItem(ctx, knId, "action-types", id),
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
    relationTypePaths: (knId: string, body: unknown) => relationTypePaths(ctx, knId, body),
    bknResources: () => listBknResources(ctx),
    createFromCatalog: (opts: CreateFromCatalogOptions) => createFromCatalog(ctx, opts),
    createFromCsv: (opts: CreateFromCsvOptions) => createFromCsv(ctx, opts),
    /**
     * Pack a local BKN directory and upload it as a knowledge network. With
     * `build`, also submit one Vega BuildTask per object type that declares a
     * `vector` index — the platform does not auto-build these on import.
     */
    push: async (
      dir: string,
      opts?: { branch?: string; build?: boolean; embeddingModel?: string },
    ) => {
      const upload = await uploadBkn(ctx, packDirectoryToTar(dir), { branch: opts?.branch });
      if (!opts?.build) return upload;
      const targets = collectIndexTargets(dir);
      const buildTasks: Array<{ objectType: string; resourceId: string; taskId: string }> = [];
      for (const t of targets) {
        if (!t.buildKey) {
          throw new Error(
            `Object type '${t.objectType}' declares a vector index but no build key; batch Vega builds require resource index_config.build_key_fields.`,
          );
        }
        await configureResourceIndex(ctx, t.resourceId, {
          buildKeyFields: [t.buildKey],
          embeddingFields: t.embeddingFields,
          ...((t.embeddingModel ?? opts.embeddingModel)
            ? { embeddingModel: t.embeddingModel ?? opts.embeddingModel }
            : {}),
        });
        const task = (await createBuildTask(ctx, {
          resource_id: t.resourceId,
          mode: "batch",
        })) as { id?: string };
        buildTasks.push({
          objectType: t.objectType,
          resourceId: t.resourceId,
          taskId: String(task.id ?? ""),
        });
      }
      return { ...(upload as object), build_tasks: buildTasks };
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
