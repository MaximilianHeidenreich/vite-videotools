import type { BuildConfig } from "bun";
import dts from "bun-plugin-dts";

const defaultBuildConfig: BuildConfig = {
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
};

await Promise.all([
  Bun.build({
    ...defaultBuildConfig,
    plugins: [dts()],
    format: "esm",
    naming: "[dir]/[name].js",
    target: "node",
  }),
  Bun.build({
    ...defaultBuildConfig,
    format: "cjs",
    naming: "[dir]/[name].cjs",
    target: "node",
  }),
  // Generate types
  Bun.$`bunx tsc --declaration --emitDeclarationOnly --outDir ./dist`,
]);
