/** Model-factory resource surface: management reads + runtime invocation. */
import {
  type ChatMessage,
  type ListModelsOptions,
  addModel,
  chatCompletions,
  deleteModels,
  editModel,
  embeddings,
  getLlmModel,
  getSmallModel,
  listLlmModels,
  listSmallModels,
  rerank,
  testModel,
} from "../api/models.js";
import type { RequestContext } from "../types.js";

export function models(ctx: RequestContext) {
  return {
    llm: {
      list: (opts?: ListModelsOptions) => listLlmModels(ctx, opts),
      get: (modelId: string) => getLlmModel(ctx, modelId),
      chat: (modelId: string, messages: ChatMessage[]) => chatCompletions(ctx, modelId, messages),
      add: (body: unknown) => addModel(ctx, "llm", body),
      edit: (body: unknown) => editModel(ctx, "llm", body),
      delete: (modelIds: string[]) => deleteModels(ctx, "llm", modelIds),
      test: (body: unknown) => testModel(ctx, "llm", body),
    },
    small: {
      list: (opts?: ListModelsOptions) => listSmallModels(ctx, opts),
      get: (modelId: string) => getSmallModel(ctx, modelId),
      embeddings: (modelId: string, input: string[]) => embeddings(ctx, modelId, input),
      rerank: (modelId: string, query: string, documents: string[]) =>
        rerank(ctx, modelId, query, documents),
      add: (body: unknown) => addModel(ctx, "small-model", body),
      edit: (body: unknown) => editModel(ctx, "small-model", body),
      delete: (modelIds: string[]) => deleteModels(ctx, "small-model", modelIds),
      test: (body: unknown) => testModel(ctx, "small-model", body),
    },
  };
}
