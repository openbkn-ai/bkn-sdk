import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFromCatalog, createFromCsv } from "../../src/resources/bkn-create.js";
import type { RequestContext } from "../../src/types.js";
import { HttpError, InputError } from "../../src/utils/errors.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

type Route = (url: URL, init: RequestInit) => unknown | undefined;

/** Route by pathname; an unmatched request fails the test loudly. */
function mockFetch(routes: Array<[RegExp, Route]>): typeof fetch {
  const fn = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    for (const [pattern, handler] of routes) {
      if (!pattern.test(url.pathname)) continue;
      const body = normalizeVegaResponse(url, handler(url, init));
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body ?? {}), { status: 200 });
    }
    throw new Error(`unrouted request: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}

function normalizeVegaResponse(url: URL, body: unknown): unknown {
  if (/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/.test(url.pathname)) {
    return { id: "discover-task-1", ...(body as Record<string, unknown>) };
  }
  if (
    /^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/.test(url.pathname) &&
    body &&
    typeof body === "object"
  ) {
    const response = body as Record<string, unknown>;
    const entries = Array.isArray(response.entries)
      ? response.entries
      : [
          {
            id: "c-1",
            name: "catalog",
            type: "physical",
            enabled: true,
            connector_type: "mysql",
            ...response,
          },
        ];
    return {
      ...response,
      entries: entries.map((entry) => ({ update_time: 1, ...(entry as Record<string, unknown>) })),
    };
  }
  if (
    !url.pathname.startsWith("/api/vega-backend/v1/resources") ||
    !body ||
    typeof body !== "object" ||
    !("entries" in body) ||
    !Array.isArray(body.entries)
  ) {
    return body;
  }
  const entries = body.entries.map((entry) => ({
    catalog_id: "c-1",
    category: "table",
    status: "active",
    local_status: "unavailable",
    source_identifier: "table",
    creator: { id: "u-1", type: "user" },
    create_time: 1,
    updater: { id: "u-1", type: "user" },
    update_time: 1,
    ...(entry as Record<string, unknown>),
  }));
  return {
    ...body,
    entries,
    ...(url.pathname.endsWith("/resources") ? { total_count: entries.length } : {}),
  };
}

function paths(fetchMock: typeof fetch): string[] {
  const calls = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
  return calls.map(([u]) => new URL(u).pathname);
}

/** A catalog whose detail responses use the `{entries:[…]}` envelope. */
function catalogRoutes(
  tables: Array<{ id: string; name: string; columns: string[]; pk?: string }>,
): Array<[RegExp, Route]> {
  return [
    [
      /^\/api\/vega-backend\/v1\/resources$/,
      () => ({ entries: tables.map((t) => ({ id: t.id, name: t.name })) }),
    ],
    [
      /^\/api\/vega-backend\/v1\/resources\/[^/]+$/,
      (url) => {
        const id = url.pathname.split("/").pop();
        const t = tables.find((x) => x.id === id);
        return {
          entries: [
            {
              id: t?.id,
              name: t?.name,
              category: "table",
              source_metadata: { columns: t?.columns.map((c) => ({ name: c, type: "varchar" })) },
              schema_definition: t?.columns.map((c) => ({ name: c, type: "varchar" })),
              ...(t?.pk ? { primary_keys: [t.pk] } : {}),
            },
          ],
        };
      },
    ],
    [/^\/api\/ontology-manager\/v1\/knowledge-networks$/, () => ({ id: "kn-1" })],
    [/^\/api\/ontology-manager\/v1\/knowledge-networks\/[^/]+\/object-types$/, () => ({})],
    [/^\/api\/ontology-manager\/v1\/knowledge-networks\/[^/]+$/, () => ({})],
  ];
}

afterEach(() => vi.unstubAllGlobals());

describe("createFromCatalog table identifiers", () => {
  it("unwraps the resource detail envelope instead of building nameless tables", async () => {
    const f = mockFetch(catalogRoutes([{ id: "r-1", name: "document", columns: ["id", "body"] }]));
    const out = (await createFromCatalog(ctx, {
      catalogId: "c-1",
      name: "kn",
      pkMap: { document: "id" },
    })) as { object_types: Array<{ name: string; pk: string }> };
    expect(out.object_types).toEqual([{ name: "document", pk: "id" }]);
    // No rollback DELETE — the run succeeded.
    expect(paths(f)).not.toContain("/api/ontology-manager/v1/knowledge-networks/kn-1");
  });

  it("waits for asynchronous discovery before listing an empty catalog again", async () => {
    const table = { id: "r-1", name: "document", columns: ["id"], pk: "id" };
    let listCount = 0;
    const f = mockFetch([
      [
        /^\/api\/vega-backend\/v1\/resources$/,
        () => ({ entries: listCount++ === 0 ? [] : [{ id: table.id, name: table.name }] }),
      ],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({ id: "task-1" })],
      [
        /^\/api\/vega-backend\/v1\/discover-tasks\/task-1$/,
        () => ({
          id: "task-1",
          catalog_id: "c-1",
          schedule_id: "",
          strategy: "full_sync",
          trigger_type: "manual",
          status: "completed",
          progress: 100,
          message: "done",
          creator: { id: "u-1", type: "user" },
          create_time: 1,
        }),
      ],
      ...catalogRoutes([table]),
    ]);

    await expect(createFromCatalog(ctx, { catalogId: "c-1", name: "kn" })).resolves.toMatchObject({
      object_types: [{ name: "document" }],
    });
    expect(paths(f)).toContain("/api/vega-backend/v1/discover-tasks/task-1");
    expect(listCount).toBe(2);
  });

  it("reports an unknown discovery task status instead of waiting for timeout", async () => {
    mockFetch([
      [/^\/api\/vega-backend\/v1\/resources$/, () => ({ entries: [] })],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({ id: "task-1" })],
      [
        /^\/api\/vega-backend\/v1\/discover-tasks\/task-1$/,
        () => ({
          id: "task-1",
          catalog_id: "c-1",
          schedule_id: "",
          strategy: "full_sync",
          trigger_type: "manual",
          status: "stopped",
          progress: 0,
          message: "",
          creator: { id: "u-1", type: "user" },
          create_time: 1,
        }),
      ],
    ]);

    await expect(createFromCatalog(ctx, { catalogId: "c-1", name: "kn" })).rejects.toThrow(
      /task-1 ended in unexpected status "stopped"/,
    );
  });

  it("asks for every table, not the backend's default page", async () => {
    const f = mockFetch(
      catalogRoutes([{ id: "r-1", name: "document", columns: ["id"], pk: "id" }]),
    );
    await createFromCatalog(ctx, { catalogId: "c-1", name: "kn" });
    // A default page of 20 would drop the 21st table from the network and then
    // report it as one the catalog does not have.
    const list = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(
      ([u]) => new URL(String(u)).pathname === "/api/vega-backend/v1/resources",
    );
    expect(new URL(String(list?.[0])).searchParams.get("limit")).toBe("-1");
  });

  it("accepts a schema-qualified --pk-map key for a bare catalog table name", async () => {
    mockFetch(catalogRoutes([{ id: "r-1", name: "document", columns: ["doc_id", "body"] }]));
    const out = (await createFromCatalog(ctx, {
      catalogId: "c-1",
      name: "kn",
      pkMap: { "yanfeng_kb.document": "doc_id" },
    })) as { object_types: Array<{ name: string; pk: string }> };
    expect(out.object_types).toEqual([{ name: "document", pk: "doc_id" }]);
  });

  it("names the catalog's actual tables when --pk-map misses", async () => {
    mockFetch(
      catalogRoutes([
        { id: "r-1", name: "document", columns: ["id"] },
        { id: "r-2", name: "chunk", columns: ["id"] },
      ]),
    );
    await expect(
      createFromCatalog(ctx, { catalogId: "c-1", name: "kn", pkMap: { orders: "id" } }),
    ).rejects.toThrow(/unknown table 'orders'\. Tables in this run: document, chunk/);
  });

  it("resolves --tables and --embedding-fields through the same matching", async () => {
    const f = mockFetch(
      catalogRoutes([
        { id: "r-1", name: "document", columns: ["id", "body"] },
        { id: "r-2", name: "chunk", columns: ["id"] },
      ]).concat([[/^\/api\/vega-backend\/v1\/build-tasks$/, () => ({ id: "task-1" })]]),
    );
    const out = (await createFromCatalog(ctx, {
      catalogId: "c-1",
      name: "kn",
      tables: ["yanfeng_kb.document"],
      pkMap: { "yanfeng_kb.document": "id" },
      embeddingFields: { "yanfeng_kb.document": ["body"] },
      build: true,
    })) as { object_types: Array<{ name: string }>; build_tasks: Array<{ table: string }> };
    expect(out.object_types.map((o) => o.name)).toEqual(["document"]);
    expect(out.build_tasks).toEqual([{ table: "document", taskId: "task-1" }]);
    // The vector feature landed on the resource before the build task ran.
    const put = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(
      ([, init]) => init.method === "PUT",
    );
    const schema = (
      JSON.parse(String(put?.[1]?.body)) as {
        schema_definition: Array<{ name: string; features?: Array<{ feature_type: string }> }>;
      }
    ).schema_definition;
    expect(schema.find((p) => p.name === "body")?.features?.[0]?.feature_type).toBe("vector");
  });

  it("matches a table key case-insensitively and with the qualifier on either side", async () => {
    mockFetch(catalogRoutes([{ id: "r-1", name: "yanfeng_kb.Document", columns: ["id"] }]));
    const out = (await createFromCatalog(ctx, {
      catalogId: "c-1",
      name: "kn",
      // Catalog carries the schema qualifier and folds case; the user does not.
      pkMap: { document: "id" },
    })) as { object_types: Array<{ name: string; pk: string }> };
    expect(out.object_types).toEqual([{ name: "yanfeng_kb.Document", pk: "id" }]);
  });

  it("reports two keys that normalize onto one table instead of dropping one", async () => {
    mockFetch(catalogRoutes([{ id: "r-1", name: "document", columns: ["id", "doc_id"] }]));
    await expect(
      createFromCatalog(ctx, {
        catalogId: "c-1",
        name: "kn",
        pkMap: { document: "id", "yanfeng_kb.document": "doc_id" },
      }),
    ).rejects.toThrow(/--pk-map has two entries for table 'document'/);
  });

  it("drops a --pk-map entry for an undiscovered table under skip, keeps it fatal otherwise", async () => {
    const logs: string[] = [];
    const routes = catalogRoutes([{ id: "r-1", name: "document", columns: ["id"], pk: "id" }]);
    mockFetch(routes);
    // Same lag as --tables: the pk-map names a table the catalog has not
    // registered. Failing here would strand rows already in the database.
    const out = (await createFromCatalog(ctx, {
      catalogId: "c-1",
      name: "kn",
      tables: ["document", "chunk"],
      pkMap: { document: "id", chunk: "id" },
      missingTables: "skip",
      onProgress: (m) => logs.push(m),
    })) as { object_types: Array<{ name: string }> };
    expect(out.object_types.map((o) => o.name)).toEqual(["document"]);
    expect(logs.join("\n")).toMatch(/Dropping --pk-map entry 'chunk'/);

    mockFetch(routes);
    await expect(
      createFromCatalog(ctx, { catalogId: "c-1", name: "kn", pkMap: { chunk: "id" } }),
    ).rejects.toThrow(/--pk-map references unknown table 'chunk'/);
  });

  it("forgives an option keyed to a table whose import failed", async () => {
    const logs: string[] = [];
    mockFetch(catalogRoutes([{ id: "r-1", name: "document", columns: ["id"], pk: "id" }]));
    // `chunk` never reached the catalog because its CSV failed — that is
    // already reported, so its --pk-map entry must not sink the other table.
    const out = (await createFromCatalog(ctx, {
      catalogId: "c-1",
      name: "kn",
      tables: ["document"],
      absentTables: ["chunk"],
      pkMap: { document: "id", chunk: "id" },
      onProgress: (m) => logs.push(m),
    })) as { object_types: Array<{ name: string }> };
    expect(out.object_types.map((o) => o.name)).toEqual(["document"]);
    expect(logs.join("\n")).toMatch(/Dropping --pk-map entry 'chunk'/);
  });

  it("forgives a --tables entry the run already reported as absent", async () => {
    const logs: string[] = [];
    mockFetch(catalogRoutes([{ id: "r-1", name: "document", columns: ["id"], pk: "id" }]));
    // A hand-typed --tables stays strict about typos, but `chunk` is a name
    // this run has already reported — failing on it would strand the rows
    // written for `document`.
    const out = (await createFromCatalog(ctx, {
      catalogId: "c-1",
      name: "kn",
      tables: ["document", "chunk"],
      absentTables: ["chunk"],
      onProgress: (m) => logs.push(m),
    })) as { object_types: Array<{ name: string }> };
    expect(out.object_types.map((o) => o.name)).toEqual(["document"]);
    expect(logs.join("\n")).toMatch(/Skipping 1 table\(s\) not in the catalog.*chunk/);
  });

  it("rejects an unknown --embedding-fields column before it can write anything", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n");
    const f = mockFetch([
      [/^\/api\/automation\/v2\/dags$/, () => ({ entries: [] })],
      [/^\/api\/automation\/v1\/data-flow\/flow$/, () => ({ id: "dag-1" })],
      [/^\/api\/automation\/v1\/run-instance\/[^/]+$/, () => ({})],
      [
        /^\/api\/automation\/v1\/dag\/[^/]+\/results$/,
        () => ({ results: [{ status: "success" }] }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow\/[^/]+$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({})],
      [
        /^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/,
        () => ({
          entries: [
            {
              id: "c-1",
              name: "catalog",
              type: "physical",
              enabled: true,
              connector_type: "mysql",
            },
          ],
        }),
      ],
      ...catalogRoutes([{ id: "r-1", name: "document", columns: ["id", "body"], pk: "id" }]),
    ]);
    // The check runs in Phase 2, so the CSV rows are written by the time it
    // fires — that is the bound. What it buys: left to `ensureFeature` this
    // surfaces in step 5, after the KN and its object types exist and with
    // earlier tables' PUTs and build tasks already landed and never rolled back.
    await expect(
      createFromCsv(ctx, {
        catalogId: "c-1",
        name: "kn",
        files: `${dir}/*.csv`,
        build: true,
        embeddingFields: { document: ["bdy"] },
      }),
    ).rejects.toThrow(
      /--embedding-fields names bdy on table 'document'.*Indexable fields: id, body/,
    );
    // Rows went in — that is why the check is reachable at all; nothing else did.
    expect(paths(f)).toContain("/api/automation/v1/data-flow/flow");
    expect(paths(f)).not.toContain("/api/ontology-manager/v1/knowledge-networks");
    expect(paths(f)).not.toContain("/api/vega-backend/v1/build-tasks");
  });

  it("tells a Phase 2 failure that the rows are already in the database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n");
    mockFetch([
      [/^\/api\/automation\/v2\/dags$/, () => ({ entries: [] })],
      [/^\/api\/automation\/v1\/data-flow\/flow$/, () => ({ id: "dag-1" })],
      [/^\/api\/automation\/v1\/run-instance\/[^/]+$/, () => ({})],
      [
        /^\/api\/automation\/v1\/dag\/[^/]+\/results$/,
        () => ({ results: [{ status: "success" }] }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow\/[^/]+$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({})],
      [
        /^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/,
        () => ({
          entries: [
            {
              id: "c-1",
              name: "catalog",
              type: "physical",
              enabled: true,
              connector_type: "mysql",
            },
          ],
        }),
      ],
      ...catalogRoutes([{ id: "r-1", name: "document", columns: ["id", "body"], pk: "id" }]),
    ]);
    // Every Phase 2 failure, not a chosen few: once the rows are in, "fix it
    // and run this again" is the wrong next step.
    const logs: string[] = [];
    const err = await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: `${dir}/*.csv`,
      pkMap: { document: "nope" },
      onProgress: (m) => logs.push(m),
    }).catch((e) => e);
    expect(String(err)).toMatch(/is not a column/);
    expect(logs.join("\n")).toMatch(/already imported.*create-from-catalog c-1/s);
    // Bad input stays bad input — the guidance must not cost the error's type.
    expect(err).toBeInstanceOf(InputError);
  });

  it("names the partial network only when the run actually left one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n");
    const csvRoutes: Array<[RegExp, Route]> = [
      [/^\/api\/automation\/v2\/dags$/, () => ({ entries: [] })],
      [/^\/api\/automation\/v1\/data-flow\/flow$/, () => ({ id: "dag-1" })],
      [/^\/api\/automation\/v1\/run-instance\/[^/]+$/, () => ({})],
      [
        /^\/api\/automation\/v1\/dag\/[^/]+\/results$/,
        () => ({ results: [{ status: "success" }] }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow\/[^/]+$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({})],
      [
        /^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/,
        () => ({
          entries: [
            {
              id: "c-1",
              name: "catalog",
              type: "physical",
              enabled: true,
              connector_type: "mysql",
            },
          ],
        }),
      ],
    ];
    const table = { id: "r-1", name: "document", columns: ["id", "body"], pk: "id" };

    // Fails after the network exists: object-type creation is the first write
    // past it, so `--no-rollback` really does leave one behind.
    const late: string[] = [];
    mockFetch([
      ...csvRoutes,
      ...catalogRoutes([table]).filter(
        ([re]) => !re.test("/api/ontology-manager/v1/knowledge-networks/kn-1/object-types"),
      ),
      [
        /^\/api\/ontology-manager\/v1\/knowledge-networks\/[^/]+\/object-types$/,
        () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
      ],
    ]);
    await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: `${dir}/*.csv`,
      noRollback: true,
      onProgress: (m) => late.push(m),
    }).catch(() => {});
    expect(late.join("\n")).toMatch(/Delete the partial knowledge network kn-1/);

    // Fails before it exists — every input check now runs ahead of the KN, so
    // there is nothing to delete and the guidance must not invent one.
    const early: string[] = [];
    mockFetch([...csvRoutes, ...catalogRoutes([table])]);
    await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: `${dir}/*.csv`,
      noRollback: true,
      pkMap: { document: "nope" },
      onProgress: (m) => early.push(m),
    }).catch(() => {});
    expect(early.join("\n")).toMatch(/already imported/);
    // Case-insensitive on purpose: the wording this replaced was lower-case,
    // and a case-sensitive assertion would pass against it.
    expect(early.join("\n")).not.toMatch(/partial knowledge network/i);
  });

  it("names the network a failed rollback left behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n");
    const logs: string[] = [];
    mockFetch([
      [/^\/api\/automation\/v2\/dags$/, () => ({ entries: [] })],
      [/^\/api\/automation\/v1\/data-flow\/flow$/, () => ({ id: "dag-1" })],
      [/^\/api\/automation\/v1\/run-instance\/[^/]+$/, () => ({})],
      [
        /^\/api\/automation\/v1\/dag\/[^/]+\/results$/,
        () => ({ results: [{ status: "success" }] }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow\/[^/]+$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/, () => ({ connector_type: "mysql" })],
      // Object-type creation fails, and the rollback DELETE is refused too, so
      // the network survives even though --no-rollback was never passed.
      [
        /^\/api\/ontology-manager\/v1\/knowledge-networks\/[^/]+\/object-types$/,
        () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
      ],
      [
        /^\/api\/ontology-manager\/v1\/knowledge-networks\/[^/]+$/,
        () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
      ],
      ...catalogRoutes([{ id: "r-1", name: "document", columns: ["id", "body"], pk: "id" }]),
    ]);
    await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: `${dir}/*.csv`,
      onProgress: (m) => logs.push(m),
    }).catch(() => {});
    // The reason decides what the user can do about it, so it must survive.
    expect(logs.join("\n")).toMatch(/Rollback of KN kn-1 failed \(.*nope.*\); it is still there/);
    expect(logs.join("\n")).toMatch(/Delete the partial knowledge network kn-1/);
  });

  it("treats a 404 from the rollback as the network being gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n");
    const logs: string[] = [];
    const f = mockFetch([
      [/^\/api\/automation\/v2\/dags$/, () => ({ entries: [] })],
      [/^\/api\/automation\/v1\/data-flow\/flow$/, () => ({ id: "dag-1" })],
      [/^\/api\/automation\/v1\/run-instance\/[^/]+$/, () => ({})],
      [
        /^\/api\/automation\/v1\/dag\/[^/]+\/results$/,
        () => ({ results: [{ status: "success" }] }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow\/[^/]+$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/, () => ({ connector_type: "mysql" })],
      [
        /^\/api\/ontology-manager\/v1\/knowledge-networks\/[^/]+\/object-types$/,
        () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
      ],
      // The rollback DELETE says the network is not there. It is gone, so the
      // user must not be sent to delete it.
      [
        /^\/api\/ontology-manager\/v1\/knowledge-networks\/[^/]+$/,
        () => new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
      ],
      ...catalogRoutes([{ id: "r-1", name: "document", columns: ["id", "body"], pk: "id" }]),
    ]);
    await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: `${dir}/*.csv`,
      onProgress: (m) => logs.push(m),
    }).catch(() => {});
    // Both assertions below are negative, so pin that the rollback really ran:
    // otherwise a change that never reaches it would keep this test green.
    expect(logs.join("\n")).toMatch(/Rolling back KN kn-1/);
    expect(paths(f)).toContain("/api/ontology-manager/v1/knowledge-networks/kn-1");
    expect(logs.join("\n")).not.toMatch(/still there/);
    expect(logs.join("\n")).not.toMatch(/partial knowledge network/i);
  });

  it("treats a non-JSON 2xx from the rollback as the delete having worked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n");
    const logs: string[] = [];
    const f = mockFetch([
      [/^\/api\/automation\/v2\/dags$/, () => ({ entries: [] })],
      [/^\/api\/automation\/v1\/data-flow\/flow$/, () => ({ id: "dag-1" })],
      [/^\/api\/automation\/v1\/run-instance\/[^/]+$/, () => ({})],
      [
        /^\/api\/automation\/v1\/dag\/[^/]+\/results$/,
        () => ({ results: [{ status: "success" }] }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow\/[^/]+$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/, () => ({ connector_type: "mysql" })],
      [
        /^\/api\/ontology-manager\/v1\/knowledge-networks\/[^/]+\/object-types$/,
        () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
      ],
      // `200 text/plain "OK"` is a common way to answer a DELETE. It raises
      // NonJsonResponseError here, but the network is gone all the same.
      [
        /^\/api\/ontology-manager\/v1\/knowledge-networks\/[^/]+$/,
        () => new Response("OK", { status: 200, headers: { "content-type": "text/plain" } }),
      ],
      ...catalogRoutes([{ id: "r-1", name: "document", columns: ["id", "body"], pk: "id" }]),
    ]);
    await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: `${dir}/*.csv`,
      onProgress: (m) => logs.push(m),
    }).catch(() => {});
    expect(paths(f)).toContain("/api/ontology-manager/v1/knowledge-networks/kn-1");
    expect(logs.join("\n")).not.toMatch(/still there/);
    expect(logs.join("\n")).not.toMatch(/partial knowledge network/i);
  });

  it("keeps quiet only when the service itself answered the rollback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n");
    const logs: string[] = [];
    mockFetch([
      [/^\/api\/automation\/v2\/dags$/, () => ({ entries: [] })],
      [/^\/api\/automation\/v1\/data-flow\/flow$/, () => ({ id: "dag-1" })],
      [/^\/api\/automation\/v1\/run-instance\/[^/]+$/, () => ({})],
      [
        /^\/api\/automation\/v1\/dag\/[^/]+\/results$/,
        () => ({ results: [{ status: "success" }] }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow\/[^/]+$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/, () => ({ connector_type: "mysql" })],
      [
        /^\/api\/ontology-manager\/v1\/knowledge-networks\/[^/]+\/object-types$/,
        () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
      ],
      // An SSO proxy answers a dead session with a 200 login page. The delete
      // never reached the service, so the network is still standing.
      [
        /^\/api\/ontology-manager\/v1\/knowledge-networks\/[^/]+$/,
        () =>
          new Response("<html><body>Sign in</body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ],
      ...catalogRoutes([{ id: "r-1", name: "document", columns: ["id", "body"], pk: "id" }]),
    ]);
    await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: `${dir}/*.csv`,
      onProgress: (m) => logs.push(m),
    }).catch(() => {});
    // Saying nothing here would leave the network orphaned with no trace.
    expect(logs.join("\n")).toMatch(/Rollback of KN kn-1 failed.*it is still there/);
    expect(logs.join("\n")).toMatch(/Delete the partial knowledge network kn-1/);
  });

  it("reads catalog details in batches rather than all at once", async () => {
    const tables = Array.from({ length: 25 }, (_, i) => ({
      id: `r-${i}`,
      name: `t${i}`,
      columns: ["id"],
      pk: "id",
    }));
    let inFlight = 0;
    let peak = 0;
    const f = mockFetch(catalogRoutes(tables));
    // Count at the fetch boundary, across a real suspension. A route handler
    // runs to completion synchronously, so counting inside one can never see
    // two reads at once — `peak` would be 1 however many go out together.
    const inner = f as unknown as (i: string, r?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit = {}) => {
        if (!/\/resources\/r-\d+$/.test(new URL(String(input)).pathname)) {
          return inner(input, init);
        }
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 0));
        try {
          return await inner(input, init);
        } finally {
          inFlight -= 1;
        }
      }),
    );
    await createFromCatalog(ctx, { catalogId: "c-1", name: "kn" });
    // Every table is still read — the cap is on how many at a time.
    expect(paths(f).filter((p) => /\/resources\/r-\d+$/.test(p))).toHaveLength(25);
    // Above 1 proves the harness sees concurrency at all; at most 20 is the cap.
    // One `Promise.all` over the catalog would peak at 25.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(20);
  });

  it("keeps a Phase 2 HTTP failure typed, guidance or not", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n");
    const logs: string[] = [];
    mockFetch([
      [/^\/api\/automation\/v2\/dags$/, () => ({ entries: [] })],
      [/^\/api\/automation\/v1\/data-flow\/flow$/, () => ({ id: "dag-1" })],
      [/^\/api\/automation\/v1\/run-instance\/[^/]+$/, () => ({})],
      [
        /^\/api\/automation\/v1\/dag\/[^/]+\/results$/,
        () => ({ results: [{ status: "success" }] }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow\/[^/]+$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/, () => ({ connector_type: "mysql" })],
      // Phase 2 is HTTP end to end; this is the shape the guidance must not eat.
      [
        /^\/api\/vega-backend\/v1\/resources$/,
        () => new Response(JSON.stringify({ error: "token expired" }), { status: 401 }),
      ],
    ]);
    const err = await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: `${dir}/*.csv`,
      onProgress: (m) => logs.push(m),
    }).catch((e) => e);
    // Rewrapping would have cost status, hint and exit code 3.
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(401);
    expect(logs.join("\n")).toMatch(/already imported/);
  });

  it("never forgives an ambiguous table key, even under skip", async () => {
    // The same table name registered under two schemas: no retry and no
    // re-discover clears this, so dropping it would lose a table in silence.
    mockFetch(
      catalogRoutes([
        { id: "r-1", name: "a.document", columns: ["id"], pk: "id" },
        { id: "r-2", name: "b.document", columns: ["id"], pk: "id" },
      ]),
    );
    await expect(
      createFromCatalog(ctx, {
        catalogId: "c-1",
        name: "kn",
        tables: ["document"],
        missingTables: "skip",
      }),
    ).rejects.toThrow(/--tables 'document' matches several tables \(a\.document, b\.document\)/);
  });

  it("gives each same-named table its own primary key", async () => {
    // The names must be *identical* for this to bite: a name-keyed map is what
    // hands the second table the first one's key, and `a.document` /
    // `b.document` would be distinct keys in that map too.
    const f = mockFetch(
      catalogRoutes([
        { id: "r-1", name: "document", columns: ["doc_id"], pk: "doc_id" },
        { id: "r-2", name: "document", columns: ["uid"], pk: "uid" },
      ]),
    );
    const out = (await createFromCatalog(ctx, { catalogId: "c-1", name: "kn" })) as {
      object_types: Array<{ name: string; pk: string }>;
    };
    expect(out.object_types).toEqual([
      { name: "document", pk: "doc_id" },
      { name: "document", pk: "uid" },
    ]);
    // Each object type binds to its own resource, with its own key.
    const post = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(
      ([u]) => String(u).includes("/object-types"),
    );
    expect(JSON.parse(String(post?.[1]?.body)).entries).toMatchObject([
      { data_source: { id: "r-1" }, primary_keys: ["doc_id"] },
      { data_source: { id: "r-2" }, primary_keys: ["uid"] },
    ]);
  });

  it("names the tables the catalog has but the run left out", async () => {
    mockFetch(
      catalogRoutes([
        { id: "r-1", name: "document", columns: ["id"], pk: "id" },
        { id: "r-2", name: "chunk", columns: ["id"], pk: "id" },
      ]),
    );
    await expect(
      createFromCatalog(ctx, {
        catalogId: "c-1",
        name: "kn",
        tables: ["document"],
        pkMap: { chunk: "id" },
      }),
    ).rejects.toThrow(/Tables in this run: document\. The catalog also has chunk/);
  });

  it("keeps a misspelled --pk-map key fatal even under skip", async () => {
    mockFetch(catalogRoutes([{ id: "r-1", name: "document", columns: ["id"], pk: "id" }]));
    // 'documnet' is not a table the import left undiscovered — it is a typo.
    // Dropping it would silently hand the primary key back to detection.
    await expect(
      createFromCatalog(ctx, {
        catalogId: "c-1",
        name: "kn",
        tables: ["document", "chunk"],
        pkMap: { documnet: "id" },
        missingTables: "skip",
      }),
    ).rejects.toThrow(/--pk-map references unknown table 'documnet'/);
  });

  it("skips an undiscovered table for a derived list, but not for a typed --tables", async () => {
    const logs: string[] = [];
    const routes = catalogRoutes([{ id: "r-1", name: "document", columns: ["id"], pk: "id" }]);
    mockFetch(routes);
    const out = (await createFromCatalog(ctx, {
      catalogId: "c-1",
      name: "kn",
      tables: ["document", "chunk"],
      missingTables: "skip",
      onProgress: (m) => logs.push(m),
    })) as { object_types: Array<{ name: string }> };
    expect(out.object_types.map((o) => o.name)).toEqual(["document"]);
    expect(logs.join("\n")).toMatch(/Skipping 1 table\(s\) not in the catalog.*chunk/);

    mockFetch(routes);
    await expect(
      createFromCatalog(ctx, { catalogId: "c-1", name: "kn", tables: ["document", "chunk"] }),
    ).rejects.toThrow(/--tables references unknown table 'chunk'/);
  });
});

describe("createFromCsv table discovery lag", () => {
  it("builds the KN from the tables the catalog did register", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n2,beta\n");
    writeFileSync(join(dir, "chunk.csv"), "id,text\n1,x\n");
    const logs: string[] = [];
    // The catalog registered `document` but not `chunk` — the closing discover
    // in importCsvToCatalog is best-effort and may lag or fail outright.
    mockFetch([
      [/^\/api\/automation\/v2\/dags$/, () => ({ entries: [] })],
      [/^\/api\/automation\/v1\/data-flow\/flow$/, () => ({ id: "dag-1" })],
      [/^\/api\/automation\/v1\/run-instance\/[^/]+$/, () => ({})],
      [
        /^\/api\/automation\/v1\/dag\/[^/]+\/results$/,
        () => ({ results: [{ status: "success" }] }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow\/[^/]+$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/, () => ({ connector_type: "mysql" })],
      ...catalogRoutes([{ id: "r-1", name: "document", columns: ["id", "body"], pk: "id" }]),
    ]);
    const out = (await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: `${dir}/*.csv`,
      onProgress: (m) => logs.push(m),
    })) as { imported_tables: string[]; object_types: Array<{ name: string }> };
    expect(out.imported_tables.sort()).toEqual(["chunk", "document"]);
    // Rows for both files are already in the database — the KN must still get built.
    expect(out.object_types.map((o) => o.name)).toEqual(["document"]);
    expect(logs.join("\n")).toMatch(/Skipping 1 table\(s\) not in the catalog.*chunk/);
  });
});

describe("createFromCsv input validation order", () => {
  it("rejects a bad embedding model before importing anything", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n");
    const f = mockFetch([
      [/^\/api\/automation\/v2\/dags$/, () => ({ entries: [] })],
      [
        /^\/api\/mf-model-manager\/v1\/small-model\/get$/,
        () => new Response("{}", { status: 404 }),
      ],
    ]);
    // Resolving inside the build step would mean a full import, a KN, its
    // object types, and a rollback — with the rows left in the database.
    await expect(
      createFromCsv(ctx, {
        catalogId: "c-1",
        name: "kn",
        files: `${dir}/*.csv`,
        build: true,
        embeddingModel: "2064382281006583808",
      }),
    ).rejects.toThrow(/No small model found with id 2064382281006583808/);
    expect(paths(f)).not.toContain("/api/automation/v1/data-flow/flow");
  });
});

describe("createFromCsv dependency preflight", () => {
  it("stops before importing when the dataflow service is missing", async () => {
    const f = mockFetch([
      [
        /^\/api\/automation\/v2\/dags$/,
        () =>
          new Response("<html><body><center>404 Not Found</center></body></html>", {
            status: 404,
            headers: { "content-type": "text/html" },
          }),
      ],
    ]);
    await expect(
      createFromCsv(ctx, { catalogId: "c-1", name: "kn", files: "/tmp/none.csv" }),
    ).rejects.toThrow(/dataflow service is not available.*create-from-catalog/s);
    // Preflight only — no DAG was created, no CSV was read.
    expect(paths(f)).toEqual(["/api/automation/v2/dags"]);
  });

  it("proceeds when the v2 listing 404s in JSON — the import runs on v1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n");
    const logs: string[] = [];
    mockFetch([
      // Service is up and routed; it just does not serve this v2 listing.
      [
        /^\/api\/automation\/v2\/dags$/,
        () => new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow$/, () => ({ id: "dag-1" })],
      [/^\/api\/automation\/v1\/run-instance\/[^/]+$/, () => ({})],
      [
        /^\/api\/automation\/v1\/dag\/[^/]+\/results$/,
        () => ({ results: [{ status: "success" }] }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow\/[^/]+$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/, () => ({ connector_type: "mysql" })],
      ...catalogRoutes([{ id: "r-1", name: "document", columns: ["id", "body"], pk: "id" }]),
    ]);
    const out = (await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: `${dir}/*.csv`,
      onProgress: (m) => logs.push(m),
    })) as { object_types: Array<{ name: string }> };
    expect(out.object_types.map((o) => o.name)).toEqual(["document"]);
    expect(logs.join("\n")).toMatch(/preflight inconclusive/);
  });

  it("stops on an auth refusal instead of reading every CSV first", async () => {
    const f = mockFetch([
      [
        /^\/api\/automation\/v2\/dags$/,
        () => new Response(JSON.stringify({ error: "token expired" }), { status: 401 }),
      ],
    ]);
    const logs: string[] = [];
    const err = await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: "/tmp/none.csv",
      onProgress: (m) => logs.push(m),
    }).catch((e) => e);
    // The auth cause survives — not reworded into "the service is unavailable".
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(401);
    expect(paths(f)).toEqual(["/api/automation/v2/dags"]);
    // A bare 401 reads as a platform-wide auth problem; name who refused.
    expect(logs.join("\n")).toMatch(/dataflow service refused the preflight \(HTTP 401\)/);
  });

  it("proceeds when the v2 listing answers 2xx in something other than JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-csv-"));
    writeFileSync(join(dir, "document.csv"), "id,body\n1,alpha\n");
    const logs: string[] = [];
    mockFetch([
      // The service answered; this listing just is not JSON. It is there, so
      // the import must not be grounded before it reads a single row.
      [
        /^\/api\/automation\/v2\/dags$/,
        () => new Response("OK", { status: 200, headers: { "content-type": "text/plain" } }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow$/, () => ({ id: "dag-1" })],
      [/^\/api\/automation\/v1\/run-instance\/[^/]+$/, () => ({})],
      [
        /^\/api\/automation\/v1\/dag\/[^/]+\/results$/,
        () => ({ results: [{ status: "success" }] }),
      ],
      [/^\/api\/automation\/v1\/data-flow\/flow\/[^/]+$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+\/discover$/, () => ({})],
      [/^\/api\/vega-backend\/v1\/catalogs\/[^/]+$/, () => ({ connector_type: "mysql" })],
      ...catalogRoutes([{ id: "r-1", name: "document", columns: ["id", "body"], pk: "id" }]),
    ]);
    const out = (await createFromCsv(ctx, {
      catalogId: "c-1",
      name: "kn",
      files: `${dir}/*.csv`,
      onProgress: (m) => logs.push(m),
    })) as { object_types: Array<{ name: string }> };
    expect(out.object_types.map((o) => o.name)).toEqual(["document"]);
    expect(logs.join("\n")).toMatch(/preflight inconclusive/);
  });

  it("stops on a 504, but not on a 500", async () => {
    // 504: the gateway routed the request and nothing answered. Left to the
    // import, every batch waits out the full client timeout before failing.
    const gone = mockFetch([
      [
        /^\/api\/automation\/v2\/dags$/,
        () => new Response(JSON.stringify({ error: "upstream timeout" }), { status: 504 }),
      ],
    ]);
    await expect(
      createFromCsv(ctx, { catalogId: "c-1", name: "kn", files: "/tmp/none.csv" }),
    ).rejects.toThrow(/dataflow service is not available.*create-from-catalog/s);
    expect(paths(gone)).toEqual(["/api/automation/v2/dags"]);

    // 500: the service handled the request badly, which is not the same as not
    // being there — the probe must step aside and let the real call speak.
    const logs: string[] = [];
    mockFetch([
      [
        /^\/api\/automation\/v2\/dags$/,
        () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
      ],
    ]);
    await expect(
      createFromCsv(ctx, {
        catalogId: "c-1",
        name: "kn",
        files: "/tmp/none.csv",
        onProgress: (m) => logs.push(m),
      }),
    ).rejects.not.toThrow(/dataflow service is not available/);
    expect(logs.join("\n")).toMatch(/preflight inconclusive/);
  });

  it("stops when a proxy answers the probe with a 200 login page", async () => {
    const f = mockFetch([
      // Session expired: an SSO proxy replies 200 with a sign-in page. The
      // status describes the proxy, so nothing behind the route was reached —
      // the same reading as its HTML 404 sibling, one status code apart.
      [
        /^\/api\/automation\/v2\/dags$/,
        () =>
          new Response("<html><body>Sign in</body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ],
    ]);
    await expect(
      createFromCsv(ctx, { catalogId: "c-1", name: "kn", files: "/tmp/none.csv" }),
    ).rejects.toThrow(/dataflow service is not available.*create-from-catalog/s);
    expect(paths(f)).toEqual(["/api/automation/v2/dags"]);
  });

  it("reports an HTML gateway page as a routing failure, not a business error", async () => {
    mockFetch([
      [
        /^\/api\/automation\/v2\/dags$/,
        () =>
          new Response("<html><body>404</body></html>", {
            status: 404,
            headers: { "content-type": "text/html" },
          }),
      ],
    ]);
    await expect(
      createFromCsv(ctx, { catalogId: "c-1", name: "kn", files: "/tmp/none.csv" }),
    ).rejects.toThrow(/did not reach the service behind \/api\/automation\/v2\/dags/);
  });
});
