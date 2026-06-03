/** Toolbox + tool resource surface (read + write). */
import {
  type CreateToolboxOptions,
  type ListToolboxesOptions,
  createToolbox,
  deleteToolbox,
  listToolboxes,
  listTools,
  setToolStatuses,
  setToolboxStatus,
} from "../api/toolboxes.js";
import type { RequestContext } from "../types.js";

export function toolboxes(ctx: RequestContext) {
  return {
    list: (opts?: ListToolboxesOptions) => listToolboxes(ctx, opts),
    tools: (boxId: string) => listTools(ctx, boxId),
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
  };
}
