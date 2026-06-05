import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts", // library entry
    cli: "src/cli.ts", // `openbkn` bin (shebang lives in the source file)
  },
  format: ["esm"],
  target: "node22",
  dts: { entry: { index: "src/index.ts" } }, // ship types for the library only
  clean: true,
  sourcemap: true,
});
