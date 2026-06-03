/**
 * Model-factory client: management reads (mf-model-manager) + runtime
 * invocation (mf-model-api), mirroring kweaver-sdk. Passed through as JSON.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const MANAGER = "/api/mf-model-manager/v1";
const API = "/api/mf-model-api/v1";

export interface ListModelsOptions {
  page?: number;
  limit?: number;
  name?: string;
  modelType?: string;
}

function listQuery(opts: ListModelsOptions) {
  // mf-model-manager paginates with page + size (NOT limit) — verified live.
  return {
    page: String(opts.page ?? 1),
    size: String(opts.limit ?? 30),
    name: opts.name ?? "",
    model_type: opts.modelType ?? "",
  };
}

export function listLlmModels(ctx: RequestContext, opts: ListModelsOptions = {}): Promise<unknown> {
  return request(ctx, `${MANAGER}/llm/list`, { query: listQuery(opts) });
}
export function getLlmModel(ctx: RequestContext, modelId: string): Promise<unknown> {
  return request(ctx, `${MANAGER}/llm/get`, { query: { model_id: modelId } });
}
export function listSmallModels(
  ctx: RequestContext,
  opts: ListModelsOptions = {},
): Promise<unknown> {
  return request(ctx, `${MANAGER}/small-model/list`, { query: listQuery(opts) });
}
export function getSmallModel(ctx: RequestContext, modelId: string): Promise<unknown> {
  return request(ctx, `${MANAGER}/small-model/get`, { query: { model_id: modelId } });
}

export interface ChatMessage {
  role: string;
  content: string;
}

/** OpenAI-compatible chat completion (non-streaming). */
export function chatCompletions(
  ctx: RequestContext,
  model: string,
  messages: ChatMessage[],
): Promise<unknown> {
  return request(ctx, `${API}/chat/completions`, {
    method: "POST",
    body: { model, messages, stream: false },
  });
}

export function embeddings(ctx: RequestContext, model: string, input: string[]): Promise<unknown> {
  return request(ctx, `${API}/small-model/embeddings`, { method: "POST", body: { model, input } });
}

export function rerank(
  ctx: RequestContext,
  model: string,
  query: string,
  documents: string[],
): Promise<unknown> {
  return request(ctx, `${API}/small-model/reranker`, {
    method: "POST",
    body: { model, query, documents },
  });
}
