import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { buildCatalog, buildPrivateCatalog } from "../scripts/catalog.mjs";
const sql = readFileSync("data/catalog.sql", "utf8");
const csv = readFileSync("data/recordings.csv", "utf8");
test('catalog joins cross-session takes by stable identity and keeps unknowns unassigned', () => {
  const data = buildCatalog(sql, csv);
  assert.equal(data.songs.length, 13);
  assert.equal(data.recordings.length, 22);
  const yoshi = data.recordings.filter(row => row.song_id === 'vgm-yoshi-circuit-double-dash');
  assert.equal(yoshi.length, 2);
  assert.equal(new Set(yoshi.map(row => row.session_id)).size, 2);
  assert.equal(data.recordings.filter(row => !row.song_id).length, 7);
  assert.equal(data.repertoire.length, 0);
  assert.equal(data.references.length, 14);
  assert.equal(data.version, 3);
  assert.ok(data.references.every(ref => ref.audio_file === null && ref.duration_seconds === null && ref.audio_format === null), 'public catalog never claims private audio availability');
  assert.equal(new Set(data.references.map(ref => ref.song_id)).size, 13);
  assert.ok(data.references.every(ref => /^[A-Za-z0-9_-]{11}$/.test(ref.youtube_id)));
  assert.ok(data.songs.every(song => song.reference_key === null && song.reference_bpm === null));
  assert.ok(data.recordings.every(take => take.played_key === null && take.played_bpm === null));
  assert.deepEqual(data, buildCatalog(sql, csv), 'projection is deterministic');
  assert.equal(JSON.stringify(data, null, 2) + '\n', readFileSync('data/catalog.json', 'utf8'), 'checked-in static catalog must match the SQL and CSV');
});

function privateFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vgm-reference-audio-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const body = Buffer.from(
    "Synthetic bytes; decoding is owned by the receipt producer.",
  );
  const asset = {
    reference_id: "gourmet-race-soundtrack",
    youtube_id: "Se1uh3PS78Y",
    audio_file: "gourmet-race-soundtrack.m4a",
    duration_seconds: 42.5,
    audio_format: "m4a",
    bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
  writeFileSync(join(root, asset.audio_file), body);
  return {
    root,
    body,
    asset,
    receipt: {
      version: 1,
      checked_at: "2026-10-06T12:00:00Z",
      assets: [asset],
    },
    catalog: buildCatalog(sql, csv),
  };
}
test("verified private audio overlays by stable reference ID without changing public metadata", (t) => {
  const f = privateFixture(t),
    before = JSON.stringify(f.catalog);
  const data = buildPrivateCatalog(f.catalog, f.receipt, f.root);
  const ref = data.references.find((ref) => ref.id === f.asset.reference_id);
  assert.equal(ref.audio_file, f.asset.audio_file);
  assert.equal(ref.duration_seconds, 42.5);
  assert.equal(ref.audio_format, "m4a");
  assert.equal(ref.youtube_id, f.asset.youtube_id);
  assert.equal(
    ref.url,
    f.catalog.references.find((ref) => ref.id === f.asset.reference_id).url,
  );
  assert.equal(data.references.filter((ref) => ref.audio_file).length, 1);
  assert.equal(
    JSON.stringify(f.catalog),
    before,
    "private projection must not mutate the public source",
  );
  assert.ok(
    data.songs.every(
      (song) => song.reference_key === null && song.reference_bpm === null,
    ),
  );
});
test("missing private files warn and remain unavailable rather than announcing a download", (t) => {
  const f = privateFixture(t),
    warnings = [];
  rmSync(join(f.root, f.asset.audio_file));
  const data = buildPrivateCatalog(f.catalog, f.receipt, f.root, {
    warn: (message) => warnings.push(message),
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /keeping the online source/);
  assert.ok(
    data.references.every(
      (ref) => ref.audio_file === null && ref.duration_seconds === null,
    ),
  );
});
test("verified YouTube audio filenames may begin with underscore or hyphen", (t) => {
  const f = privateFixture(t);
  for (const audio_file of ["_91Um2pW5Sk.m4a", "-leading-source.m4a"]) {
    writeFileSync(join(f.root, audio_file), f.body);
    const asset = {
      ...f.asset,
      reference_id: "meta-knight-super-soul-bros",
      youtube_id: "_91Um2pW5Sk",
      audio_file,
    };
    const data = buildPrivateCatalog(
      f.catalog,
      { ...f.receipt, assets: [asset] },
      f.root,
    );
    assert.equal(
      data.references.find((ref) => ref.id === asset.reference_id).audio_file,
      audio_file,
    );
  }
});
test("private receipts reject unsafe paths, executables, wrong sources and unverified metadata", (t) => {
  const f = privateFixture(t);
  const badAsset = (patch) =>
    buildPrivateCatalog(
      f.catalog,
      { ...f.receipt, assets: [{ ...f.asset, ...patch }] },
      f.root,
    );
  for (const audio_file of [
    "../outside.m4a",
    "/tmp/outside.m4a",
    "https://example.test/song.m4a",
    "song.m4a.exe",
    "nested/song.m4a",
    "..%2foutside.m4a",
  ])
    assert.throws(() => badAsset({ audio_file }), /safe audio basename/);
  assert.throws(
    () => badAsset({ reference_id: "missing" }),
    /source identity mismatch/,
  );
  assert.throws(
    () => badAsset({ youtube_id: "WrongId0000" }),
    /source identity mismatch/,
  );
  assert.throws(() => badAsset({ audio_format: "opus" }), /format/);
  for (const patch of [
    { duration_seconds: 0 },
    { duration_seconds: NaN },
    { duration_seconds: "42.5" },
    { bytes: 0 },
    { bytes: 1.5 },
    { sha256: "unknown" },
  ])
    assert.throws(() => badAsset(patch), /verified reference audio metadata/);
  assert.throws(
    () =>
      buildPrivateCatalog(
        f.catalog,
        { ...f.receipt, assets: [f.asset, f.asset] },
        f.root,
      ),
    /Duplicate/,
  );
  assert.throws(
    () =>
      buildPrivateCatalog(
        f.catalog,
        { ...f.receipt, checked_at: "2026" },
        f.root,
      ),
    /Invalid reference audio receipt/,
  );
});
test("private availability rejects tampered bytes and symlinks instead of exposing external files", (t) => {
  const f = privateFixture(t);
  writeFileSync(join(f.root, f.asset.audio_file), Buffer.alloc(f.body.length));
  assert.throws(
    () => buildPrivateCatalog(f.catalog, f.receipt, f.root),
    /verified receipt/,
  );
  rmSync(join(f.root, f.asset.audio_file));
  symlinkSync(
    join(f.root, "missing-outside.m4a"),
    join(f.root, f.asset.audio_file),
  );
  assert.throws(
    () => buildPrivateCatalog(f.catalog, f.receipt, f.root),
    /contained regular file/,
  );
});
test("private CLI writes only an ignored projection and preserves committed public JSON", (t) => {
  const f = privateFixture(t),
    receiptPath = join(f.root, "receipt.json"),
    publicBefore = readFileSync("data/catalog.json", "utf8"),
    cliRoot = join(f.root, "cli-run");
  writeFileSync(receiptPath, JSON.stringify(f.receipt));
  mkdirSync(join(cliRoot, "data"), { recursive: true });
  writeFileSync(join(cliRoot, "data", "catalog.sql"), sql);
  writeFileSync(join(cliRoot, "data", "recordings.csv"), csv);
  writeFileSync(join(cliRoot, "data", "catalog.json"), publicBefore);
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      resolve("scripts/catalog.mjs"),
      "--audio-receipt",
      receiptPath,
      "--audio-root",
      f.root,
    ],
    { encoding: "utf8", cwd: cliRoot },
  );
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(
    readFileSync(
      join(cliRoot, ".catalog-build", "catalog.private.json"),
      "utf8",
    ),
  );
  assert.equal(
    data.references.find((ref) => ref.id === f.asset.reference_id).audio_file,
    f.asset.audio_file,
  );
  assert.equal(
    readFileSync(join(cliRoot, "data", "catalog.json"), "utf8"),
    publicBefore,
  );
  assert.equal(readFileSync("data/catalog.json", "utf8"), publicBefore);
});
test('unrecorded repertoire songs and independent reference artists are valid', () => {
  const extra = "INSERT INTO songs (id, title) VALUES ('permanent-fixture-id', 'Unrecorded fixture'); INSERT INTO repertoire (song_id, note, position) VALUES ('permanent-fixture-id', 'Chosen explicitly', 1); INSERT INTO song_references (id, song_id, kind, label, url, artist) VALUES ('fixture-ref', 'permanent-fixture-id', 'cover', 'Synthetic cover', 'https://example.test/cover', 'Reference artist');";
  const data = buildCatalog(sql + extra, csv);
  assert.equal(data.songs.find(song => song.id === 'permanent-fixture-id').composer, null);
  assert.equal(data.recordings.filter(row => row.song_id === 'permanent-fixture-id').length, 0);
  assert.equal(data.repertoire[0].song_id, 'permanent-fixture-id');
  assert.equal(data.references.find(ref => ref.id === 'fixture-ref').artist, 'Reference artist');
});
test('catalog rejects dangling relationships, missing takes, and executable links', () => {
  assert.throws(() => buildCatalog(sql + "INSERT INTO repertoire (song_id, note, position) VALUES ('missing', '', 0);", csv), /FOREIGN KEY/);
  assert.throws(() => buildCatalog(sql + "DELETE FROM recordings WHERE file='IMG_7799.MOV';", csv), /every archive take/);
  assert.throws(() => buildCatalog(sql + "INSERT INTO song_references (id, song_id, kind, label, url) VALUES ('bad', 'vgm-gourmet-race', 'other', 'bad', 'javascript:alert(1)');", csv), /Invalid reference URL/);
});
test('reference key and tempo are independent of each played take', () => {
  const data = buildCatalog(sql + "UPDATE songs SET reference_key='C minor', reference_bpm=120 WHERE id='vgm-yoshi-circuit-double-dash'; UPDATE recordings SET played_key='D minor', played_bpm=108.5 WHERE file='IMG_7788.MOV';", csv);
  const song = data.songs.find(row => row.id === 'vgm-yoshi-circuit-double-dash');
  assert.equal(song.reference_key, 'C minor');
  assert.equal(song.reference_bpm, 120);
  const first = data.recordings.find(row => row.file === 'IMG_7788.MOV');
  assert.equal(first.played_key, 'D minor');
  assert.equal(first.played_bpm, 108.5);
  const other = data.recordings.find(row => row.file === 'IMG_5944 MKart Yoshi Circuit.MOV');
  assert.equal(other.played_key, null, 'unknown played key does not inherit the reference');
  assert.equal(other.played_bpm, null);
});
test('tempo rejects nonpositive, nonnumeric and infinite values for songs and takes', () => {
  for (const value of ['0', '-1', "'unknown'", '1e999']) {
    assert.throws(() => buildCatalog(sql + `UPDATE songs SET reference_bpm=${value} WHERE id='vgm-gourmet-race';`, csv), /CHECK|finite positive/);
    assert.throws(() => buildCatalog(sql + `UPDATE recordings SET played_bpm=${value} WHERE file='IMG_7799.MOV';`, csv), /CHECK|finite positive/);
  }
});
test('YouTube IDs require a recognized hostname and an exact video ID', () => {
  const withUrl = url => buildCatalog(sql + `INSERT INTO song_references (id, song_id, kind, label, url) VALUES ('fixture-url', 'vgm-gourmet-race', 'chart', 'Fixture', '${url}');`, csv).references.find(ref => ref.id === 'fixture-url');
  assert.equal(withUrl('https://youtu.be/Se1uh3PS78Y?t=2').youtube_id, 'Se1uh3PS78Y');
  assert.equal(withUrl('https://www.youtube.com/embed/Se1uh3PS78Y').youtube_id, 'Se1uh3PS78Y');
  assert.equal(withUrl('https://www.youtube.com/shorts/Se1uh3PS78Y').youtube_id, 'Se1uh3PS78Y');
  assert.equal(withUrl('https://example.test/chart').youtube_id, null, 'ordinary chart links remain valid');
  assert.equal(withUrl('https://youtube.com.example.test/watch?v=Se1uh3PS78Y').youtube_id, null, 'a lookalike host never becomes an embedded video');
  for (const url of ['https://youtu.be/short', 'https://www.youtube.com/watch', 'https://www.youtube.com/watch?v=Se1uh3PS78Ymore', 'https://www.youtube.com/watch?v=Se1uh3PS78%25', 'https://www.youtube.com/channel/Se1uh3PS78Y']) {
    assert.throws(() => withUrl(url), /Invalid YouTube/);
  }
});
