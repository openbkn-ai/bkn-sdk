/** Knowledge-network resource surface (the exported SDK API). */
import {
  type GetKnOptions,
  type ListKnOptions,
  type ListSchemaOptions,
  type SemanticSearchOptions,
  getKnowledgeNetwork,
  listActionTypes,
  listKnowledgeNetworks,
  listObjectTypes,
  listRelationTypes,
  semanticSearch,
} from "../api/knowledge-networks.js";
import type { RequestContext } from "../types.js";

export function kn(ctx: RequestContext) {
  return {
    list: (opts?: ListKnOptions) => listKnowledgeNetworks(ctx, opts),
    get: (knId: string, opts?: GetKnOptions) => getKnowledgeNetwork(ctx, knId, opts),
    search: (knId: string, query: string, opts?: SemanticSearchOptions) =>
      semanticSearch(ctx, knId, query, opts),
    objectTypes: (knId: string, opts?: ListSchemaOptions) => listObjectTypes(ctx, knId, opts),
    relationTypes: (knId: string, opts?: ListSchemaOptions) => listRelationTypes(ctx, knId, opts),
    actionTypes: (knId: string, opts?: ListSchemaOptions) => listActionTypes(ctx, knId, opts),
  };
}
