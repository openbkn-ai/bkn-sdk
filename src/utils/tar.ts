// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * BKN directory ↔ tar helpers. Shells out to the system `tar` (present on
 * Linux/macOS and Windows 10 1803+). `COPYFILE_DISABLE=1` stops macOS from
 * embedding `._*` AppleDouble resource forks the backend would reject.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const TAR_MISSING =
  "tar executable not found. On Windows, ensure tar.exe is in PATH " +
  "(ships with Windows 10 1803+) or install GNU tar via Git for Windows / scoop.";

/** Pack a directory's contents (not the dir itself) into a tar buffer. */
export function packDirectoryToTar(dirPath: string): Buffer {
  const abs = resolve(dirPath);
  const result = spawnSync("tar", ["cf", "-", "-C", abs, "."], {
    maxBuffer: 1024 * 1024 * 512,
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(TAR_MISSING);
  }
  if (result.status !== 0) {
    throw new Error(`tar pack failed: ${result.stderr?.toString() ?? result.status}`);
  }
  return result.stdout;
}

/** Extract a tar buffer into a target directory (created by the caller). */
export function extractTarToDirectory(tarBuffer: Buffer, dirPath: string): void {
  const abs = resolve(dirPath);
  const result = spawnSync("tar", ["xf", "-", "-C", abs], {
    input: tarBuffer,
    maxBuffer: 1024 * 1024 * 512,
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(TAR_MISSING);
  }
  if (result.status !== 0) {
    throw new Error(`tar extract failed: ${result.stderr?.toString() ?? result.status}`);
  }
}
