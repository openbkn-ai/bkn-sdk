// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Toolbox + tool resource surface (read + write). */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type CreateToolboxOptions,
  type ImpexType,
  type ListToolboxesOptions,
  type ListToolsOptions,
  type ToolInvokeEnvelope,
  createToolbox,
  debugTool,
  deleteToolbox,
  executeTool,
  exportConfig,
  importConfig,
  listToolboxes,
  listTools,
  setToolStatuses,
  setToolboxStatus,
  uploadTool,
} from "../api/toolboxes.js";
import type { RequestContext } from "../types.js";

export function toolboxes(ctx: RequestContext) {
  return {
    list: (opts?: ListToolboxesOptions) => listToolboxes(ctx, opts),
    tools: (boxId: string, opts?: ListToolsOptions) => listTools(ctx, boxId, opts),
    create: (opts: CreateToolboxOptions) => createToolbox(ctx, opts),
    delete: (boxId: string) => deleteToolbox(ctx, boxId),
    publish: (boxId: string) => setToolboxStatus(ctx, boxId, "published"),
    unpublish: (boxId: string) => setToolboxStatus(ctx, boxId, "draft"),
    setToolStatus: (boxId: string, toolIds: string[], status: "enabled" | "disabled") =>
      setToolStatuses(
        ctx,
        boxId,
        toolIds.map((toolId) => ({ toolId, status })),
      ),
    upload: (boxId: string, filePath: string, metadataType?: string) =>
      uploadTool(ctx, boxId, filePath, metadataType),
    /** Export a toolbox config to a local `.adp` file. */
    export: async (id: string, outPath: string, type?: ImpexType) => {
      const bytes = await exportConfig(ctx, id, type);
      const dest = resolve(outPath);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
      return { id, path: dest, bytes: bytes.length };
    },
    /** Import a toolbox config from a local `.adp` file. */
    import: (filePath: string, type?: ImpexType) => importConfig(ctx, filePath, type),
    execute: (boxId: string, toolId: string, e?: ToolInvokeEnvelope) =>
      executeTool(ctx, boxId, toolId, e),
    debug: (boxId: string, toolId: string, e?: ToolInvokeEnvelope) =>
      debugTool(ctx, boxId, toolId, e),
  };
}
