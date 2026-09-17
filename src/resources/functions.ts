// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Sandbox function surface: run code without registering it as anything. */
import {
  type ExecuteFunctionOptions,
  type FunctionAiGenerationRequest,
  type FunctionAiGenerationType,
  executeFunction,
  functionTemplate,
  generateFunction,
  getFunctionPromptTemplate,
  inferFunctionSchema,
  listDependencyVersions,
  listFunctionDependencies,
} from "../api/functions.js";
import type { RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";

function checkedGenerationRequest(
  type: FunctionAiGenerationType,
  request: FunctionAiGenerationRequest,
): FunctionAiGenerationRequest {
  if (request.stream) {
    throw new InputError(
      "Function AI generation streaming returns SSE, which neither client.functions.generate nor the openbkn CLI supports yet; omit stream for the JSON response.",
    );
  }
  if (type === "python_function_generator" && !request.query?.trim()) {
    throw new InputError("python_function_generator requires a non-empty query.");
  }
  if (type === "metadata_param_generator" && !request.code?.trim()) {
    throw new InputError("metadata_param_generator requires non-empty code.");
  }
  return request;
}

export function functions(ctx: RequestContext) {
  return {
    run: (opts: ExecuteFunctionOptions) => executeFunction(ctx, opts),
    inferSchema: (code: string) => inferFunctionSchema(ctx, code),
    dependencies: () => listFunctionDependencies(ctx),
    dependencyVersions: (
      packageName: string,
      opts?: { pypiRepoUrl?: string; pythonVersion?: string },
    ) => listDependencyVersions(ctx, packageName, opts),
    template: (templateType?: string) => functionTemplate(ctx, templateType),
    generate: (type: FunctionAiGenerationType, request: FunctionAiGenerationRequest) =>
      generateFunction(ctx, type, checkedGenerationRequest(type, request)),
    promptTemplate: (type: FunctionAiGenerationType) => getFunctionPromptTemplate(ctx, type),
  };
}
