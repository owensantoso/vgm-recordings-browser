import { build, context } from "esbuild";
import {
  cp,
  mkdir,
  rm,
  readFile,
  writeFile,
  symlink,
  rename,
} from "node:fs/promises";
import { resolve } from "node:path";
import { buildPrivateCatalog } from "./catalog.mjs";
import { readVerifiedStemSets } from "./practice-store.mjs";

const privateAudio = process.argv.includes("--private-audio");
const output = privateAudio ? "private-dist.next" : "dist";
let privateCatalog;
let stemSets = [];
// Verify all private source associations before touching an existing preview.
if (privateAudio) {
  const catalog = JSON.parse(await readFile("data/catalog.json", "utf8"));
  const receipt = JSON.parse(
    await readFile("reference-audio/manifest.json", "utf8"),
  );
  privateCatalog = buildPrivateCatalog(catalog, receipt, "reference-audio");
  stemSets = readVerifiedStemSets(process.cwd());
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of [
  "index.html",
  "THIRD_PARTY_NOTICES.md",
  "data",
  "audio",
  "thumbs",
  "icons",
]) {
  try {
    if (privateAudio && ["audio", "thumbs", "icons"].includes(path))
      await symlink(resolve(path), `${output}/${path}`, "dir");
    else await cp(path, `${output}/${path}`, { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT" || !["audio", "thumbs", "icons"].includes(path))
      throw error;
    console.warn(
      `Missing ${path}; media verification requires a full checkout.`,
    );
  }
}
if (privateCatalog) {
  await writeFile(
    `${output}/data/catalog.json`,
    JSON.stringify(privateCatalog, null, 2) + "\n",
  );
  await mkdir(`${output}/reference-audio`, { recursive: true });
  for (const ref of privateCatalog.references.filter((ref) => ref.audio_file))
    await symlink(
      resolve("reference-audio", ref.audio_file),
      `${output}/reference-audio/${ref.audio_file}`,
    );
  if (stemSets.length) {
    await mkdir(`${output}/reference-audio/stems`, {recursive:true});
    for (const set of stemSets) for (const track of set.tracks)
      await symlink(resolve("reference-audio/stems",track.file),`${output}/reference-audio/stems/${track.file}`);
    console.log(`Private stem sets: ${stemSets.length} verified.`);
  }
  console.log(
    `Private listening audio: ${privateCatalog.references.filter((ref) => ref.audio_file).length} verified sources.`,
  );
}
const options = {
  entryPoints: ["src/main.tsx"],
  bundle: true,
  outdir: `${output}/assets`,
  entryNames: "app",
  format: "esm",
  target: "es2022",
  minify: !process.argv.includes("--serve"),
};
if (process.argv.includes("--serve")) {
  if (privateAudio)
    throw new Error(
      "Use the durable private preview runtime for private builds.",
    );
  const ctx = await context(options);
  await ctx.watch();
  const server = await ctx.serve({
    servedir: output,
    host: "0.0.0.0",
    port: 4173,
  });
  console.log(`Listening on ${server.port}`);
} else {
  await build(options);
  if (privateAudio) {
    await rm("private-dist.previous", { recursive: true, force: true });
    try {
      await rename("private-dist", "private-dist.previous");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(output, "private-dist");
    await rm("private-dist.previous", { recursive: true, force: true });
  } else await cp(`${output}/assets`, "assets", { recursive: true });
}
