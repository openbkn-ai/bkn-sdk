// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { randomBytes, randomUUID } from "node:crypto";
import type { TraceContext, TraceContextOptions } from "./types.js";

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const REQUEST_ID_RE = /^req_[0-9A-Za-z_.-]+$/;
const CORRELATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ALLOWED_BAGGAGE = new Set(["bkn.account.type", "bkn.runtime.env"]);

export function isValidRequestId(value: string | undefined): value is string {
  return typeof value === "string" && REQUEST_ID_RE.test(value);
}

export function isValidCorrelationId(value: string | undefined): value is string {
  return typeof value === "string" && CORRELATION_ID_RE.test(value.trim());
}

export function isValidTraceparent(value: string | undefined): value is string {
  if (typeof value !== "string") return false;
  const match = TRACEPARENT_RE.exec(value);
  if (!match) return false;
  const [, traceId, spanId] = match;
  return traceId !== "0".repeat(32) && spanId !== "0".repeat(16);
}

export function createTraceContext(opts: TraceContextOptions = {}): TraceContext {
  const requestId = isValidRequestId(opts.requestId) ? opts.requestId : `req_${randomUUID()}`;
  const traceparent = isValidTraceparent(opts.traceparent) ? opts.traceparent : newTraceparent();
  const baggage = filterBaggage(opts.baggage);
  const conversationId = isValidCorrelationId(opts.conversationId)
    ? opts.conversationId.trim()
    : undefined;
  const interactionId = isValidCorrelationId(opts.interactionId)
    ? opts.interactionId.trim()
    : undefined;
  return {
    requestId,
    traceparent,
    ...(conversationId ? { conversationId } : {}),
    ...(interactionId ? { interactionId } : {}),
    ...(Object.keys(baggage).length > 0 ? { baggage } : {}),
  };
}

export function filterBaggage(baggage: Record<string, string> | undefined): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(baggage ?? {})) {
    if (ALLOWED_BAGGAGE.has(key) && value !== "") filtered[key] = value;
  }
  return filtered;
}

export function serializeBaggage(baggage: Record<string, string> | undefined): string | undefined {
  const filtered = filterBaggage(baggage);
  const entries = Object.entries(filtered);
  if (entries.length === 0) return undefined;
  return entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join(",");
}

function newTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

function randomHex(bytes: number): string {
  let value = randomBytes(bytes).toString("hex");
  while (/^0+$/.test(value)) value = randomBytes(bytes).toString("hex");
  return value;
}
