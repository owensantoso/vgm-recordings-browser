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
  assert.equal(data.references.length, 0);
  assert.deepEqual(data, buildCatalog(sql, csv), 'projection is deterministic');
  assert.equal(JSON.stringify(data, null, 2) + '\n', readFileSync('data/catalog.json', 'utf8'), 'checked-in static catalog must match the SQL and CSV');
});
test('unrecorded repertoire songs and independent reference artists are valid', () => {
  const extra = "INSERT INTO songs VALUES ('permanent-fixture-id', 'Unrecorded fixture', NULL, NULL, NULL); INSERT INTO repertoire VALUES ('permanent-fixture-id', 'Chosen explicitly', 1); INSERT INTO song_references VALUES ('fixture-ref', 'permanent-fixture-id', 'cover', 'Synthetic cover', 'https://example.test/cover', 'Reference artist');";
  const data = buildCatalog(sql + extra, csv);
  assert.equal(data.songs.find(song => song.id === 'permanent-fixture-id').composer, null);
  assert.equal(data.recordings.filter(row => row.song_id === 'permanent-fixture-id').length, 0);
  assert.equal(data.repertoire[0].song_id, 'permanent-fixture-id');
  assert.equal(data.references[0].artist, 'Reference artist');
});
test('catalog rejects dangling relationships, missing takes, and executable links', () => {
  assert.throws(() => buildCatalog(sql + "INSERT INTO repertoire VALUES ('missing', '', 0);", csv), /FOREIGN KEY/);
  assert.throws(() => buildCatalog(sql + "DELETE FROM recordings WHERE file='IMG_7799.MOV';", csv), /every archive take/);
  assert.throws(() => buildCatalog(sql + "INSERT INTO song_references VALUES ('bad', 'vgm-gourmet-race', 'other', 'bad', 'javascript:alert(1)', NULL);", csv), /Invalid reference URL/);
});
