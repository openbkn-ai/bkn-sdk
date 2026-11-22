// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Shared wire definitions for API Catalogs and read-only API Resources. */
import { z } from "zod";
import type { Decimal } from "../utils/json-bigint.js";

export type ExactNumber = number | bigint | Decimal;
export type APIJSONValue =
  | null
  | boolean
  | string
  | ExactNumber
  | APIJSONValue[]
  | { [key: string]: APIJSONValue };
export type JSONSchema = boolean | Record<string, unknown>;

export interface APICondition extends Record<string, unknown> {
  operation: string;
  field?: string;
  value?: unknown;
  value_from?: "const" | "field";
  sub_conditions?: APICondition[];
}

export interface HTTPConstructionNode extends Record<string, unknown> {
  type?: string;
  schema?: JSONSchema;
  value?: unknown;
  serialize?: "json" | "sql";
  serialize_options?: { fields: Record<string, string> };
  properties?: Record<string, HTTPConstructionNode>;
}

export interface HTTPQueryParameter extends HTTPConstructionNode {
  name: string;
  required?: boolean;
  default_value?: APIJSONValue;
}

export interface HTTPRequestDefinition {
  method: string;
  path: string;
  headers?: Record<string, string>;
  /** Dynamic construction nodes retain the complete backend-defined schema/value/serialize shape. */
  parameters?: HTTPQueryParameter[];
  body?: HTTPConstructionNode;
}

export interface HTTPResponseDefinition {
  description: string;
  schema: JSONSchema;
  headers?: Record<string, unknown>;
  /** Business responses only; empty string selects the whole body. */
  result_rows?: string;
  result_total?: string;
}

export interface HTTPOperationDefinition {
  request: HTTPRequestDefinition;
  response: { content_type: "application/json"; statuses: Record<string, HTTPResponseDefinition> };
  success_rule: { http_status: number[]; body_filter_condition?: APICondition };
}

export interface CatalogVariable {
  /** Omitted on redacted reads; complete replacement requires the original value. */
  value?: APIJSONValue;
  /** Omitted or null is treated as false by the backend. */
  sensitive?: boolean | null;
}

export interface APICatalogConfig extends Record<string, unknown> {
  base_url: string;
  variables?: Record<string, CatalogVariable>;
  login_request?: HTTPOperationDefinition;
  options?: { timeout_seconds?: number; max_response_mib?: number };
}

export interface APIPagingRule {
  mode: "offset" | "page";
  default_limit: number;
  max_limit: number;
  page_base?: number;
}

export interface APIDefinition extends HTTPOperationDefinition {
  variables?: Record<string, CatalogVariable>;
  paging_rule?: APIPagingRule;
}

/** Invocation carries conditions and single-page positions only, never destinations or credentials. */
export const APIInvocationPaging = z
  .object({
    mode: z.literal("single").optional(),
    offset: z.number().int().nonnegative().safe().optional(),
    limit: z.number().int().nonnegative().safe().optional(),
  })
  .strict();
export const APIValidation = z
  .object({
    filter_condition: z.record(z.unknown()).optional(),
    paging: APIInvocationPaging.optional(),
  })
  .strict();

export interface APIValidationInput {
  filter_condition?: APICondition | Record<string, unknown>;
  paging?: { mode?: "single"; offset?: number; limit?: number };
}
