/** Toolbox + tool resource surface (read side). */
import { type ListToolboxesOptions, listToolboxes, listTools } from "../api/toolboxes.js";
import type { RequestContext } from "../types.js";

export function toolboxes(ctx: RequestContext) {
  return {
    list: (opts?: ListToolboxesOptions) => listToolboxes(ctx, opts),
    tools: (boxId: string) => listTools(ctx, boxId),
  };
}
