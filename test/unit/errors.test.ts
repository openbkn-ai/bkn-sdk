import { describe, expect, it } from "vitest";
import { HttpError, formatError, readableServerError } from "../../src/utils/errors.js";

const body = (value: unknown) => JSON.stringify(value);

describe("readableServerError: string envelopes", () => {
  it("reads the comm-go BaseError envelope and ignores legacy guidance", () => {
    expect(
      readableServerError(
        body({
          error_code: "Vega.Catalog.NotFound",
          description: "catalog not found",
          solution: "check the catalog id",
          error_link: "",
          error_details: "",
        }),
      ),
    ).toBe("catalog not found [Vega.Catalog.NotFound]");
  });

  it("reads a plain string error and a compact code/description envelope", () => {
    expect(readableServerError(body({ error: "boom" }))).toBe("boom");
    expect(readableServerError(body({ code: "Public.BadRequest", description: "bad input" }))).toBe(
      "bad input [Public.BadRequest]",
    );
  });

  it("follows an upstream envelope embedded in string details", () => {
    const upstream = body({ error_code: "Up.Failed", description: "upstream failed" });
    expect(
      readableServerError(
        body({
          code: "Public.BadGateway",
          description: "call failed",
          details: `proxy: ${upstream}`,
        }),
      ),
    ).toBe("call failed [Public.BadGateway] (upstream failed [Up.Failed])");
  });

  it("returns empty for a non-JSON body", () => {
    expect(readableServerError("<html>")).toBe("");
  });
});

describe("readableServerError: object `error`", () => {
  it("renders the BKN Trace lifecycle envelope with code, state and required action", () => {
    const rendered = readableServerError(
      body({
        error: {
          code: "interaction_in_progress",
          message: "conversation already has an active interaction",
          retryable: true,
          retry_after_ms: 1500,
          current_status: "active",
          current_interaction_id: "int-7",
          required_action: "finish_current_interaction",
          request_id: "req-1",
        },
      }),
    );
    expect(rendered).toBe(
      "conversation already has an active interaction [interaction_in_progress] (current_status: active; current_interaction_id: int-7; retryable after 1500ms; request_id: req-1) — required_action: finish_current_interaction",
    );
  });

  it("renders the OpenAI-compatible envelope with code and type", () => {
    expect(
      readableServerError(
        body({
          error: {
            message: "Service is too busy. Please try again later.",
            type: "service_unavailable_error",
            param: null,
            code: "ModelFactory.Router.Busy",
          },
        }),
      ),
    ).toBe(
      "Service is too busy. Please try again later. [ModelFactory.Router.Busy/service_unavailable_error]",
    );
    expect(
      readableServerError(
        body({
          error: { message: "missing model", type: "invalid_request_error", param: "model" },
        }),
      ),
    ).toBe("missing model [invalid_request_error] (param: model)");
  });

  it("does not report a non-retryable lifecycle error as retryable", () => {
    expect(
      readableServerError(
        body({ error: { code: "permission_denied", message: "denied", retryable: false } }),
      ),
    ).toBe("denied [permission_denied]");
  });

  it("surfaces the lifecycle message through formatError on a 409", () => {
    const err = new HttpError(
      409,
      "Conflict",
      body({ error: { code: "terminal_conflict", message: "already completed" } }),
    );
    expect(formatError(err)).toBe(
      "Request failed (HTTP 409 Conflict): already completed [terminal_conflict]",
    );
  });
});

describe("readableServerError: object `error_details`", () => {
  it("renders vega's id lists instead of dropping them", () => {
    expect(
      readableServerError(
        body({
          error_code: "Vega.Catalog.HasActiveTasks",
          description: "catalog has running tasks",
          solution: "",
          error_link: "",
          error_details: { running_ids: ["t1", "t2"] },
        }),
      ),
    ).toBe("catalog has running tasks [Vega.Catalog.HasActiveTasks] (running_ids: t1, t2)");
  });

  it("keeps the object `error_details` when a prose `details` string is also present", () => {
    expect(
      readableServerError(
        body({
          error_code: "Vega.Catalog.HasActiveTasks",
          description: "catalog has running tasks",
          details: "wait for the tasks to finish",
          error_details: { running_ids: ["t1", "t2"] },
        }),
      ),
    ).toBe(
      "catalog has running tasks [Vega.Catalog.HasActiveTasks] wait for the tasks to finish (running_ids: t1, t2)",
    );
  });

  it("caps long id lists and keeps nested values compact", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `id${i}`);
    const rendered = readableServerError(
      body({
        error_code: "Vega.Missing",
        description: "missing",
        error_details: { missing_ids: ids, dependency: { kind: "catalog" } },
      }),
    );
    expect(rendered).toBe(
      'missing [Vega.Missing] (missing_ids: id0, id1, id2, id3, id4, id5, id6, id7, id8, id9 (+2 more); dependency: {"kind":"catalog"})',
    );
  });
});

describe("shared error migration", () => {
  it("uses the error code when rendering leaves an empty description", () => {
    expect(
      readableServerError(
        body({
          error_code: "Vega.Query.Invalid",
          description: "  ",
          message: "generic HTTP failure",
          metadata: { field: "title" },
        }),
      ),
    ).toBe("Vega.Query.Invalid");
  });
  it("accepts new responses without legacy fields", () => {
    expect(
      readableServerError(
        body({
          error_code: "Vega.Query.Invalid",
          description: "The query is invalid. Check its limit.",
          error_details: "{{ literal }}",
        }),
      ),
    ).toBe("The query is invalid. Check its limit. [Vega.Query.Invalid] {{ literal }}");
  });
  it("ignores legacy solution and error_link fields", () => {
    expect(
      readableServerError(
        body({
          error_code: "Vega.Query.Invalid",
          description: "Bad query",
          solution: "Check the limit",
          error_link: "https://example.com/errors/query",
        }),
      ),
    ).toBe("Bad query [Vega.Query.Invalid]");
    expect(
      readableServerError(
        body({
          error_code: "Vega.Query.Invalid",
          description: "Bad query",
          solution: { unused: true },
          error_link: ["unused"],
        }),
      ),
    ).toBe("Bad query [Vega.Query.Invalid]");
  });
});

describe("structured error detail arrays", () => {
  it("renders top-level scalar arrays without interpreting template text", () => {
    expect(
      readableServerError(
        body({
          error_code: "Vega.Invalid",
          description: "Bad fields",
          error_details: ["name is required", "{{ literal }}", 0, false, null],
        }),
      ),
    ).toBe("Bad fields [Vega.Invalid] (name is required, {{ literal }}, 0, false, null)");
  });

  it("keeps object and nested array details readable", () => {
    expect(
      readableServerError(
        body({
          error_code: "Vega.Invalid",
          description: "Bad fields",
          error_details: [{ field: "name", reason: "required" }, ["limit", 10]],
        }),
      ),
    ).toBe('Bad fields [Vega.Invalid] ({"field":"name","reason":"required"}, ["limit",10])');
  });

  it("bounds top-level array items and output length", () => {
    expect(
      readableServerError(
        body({
          error_code: "Vega.Invalid",
          description: "Bad fields",
          error_details: Array.from({ length: 12 }, (_, i) => `field${i}`),
        }),
      ),
    ).toBe(
      "Bad fields [Vega.Invalid] (field0, field1, field2, field3, field4, field5, field6, field7, field8, field9 (+2 more))",
    );
    const rendered = readableServerError(
      body({
        error_code: "Vega.Invalid",
        description: "Bad fields",
        error_details: ["x".repeat(1000)],
      }),
    );
    expect(rendered).toContain("xxx");
    expect(rendered.length).toBeLessThanOrEqual("Bad fields [Vega.Invalid] ()".length + 301);
  });

  it("ignores empty arrays and unknown legacy link fields", () => {
    expect(
      readableServerError(
        body({
          code: "Public.BadRequest",
          description: "Bad input",
          details: [],
          link: { unused: true },
        }),
      ),
    ).toBe("Bad input [Public.BadRequest]");
  });
});

describe("independent Trace HTTP errors", () => {
  it.each([
    ["INVALID_ARGUMENT", "limit 必须是 1 到 200 之间的整数"],
    ["INVALID_ARGUMENT", "limit must be an integer between 1 and 200"],
    ["INVALID_ARGUMENT", "from 必须是 RFC3339 时间戳"],
    ["INVALID_ARGUMENT", "from must be an RFC3339 timestamp"],
    ["INVALID_ARGUMENT", "page_size 必须是 1 到 200 之间的整数"],
    ["INVALID_ARGUMENT", "page_size must be an integer between 1 and 200"],
    ["NOT_FOUND", "Trace 不存在"],
    ["NOT_FOUND", "trace not found"],
  ])("formats Trace %s reason %s", (code, message) => {
    const error = new HttpError(
      code === "NOT_FOUND" ? 404 : 400,
      "",
      body({ error_code: code, code, message, trace_id: "trace-test" }),
    );
    expect(formatError(error)).toContain(`${message} [${code}]`);
  });
  it.each(["", null, " "])(
    "keeps an explicit shared description %j authoritative",
    (description) => {
      expect(
        readableServerError(
          body({
            error_code: "INVALID_ARGUMENT",
            code: "INVALID_ARGUMENT",
            message: "Trace-like message",
            trace_id: "",
            description,
          }),
        ),
      ).toBe("INVALID_ARGUMENT");
    },
  );
  it.each([
    { error_code: "INVALID_ARGUMENT", message: "generic" },
    { error_code: "INVALID_ARGUMENT", code: "other", message: "generic", trace_id: "" },
    { error_code: "INVALID_ARGUMENT", code: "INVALID_ARGUMENT", message: "", trace_id: "" },
  ])("retains code fallback for %j", (data) => {
    expect(readableServerError(body(data))).toBe("INVALID_ARGUMENT");
  });
});
