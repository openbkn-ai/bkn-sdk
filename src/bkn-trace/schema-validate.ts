// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * `trace schema validate` — validate a local eval-set or diagnosis-rule file
 * (JSON or YAML) against a zod schema. Catches malformed cases/rules before
 * `eval-set test` runs them or before a custom rule is shipped.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";

const Assertion = z
  .object({
    type: z.enum([
      "contains",
      "not_contains",
      "regex",
      "tool_call_count",
      "tool_call_order",
      "latency_ms",
      "semantic_match",
    ]),
  })
  .passthrough();

const EvalCase = z.object({
  query_id: z.string().optional(),
  query: z.string().optional(),
  input: z.object({ user_message: z.string() }).optional(),
  reference: z.object({ answer: z.string() }).optional(),
  assertions: z.array(Assertion).optional(),
  tags: z.array(z.string()).optional(),
});

const EvalSetFile = z.union([
  z.array(EvalCase),
  z.object({ cases: z.array(EvalCase) }),
  z.object({ queries: z.array(EvalCase) }),
]);

const DiagnosisRule = z.object({
  id: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  symptom: z.string(),
  predicate: z.string().optional(),
  rubric: z.unknown().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type SchemaKind = "eval-set" | "rule";

export interface SchemaValidateResult {
  valid: boolean;
  kind: SchemaKind;
  file: string;
  errors: string[];
}

function parseFile(file: string): unknown {
  const text = readFileSync(file, "utf8");
  const ext = extname(file).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") return yaml.load(text);
  return JSON.parse(text);
}

/** Infer the schema kind from the parsed shape when not given explicitly. */
function inferKind(data: unknown): SchemaKind {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    if ("predicate" in o || "rubric" in o || ("symptom" in o && "severity" in o)) return "rule";
  }
  return "eval-set";
}

export function validateSchemaFile(file: string, kind?: SchemaKind): SchemaValidateResult {
  let data: unknown;
  try {
    data = parseFile(file);
  } catch (e) {
    return {
      valid: false,
      kind: kind ?? "eval-set",
      file,
      errors: [`parse error: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
  const resolved = kind ?? inferKind(data);
  const schema = resolved === "rule" ? DiagnosisRule : EvalSetFile;
  const result = schema.safeParse(data);
  if (result.success) return { valid: true, kind: resolved, file, errors: [] };
  return {
    valid: false,
    kind: resolved,
    file,
    errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
