/**
 * @openbkn/bkn-sdk — library entry.
 * Re-exports the client factory, resource namespaces, and shared types.
 * No side effects on import.
 */
export { createClient, type BknClient } from "./client.js";
export type { ClientOptions, RequestContext } from "./types.js";
export {
  DEFAULT_BUSINESS_DOMAIN,
  DEFAULT_LIST_LIMIT,
  DEFAULT_QUERY_LIMIT,
} from "./types.js";
export { HttpError, InputError } from "./utils/errors.js";

// Resource namespaces (advanced: use with a resolved RequestContext).
export { dataflows } from "./resources/dataflows.js";
export { kn } from "./resources/knowledge-networks.js";
export { resources } from "./resources/resources.js";
export { vega } from "./resources/vega.js";

// Auth is store-backed (pre-token), so it is a standalone namespace.
export * as auth from "./resources/auth.js";

// Vega build types are part of the public contract.
export type {
  BuildMode,
  BuildTask,
  CreateBuildTaskRequest,
} from "./api/vega.js";

// Low-level escape hatch for endpoints not yet wrapped.
export { request } from "./api/http.js";
export { resolveContext } from "./config/resolve.js";
