import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalog } from '../scripts/catalog.mjs';
const sql = readFileSync('data/catalog.sql', 'utf8');
const csv = readFileSync('data/recordings.csv', 'utf8');
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
  assert.equal(new Set(data.references.map(ref => ref.song_id)).size, 13);
  assert.ok(data.references.every(ref => /^[A-Za-z0-9_-]{11}$/.test(ref.youtube_id)));
  assert.ok(data.songs.every(song => song.reference_key === null && song.reference_bpm === null));
  assert.ok(data.recordings.every(take => take.played_key === null && take.played_bpm === null));
  assert.deepEqual(data, buildCatalog(sql, csv), 'projection is deterministic');
  assert.equal(JSON.stringify(data, null, 2) + '\n', readFileSync('data/catalog.json', 'utf8'), 'checked-in static catalog must match the SQL and CSV');
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
