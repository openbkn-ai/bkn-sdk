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
  createResourceDocuments,
  deleteResource,
  deleteResourceDocuments,
  deleteResourceDocumentsByFilter,
  findResource,
  getResource,
  getResourceDocument,
  listResources,
  queryResource,
  updateResource,
  upsertResourceDocument,
  upsertResourceDocuments,
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
    configureIndex: (id: string, opts: Parameters<typeof configureResourceIndex>[2]) =>
      configureResourceIndex(ctx, id, opts),
    find: (name: string, opts?: FindResourceOptions) => findResource(ctx, name, opts),
    query: (id: string, opts?: QueryResourceOptions) => queryResource(ctx, id, opts),
    createDocuments: (id: string, documents: ResourceDocument[]) =>
      createResourceDocuments(ctx, id, documents),
    upsertDocuments: (id: string, documents: Array<ResourceDocument & { id: string }>) =>
      upsertResourceDocuments(ctx, id, documents),
    getDocument: (id: string, documentId: string) => getResourceDocument(ctx, id, documentId),
    upsertDocument: (id: string, documentId: string, document: ResourceDocument) =>
      upsertResourceDocument(ctx, id, documentId, document),
    deleteDocuments: (id: string, documentIds: string | string[]) =>
      deleteResourceDocuments(ctx, id, documentIds),
    deleteDocumentsByFilter: (id: string, filterCondition: Record<string, unknown>) =>
      deleteResourceDocumentsByFilter(ctx, id, filterCondition),
  };
}
