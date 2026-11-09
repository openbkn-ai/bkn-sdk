// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

export type EvalRunScope =
  | { kind: "suite"; suite_id: string; version: number }
  | { kind: "cases"; case_ids: string[] };
export type EvalRunPlanSchedule = { time_of_day: string; timezone: string } & (
  | { kind: "daily" }
  | { kind: "weekly"; weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7 }
  | { kind: "monthly"; day_of_month: number }
);

/** Request JSON shapes. The server enforces required business fields and cross-field rules. */
export interface EvalOperationBodies {
  previewEvalRuleApplication: {
    limit?: number;
    only_samples?: boolean;
    page?: number;
    q?: string;
    resources?: Array<{ id?: string; kind?: string }>;
    rule_ids?: Array<string>;
    samples?: Array<{
      arguments?: unknown;
      assertions?: unknown;
      definition_only?: boolean;
      evidence_refs?: Array<string>;
      expected?: unknown;
      question?: string;
      resource_checksum?: string;
      rule_checksum?: string;
      sample_id?: string;
      scope?: unknown;
      source_kind?: string;
      target_key?: string;
      title?: string;
    }>;
    targets?: Array<{ resource_key?: string; rule_id?: string; target_id?: string }>;
  };
  saveEvalRuleApplication: {
    limit?: number;
    only_samples?: boolean;
    page?: number;
    q?: string;
    resources?: Array<{ id?: string; kind?: string }>;
    rule_ids?: Array<string>;
    samples?: Array<{
      arguments?: unknown;
      assertions?: unknown;
      definition_only?: boolean;
      evidence_refs?: Array<string>;
      expected?: unknown;
      question?: string;
      resource_checksum?: string;
      rule_checksum?: string;
      sample_id?: string;
      scope?: unknown;
      source_kind?: string;
      target_key?: string;
      title?: string;
    }>;
    targets?: Array<{ resource_key?: string; rule_id?: string; target_id?: string }>;
  };
  compareEvalAgentRuns: {
    runs: Array<{ result_revision?: number; run_id?: string }>;
    suite_id: string;
    suite_version: number;
  };
  createEvalCase: {
    definition: {
      assertions?: unknown;
      category?: string;
      diagnostic_spec?: unknown;
      execution_spec?: unknown;
      expected_source?: unknown;
      expected_spec?: unknown;
      input_spec?: unknown;
      risk_level?: string;
      title?: string;
    };
    enabled?: boolean;
  };
  createEvalRun: {
    idempotency_key: string;
    scope: EvalRunScope;
    target: { branch?: string; data_baseline_id?: string };
  };
  createEvalRunPlan: {
    enabled?: boolean;
    name: string;
    overlap_policy: "skip";
    revision?: number;
    schedule: EvalRunPlanSchedule;
    suite_id: string;
    suite_version?: number;
    version_policy: "latest" | "fixed";
  };
  createEvalSuite: {
    description?: string;
    members?: Array<string>;
    name: string;
    tags?: Array<string>;
  };
  previewEvalRunSelection: {
    execution_mode?: "platform" | "external" | "scheduled";
    scope: EvalRunScope;
  };
  previewEvalRuleMatches: {
    applicability?: { all?: Array<{ field?: string; operator?: string; value?: string }> };
    kind: string;
  };
  replaceEvalCase: {
    checksum: string;
    definition: {
      assertions?: unknown;
      category?: string;
      diagnostic_spec?: unknown;
      execution_spec?: unknown;
      expected_source?: unknown;
      expected_spec?: unknown;
      input_spec?: unknown;
      risk_level?: string;
      title?: string;
    };
    enabled?: boolean;
    revision: number;
  };
  replaceEvalSuite: {
    checksum: string;
    description?: string;
    members?: Array<string>;
    name: string;
    tags?: Array<string>;
    version: number;
  };
  trialEvalCase: {
    assertions: unknown;
    category?: string;
    diagnostic_spec?: unknown;
    execution_spec: unknown;
    expected_source: unknown;
    expected_spec: unknown;
    input_spec: unknown;
    risk_level?: string;
    title: string;
  };
  saveEvalTemplateConfig: {
    checksum: string;
    revision: number;
    rules: Array<{
      check?: unknown;
      applicability?: { all?: Array<{ field?: string; operator?: string; value?: string }> };
      appliesWhen?: string;
      builtinVersion?: number;
      description?: string;
      enabled?: boolean;
      evidence?: string;
      generationMode?: string;
      group?: string;
      id?: string;
      kind?: string;
      origin?: string;
      planDimensions?: Array<string>;
      preset?: string;
      revision?: number;
      title?: string;
    }>;
  };
  saveEvalOverviewScope: {
    excluded_kinds?: Array<string>;
    excluded_resources?: Array<{ id?: string; kind?: string }>;
    revision: number;
    updated_at?: string;
    updated_by?: string;
  };
  setEvalCaseState: { enabled: boolean };
  setEvalRunPlanState: { enabled: boolean; revision: number };
  updateEvalRunPlan: {
    enabled?: boolean;
    name: string;
    overlap_policy: "skip";
    revision: number;
    schedule: EvalRunPlanSchedule;
    suite_id: string;
    suite_version?: number;
    version_policy: "latest" | "fixed";
  };
}
