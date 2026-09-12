// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Resource surface (the exported SDK API) over vega-backend resources. */
import {
  type CreateResourceRequest,
  type FindResourceOptions,
  type ListResourcesOptions,
  type QueryResourceOptions,
  type ResourceDocument,
  type UpdateResourceOptions,
  configureResourceIndex,
  createResource,
  createResourceDocument,
  deleteResource,
  deleteResourceDocuments,
  deleteResourceDocumentsByFilter,
  disableResource,
  enableResource,
  findResource,
  getResource,
  getResourceDocuments,
  listResources,
  queryResource,
  updateResource,
  upsertResourceDocument,
} from "../api/resources.js";
import type { RequestContext } from "../types.js";

export function resources(ctx: RequestContext) {
  return {
    list: (opts?: ListResourcesOptions) => listResources(ctx, opts),
    get: (id: string | string[], opts?: { ignoreMissing?: boolean }) => getResource(ctx, id, opts),
    create: (req: CreateResourceRequest) => createResource(ctx, req),
    delete: (id: string | string[], opts?: Parameters<typeof deleteResource>[2]) =>
      deleteResource(ctx, id, opts),
    update: (id: string, patch: UpdateResourceOptions) => updateResource(ctx, id, patch),
    enable: (id: string) => enableResource(ctx, id),
    disable: (id: string) => disableResource(ctx, id),
    configureIndex: (id: string, opts: Parameters<typeof configureResourceIndex>[2]) =>
      configureResourceIndex(ctx, id, opts),
    find: (name: string, opts?: FindResourceOptions) => findResource(ctx, name, opts),
    query: (id: string, opts?: QueryResourceOptions) => queryResource(ctx, id, opts),
    createDocument: (id: string, document: ResourceDocument) =>
      createResourceDocument(ctx, id, document),
    getDocuments: (
      id: string,
      documentIds: string | string[],
      opts?: { ignoreMissing?: boolean },
    ) => getResourceDocuments(ctx, id, documentIds, opts),
    upsertDocument: (id: string, documentId: string, document: ResourceDocument) =>
      upsertResourceDocument(ctx, id, documentId, document),
    deleteDocuments: (
      id: string,
      documentIds: string | string[],
      opts?: { ignoreMissing?: boolean },
    ) => deleteResourceDocuments(ctx, id, documentIds, opts),
    deleteDocumentsByFilter: (id: string, filterCondition: Record<string, unknown>) =>
      deleteResourceDocumentsByFilter(ctx, id, filterCondition),
  };
}
