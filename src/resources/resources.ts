// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Resource surface (the exported SDK API) over vega-backend resources. */
import {
  type FindResourceOptions,
  type ListResourcesOptions,
  type QueryResourceOptions,
  type UpdateResourceOptions,
  configureResourceIndex,
  deleteResource,
  findResource,
  getResource,
  listResources,
  queryResource,
  updateResource,
} from "../api/resources.js";
import type { RequestContext } from "../types.js";

export function resources(ctx: RequestContext) {
  return {
    list: (opts?: ListResourcesOptions) => listResources(ctx, opts),
    get: (id: string) => getResource(ctx, id),
    delete: (id: string) => deleteResource(ctx, id),
    update: (id: string, patch: UpdateResourceOptions) => updateResource(ctx, id, patch),
    configureIndex: (id: string, opts: Parameters<typeof configureResourceIndex>[2]) =>
      configureResourceIndex(ctx, id, opts),
    find: (name: string, opts?: FindResourceOptions) => findResource(ctx, name, opts),
    query: (id: string, opts?: QueryResourceOptions) => queryResource(ctx, id, opts),
  };
}
