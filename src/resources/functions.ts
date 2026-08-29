// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Sandbox function surface: run code without registering it as anything. */
import {
  type ExecuteFunctionOptions,
  executeFunction,
  functionTemplate,
  inferFunctionSchema,
  listDependencyVersions,
  listFunctionDependencies,
} from "../api/functions.js";
import type { RequestContext } from "../types.js";

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
  };
}
