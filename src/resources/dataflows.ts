// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Dataflow resource surface (read side). */
import {
  type ListRunsOptions,
  type LogsOptions,
  createDataflow,
  getDataflowLogs,
  listDataflowRuns,
  listDataflows,
  runDataflowRemote,
} from "../api/dataflow.js";
import { createKnowledgeNetworkRaw } from "../api/knowledge-networks.js";
import { createResourceRaw } from "../api/resources.js";
import type { RequestContext } from "../types.js";
import {
  type TemplateType,
  generateSourceIdentifier,
  listTemplates,
  loadTemplate,
  renderTemplate,
} from "../utils/dataflow-templates.js";

function instantiate(type: TemplateType, name: string, args: Record<string, unknown>) {
  const t = loadTemplate(type, name);
  if (!t) throw new Error(`Template not found: ${type}/${name}`);
  const merged = { ...args };
  if (type === "dataset" && !merged.source_identifier) {
    merged.source_identifier = generateSourceIdentifier(`dataflow_${t.manifest.name}`);
  }
  return renderTemplate(t, merged);
}

export function dataflows(ctx: RequestContext) {
  return {
    list: () => listDataflows(ctx),
    runs: (dagId: string, opts?: ListRunsOptions) => listDataflowRuns(ctx, dagId, opts),
    logs: (dagId: string, instanceId: string, opts?: LogsOptions) =>
      getDataflowLogs(ctx, dagId, instanceId, opts),
    run: (dagId: string, url: string, name: string) => runDataflowRemote(ctx, dagId, url, name),
    create: (body: unknown) => createDataflow(ctx, body),
    templates: () => listTemplates(),
    /** Instantiate a dataset template → create a vega resource. */
    createDataset: (template: string, args: Record<string, unknown>) =>
      createResourceRaw(ctx, instantiate("dataset", template, args)),
    /** Instantiate a bkn template → create a knowledge network. */
    createBkn: (template: string, args: Record<string, unknown>) =>
      createKnowledgeNetworkRaw(ctx, instantiate("bkn", template, args)),
  };
}
