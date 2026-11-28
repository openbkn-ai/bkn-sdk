// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Edition awareness. From 0.2.2 Execution Factory, action types and the Dynamic
 * Model (event classes, object metrics, capability mounts, drafts/versions) are
 * part of the Professional edition: a Community platform has no such routes, so
 * the call answers a bare 404. {@link explainProfessional404} turns that 404
 * into a message that names the edition, after reading it once per invocation
 * from `GET /api/safe/v1/capabilities`.
 */
import type { RequestContext } from "../types.js";
import { isDryRun } from "../utils/dry-run.js";
import { HttpError } from "../utils/errors.js";
import { buildHeaders } from "./headers.js";
import { tlsFetch } from "./tls.js";

export type Edition = "community" | "professional" | "enterprise" | "industry";

const RANK: Record<Edition, number> = { community: 0, professional: 1, enterprise: 2, industry: 3 };

/** Routes that exist only on Professional or above, with the feature each one is. */
const PROFESSIONAL_ROUTES: Array<[RegExp, string]> = [
  [/^\/api\/agent-operator-integration\/v1\/skills(\/|$)/, "Skills"],
  [/^\/api\/agent-operator-integration\/v1\/mcp(\/|$)/, "MCP Servers"],
  [/^\/api\/agent-operator-integration\/v1\/function(\/|$)/, "Functions"],
  [/^\/api\/agent-operator-integration\/v1\/tool-box(\/|$)/, "Toolboxes and tools"],
  [/^\/api\/agent-operator-integration\/v1\/impex(\/|$)/, "Toolbox import/export"],
  [/^\/api\/agent-operator-integration\//, "Execution Factory"],
  [/^\/api\/(?:bkn-backend|ontology-query)\/v1\/object-metrics(\/|$)/, "Object metrics"],
  [
    /^\/api\/(?:bkn-backend|ontology-query)\/v1\/knowledge-networks\/[^/]+\/object-metrics(\/|$)/,
    "Object metrics",
  ],
  [
    /^\/api\/(?:bkn-backend|ontology-query)\/v1\/knowledge-networks\/[^/]+\/action-types(\/|$)/,
    "Action types",
  ],
  [
    /^\/api\/(?:bkn-backend|ontology-query)\/v1\/knowledge-networks\/[^/]+\/action-schedules(\/|$)/,
    "Action schedules",
  ],
  [
    /^\/api\/(?:bkn-backend|ontology-query)\/v1\/knowledge-networks\/[^/]+\/action-(?:executions|logs)(\/|$)/,
    "Action executions",
  ],
  [
    /^\/api\/(?:bkn-backend|ontology-query)\/v1\/knowledge-networks\/[^/]+\/capabilities(\/|$)/,
    "Capability mounts",
  ],
  [
    /^\/api\/(?:bkn-backend|ontology-query)\/v1\/knowledge-networks\/[^/]+\/event-(?:types|classes)(\/|$)/,
    "Event classes",
  ],
  [
    /^\/api\/(?:bkn-backend|ontology-query)\/v1\/knowledge-networks\/[^/]+\/(?:drafts|versions)(\/|$)/,
    "Drafts and versions",
  ],
];

/** The Professional feature a request path belongs to, or undefined for Community routes. */
export function professionalFeature(pathname: string): string | undefined {
  for (const [re, name] of PROFESSIONAL_ROUTES) if (re.test(pathname)) return name;
  return undefined;
}

const editions = new Map<string, Promise<Edition | undefined>>();

/**
 * The platform edition, read once per invocation and base URL. `undefined` when
 * it cannot be read (older platform, network error): callers then keep the
 * original error rather than guess.
 */
export function platformEdition(ctx: RequestContext): Promise<Edition | undefined> {
  const key = ctx.baseUrl;
  let hit = editions.get(key);
  if (!hit) {
    hit = readEdition(ctx);
    editions.set(key, hit);
  }
  return hit;
}

/** Forget cached editions (tests). */
export function resetEditionCache(): void {
  editions.clear();
}

async function readEdition(ctx: RequestContext): Promise<Edition | undefined> {
  try {
    const res = await tlsFetch(ctx, `${ctx.baseUrl}/api/safe/v1/capabilities`, {
      headers: buildHeaders(ctx),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const body = JSON.parse(await res.text()) as { edition?: unknown };
    return typeof body.edition === "string" && body.edition in RANK
      ? (body.edition as Edition)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A Professional route answered 404 on a Community platform. Still an HttpError (status 404). */
export class EditionRequiredError extends HttpError {
  readonly feature: string;
  readonly required = "professional";

  constructor(feature: string, original: HttpError) {
    super(original.status, original.statusText, original.body, original.hint, original.gateway);
    this.name = "EditionRequiredError";
    this.feature = feature;
    this.message = `${feature} require the Professional edition; this platform is Community.`;
  }
}

/**
 * Return `err` unchanged unless it is a 404 on a Professional route of a
 * Community platform, in which case return an {@link EditionRequiredError}.
 * Never throws and never turns a Professional platform's 404 into anything else.
 */
export async function explainProfessional404(
  ctx: RequestContext,
  url: URL | string,
  err: HttpError,
): Promise<HttpError> {
  if (err.status !== 404 || err.gateway || isDryRun()) return err;
  const pathname = typeof url === "string" ? new URL(url).pathname : url.pathname;
  const feature = professionalFeature(pathname);
  if (!feature) return err;
  const edition = await platformEdition(ctx);
  return edition === "community" ? new EditionRequiredError(feature, err) : err;
}

/** Build the HttpError for a failed raw-fetch response, edition-aware. */
export async function httpErrorFor(
  ctx: RequestContext,
  url: URL | string,
  res: { status: number; statusText: string },
  body: string,
): Promise<HttpError> {
  return explainProfessional404(ctx, url, new HttpError(res.status, res.statusText, body));
}
