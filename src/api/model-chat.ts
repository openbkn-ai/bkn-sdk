// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { z } from "zod";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";

export interface ChatMessage {
  role: string;
  content?: string | Record<string, unknown>[] | null;
  tool_calls?: Record<string, unknown>[];
  tool_call_id?: string;
  /** Provider-returned metadata (name, refusal, reasoning_content, etc.) is preserved. */
  [key: string]: unknown;
}

export interface ChatTool {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export interface ChatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Record<string, unknown>[];
      [key: string]: unknown;
    };
    finish_reason?: string | null;
    [key: string]: unknown;
  }>;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Optional generation controls; transport options are never sent to the model. */
export interface ChatOptions {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  maxCompletionTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  responseFormat?: Record<string, unknown>;
  tools?: ChatTool[];
  toolChoice?: string | Record<string, unknown>;
  stop?: string | string[];
  cache?: boolean;
  system?: Record<string, unknown>[];
  /** Total inference timeout, including response consumption; default 30 seconds. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ChatStreamOptions extends ChatOptions {
  /** Full chunks expose tool-call deltas and usage alongside the text callback. */
  onChunk?: (chunk: ChatStreamChunk) => void;
}

export class ModelStreamError extends Error {
  readonly code?: string | number;
  constructor(message: string, code?: string | number) {
    super(message);
    this.name = "ModelStreamError";
    this.code = code;
  }
}

const record = z.record(z.unknown());
const optionsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().gt(0).max(1).optional(),
    topK: z.number().int().min(1).optional(),
    maxTokens: z.number().int().min(10).optional(),
    maxCompletionTokens: z.number().int().min(10).optional(),
    presencePenalty: z.number().min(-2).max(2).optional(),
    frequencyPenalty: z.number().min(-2).max(2).optional(),
    responseFormat: record.optional(),
    tools: z
      .array(
        z
          .object({
            type: z.literal("function"),
            function: z
              .object({
                name: z.string().min(1),
                description: z.string().optional(),
                parameters: record,
              })
              .strict(),
          })
          .strict(),
      )
      .optional(),
    toolChoice: z.union([z.string(), record]).optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    cache: z.boolean().optional(),
    system: z.array(record).optional(),
    timeoutMs: z.number().int().positive().max(2_147_483_647).optional(),
    signal: z.instanceof(AbortSignal).optional(),
    onChunk: z.custom<(chunk: ChatStreamChunk) => void>((v) => typeof v === "function").optional(),
  })
  .strict();
const messagesSchema = z
  .array(
    z
      .object({
        role: z.enum(["user", "assistant", "system", "tool"]),
        content: z
          .union([z.string(), z.array(record)])
          .nullable()
          .optional(),
        tool_calls: z.array(record).optional(),
        tool_call_id: z.string().optional(),
      })
      .passthrough(),
  )
  .min(1);

/** Validate before any lookup/request, retaining meaningful zero/false values. */
export function prepareChat(
  model: string,
  messages: ChatMessage[],
  options: ChatStreamOptions = {},
) {
  const parsed = optionsSchema.safeParse(options);
  const parsedMessages = messagesSchema.safeParse(messages);
  if (!parsed.success || !parsedMessages.success || typeof model !== "string" || !model.trim()) {
    const issues = !parsed.success
      ? parsed.error.issues
      : !parsedMessages.success
        ? parsedMessages.error.issues
        : [];
    // Do not echo message bodies or option values in an input error.
    throw new InputError(
      `Invalid chat input${issues.length ? `: ${issues.map((i) => i.path.join(".") || "options/messages").join(", ")}` : ": model is required"}.`,
    );
  }
  parsed.data.signal?.throwIfAborted();
  const { timeoutMs, signal, onChunk, ...generation } = parsed.data;
  const fields: Record<keyof typeof generation, string> = {
    temperature: "temperature",
    topP: "top_p",
    topK: "top_k",
    maxTokens: "max_tokens",
    maxCompletionTokens: "max_completion_tokens",
    presencePenalty: "presence_penalty",
    frequencyPenalty: "frequency_penalty",
    responseFormat: "response_format",
    tools: "tools",
    toolChoice: "tool_choice",
    stop: "stop",
    cache: "cache",
    system: "system",
  };
  const wire: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(generation)) {
    if (value !== undefined) wire[fields[key as keyof typeof generation]] = value;
  }
  return { wire, messages: parsedMessages.data, timeoutMs: timeoutMs ?? 30_000, signal, onChunk };
}

export function chatDeadline(timeoutMs: number, callerSignal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Model inference timed out", "TimeoutError")),
    timeoutMs,
  );
  return {
    signal: callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal,
    dispose: () => clearTimeout(timer),
  };
}

/** SSE framing stays separate from fetch/auth so callback errors are never mistaken for parse failures. */
export async function readChatStream(
  response: Response,
  onDelta: (text: string) => void,
  signal: AbortSignal,
  onChunk?: (chunk: ChatStreamChunk) => void,
): Promise<string> {
  if (!response.body) throw new ModelStreamError("No response body for model stream");
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream"))
    throw new ModelStreamError("Model stream did not return text/event-stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let data: string[] = [];
  let event = "";
  let text = "";
  let done = false;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const dispatch = () => {
    if (data.length === 0) {
      event = "";
      return;
    }
    const payload = data.join("\n");
    data = [];
    const eventName = event;
    event = "";
    // Empty data events are keep-alives, but an explicit error event must still fail.
    if (!payload.trim()) {
      if (eventName === "error") throw new ModelStreamError("Model stream failed");
      return;
    }
    if (payload.trim() === "[DONE]") {
      done = true;
      return;
    }
    let chunk: ChatStreamChunk;
    try {
      const value = parseBigIntJSON(payload);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected object");
      chunk = value as ChatStreamChunk;
    } catch {
      throw new ModelStreamError("Malformed model stream data", "invalid_stream");
    }
    if (chunk.error !== undefined || eventName === "error") {
      const error = chunk.error ?? chunk;
      const detail = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
      throw new ModelStreamError(
        typeof detail.message === "string" ? detail.message : "Model stream failed",
        typeof detail.code === "string" || typeof detail.code === "number"
          ? detail.code
          : undefined,
      );
    }
    onChunk?.(chunk);
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      text += delta;
      onDelta(delta);
    }
  };
  const line = (value: string) => {
    if (value === "") {
      dispatch();
      return;
    }
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const key = colon < 0 ? value : value.slice(0, colon);
    const raw = colon < 0 ? "" : value.slice(colon + 1);
    const valueText = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (key === "data") data.push(valueText);
    else if (key === "event") event = valueText;
  };
  try {
    while (!done) {
      signal.throwIfAborted();
      const result = await reader.read();
      signal.throwIfAborted();
      buffer += result.done ? decoder.decode() : decoder.decode(result.value, { stream: true });
      // CRLF may itself be split between transport chunks.
      let end = buffer.indexOf("\n");
      while (!done && end >= 0) {
        signal.throwIfAborted();
        line(buffer.slice(0, end).replace(/\r$/, ""));
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf("\n");
      }
      if (result.done) {
        if (buffer) line(buffer.replace(/\r$/, ""));
        dispatch();
        if (!done)
          throw new ModelStreamError("Model stream ended before [DONE]", "incomplete_stream");
      }
    }
    signal.throwIfAborted();
    return text;
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
