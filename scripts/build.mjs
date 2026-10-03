import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const path of ["index.html", "data", "audio", "thumbs", "icons"]) {
  try {
    await cp(path, `dist/${path}`, { recursive: true });
  } catch (error) {
    // A text-only review checkout can omit the large media archive.
    if (error.code !== "ENOENT" || !["audio", "thumbs", "icons"].includes(path))
      throw error;
    console.warn(
      `Missing ${path}; media verification requires a full checkout.`,
    );
  }
}
const options = {
  entryPoints: ["src/main.tsx"],
  bundle: true,
  outdir: "dist/assets",
  entryNames: "app",
  format: "esm",
  target: "es2022",
  minify: !process.argv.includes("--serve"),
};
if (process.argv.includes("--serve")) {
  const ctx = await context(options);
  await ctx.watch();
  const server = await ctx.serve({
    servedir: "dist",
    host: "0.0.0.0",
    port: 4173,
  });
  console.log(`Listening on ${server.port}`);
} else {
  await build(options);
  // Keep branch-based GitHub Pages working without changing repository settings.
  await cp("dist/assets", "assets", { recursive: true });
}
