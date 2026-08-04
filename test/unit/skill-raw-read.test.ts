import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skills } from "../../src/resources/skills.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

async function archive(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/**
 * Stands in for a deploy whose consumer surface only ever hands back an
 * object-store URL — the case the archive fallback exists for.
 */
function mockDeploy(opts: {
  archiveBytes?: Uint8Array;
  readContent?: string;
  manifest?: unknown[];
}) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path.endsWith("/download")) {
      if (!opts.archiveBytes) return new Response("no archive", { status: 404 });
      return new Response(opts.archiveBytes, { status: 200 });
    }
    if (path.endsWith("/files/read")) {
      const body =
        opts.readContent === undefined
          ? { url: "http://minio.internal/x", content: "" }
          : { url: "", content: opts.readContent };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (path.endsWith("/content")) {
      return new Response(JSON.stringify({ files: opts.manifest ?? [] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("raw file reads", () => {
  it("uses the inlined content when the backend provides it, without downloading", async () => {
    const { calls } = mockDeploy({ readContent: "# hello\n" });
    const text = await skills(ctx).readFileRaw("inline-1", "SKILL.md");
    expect(text).toBe("# hello\n");
    expect(calls.some((p) => p.endsWith("/download"))).toBe(false);
  });

  it("falls back to the archive when the backend answers with a URL", async () => {
    const { calls } = mockDeploy({
      archiveBytes: await archive({ "styles/tokens.json": '{"a":1}' }),
    });
    const text = await skills(ctx).readFileRaw("fallback-1", "styles/tokens.json");
    expect(text).toBe('{"a":1}');
    expect(calls.filter((p) => p.endsWith("/download"))).toHaveLength(1);
  });

  it("downloads the archive once across several reads", async () => {
    const { calls } = mockDeploy({
      archiveBytes: await archive({ "a.md": "A", "b.md": "B" }),
    });
    const s = skills(ctx);
    expect(await s.readFileRaw("cache-1", "a.md")).toBe("A");
    expect(await s.readFileRaw("cache-1", "b.md")).toBe("B");
    expect(calls.filter((p) => p.endsWith("/download"))).toHaveLength(1);
  });

  it("reads the draft archive separately from the published one", async () => {
    const { calls } = mockDeploy({ archiveBytes: await archive({ "a.md": "A" }) });
    const s = skills(ctx);
    await s.readFileRaw("view-1", "a.md");
    await s.readFileRaw("view-1", "a.md", { draft: true });
    expect(calls.filter((p) => p.endsWith("/download"))).toEqual([
      "/api/agent-operator-integration/v1/skills/view-1/download",
      "/api/agent-operator-integration/v1/skills/view-1/management/download",
    ]);
  });

  it("refuses binary files from the archive instead of emitting garbage", async () => {
    mockDeploy({
      archiveBytes: await archive({ "logo.png": new Uint8Array([0x89, 0x50, 0x00, 0x1a]) }),
    });
    await expect(skills(ctx).readFileRaw("binary-1", "logo.png")).rejects.toThrow(/binary file/);
  });

  it("refuses binary that isn't NUL-bearing but isn't UTF-8 either", async () => {
    // A PNG header with no NUL byte: only a strict decode catches this.
    mockDeploy({ archiveBytes: await archive({ "logo.png": new Uint8Array([0x89, 0x50, 0x4e]) }) });
    await expect(skills(ctx).readFileRaw("binary-2", "logo.png")).rejects.toThrow(/binary file/);
  });

  it("refuses binary the backend already inlined lossily", async () => {
    // The backend decodes bytes into JSON before we see them, so the original
    // bytes are gone and U+FFFD is all that marks the damage.
    mockDeploy({ readContent: "�PNG\r\n\n" });
    await expect(skills(ctx).readFileRaw("binary-3", "logo.png")).rejects.toThrow(/binary file/);
  });

  it("names the missing path rather than returning an empty string", async () => {
    mockDeploy({ archiveBytes: await archive({ "a.md": "A" }) });
    await expect(skills(ctx).readFileRaw("missing-1", "nope.md")).rejects.toThrow(/not found/);
  });

  it("content --raw resolves SKILL.md", async () => {
    mockDeploy({ archiveBytes: await archive({ "SKILL.md": "# doc\n" }) });
    expect(await skills(ctx).contentRaw("content-1")).toBe("# doc\n");
  });
});

describe("skills.files", () => {
  const manifest = [
    { rel_path: "SKILL.md", file_type: "reference", size: 10 },
    { rel_path: "styles/tokens.json", file_type: "config", size: 20 },
  ];

  it("lists one level with subtree totals", async () => {
    mockDeploy({ manifest });
    const out = await skills(ctx).files("files-1");
    expect(out.entries.map((e) => e.name)).toEqual(["styles", "SKILL.md"]);
    expect(out).toMatchObject({ totalFiles: 2, totalSize: 30 });
  });

  it("points a file path at read-file", async () => {
    mockDeploy({ manifest });
    await expect(skills(ctx).files("files-2", "SKILL.md")).rejects.toThrow(/skill read-file/);
  });

  it("reports an unknown path", async () => {
    mockDeploy({ manifest });
    await expect(skills(ctx).files("files-3", "nope")).rejects.toThrow(/not found/);
  });
});
