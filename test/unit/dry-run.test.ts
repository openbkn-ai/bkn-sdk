import { describe, expect, it } from "vitest";
import { DryRunSignal, enableDryRun, previewRequest } from "../../src/utils/dry-run.js";

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
  it("redacts declared variable values independently of their names without changing the input", () => {
    const config = {
      options: { timeout_seconds: 30, max_response_mib: 10 },
      variables: {
        tenant: "public",
        arbitrary: "private-option",
        api_key: "private-key",
        token: "private-token",
      },
      sensitive_variables: ["arbitrary", "api_key", "token"],
    };
    const req = preview({
      method: "POST",
      url: "https://x/catalogs",
      body: { connector_config: config },
    });
    expect(req.body).toEqual({
      connector_config: {
        options: { timeout_seconds: 30, max_response_mib: 10 },
        variables: {
          tenant: "public",
          arbitrary: "<redacted>",
          api_key: "<redacted>",
          token: "<redacted>",
        },
        sensitive_variables: ["arbitrary", "api_key", "token"],
      },
    });
    expect(config.variables.arbitrary).toBe("private-option");
    expect(config.variables.token).toBe("private-token");
    expect(JSON.stringify(req)).not.toContain("private-option");
    expect(JSON.stringify(req)).not.toContain("private-key");
    expect(JSON.stringify(req)).not.toContain("private-token");
  });

  it.each(["_secret", "__paging"])(
    "hides all variables when a declared variable name starts with an underscore: %s",
    (name) => {
      const req = preview({
        method: "PUT",
        url: "https://x/catalogs/id",
        body: {
          connector_config: {
            variables: { [name]: "private-option", tenant: "public" },
            sensitive_variables: [name],
          },
        },
      });
      expect(req.body).toEqual({
        connector_config: {
          variables: "<redacted>",
          sensitive_variables: [name],
        },
      });
      expect(JSON.stringify(req)).not.toContain("private-option");
    },
  );

  it("accepts a letter-leading variable name with an internal underscore and digit", () => {
    const req = preview({
      method: "POST",
      url: "https://x/catalogs",
      body: {
        connector_config: {
          variables: { Client_key2: "private-option", tenant: "public" },
          sensitive_variables: ["Client_key2"],
        },
      },
    });
    expect(req.body).toEqual({
      connector_config: {
        variables: { Client_key2: "<redacted>", tenant: "public" },
        sensitive_variables: ["Client_key2"],
      },
    });
  });

  it.each([null, "arbitrary", ["arbitrary", "arbitrary"], [42], ["variables.arbitrary"]])(
    "hides variables for invalid sensitive-variable metadata %j",
    (sensitive_variables) => {
      const req = preview({
        method: "PUT",
        url: "https://x/catalogs/id",
        body: JSON.stringify({
          connector_config: { variables: { arbitrary: "private-option" }, sensitive_variables },
        }),
      });
      expect(JSON.stringify(req)).not.toContain("private-option");
    },
  );

  it("keeps database options and Resource computed variables independent of Catalog declarations", () => {
    const resourceVariables = {
      where_clause: { type: "string", serialize: "sql", value: "{{ __filter_condition }}" },
    };
    const req = preview({
      method: "POST",
      url: "https://x/catalogs",
      body: {
        connector_config: {
          variables: { arbitrary: "private-variable", tenant: "public" },
          sensitive_variables: ["arbitrary"],
          options: { arbitrary: "database-option", password: "database-password" },
        },
        api_definition: { variables: resourceVariables },
      },
    });
    expect(req.body).toEqual({
      connector_config: {
        variables: { arbitrary: "<redacted>", tenant: "public" },
        sensitive_variables: ["arbitrary"],
        options: { arbitrary: "database-option", password: "<redacted>" },
      },
      api_definition: { variables: resourceVariables },
    });
    expect(JSON.stringify(req)).not.toContain("private-variable");
    expect(JSON.stringify(req)).not.toContain("database-password");
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
