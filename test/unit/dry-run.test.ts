import { describe, expect, it, vi } from "vitest";
import { tlsFetch } from "../../src/api/tls.js";
import { DryRunSignal, enableDryRun, previewRequest } from "../../src/utils/dry-run.js";
import { Decimal, stringifyBigIntJSON } from "../../src/utils/json-bigint.js";

function preview(input: Parameters<typeof previewRequest>[0]) {
  enableDryRun();
  try {
    previewRequest(input);
  } catch (err) {
    if (err instanceof DryRunSignal) return err.request;
    throw err;
  }
  throw new Error("preview did not stop the request");
}

describe("--dry-run preview", () => {
  it("keeps exact decimal and bigint literals while hiding Resource secrets", () => {
    const req = preview({
      method: "POST",
      url: "https://x/resources",
      body: '{"api_definition":{"variables":{"secret":{"value":"example-private","sensitive":true},"public":{"value":1234567890123456.78,"sensitive":false}}},"validation":{"filter_condition":{"value":9007199254740993}}}',
    });
    const wire = stringifyBigIntJSON(req);
    expect(wire).not.toContain("example-private");
    expect(wire).toContain("1234567890123456.78");
    expect(wire).toContain("9007199254740993");
    const body = req.body as { api_definition: { variables: { public: { value: unknown } } } };
    expect(body.api_definition.variables.public.value).toBeInstanceOf(Decimal);
  });
  it("redacts sensitive wrapper values independently of names without changing metadata or input", () => {
    const config = {
      options: { timeout_seconds: 30, max_response_mib: 10 },
      variables: {
        tenant: { value: "public" },
        disabled: { value: false, sensitive: false },
        count: { value: 0 },
        empty: { value: "" },
        nested: { value: { value: "business-data", sensitive: true, values: [false, null] } },
        arbitrary: { value: "private-option", sensitive: true },
        api_key: { value: "private-key" },
        token: { value: "private-token", sensitive: false },
      },
    };
    const req = preview({
      method: "POST",
      url: "https://x/catalogs",
      body: { connector_config: config },
    });
    expect(req.body).toEqual({
      connector_config: {
        options: config.options,
        variables: {
          tenant: { value: "public" },
          disabled: { value: false, sensitive: false },
          count: { value: 0 },
          empty: { value: "" },
          nested: config.variables.nested,
          arbitrary: { value: "<redacted>", sensitive: true },
          api_key: { value: "<redacted>" },
          token: { value: "<redacted>", sensitive: false },
        },
      },
    });
    expect(config.variables.arbitrary.value).toBe("private-option");
    expect(config.variables.token.value).toBe("private-token");
    expect(JSON.stringify(req)).not.toContain("private-");
  });

  it("keeps sensitive metadata when ordinary reads omit the value", () => {
    expect(
      preview({
        method: "PUT",
        url: "https://x/catalogs/id",
        body: {
          connector_config: { variables: { arbitrary: { sensitive: true } } },
        },
      }).body,
    ).toEqual({ connector_config: { variables: { arbitrary: { sensitive: true } } } });
  });

  it.each([
    { value: null },
    { value: null, sensitive: false },
    { value: null, sensitive: true },
    { value: undefined },
    { value: undefined, sensitive: false },
    { value: undefined, sensitive: true },
    {},
    { sensitive: false },
  ])("hides Catalog declarations without a non-null value %j", (spec) => {
    const req = preview({
      method: "POST",
      url: "https://x/catalogs",
      body: { connector_config: { variables: { tenant: spec } } },
    });
    expect(req.body).toEqual({ connector_config: { variables: { tenant: "<redacted>" } } });
  });

  it("preserves case-sensitive names and flags through parsed JSON previews", () => {
    const req = preview({
      method: "POST",
      url: "https://x/catalogs",
      body: JSON.stringify({
        connector_config: {
          variables: {
            Client_key2: { value: "private-option", sensitive: true },
            client_key2: { value: "public", sensitive: false },
          },
        },
      }),
    });
    expect(req.body).toEqual({
      connector_config: {
        variables: {
          Client_key2: { value: "<redacted>", sensitive: true },
          client_key2: { value: "public", sensitive: false },
        },
      },
    });
  });

  it.each(["_secret", "__paging", "1key"])(
    "hides wrappers with invalid variable names: %s",
    (name) => {
      const req = preview({
        method: "POST",
        url: "https://x/catalogs",
        body: {
          connector_config: {
            variables: { [name]: { value: "private-option" }, tenant: { value: "public" } },
          },
        },
      });
      expect(req.body).toEqual({
        connector_config: { variables: { [name]: "<redacted>", tenant: { value: "public" } } },
      });
    },
  );

  it.each([null, "false", "true", 0, 1, [], {}])(
    "fails closed for invalid sensitive flags %j",
    (sensitive) => {
      const req = preview({
        method: "POST",
        url: "https://x/catalogs",
        body: {
          connector_config: { variables: { arbitrary: { value: "private-option", sensitive } } },
        },
      });
      expect(req.body).toEqual({ connector_config: { variables: { arbitrary: "<redacted>" } } });
      expect(JSON.stringify(req)).not.toContain("private-option");
    },
  );

  it.each([
    "private-option",
    false,
    null,
    [],
    { value: "private-option", type: "string" },
    { value: "private-option", sensitive: true, extra: "private-extra" },
    { sensitive: false },
    { value: { nested: "private-option" }, sensitive: true },
    { value: 42, sensitive: true },
  ])("fails closed for malformed or bare Catalog variable values %j", (value) => {
    const req = preview({
      method: "POST",
      url: "https://x/catalogs",
      body: {
        connector_config: { variables: { arbitrary: value } },
      },
    });
    expect(req.body).toEqual({ connector_config: { variables: { arbitrary: "<redacted>" } } });
    expect(JSON.stringify(req)).not.toContain("private-");
  });

  it.each([null, false, ["private-option"], "private-option"])(
    "hides malformed Catalog variable maps %j",
    (variables) => {
      expect(
        preview({
          method: "POST",
          url: "https://x/catalogs",
          body: {
            connector_config: { variables },
          },
        }).body,
      ).toEqual({ connector_config: { variables: "<redacted>" } });
    },
  );

  it("protects Resource variable wrappers while leaving unrelated business objects independent", () => {
    const resourceVariables = {
      public: { value: { optional: null, values: [null, false] }, sensitive: false },
      private: { value: "private-resource-value", sensitive: true },
    };
    const businessVariables = {
      arbitrary: { value: "business-data", sensitive: true },
      optional: { value: null },
    };
    const req = preview({
      method: "POST",
      url: "https://x/catalogs",
      body: {
        connector_config: {
          variables: {
            arbitrary: { value: "private-variable", sensitive: true },
            tenant: { value: "public" },
          },
          options: { arbitrary: "database-option", password: "database-password" },
        },
        api_definition: { variables: resourceVariables },
        result: { variables: businessVariables },
      },
    });
    expect(req.body).toEqual({
      connector_config: {
        variables: {
          arbitrary: { value: "<redacted>", sensitive: true },
          tenant: { value: "public" },
        },
        options: { arbitrary: "database-option", password: "<redacted>" },
      },
      api_definition: {
        variables: {
          public: resourceVariables.public,
          private: { value: "<redacted>", sensitive: true },
        },
      },
      result: { variables: businessVariables },
    });
    expect(JSON.stringify(req)).not.toContain("private-resource-value");
    expect(resourceVariables.private.value).toBe("private-resource-value");
  });

  it("still redacts credential-shaped fields inside public wrapped JSON values", () => {
    const req = preview({
      method: "POST",
      url: "https://x/catalogs",
      body: {
        connector_config: {
          variables: {
            tenant: {
              value: {
                password: "private-password",
                items: [{ token: "private-token", enabled: false }],
              },
            },
          },
        },
      },
    });
    expect(req.body).toEqual({
      connector_config: {
        variables: {
          tenant: {
            value: { password: "<redacted>", items: [{ token: "<redacted>", enabled: false }] },
          },
        },
      },
    });
  });

  it("previews Catalog wrapper protection without sending a request", async () => {
    enableDryRun();
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not send"));
    try {
      await expect(
        tlsFetch(false, "https://x/catalogs", {
          method: "POST",
          body: JSON.stringify({
            connector_config: {
              variables: { arbitrary: { value: "private-option", sensitive: true } },
            },
          }),
        }),
      ).rejects.toMatchObject({
        name: "DryRunSignal",
        request: {
          body: {
            connector_config: {
              variables: { arbitrary: { value: "<redacted>", sensitive: true } },
            },
          },
        },
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it("redacts the header that identifies the caller", () => {
    const req = preview({
      method: "GET",
      url: "https://x/api/y",
      headers: { authorization: "Bearer ory_at_secret" },
    });
    expect(req.headers.authorization).toBe("<redacted>");
  });

  it("redacts a credential carried as a body field, not only as a header", () => {
    // `sandbox run --pass-token` puts one in `bkn_token`, and a preview is
    // something a caller pastes into a terminal, an issue, or a log.
    const req = preview({
      method: "POST",
      url: "https://x/api/y",
      body: JSON.stringify({
        code: "print(1)",
        bkn_token: "ory_at_secret",
        bkn_conversation_id: "conv-1",
      }),
    });
    const body = req.body as Record<string, unknown>;
    expect(body.bkn_token).toBe("<redacted>");
    expect(body.code).toBe("print(1)");
    expect(body.bkn_conversation_id).toBe("conv-1");
  });

  it("reaches a credential nested inside the body", () => {
    const req = preview({
      method: "POST",
      url: "https://x/api/y",
      body: { items: [{ name: "a", password: "hunter2" }] },
    });
    expect(req.body).toEqual({ items: [{ name: "a", password: "<redacted>" }] });
  });
  it("redacts Eval run and task credentials in a participant RPC preview", () => {
    const req = preview({
      method: "POST",
      url: "https://x/api/bkn-backend/v1/eval-mcp/call",
      body: JSON.stringify({
        name: "bkn_eval_submit_result",
        arguments: {
          run_id: "run-1",
          run_token: "private-eval-run-token",
          task_token: "private-eval-task-token",
          answer: "Business answer",
          structured_output: { leadtime_days: 14 },
        },
      }),
    });
    expect(req.body).toEqual({
      name: "bkn_eval_submit_result",
      arguments: {
        run_id: "run-1",
        run_token: "<redacted>",
        task_token: "<redacted>",
        answer: "Business answer",
        structured_output: { leadtime_days: 14 },
      },
    });
    expect(JSON.stringify(req)).not.toContain("private-eval");
  });
});
