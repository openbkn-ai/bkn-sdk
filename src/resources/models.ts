/** Model-factory resource surface: management reads + runtime invocation. */
import {
  type ChatMessage,
  type ListModelsOptions,
  chatCompletions,
  embeddings,
  getLlmModel,
  getSmallModel,
  listLlmModels,
  listSmallModels,
  rerank,
} from "../api/models.js";
import type { RequestContext } from "../types.js";

export function models(ctx: RequestContext) {
  return {
    llm: {
      list: (opts?: ListModelsOptions) => listLlmModels(ctx, opts),
      get: (modelId: string) => getLlmModel(ctx, modelId),
      chat: (modelId: string, messages: ChatMessage[]) => chatCompletions(ctx, modelId, messages),
    },
    small: {
      list: (opts?: ListModelsOptions) => listSmallModels(ctx, opts),
      get: (modelId: string) => getSmallModel(ctx, modelId),
      embeddings: (modelId: string, input: string[]) => embeddings(ctx, modelId, input),
      rerank: (modelId: string, query: string, documents: string[]) =>
        rerank(ctx, modelId, query, documents),
    },
  };
}
