import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["tests/ui.test.tsx"],
  outfile: ".test-build/ui.test.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const result = spawnSync(
  process.execPath,
  ["--test", ".test-build/ui.test.mjs"],
  { stdio: "inherit" },
);
await rm(".test-build", { recursive: true, force: true });
process.exitCode = result.status ?? 1;
