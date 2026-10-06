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
    const stemFiles = new Set(stemSets.flatMap(set => [
      ...set.tracks.map(track => track.file),
      ...(set.chunks || []).flatMap(chunk => chunk.files.map(file => file.file)),
      ...(set.waveforms ? [set.waveforms.file] : []),
    ]));
    for (const file of stemFiles)
      await symlink(resolve("reference-audio/stems",file),`${output}/reference-audio/stems/${file}`);
    console.log(`Private stem sets: ${stemSets.length} verified.`);
  }
  console.log(
    `Private listening audio: ${privateCatalog.references.filter((ref) => ref.audio_file).length} verified sources.`,
  );
}
const options = {
  entryPoints: { app: "src/main.tsx", "stem-rate-worklet": "src/stem-rate-worklet.ts" },
  bundle: true,
  outdir: `${output}/assets`,
  entryNames: "[name]",
  format: "esm",
  target: "es2022",
  minify: !process.argv.includes("--serve"),
};
await mkdir(`${output}/assets`, { recursive: true });
await cp("node_modules/@soundtouchjs/core/LICENSE", `${output}/assets/SOUNDTOUCH-LICENSE.txt`);
await writeFile(`${output}/assets/SOUNDTOUCH-SOURCE.txt`,
  "SoundTouchJS core 2.1.1 and interpolation-strategy-lanczos 2.1.1 (MPL-2.0).\n" +
  "Unmodified package source: https://registry.npmjs.org/@soundtouchjs/core/-/core-2.1.1.tgz\n" +
  "https://registry.npmjs.org/@soundtouchjs/interpolation-strategy-lanczos/-/interpolation-strategy-lanczos-2.1.1.tgz\n" +
  "Project: https://github.com/cutterbl/SoundTouchJS\n");
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
