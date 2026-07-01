// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

import type { RequestContext } from "../types.js";
/**
 * Model-factory client: management reads (mf-model-manager) + runtime
 * invocation (mf-model-api). Passed through as JSON.
 */
import { HttpError } from "../utils/errors.js";
import { authFetch } from "./auth-fetch.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { applyTls } from "./tls.js";

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

/** Pull `choices[0].delta.content` out of one OpenAI streaming chunk. */
function deltaContent(chunk: Record<string, unknown>): string {
  const choices = chunk.choices as Array<{ delta?: { content?: unknown } }> | undefined;
  const c = choices?.[0]?.delta?.content;
  return typeof c === "string" ? c : "";
}

/**
 * Streaming chat completion (OpenAI-style SSE: `data: {...}` / `data: [DONE]`).
 * Invokes `onDelta` with each text fragment as it arrives and resolves with the
 * full concatenated text.
 */
export async function chatCompletionsStream(
  ctx: RequestContext,
  model: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
): Promise<string> {
  applyTls(ctx);
  const res = await authFetch(ctx, () =>
    fetch(`${ctx.baseUrl}${API}/chat/completions`, {
      method: "POST",
      headers: {
        ...buildHeaders(ctx),
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ model, messages, stream: true }),
    }),
  );
  if (!res.ok) throw new HttpError(res.status, res.statusText, await res.text());

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body for stream");
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";

  const handle = (line: string): void => {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]" || payload === "") return;
    try {
      const text = deltaContent(JSON.parse(payload) as Record<string, unknown>);
      if (text) {
        out += text;
        onDelta(text);
      }
    } catch {
      /* skip malformed keep-alive / partial lines */
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const ln of lines) handle(ln);
  }
  if (buffer.trim()) handle(buffer);
  return out;
}

export function embeddings(ctx: RequestContext, model: string, input: string[]): Promise<unknown> {
  return request(ctx, `${API}/small-model/embeddings`, { method: "POST", body: { model, input } });
}

// ---- management writes (mf-model-manager) ---------------------------------

export type ModelKind = "llm" | "small-model";

export function addModel(ctx: RequestContext, kind: ModelKind, body: unknown): Promise<unknown> {
  return request(ctx, `${MANAGER}/${kind}/add`, { method: "POST", body });
}
export function editModel(ctx: RequestContext, kind: ModelKind, body: unknown): Promise<unknown> {
  return request(ctx, `${MANAGER}/${kind}/edit`, { method: "POST", body });
}
export function deleteModels(
  ctx: RequestContext,
  kind: ModelKind,
  modelIds: string[],
): Promise<unknown> {
  return request(ctx, `${MANAGER}/${kind}/delete`, {
    method: "POST",
    body: { model_ids: modelIds },
  });
}
export function testModel(ctx: RequestContext, kind: ModelKind, body: unknown): Promise<unknown> {
  return request(ctx, `${MANAGER}/${kind}/test`, { method: "POST", body });
}

// ---- default model selection (mf-model-manager) ----------------------------
// LLM default state is also surfaced as a `default` flag on each `llm/list` row;
// the small-model default is read back via `getDefaultSmallModel`.

/** Set (or with `isDefault=false` clear) the system default LLM. Admin-only. */
export function setDefaultLlm(
  ctx: RequestContext,
  modelId: string,
  isDefault = true,
): Promise<unknown> {
  return request(ctx, `${MANAGER}/llm/default/edit`, {
    method: "POST",
    body: { model_id: modelId, default: isDefault },
  });
}

/** Set (or clear) the system default small model. Type is inferred from the model. */
export function setDefaultSmallModel(
  ctx: RequestContext,
  modelId: string,
  isDefault = true,
): Promise<unknown> {
  return request(ctx, `${MANAGER}/small-model/set-default`, {
    method: "POST",
    body: { model_id: modelId, default: isDefault },
  });
}

/** Get the system default small model for a type (`{}` when none is set). */
export function getDefaultSmallModel(
  ctx: RequestContext,
  modelType = "embedding",
): Promise<unknown> {
  return request(ctx, `${MANAGER}/small-model/get_default`, {
    query: { model_type: modelType },
  });
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
