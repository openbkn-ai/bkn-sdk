// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import type { EvalOperation } from "../api/eval-operations.js";
import {
  type EvalOperationInput,
  type EvalRequestOptions,
  evalParticipantApi,
  evalRequest,
} from "../api/evals.js";
import type { RequestContext } from "../types.js";

/** Enterprise quality evaluation; separate from Trace fixture generation. */
export function evals(ctx: RequestContext) {
  return {
    forNetwork: (knId: string) => ({
      /** Use an operation from EVAL_OPERATIONS; no arbitrary path escapes. */
      request: <K extends EvalOperation>(
        operation: K,
        input: EvalOperationInput<K>,
        options?: EvalRequestOptions,
      ) => evalRequest(ctx, knId, operation, input, options),
    }),
    /** No automatic agent runner. Call discover/start/next/submit/progress explicitly. */
    participant: evalParticipantApi(ctx),
  };
}
