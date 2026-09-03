// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import type { RequestContext } from "../types.js";
/**
 * Model-factory client: management reads (mf-model-manager) + runtime
 * invocation (mf-model-api). Passed through as JSON.
 */
import { HttpError, InputError } from "../utils/errors.js";
import { parseBigIntJSON, stringifyBigIntJSON } from "../utils/json-bigint.js";
import { authFetch } from "./auth-fetch.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { tlsFetch } from "./tls.js";
import { ensureCompatible } from "./version-check.js";

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

/**
 * Resolve a small-model reference to the NAME the rest of the platform expects.
 *
 * Every consumer of a small model (`--embedding-model`, `small embeddings`)
 * keys off `model_name`, but `small list` / `small get-default` lead with the
 * numeric `model_id` — so the first value a user copies is the one that fails,
 * downstream and unhelpfully (`embedding model "…" not found`). Mirror
 * `resolveLlmModelName`: a numeric arg is an id to look up, anything else is
 * already a name.
 */
export async function resolveSmallModelName(ctx: RequestContext, model: string): Promise<string> {
  // Not routed through `resolveSmallModel`: that one needs the id too and pays
  // a list read for it, and a caller who only wants the name and already has
  // one must not pay for a round trip it does not need.
  if (!/^\d+$/.test(model)) return model;
  return (await resolveSmallModel(ctx, model)).name;
}

/** A small model's id and name together, from either one. */
export interface SmallModelRef {
  id: string;
  name: string;
}

/**
 * Resolve a small-model reference to *both* forms.
 *
 * The platform does not agree with itself about which it wants: a resource's
 * `index_config.default_embedding_model` takes the name, while a property
 * feature's `config.embedding_model` takes the numeric id and answers a PUT
 * carrying a name with
 *
 *     embedding model ID "text-embedding-v4" for field "name" not found
 *
 * Both were verified against a live deploy, one field at a time. So a caller
 * that writes both needs both, and neither direction can be assumed from the
 * other.
 */
export async function resolveSmallModel(
  ctx: RequestContext,
  model: string,
): Promise<SmallModelRef> {
  if (!/^\d+$/.test(model)) {
    const id = await smallModelIdByName(ctx, model);
    return { id, name: model };
  }
  // Only a genuine "no such id" may fall through to the InputError below. An
  // expired token, a 5xx, or a deploy without model-factory must keep its own
  // cause — collapsing those into "you typed a bad id" is the exact failure
  // mode this resolver exists to remove. A gateway 404 is that last case
  // wearing the status of the first: nothing behind the route saw the id.
  const detail = (await getSmallModel(ctx, model).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 404 && !e.gateway) return undefined;
    throw e;
  })) as { model_name?: string; data?: { model_name?: string } } | undefined;
  const name = detail?.model_name ?? detail?.data?.model_name;
  if (!name) {
    throw new InputError(
      [
        `No small model found with id ${model}.`,
        "This flag takes the model name (`model_name`) or a valid model id —",
        "list them with `openbkn model small list`.",
      ].join(" "),
    );
  }
  return { id: model, name };
}

/**
 * Find a small model's id from its name.
 *
 * There is no lookup-by-name endpoint, and the `name` query parameter is
 * ignored — a deploy answering it returns every model whatever is asked for —
 * so the match happens here. Paged rather than asked for in one go: `size` is
 * the backend's own bound and `limit: -1` is not a value it takes, answering
 * `ModelFactory.Router.ParamError.FormatError` instead. A name the platform
 * does not have is the caller's own typo and says so; anything else (auth,
 * 5xx, no model-factory) keeps its cause, for the same reason the id lookup
 * above does.
 */
async function smallModelIdByName(ctx: RequestContext, name: string): Promise<string> {
  const PAGE = 100;
  for (let page = 1; page <= 50; page++) {
    const listed = (await listSmallModels(ctx, { page, limit: PAGE })) as {
      data?: Array<{ model_id?: string | number; model_name?: string }>;
      entries?: Array<{ model_id?: string | number; model_name?: string }>;
    };
    const rows = listed?.data ?? listed?.entries ?? [];
    const hit = rows.find((m) => m?.model_name === name);
    if (hit?.model_id !== undefined) return String(hit.model_id);
    if (rows.length < PAGE) break;
  }
  throw new InputError(
    [`No small model named ${name}.`, "List them with `openbkn model small list`."].join(" "),
  );
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
  await ensureCompatible(ctx, new URL(`${ctx.baseUrl}${API}/chat/completions`));
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx.insecure, `${ctx.baseUrl}${API}/chat/completions`, {
      method: "POST",
      headers: {
        ...buildHeaders(ctx),
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: stringifyBigIntJSON({ model, messages, stream: true }),
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
      const text = deltaContent(parseBigIntJSON(payload) as Record<string, unknown>);
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

export async function embeddings(
  ctx: RequestContext,
  model: string,
  input: string[],
): Promise<unknown> {
  return request(ctx, `${API}/small-model/embeddings`, {
    method: "POST",
    body: { model: await resolveSmallModelName(ctx, model), input },
  });
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

export async function rerank(
  ctx: RequestContext,
  model: string,
  query: string,
  documents: string[],
): Promise<unknown> {
  return request(ctx, `${API}/small-model/reranker`, {
    method: "POST",
    body: { model: await resolveSmallModelName(ctx, model), query, documents },
  });
}
