// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Wire contract of the knowledge-network routes against the published bkn-backend and
 * ontology-query specs: required override headers, query parameters, encoded path ids.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteActionSchedules,
  getConceptGroup,
  listActionSchedules,
  listBknResources,
  listCapabilities,
  listConceptGroups,
  removeConceptGroupMembers,
  uploadBkn,
} from "../../src/api/bkn-backend.js";
import {
  cancelActionLog,
  createMetric,
  createObjectTypes,
  createSchemaItem,
  deleteSchemaItem,
  dryRunMetric,
  executeActionType,
  getActionLog,
  getKnowledgeNetwork,
  getSchemaItem,
  listActionLogs,
  listActionTypes,
  listMetrics,
  listObjectTypes,
  listRelationTypes,
  queryActionType,
  queryMetricData,
  queryObjectTypeInstances,
  querySubgraph,
  updateSchemaItem,
} from "../../src/api/knowledge-networks.js";
import type { RequestContext } from "../../src/types.js";
import { InputError } from "../../src/utils/errors.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

type CallArgs = [string | URL, RequestInit];

function mockFetch() {
  const fn = vi.fn(
    async (_url: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function lastCall(fn: ReturnType<typeof mockFetch>): { url: URL; init: RequestInit } {
  const args = fn.mock.calls.at(-1) as CallArgs | undefined;
  if (!args) throw new Error("fetch was not called");
  return { url: new URL(String(args[0])), init: args[1] };
}

function header(init: RequestInit, name: string): string | undefined {
  const h = init.headers;
  if (h instanceof Headers) return h.get(name) ?? undefined;
  const record = (h ?? {}) as Record<string, string>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? record[key] : undefined;
}

afterEach(() => vi.unstubAllGlobals());

describe("bkn resources", () => {
  it("always names resource_type=knowledge_network, which the backend requires", async () => {
    const f = mockFetch();
    await listBknResources(ctx);
    const { url } = lastCall(f);
    expect(url.pathname).toBe("/api/bkn-backend/v1/resources");
    expect(url.searchParams.get("resource_type")).toBe("knowledge_network");
    expect(url.searchParams.get("limit")).toBe("30");
  });

  it("passes keyword and paging", async () => {
    const f = mockFetch();
    await listBknResources(ctx, {
      keyword: "ord",
      offset: 5,
      limit: 2,
      sort: "name",
      direction: "asc",
    });
    const q = lastCall(f).url.searchParams;
    expect(q.get("keyword")).toBe("ord");
    expect(q.get("offset")).toBe("5");
    expect(q.get("limit")).toBe("2");
    expect(q.get("sort")).toBe("name");
    expect(q.get("direction")).toBe("asc");
  });
});

describe("action-type query", () => {
  it("sends the GET override, no trailing slash, and its query flags", async () => {
    const f = mockFetch();
    await queryActionType(
      ctx,
      "kn-1",
      "at/1",
      {},
      {
        branch: "dev",
        includeTypeInfo: true,
        excludeSystemProperties: ["_display", "_instance_id"],
      },
    );
    const { url, init } = lastCall(f);
    expect(init.method).toBe("POST");
    expect(url.pathname).toBe("/api/ontology-query/v1/knowledge-networks/kn-1/action-types/at%2F1");
    expect(header(init, "X-HTTP-Method-Override")).toBe("GET");
    expect(url.searchParams.get("branch")).toBe("dev");
    expect(url.searchParams.get("include_type_info")).toBe("true");
    expect(url.searchParams.getAll("exclude_system_properties")).toEqual([
      "_display",
      "_instance_id",
    ]);
  });
});

describe("schema creates carry the POST override", () => {
  it("object-type batch create (create-from-catalog path)", async () => {
    const f = mockFetch();
    await createObjectTypes(ctx, "kn-1", [{ id: "a" }]);
    const { init } = lastCall(f);
    expect(header(init, "X-HTTP-Method-Override")).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ entries: [{ id: "a" }] });
  });

  it.each(["object-types", "relation-types", "action-types"] as const)(
    "%s create sends POST override and keeps an {entries} body",
    async (kind) => {
      const f = mockFetch();
      await createSchemaItem(ctx, "kn-1", kind, { entries: [{ id: "x" }] }, { branch: "dev" });
      const { url, init } = lastCall(f);
      expect(url.pathname).toBe(`/api/bkn-backend/v1/knowledge-networks/kn-1/${kind}`);
      expect(url.searchParams.get("branch")).toBe("dev");
      expect(header(init, "X-HTTP-Method-Override")).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ entries: [{ id: "x" }] });
    },
  );

  it("wraps a bare array into {entries}", async () => {
    const f = mockFetch();
    await createSchemaItem(ctx, "kn-1", "relation-types", [{ id: "r" }]);
    expect(JSON.parse(lastCall(f).init.body as string)).toEqual({ entries: [{ id: "r" }] });
  });

  it("metric create sends POST override", async () => {
    const f = mockFetch();
    await createMetric(ctx, "kn-1", [{ name: "m" }]);
    const { url, init } = lastCall(f);
    expect(url.pathname).toBe("/api/bkn-backend/v1/knowledge-networks/kn-1/metrics");
    expect(header(init, "X-HTTP-Method-Override")).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ entries: [{ name: "m" }] });
  });
});

describe("concept groups and action schedules", () => {
  it("concept-group list asks for every row by default instead of the backend's 10", async () => {
    const f = mockFetch();
    await listConceptGroups(ctx, "kn-1");
    expect(lastCall(f).url.searchParams.get("limit")).toBe("-1");
  });

  it("concept-group list passes filters", async () => {
    const f = mockFetch();
    await listConceptGroups(ctx, "kn-1", {
      branch: "dev",
      namePattern: "sales",
      tag: "t",
      sort: "name",
      direction: "asc",
      offset: 10,
      limit: 5,
    });
    const q = lastCall(f).url.searchParams;
    expect(Object.fromEntries(q)).toEqual({
      branch: "dev",
      name_pattern: "sales",
      tag: "t",
      sort: "name",
      direction: "asc",
      offset: "10",
      limit: "5",
    });
  });

  it("concept-group get passes branch, statistics and mode", async () => {
    const f = mockFetch();
    await getConceptGroup(ctx, "kn-1", "cg 1", {
      branch: "dev",
      includeStatistics: true,
      mode: "m",
    });
    const { url } = lastCall(f);
    expect(url.pathname).toBe("/api/bkn-backend/v1/knowledge-networks/kn-1/concept-groups/cg%201");
    expect(url.searchParams.get("include_statistics")).toBe("true");
    expect(url.searchParams.get("mode")).toBe("m");
  });

  it("action-schedule list defaults to all rows and passes its filters", async () => {
    const f = mockFetch();
    await listActionSchedules(ctx, "kn-1");
    expect(lastCall(f).url.searchParams.get("limit")).toBe("-1");
    await listActionSchedules(ctx, "kn-1", {
      actionTypeId: "at-1",
      status: "active",
      namePattern: "nightly",
    });
    const q = lastCall(f).url.searchParams;
    expect(q.get("action_type_id")).toBe("at-1");
    expect(q.get("status")).toBe("active");
    expect(q.get("name_pattern")).toBe("nightly");
  });

  it("encodes each id of a comma-joined delete, keeping the commas", async () => {
    const f = mockFetch();
    await removeConceptGroupMembers(ctx, "kn-1", "cg-1", "ot/a, ot?b");
    expect(lastCall(f).url.pathname).toBe(
      "/api/bkn-backend/v1/knowledge-networks/kn-1/concept-groups/cg-1/object-types/ot%2Fa,ot%3Fb",
    );
    await deleteActionSchedules(ctx, "kn-1", ["s#1", "s 2"]);
    expect(lastCall(f).url.pathname).toBe(
      "/api/bkn-backend/v1/knowledge-networks/kn-1/action-schedules/s%231,s%202",
    );
    // `?` inside an id must not start a query string.
    expect(lastCall(f).url.search).toBe("");
  });

  it("refuses an empty id list before sending a DELETE", async () => {
    const f = mockFetch();
    expect(() => deleteActionSchedules(ctx, "kn-1", " , ")).toThrow(InputError);
    expect(() => removeConceptGroupMembers(ctx, "kn-1", "cg-1", [])).toThrow(InputError);
    expect(f).not.toHaveBeenCalled();
  });

  it("capability list passes sort and direction", async () => {
    const f = mockFetch();
    await listCapabilities(ctx, "kn-1", { sort: "update_time", direction: "asc" });
    const q = lastCall(f).url.searchParams;
    expect(q.get("sort")).toBe("update_time");
    expect(q.get("direction")).toBe("asc");
  });
});

describe("action logs", () => {
  it("list passes every filter and comma-joins search_after", async () => {
    const f = mockFetch();
    await listActionLogs(ctx, "kn-1", {
      keyword: "abc",
      startTimeFrom: 1,
      startTimeTo: 2,
      offset: 3,
      needTotal: true,
      triggerType: "scheduled",
      searchAfter: [1704067200000, "cqq2g8h4d2fg00fvm8dg"],
    });
    const q = lastCall(f).url.searchParams;
    expect(q.get("keyword")).toBe("abc");
    expect(q.get("start_time_from")).toBe("1");
    expect(q.get("start_time_to")).toBe("2");
    expect(q.get("offset")).toBe("3");
    expect(q.get("need_total")).toBe("true");
    expect(q.get("trigger_type")).toBe("scheduled");
    expect(q.get("search_after")).toBe("1704067200000,cqq2g8h4d2fg00fvm8dg");
  });

  it("get pages the embedded results", async () => {
    const f = mockFetch();
    await getActionLog(ctx, "kn-1", "log-1", {
      resultsLimit: 10,
      resultsOffset: 20,
      resultsStatus: "failed",
    });
    const q = lastCall(f).url.searchParams;
    expect(q.get("results_limit")).toBe("10");
    expect(q.get("results_offset")).toBe("20");
    expect(q.get("results_status")).toBe("failed");
  });

  it("cancel sends a reason only when given", async () => {
    const f = mockFetch();
    await cancelActionLog(ctx, "kn-1", "log-1");
    expect(lastCall(f).init.body).toBeUndefined();
    await cancelActionLog(ctx, "kn-1", "log-1", { reason: "stuck" });
    expect(JSON.parse(lastCall(f).init.body as string)).toEqual({ reason: "stuck" });
  });
});

describe("ontology-query read flags", () => {
  it("subgraph passes query_type and the instance flags", async () => {
    const f = mockFetch();
    await querySubgraph(
      ctx,
      "kn-1",
      {},
      {
        queryType: "relation_path",
        branch: "dev",
        includeLogicParams: true,
        excludeSystemProperties: ["_instance_identity"],
        ignoringStoreCache: true,
      },
    );
    const q = lastCall(f).url.searchParams;
    expect(q.get("query_type")).toBe("relation_path");
    expect(q.get("branch")).toBe("dev");
    expect(q.get("include_logic_params")).toBe("true");
    expect(q.getAll("exclude_system_properties")).toEqual(["_instance_identity"]);
    expect(q.get("ignoring_store_cache")).toBe("true");
  });

  it("subgraph sends no query string by default", async () => {
    const f = mockFetch();
    await querySubgraph(ctx, "kn-1", {});
    expect(lastCall(f).url.search).toBe("");
  });

  it("object-type instance query passes its flags", async () => {
    const f = mockFetch();
    await queryObjectTypeInstances(
      ctx,
      "kn-1",
      "ot-1",
      { limit: 1 },
      { includeTypeInfo: true, includeLogicParams: true, branch: "dev" },
    );
    const q = lastCall(f).url.searchParams;
    expect(q.get("include_type_info")).toBe("true");
    expect(q.get("include_logic_params")).toBe("true");
    expect(q.get("branch")).toBe("dev");
  });

  it("execute and metric reads pass branch and fill_null", async () => {
    const f = mockFetch();
    await executeActionType(ctx, "kn-1", "at-1", {}, { branch: "dev" });
    expect(lastCall(f).url.searchParams.get("branch")).toBe("dev");
    await queryMetricData(ctx, "kn-1", "m-1", {}, { branch: "dev", fillNull: true });
    expect(lastCall(f).url.searchParams.get("fill_null")).toBe("true");
    await dryRunMetric(ctx, "kn-1", {}, { fillNull: true });
    expect(lastCall(f).url.searchParams.get("fill_null")).toBe("true");
  });
});

describe("knowledge network and schema items", () => {
  it("get passes branch and detail_level", async () => {
    const f = mockFetch();
    await getKnowledgeNetwork(ctx, "kn-1", { branch: "dev", detailLevel: "summary" });
    const q = lastCall(f).url.searchParams;
    expect(q.get("branch")).toBe("dev");
    expect(q.get("detail_level")).toBe("summary");
  });

  it("schema lists pass the shared filters and their own", async () => {
    const f = mockFetch();
    await listObjectTypes(ctx, "kn-1", {
      namePattern: "ord",
      tag: "t",
      sort: "name",
      direction: "asc",
      needTotal: false,
      searchAfter: "a,b",
    });
    let q = lastCall(f).url.searchParams;
    expect(q.get("name_pattern")).toBe("ord");
    expect(q.get("tag")).toBe("t");
    expect(q.get("need_total")).toBe("false");
    expect(q.get("search_after")).toBe("a,b");

    await listRelationTypes(ctx, "kn-1", {
      sourceObjectTypeId: "s",
      targetObjectTypeId: "t",
      boundObjectTypeId: ["a", "b"],
    });
    q = lastCall(f).url.searchParams;
    expect(q.get("source_object_type_id")).toBe("s");
    expect(q.get("target_object_type_id")).toBe("t");
    expect(q.getAll("bound_object_type_id")).toEqual(["a", "b"]);

    await listActionTypes(ctx, "kn-1", { actionType: "add", objectTypeId: "ot-1" });
    q = lastCall(f).url.searchParams;
    expect(q.get("action_type")).toBe("add");
    expect(q.get("object_type_id")).toBe("ot-1");

    await listMetrics(ctx, "kn-1", { branch: "dev", scopeType: "object_type", scopeRef: "ot-1" });
    q = lastCall(f).url.searchParams;
    expect(q.get("branch")).toBe("dev");
    expect(q.get("scope_type")).toBe("object_type");
    expect(q.get("scope_ref")).toBe("ot-1");
    expect(q.get("limit")).toBe("-1");
  });

  it("get/update/delete pass branch, strict_mode and force_delete", async () => {
    const f = mockFetch();
    await getSchemaItem(ctx, "kn-1", "relation-types", "rt-1", { branch: "dev" });
    expect(lastCall(f).url.searchParams.get("branch")).toBe("dev");

    await updateSchemaItem(ctx, "kn-1", "object-types", "ot-1", {}, { strictMode: false });
    expect(lastCall(f).url.searchParams.get("strict_mode")).toBe("false");

    await deleteSchemaItem(ctx, "kn-1", "object-types", "ot-1", { forceDelete: true });
    expect(lastCall(f).url.searchParams.get("force_delete")).toBe("true");

    // force_delete is an object-type parameter only.
    await deleteSchemaItem(ctx, "kn-1", "relation-types", "rt-1", { forceDelete: true });
    expect(lastCall(f).url.searchParams.has("force_delete")).toBe(false);
  });
});

describe("bkn push", () => {
  it("passes import_mode, strict_mode and binding_policy", async () => {
    const f = mockFetch();
    await uploadBkn(ctx, Buffer.from("tar"), {
      importMode: "overwrite",
      strictMode: false,
      bindingPolicy: "detach",
    });
    const { url } = lastCall(f);
    expect(url.pathname).toBe("/api/bkn-backend/v1/bkns");
    expect(url.searchParams.get("branch")).toBe("main");
    expect(url.searchParams.get("import_mode")).toBe("overwrite");
    expect(url.searchParams.get("strict_mode")).toBe("false");
    expect(url.searchParams.get("binding_policy")).toBe("detach");
  });

  it("sends only branch by default", async () => {
    const f = mockFetch();
    await uploadBkn(ctx, Buffer.from("tar"));
    expect([...lastCall(f).url.searchParams.keys()]).toEqual(["branch"]);
  });
});
