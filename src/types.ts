/** Shared types for the SDK surface. No runtime, no side effects. */

/** Options a caller supplies; any field may be resolved from env/config store. */
export interface ClientOptions {
  baseUrl?: string;
  token?: string;
  /** Specific user credentials (transient); maps to legacy `--user`. */
  user?: string;
  /** Business domain header; defaults to `bd_public`. */
  businessDomain?: string;
  /** Skip TLS verification (dev / self-signed only). */
  insecure?: boolean;
}

/** Fully resolved request context — every field is known. */
export interface RequestContext {
  baseUrl: string;
  token: string;
  businessDomain: string;
  insecure: boolean;
}

export const DEFAULT_BUSINESS_DOMAIN = "bd_public";

/** Default list/query limits — see AGENTS.md conventions. */
export const DEFAULT_LIST_LIMIT = 30;
export const DEFAULT_QUERY_LIMIT = 50;
