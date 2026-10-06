import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createPracticeStore, createPracticeHandler, inspectWav } from '../scripts/practice-store.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'vgm-practice-store-'));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(join(repoRoot, 'data'));
  mkdirSync(join(repoRoot, 'reference-audio'));
  const bytes = Buffer.from('Synthetic source receipt; decoding belongs to the source producer.');
  const asset = { reference_id: 'alpha-original', youtube_id: 'Fixture0001', audio_file: 'Fixture0001.m4a', duration_seconds: 20, audio_format: 'm4a', bytes: bytes.length, sha256: hash(bytes) };
  const other = { ...asset, reference_id: 'beta-original', youtube_id: 'Fixture0002', audio_file: 'Fixture0002.m4a' };
  const receipt = { version: 1, checked_at: '2026-10-07T00:00:00Z', assets: [asset, other] };
  writeFileSync(join(repoRoot, 'data/catalog.json'), JSON.stringify({ references: [asset, other].map(a => ({ id: a.reference_id, youtube_id: a.youtube_id, kind: 'original' })) }));
  for (const a of receipt.assets) writeFileSync(join(repoRoot, 'reference-audio', a.audio_file), bytes);
  const saveReceipt = () => writeFileSync(join(repoRoot, 'reference-audio/manifest.json'), JSON.stringify(receipt));
  saveReceipt();
  return { repoRoot, receipt, asset, saveReceipt, input: { sourceId: 'ref:alpha-original', sourceHash: asset.sha256, label: ' Verse ', start: 1.25, end: 4.5 } };
}
const status = expected => error => error.status === expected;
function open(t, f) { const store = createPracticeStore(f); t.after(() => store.close()); return store; }

function wav({ sampleRate = 8000, channels = 2, frames = 8000, bits = 16 } = {}) {
  const block = channels * bits / 8, data = frames * block, bytes = Buffer.alloc(44 + data);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * block, 28); bytes.writeUInt16LE(block, 32); bytes.writeUInt16LE(bits, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(data, 40);
  return bytes;
}
function stemFixture(f, changes = {}) {
  const root = join(f.repoRoot, 'reference-audio/stems'); mkdirSync(root, { recursive: true });
  const bytes = wav(), file = 'vocals.wav'; writeFileSync(join(root, file), bytes);
  const set = { id: randomUUID(), sourceId: f.input.sourceId, sourceHash: f.input.sourceHash, coverage: 'excerpt', start: 5, end: 6, sampleRate: 8000, channels: 2, frames: 8000, tracks: [{ id: 'vocals', label: 'Vocals', file, bytes: bytes.length, sha256: hash(bytes) }], ...changes };
  const save = () => writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: 1, stemSets: [set] }));
  save(); return { set, save, root, bytes };
}

test('named original-source sections persist with UUID identity and independent revisions', t => {
  const f = fixture(t), store = createPracticeStore(f);
  assert.deepEqual(store.read(f.input.sourceId), { sourceId: f.input.sourceId, sourceHash: f.input.sourceHash, duration: 20, sections: [], stemSet: null });
  const first = store.create(f.input), second = store.create({ ...f.input, label: 'Chorus', start: 10, end: 15 });
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.label, 'Verse'); assert.equal(first.revision, 1); assert.notEqual(first.id, second.id);
  const updated = store.update(first.id, { ...f.input, revision: 1, label: 'Verse 1', end: 5 });
  assert.equal(updated.revision, 2); assert.equal(updated.id, first.id);
  assert.throws(() => store.update(first.id, { ...f.input, revision: 1 }), status(409));
  assert.equal(store.read('ref:beta-original').sections.length, 0);
  store.close();
  const reopened = open(t, f);
  assert.deepEqual(reopened.read(f.input.sourceId).sections, [updated, second]);
});

test('section validation rejects invalid ranges/labels and accepts exact minimum fractional span', t => {
  const f = fixture(t), store = open(t, f);
  for (const fields of [{ label: '' }, { label: ' '.repeat(4) }, { label: 'a'.repeat(81) }, { start: -1 }, { start: NaN }, { end: Infinity }, { start: 5, end: 4 }, { start: 1, end: 1.249 }, { end: 20.1 }, { start: '1' }, { end: null }]) {
    assert.throws(() => store.create({ ...f.input, ...fields }), status(400));
  }
  assert.equal(store.create({ ...f.input, start: .1, end: .35 }).end, .35);
  assert.throws(() => store.create({ ...f.input, sourceId: 'take.wav' }), status(400));
  assert.throws(() => store.create({ ...f.input, sourceId: 'ref:nonexistent' }), status(400));
  assert.throws(() => store.create({ ...f.input, sourceHash: '0'.repeat(64) }), status(409));
  const section = store.create(f.input);
  assert.throws(() => store.update(section.id, { ...f.input, sourceId: 'ref:beta-original', revision: 1 }), status(404));
  assert.throws(() => store.update(section.id, { ...f.input, revision: 0 }), status(400));
});

test('receipt/file drift rejects old saved sections and prevents silent retiming', t => {
  const f = fixture(t), store = open(t, f); const section = store.create(f.input);
  const file = join(f.repoRoot, 'reference-audio', f.asset.audio_file);
  writeFileSync(file, 'changed');
  assert.throws(() => store.read(f.input.sourceId), status(409));
  const bytes = Buffer.from('New verified source with new timing');
  writeFileSync(file, bytes); f.asset.bytes = bytes.length; f.asset.sha256 = hash(bytes); f.saveReceipt();
  assert.throws(() => store.read(f.input.sourceId), status(409));
  assert.throws(() => store.update(section.id, { ...f.input, sourceHash: f.asset.sha256, revision: 1 }), status(409));
  assert.throws(() => store.create({ ...f.input, sourceHash: f.asset.sha256 }), status(409));
});

test('only catalog-linked receipt identities and contained regular source assets are accepted', t => {
  const f = fixture(t), store = open(t, f);
  f.asset.youtube_id = 'Wrong000001'; f.saveReceipt();
  assert.throws(() => store.read(f.input.sourceId), status(409));
  f.asset.youtube_id = 'Fixture0001'; f.saveReceipt();
  const file = join(f.repoRoot, 'reference-audio', f.asset.audio_file), elsewhere = join(f.repoRoot, 'outside.m4a');
  writeFileSync(elsewhere, readFileSync(file)); rmSync(file); symlinkSync(elsewhere, file);
  assert.throws(() => store.read(f.input.sourceId), status(409));
});

test('verified stems expose exact source coverage and measured WAV metadata', t => {
  const f = fixture(t), stem = stemFixture(f), store = open(t, f);
  assert.deepEqual(inspectWav(stem.bytes), { sampleRate: 8000, channels: 2, frames: 8000 });
  assert.deepEqual(store.read(f.input.sourceId).stemSet, stem.set);
  assert.equal(store.read('ref:beta-original').stemSet, null);
});

test('stems fail closed for hashes, paths, duplicate identities, coverage, or actual WAV format mismatch', t => {
  const f = fixture(t), stem = stemFixture(f), store = open(t, f), baseline = structuredClone(stem.set);
  for (const mutate of [
    s => { s.sourceHash = '0'.repeat(64); }, s => { s.start = -1; }, s => { s.end = 21; },
    s => { s.coverage = 'full-source'; }, s => { s.frames = 7999; s.sampleRate = 7999; },
    s => { s.channels = 1; }, s => { s.tracks[0].file = '../vocals.wav'; },
    s => { s.tracks[0].sha256 = '0'.repeat(64); }, s => { s.tracks[0].bytes--; },
    s => { s.tracks.push({ ...s.tracks[0] }); },
  ]) {
    Object.assign(stem.set, structuredClone(baseline)); mutate(stem.set); stem.save();
    assert.throws(() => store.read(f.input.sourceId), status(503));
  }
  Object.assign(stem.set, baseline); stem.save();
  const trackPath = join(stem.root, 'vocals.wav'); const outside = join(f.repoRoot, 'outside.wav');
  writeFileSync(outside, stem.bytes); rmSync(trackPath); symlinkSync(outside, trackPath);
  assert.throws(() => store.read(f.input.sourceId), status(503));
  assert.throws(() => inspectWav(Buffer.from('Not an actual WAV')));
});

async function serverFixture(t) {
  const f = fixture(t), handler = createPracticeHandler({ repoRoot: f.repoRoot, allowedOrigins: ['https://music.example'] });
  const server = createServer(async (req, res) => { if (!await handler(req, res, new URL(req.url, 'http://local').pathname)) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); handler.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path = '/api/practice', input = f.input, options = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://music.example', ...options.headers }, body: JSON.stringify(input), ...options, headers: { 'Content-Type': 'application/json', Origin: 'https://music.example', ...options.headers } });
  return { ...f, base, request };
}

test('private API persists create/update, reports stale edits, and scopes exact source query', async t => {
  const f = await serverFixture(t);
  let response = await fetch(f.base + '/api/practice?source=ref%3Aalpha-original'); assert.equal(response.status, 200);
  assert.equal((await response.json()).sections.length, 0); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('access-control-allow-origin'), null);
  response = await f.request(); assert.equal(response.status, 201); const { section } = await response.json();
  response = await f.request(`/api/practice/${section.id}`, { ...f.input, revision: 1, label: 'Chorus' }, { method: 'PUT' }); assert.equal(response.status, 200); assert.equal((await response.json()).section.revision, 2);
  response = await f.request(`/api/practice/${section.id}`, { ...f.input, revision: 1 }, { method: 'PUT' }); assert.equal(response.status, 409);
  response = await fetch(f.base + '/api/practice?source=ref%3Aalpha-original&source=ref%3Abeta-original'); assert.equal(response.status, 400);
  response = await fetch(f.base + '/not-owned'); assert.equal(response.status, 404);
});

test('API rejects nonexact/missing origins, oversized/invalid JSON, wrong content type and methods', async t => {
  const f = await serverFixture(t);
  for (const Origin of ['', 'null', 'https://music.example.evil', 'http://music.example']) { const r = await f.request(undefined, undefined, { headers: { Origin } }); assert.equal(r.status, 403); }
  assert.equal((await f.request(undefined, { ...f.input, label: 'x'.repeat(17000) })).status, 413);
  assert.equal((await f.request(undefined, undefined, { body: '{' })).status, 400);
  assert.equal((await f.request(undefined, undefined, { body: '[]' })).status, 400);
  assert.equal((await f.request(undefined, undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await fetch(f.base + '/api/practice', { method: 'DELETE' })).status, 405);
});

async function streamedRequest(base, bytes) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(base + '/api/practice', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://music.example' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.write(bytes); req.end();
  });
}

test('chunked requests remain bounded without losing the error response and reject invalid UTF-8', async t => {
  const f = await serverFixture(t);
  assert.equal(await streamedRequest(f.base, Buffer.alloc(17000, 32)), 413);
  const malformed = Buffer.concat([Buffer.from('{"label":"'), Buffer.from([0xff]), Buffer.from('"}')]);
  assert.equal(await streamedRequest(f.base, malformed), 400);
  assert.equal((await fetch(f.base + '/api/practice?source=ref%3Aalpha-original')).status, 200);
});
