import { describe, expect, it } from "vitest";
import { parseFormField, parseHeader } from "../../src/api/call.js";

describe("parseHeader", () => {
  it("splits on the first colon and trims", () => {
    expect(parseHeader("Authorization: Bearer x")).toEqual(["Authorization", "Bearer x"]);
  });
  it("handles values containing colons", () => {
    expect(parseHeader("X-Url: http://a:8080")).toEqual(["X-Url", "http://a:8080"]);
  });
  it("rejects malformed headers", () => {
    expect(parseHeader("nope")).toBeNull();
    expect(parseHeader(":empty-name")).toBeNull();
  });
});

describe("parseFormField", () => {
  it("parses key=value", () => {
    expect(parseFormField("name=demo")).toEqual(["name", "demo", false]);
  });
  it("flags key=@file as a file", () => {
    expect(parseFormField("spec=@/tmp/x.yaml")).toEqual(["spec", "/tmp/x.yaml", true]);
  });
  it("throws without =", () => {
    expect(() => parseFormField("bad")).toThrow();
  });
});
