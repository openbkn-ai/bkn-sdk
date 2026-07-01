// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

import type { RequestContext } from "../types.js";
/**
 * Agent chat (agent-factory app runtime). The chat stream is NOT OpenAI-style:
 * each SSE `data:` line is a JSON-patch-ish `{key, content, action}` that mutates
 * a server-side result tree. We replay those patches into a local tree and pull
 * the answer text out of it after each frame, emitting only the new suffix.
 * @deprecated The Decision Agent (agent-factory) surface is being phased out and
 * may be removed in a future release. Avoid building new integrations on it.
 */
import { HttpError } from "../utils/errors.js";
import { authFetch } from "./auth-fetch.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { applyTls } from "./tls.js";

const FACTORY = "/api/agent-factory";

export interface AgentInfo {
  id: string;
  key: string;
  version: string;
}

/** Resolve an agent's {id,key,version} from agent-market (required to chat). */
export async function fetchAgentInfo(
  ctx: RequestContext,
  agentId: string,
  version = "v0",
): Promise<AgentInfo> {
  const data = (await request(
    ctx,
    `${FACTORY}/v3/agent-market/agent/${encodeURIComponent(agentId)}/version/${encodeURIComponent(version)}`,
    { query: { is_visit: true } },
  )) as Record<string, unknown>;
  const id = data.id;
  const key = data.key;
  if (typeof id !== "string" || !id || typeof key !== "string" || !key) {
    throw new Error("Agent info response did not include id and key.");
  }
  return { id, key, version: typeof data.version === "string" ? data.version : version };
}

// ---- JSON-patch result tree -------------------------------------------------

function getByPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function setByPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i += 1) {
    const k = path[i] as string;
    if (!(k in cur) || typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[path[path.length - 1] as string] = value;
}

function applyPatch(
  data: { key?: string[]; content?: unknown; action?: string },
  result: Record<string, unknown>,
): void {
  const path = data.key;
  if (!path || path.length === 0) return;
  if (data.action === "upsert" && data.content !== undefined) {
    setByPath(result, path, data.content);
  } else if (data.action === "append") {
    const existing = getByPath(result, path);
    const add = typeof data.content === "string" ? data.content : String(data.content ?? "");
    setByPath(result, path, typeof existing === "string" ? existing + add : add);
  } else if (data.action === "remove" && path.length === 1) {
    delete result[path[0] as string];
  }
}

/** Pull the answer text from the accumulated result tree (best-effort). */
export function extractText(result: Record<string, unknown>): string {
  const content = getByPath(result, ["message", "content"]) as Record<string, unknown> | undefined;
  if (content) {
    if (typeof content.text === "string" && content.text) return content.text;
    const fa = content.final_answer as Record<string, unknown> | undefined;
    const ans = fa?.answer as Record<string, unknown> | undefined;
    if (typeof ans?.text === "string" && ans.text) return ans.text;
    if (typeof fa?.text === "string" && fa.text) return fa.text;
  }
  const msg = result.message as Record<string, unknown> | undefined;
  if (typeof msg?.text === "string" && msg.text) return msg.text;
  return "";
}

export interface ChatResult {
  text: string;
  conversationId?: string;
}

export interface SendChatOptions {
  conversationId?: string;
  stream?: boolean;
  onDelta?: (text: string) => void;
}

/** Send one chat turn (streaming or not). Resolves with the full text. */
export async function sendChat(
  ctx: RequestContext,
  info: AgentInfo,
  query: string,
  opts: SendChatOptions = {},
): Promise<ChatResult> {
  applyTls(ctx);
  const body: Record<string, unknown> = {
    agent_id: info.id,
    agent_key: info.key,
    agent_version: info.version,
    query,
    stream: Boolean(opts.stream),
  };
  if (opts.conversationId) body.conversation_id = opts.conversationId;

  const res = await authFetch(ctx, () =>
    fetch(`${ctx.baseUrl}${FACTORY}/v1/app/${info.key}/chat/completion`, {
      method: "POST",
      headers: {
        ...buildHeaders(ctx),
        "content-type": "application/json",
        accept: opts.stream ? "text/event-stream" : "application/json",
        "x-language": "zh-CN",
      },
      body: JSON.stringify(body),
    }),
  );
  if (!res.ok) throw new HttpError(res.status, res.statusText, await res.text());

  const contentType = res.headers.get("content-type") ?? "";
  if (opts.stream && contentType.includes("text/event-stream")) {
    return consumeStream(res, opts.onDelta);
  }
  const result = JSON.parse(await res.text()) as Record<string, unknown>;
  return { text: extractText(result), conversationId: conversationIdOf(result) };
}

function conversationIdOf(result: Record<string, unknown>): string | undefined {
  const id = result.conversation_id;
  return typeof id === "string" ? id : undefined;
}

async function consumeStream(res: Response, onDelta?: (text: string) => void): Promise<ChatResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body for stream");
  const decoder = new TextDecoder();
  const result: Record<string, unknown> = {};
  let buffer = "";
  let lastText = "";
  let conversationId: string | undefined;

  const handle = (line: string): void => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "" || payload === "[DONE]") return;
    let data: { key?: string[]; content?: unknown; action?: string };
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    applyPatch(data, result);
    if (data.key?.length === 1 && data.key[0] === "conversation_id") {
      conversationId = typeof data.content === "string" ? data.content : conversationId;
    }
    const text = extractText(result);
    if (text && text !== lastText) {
      if (onDelta) onDelta(text.slice(lastText.length));
      lastText = text;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const ln of lines) handle(ln.replace(/\r$/, ""));
  }
  if (buffer.trim()) handle(buffer.trim());
  return { text: lastText, conversationId: conversationId ?? conversationIdOf(result) };
}
