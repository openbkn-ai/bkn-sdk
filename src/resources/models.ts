/** Model-factory resource surface: management reads + runtime invocation. */
import {
  type ChatMessage,
  type ListModelsOptions,
  addModel,
  chatCompletions,
  chatCompletionsStream,
  deleteModels,
  editModel,
  embeddings,
  getDefaultSmallModel,
  getLlmModel,
  getSmallModel,
  listLlmModels,
  listSmallModels,
  rerank,
  setDefaultLlm,
  setDefaultSmallModel,
  testModel,
} from "../api/models.js";
import type { RequestContext } from "../types.js";

export function models(ctx: RequestContext) {
  return {
    llm: {
      list: (opts?: ListModelsOptions) => listLlmModels(ctx, opts),
      get: (modelId: string) => getLlmModel(ctx, modelId),
      chat: (modelId: string, messages: ChatMessage[]) => chatCompletions(ctx, modelId, messages),
      chatStream: (modelId: string, messages: ChatMessage[], onDelta: (t: string) => void) =>
        chatCompletionsStream(ctx, modelId, messages, onDelta),
      add: (body: unknown) => addModel(ctx, "llm", body),
      edit: (body: unknown) => editModel(ctx, "llm", body),
      delete: (modelIds: string[]) => deleteModels(ctx, "llm", modelIds),
      test: (body: unknown) => testModel(ctx, "llm", body),
      /** Set (or clear) the system default LLM. */
      setDefault: (modelId: string, isDefault = true) => setDefaultLlm(ctx, modelId, isDefault),
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
      /** Set (or clear) the system default small model (type inferred from the model). */
      setDefault: (modelId: string, isDefault = true) =>
        setDefaultSmallModel(ctx, modelId, isDefault),
      /** Get the system default small model for a type (default "embedding"). */
      getDefault: (modelType?: string) => getDefaultSmallModel(ctx, modelType),
    },
  };
}
