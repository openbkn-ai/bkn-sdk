import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditionRequiredError,
  professionalFeature,
  resetEditionCache,
} from "../../src/api/edition.js";
import { request } from "../../src/api/http.js";
import type { RequestContext } from "../../src/types.js";
import { HttpError, formatError } from "../../src/utils/errors.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

function platform(edition: string | undefined) {
  const fetch = vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/api/safe/v1/capabilities")) {
      return edition ? Response.json({ edition }) : new Response("nope", { status: 404 });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const capCalls = (f: ReturnType<typeof platform>) =>
  f.mock.calls.filter(([u]) => String(u).endsWith("/safe/v1/capabilities")).length;

beforeEach(() => resetEditionCache());
afterEach(() => vi.unstubAllGlobals());

describe("professionalFeature", () => {
  it.each([
    ["/api/agent-operator-integration/v1/tool-box", "Toolboxes and tools"],
    ["/api/agent-operator-integration/v1/skills/abc", "Skills"],
    ["/api/agent-operator-integration/v1/mcp", "MCP Servers"],
    ["/api/agent-operator-integration/v1/function/execute", "Functions"],
    ["/api/bkn-backend/v1/knowledge-networks/k1/action-types", "Action types"],
    ["/api/bkn-backend/v1/knowledge-networks/k1/action-schedules/s", "Action schedules"],
    ["/api/ontology-query/v1/knowledge-networks/k1/action-executions/e", "Action executions"],
    ["/api/bkn-backend/v1/knowledge-networks/k1/capabilities", "Capability mounts"],
    ["/api/bkn-backend/v1/knowledge-networks/k1/object-metrics/m/versions", "Object metrics"],
  ])("%s -> %s", (path, feature) => expect(professionalFeature(path)).toBe(feature));

  it("leaves Community routes alone", () => {
    expect(professionalFeature("/api/bkn-backend/v1/knowledge-networks/k1/object-types")).toBe(
      undefined,
    );
    expect(professionalFeature("/api/safe/v1/capabilities")).toBe(undefined);
  });
});

describe("request on a Professional route", () => {
  it("reports the edition on Community, reading capabilities once", async () => {
    const f = platform("community");
    const err = (await request(ctx, "/api/agent-operator-integration/v1/tool-box").catch(
      (e: unknown) => e,
    )) as HttpError;
    expect(err).toBeInstanceOf(EditionRequiredError);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(formatError(err)).toContain("require the Professional edition");
    await request(ctx, "/api/bkn-backend/v1/knowledge-networks/k/action-types").catch(() => {});
    expect(capCalls(f)).toBe(1);
  });

  it("keeps the plain 404 on Professional", async () => {
    platform("professional");
    const err = (await request(ctx, "/api/agent-operator-integration/v1/tool-box/x").catch(
      (e: unknown) => e,
    )) as HttpError;
    expect(err).not.toBeInstanceOf(EditionRequiredError);
    expect(err.status).toBe(404);
  });

  it("keeps the plain 404 when the edition cannot be read", async () => {
    platform(undefined);
    const err = (await request(ctx, "/api/agent-operator-integration/v1/mcp").catch(
      (e: unknown) => e,
    )) as HttpError;
    expect(err).not.toBeInstanceOf(EditionRequiredError);
  });

  it("does not read the edition for a Community route", async () => {
    const f = platform("community");
    await request(ctx, "/api/bkn-backend/v1/knowledge-networks/k/object-types").catch(() => {});
    expect(capCalls(f)).toBe(0);
  });
});
