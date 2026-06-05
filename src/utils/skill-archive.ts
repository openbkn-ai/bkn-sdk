/**
 * Skill package ↔ zip helpers (jszip). Skills are shipped as a zip whose root
 * holds SKILL.md plus any referenced files; the backend reads `skill_file_index`
 * from the archive, so the directory layout must be preserved.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import JSZip from "jszip";

function walk(dir: string, base: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, files);
    else files.push(full);
  }
}

/** Zip a directory's contents (paths relative to the dir, forward slashes). */
export async function zipDirectory(dir: string): Promise<Uint8Array> {
  const abs = resolve(dir);
  if (!existsSync(abs)) throw new Error(`directory not found: ${abs}`);
  const zip = new JSZip();
  const files: string[] = [];
  walk(abs, abs, files);
  for (const file of files) {
    const rel = relative(abs, file).split(sep).join("/");
    zip.file(rel, readFileSync(file));
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

/** Extract a zip archive into a target directory (created if missing). */
export async function unzipToDirectory(bytes: Uint8Array, dir: string): Promise<string[]> {
  const abs = resolve(dir);
  mkdirSync(abs, { recursive: true });
  const zip = await JSZip.loadAsync(bytes);
  const written: string[] = [];
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;
    const out = join(abs, entry.name);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, await entry.async("nodebuffer"));
    written.push(out);
  }
  return written;
}
