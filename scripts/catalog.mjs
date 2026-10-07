import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, extname } from "node:path";
import { parseArgs } from "node:util";
import { parseCsv } from "../src/recordings.ts";

export function referenceYoutubeId(url) {
  const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
  let id;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.match(/^\/([^/]+)\/?$/)?.[1];
  } else if (hosts.includes(url.hostname)) {
    id = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1];
  } else {
    return null;
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('Invalid YouTube reference URL.');
  return id;
}

export function buildCatalog(sql, csv, databasePath = ':memory:') {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    db.exec(sql);
    const recordings = parseCsv(csv);
    const links = db.prepare('SELECT file, session_id, song_id, played_key, played_bpm FROM recordings ORDER BY file').all();
    const byFile = new Map(recordings.map(row => [row.file, row]));
    if (links.length !== recordings.length) throw new Error('Catalog must cover every archive take exactly once.');
    for (const link of links) {
      const row = byFile.get(link.file);
      if (!row || row.session_id !== link.session_id) throw new Error(`Archive/catalog mismatch: ${link.file}`);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Dangling catalog relationship.');
    const references = db.prepare('SELECT id, song_id, kind, label, url, artist FROM song_references ORDER BY id').all();
    for (const ref of references) {
      const url = new URL(ref.url);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`Invalid reference URL: ${ref.id}`);
      ref.youtube_id = referenceYoutubeId(url);
      ref.audio_file = null;
      ref.duration_seconds = null;
      ref.audio_format = null;
    }
    const songs = db.prepare('SELECT id, title, game, franchise, composer, reference_key, reference_bpm FROM songs ORDER BY title COLLATE NOCASE, id').all();
    if ([...songs.map(song => song.reference_bpm), ...links.map(take => take.played_bpm)].some(bpm => bpm !== null && !Number.isFinite(bpm))) {
      throw new Error('Tempo must be a finite positive number.');
    }
    return {
      version: 3,
      songs,
      sessions: db.prepare('SELECT id, label, date FROM sessions ORDER BY date DESC').all(),
      recordings: links,
      references,
      repertoire: db.prepare('SELECT song_id, note, position FROM repertoire ORDER BY position, song_id').all(),
    };
  } finally { db.close(); }
}

// The private receipt owns local assets; it is never inferred from the public SQL.
export function buildPrivateCatalog(
  catalog,
  receipt,
  audioRoot,
  { warn = console.warn } = {},
) {
  if (
    receipt?.version !== 1 ||
    !Array.isArray(receipt.assets) ||
    typeof receipt.checked_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      receipt.checked_at,
    ) ||
    !Number.isFinite(Date.parse(receipt.checked_at))
  ) {
    throw new Error("Invalid reference audio receipt.");
  }
  const references = new Map(catalog.references.map((ref) => [ref.id, ref]));
  const seenIds = new Set(),
    seenFiles = new Set(),
    local = new Map();
  for (const asset of receipt.assets) {
    const ref = references.get(asset.reference_id);
    if (!ref || !ref.youtube_id || asset.youtube_id !== ref.youtube_id)
      throw new Error("Reference audio source identity mismatch.");
    if (seenIds.has(asset.reference_id) || seenFiles.has(asset.audio_file))
      throw new Error("Duplicate reference audio association.");
    seenIds.add(asset.reference_id);
    seenFiles.add(asset.audio_file);
    if (
      typeof asset.audio_file !== "string" ||
      !/^[A-Za-z0-9_-]+\.(?:m4a|mp3|wav|flac|opus|ogg|webm|aac)$/.test(
        asset.audio_file,
      )
    ) {
      throw new Error("Reference audio file must be a safe audio basename.");
    }
    if (
      typeof asset.duration_seconds !== "number" ||
      !Number.isFinite(asset.duration_seconds) ||
      asset.duration_seconds <= 0 ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      !/^[a-f0-9]{64}$/i.test(asset.sha256 || "")
    ) {
      throw new Error("Invalid verified reference audio metadata.");
    }
    if (asset.audio_format !== extname(asset.audio_file).slice(1))
      throw new Error(
        "Reference audio format does not match the file extension.",
      );
    const path = resolve(audioRoot, asset.audio_file);
    let info;
    try {
      info = lstatSync(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      warn(
        `Reference audio missing: ${asset.reference_id}; keeping the online source.`,
      );
      continue;
    }
    if (
      !info.isFile() ||
      dirname(realpathSync(path)) !== realpathSync(audioRoot)
    )
      throw new Error("Reference audio must be a contained regular file.");
    if (
      info.size !== asset.bytes ||
      createHash("sha256").update(readFileSync(path)).digest("hex") !==
        asset.sha256.toLowerCase()
    )
      throw new Error("Reference audio does not match its verified receipt.");
    local.set(asset.reference_id, asset);
  }
  return {
    ...catalog,
    references: catalog.references.map((ref) => {
      const asset = local.get(ref.id);
      return {
        ...ref,
        audio_file: asset?.audio_file ?? null,
        duration_seconds: asset?.duration_seconds ?? null,
        audio_format: asset?.audio_format ?? null,
      };
    }),
  };
}

if (
  process.argv[1]?.endsWith("/catalog.mjs") ||
  process.argv[1] === "scripts/catalog.mjs"
) {
  const { values } = parseArgs({
    options: {
      "audio-receipt": { type: "string" },
      "audio-root": { type: "string" },
    },
  });
  const sql = readFileSync("data/catalog.sql", "utf8");
  const csv = readFileSync("data/recordings.csv", "utf8");
  mkdirSync(".catalog-build", { recursive: true });
  // A new in-memory database validates the complete reviewed source each run.
  const catalog = buildCatalog(sql, csv);
  if (values["audio-receipt"]) {
    const receipt = JSON.parse(readFileSync(values["audio-receipt"], "utf8"));
    const privateCatalog = buildPrivateCatalog(
      catalog,
      receipt,
      values["audio-root"] || "reference-audio",
    );
    writeFileSync(
      ".catalog-build/catalog.private.json",
      JSON.stringify(privateCatalog, null, 2) + "\n",
    );
    console.log(
      `Private catalog: ${privateCatalog.references.filter((ref) => ref.audio_file).length} verified local listening references.`,
    );
  } else {
    if (values["audio-root"])
      throw new Error("--audio-root requires --audio-receipt.");
    const { rmSync } = await import("node:fs");
    rmSync(".catalog-build/catalog.sqlite", { force: true });
    buildCatalog(sql, csv, ".catalog-build/catalog.sqlite");
    writeFileSync("data/catalog.json", JSON.stringify(catalog, null, 2) + "\n");
    console.log(
      `Catalog: ${catalog.songs.length} songs, ${catalog.recordings.length} archive associations, ${catalog.repertoire.length} repertoire entries.`,
    );
  }
}
