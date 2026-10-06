import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { buildPrivateCatalog } from './catalog.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const jsonFile = path => JSON.parse(readFileSync(path, 'utf8'));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function sourceIdentity(repoRoot, sourceId) {
  if (typeof sourceId !== 'string' || !/^ref:[A-Za-z0-9_-]+$/.test(sourceId)) fail(400, 'Choose a verified listening reference.');
  const referenceId = sourceId.slice(4);
  const catalog = jsonFile(resolve(repoRoot, 'data/catalog.json'));
  const receipt = jsonFile(resolve(repoRoot, 'reference-audio/manifest.json'));
  const ref = catalog.references?.find(item => item.id === referenceId);
  const assets = receipt.assets?.filter(item => item.reference_id === referenceId);
  if (!ref || assets?.length !== 1) fail(400, 'This source has no verified local audio.');
  const asset = assets[0];
  let verified;
  try {
    verified = buildPrivateCatalog({ references: [ref] }, { ...receipt, assets }, resolve(repoRoot, 'reference-audio'), { warn() {} });
  } catch { fail(409, 'Source audio no longer matches its verified receipt.'); }
  if (!verified.references[0].audio_file) fail(503, 'The verified source audio is unavailable.');
  return { sourceId, referenceId, sourceHash: asset.sha256.toLowerCase(), duration: asset.duration_seconds };
}

function rangeFields(input, duration) {
  if (!object(input) || typeof input.label !== 'string' || !input.label.trim() || input.label.trim().length > 80) fail(400, 'Use a section name from 1 to 80 characters.');
  const { start, end } = input;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start + 0.25 || end > duration) fail(400, 'The section must span at least 0.25 seconds within this source.');
  return { label: input.label.trim(), start, end };
}

function annotationFields(input, duration) {
  if (!object(input) || !['chord', 'note'].includes(input.type) || typeof input.text !== 'string' || !input.text.trim() || input.text.trim().length > (input.type === 'chord' ? 80 : 2000)) fail(400, 'Enter a chord up to 80 characters or a note up to 2000 characters.');
  const range = rangeFields({ ...input, label: 'Annotation' }, duration);
  return { type: input.type, text: input.text.trim(), start: range.start, end: range.end };
}

function annotationView(row) {
  return { id: row.id, type: row.type, text: row.text, start: row.start_seconds, end: row.end_seconds, revision: row.revision };
}

function assertHash(input, source) {
  if (!object(input) || typeof input.sourceHash !== 'string' || input.sourceHash !== source.sourceHash) fail(409, 'The source changed. Reload its sections before editing.');
}

function sectionView(row) {
  return { id: row.id, label: row.label, start: row.start_seconds, end: row.end_seconds, revision: row.revision };
}

// WAV tracks are measured against their rendered coverage, not the original file's duration.
export function inspectWav(bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Invalid WAV container.');
  let fmt, data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), begin = offset + 8;
    if (begin + size > bytes.length) throw new Error('Truncated WAV chunk.');
    if (kind === 'fmt ') { if (fmt) throw new Error('Duplicate WAV format.'); fmt = bytes.subarray(begin, begin + size); }
    if (kind === 'data') { if (data !== undefined) throw new Error('Duplicate WAV audio.'); data = size; }
    offset = begin + size + (size % 2);
  }
  if (!fmt || fmt.length < 16 || !data) throw new Error('Missing WAV format or audio.');
  let encoding = fmt.readUInt16LE(0);
  if (encoding === 0xfffe) {
    if (fmt.length < 40 || fmt.readUInt16LE(16) < 22 || fmt.subarray(26, 40).toString('hex') !== '000000001000800000aa00389b71') throw new Error('Unsupported WAV format.');
    encoding = fmt.readUInt16LE(24);
  }
  const channels = fmt.readUInt16LE(2), sampleRate = fmt.readUInt32LE(4), blockAlign = fmt.readUInt16LE(12), bits = fmt.readUInt16LE(14);
  if (![1, 3].includes(encoding) || ![16, 24, 32, 64].includes(bits) || (encoding === 3 && ![32, 64].includes(bits)) || channels < 1 || sampleRate < 1 || blockAlign !== channels * bits / 8 || fmt.readUInt32LE(8) !== sampleRate * blockAlign || data % blockAlign !== 0) throw new Error('Invalid WAV audio format.');
  return { channels, sampleRate, frames: data / blockAlign };
}

export function inspectFlac(bytes) {
  if (bytes.length < 42 || bytes.toString('ascii', 0, 4) !== 'fLaC' || (bytes[4] & 0x7f) !== 0 || bytes.readUIntBE(5, 3) !== 34) throw new Error('Invalid FLAC STREAMINFO header.');
  const packed = bytes.readBigUInt64BE(18);
  const sampleRate = Number(packed >> 44n);
  const channels = Number((packed >> 41n) & 7n) + 1;
  const bitsPerSample = Number((packed >> 36n) & 31n) + 1;
  const frames = Number(packed & 0xfffffffffn);
  if (sampleRate <= 0 || frames <= 0 || bitsPerSample !== 16) throw new Error('FLAC must declare positive sample rate/frame count and 16-bit audio.');
  return { sampleRate, channels, frames, bitsPerSample };
}

function inspectStemAudio(root, asset) {
  const bytes = verifiedFile(root, asset, 'audio');
  return asset.file.endsWith('.flac') ? inspectFlac(bytes) : inspectWav(bytes);
}

function verifiedFile(root, asset, extension) {
  if (!object(asset) || typeof asset.file !== 'string' || !(extension === 'audio' ? /^[A-Za-z0-9_-]+\.(?:wav|flac)$/ : /^[A-Za-z0-9_-]+\.json$/).test(asset.file) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || typeof asset.sha256 !== 'string' || !HASH.test(asset.sha256)) throw new Error('Invalid asset identity.');
  const path = resolve(root, asset.file), stat = lstatSync(path);
  if (!stat.isFile() || dirname(realpathSync(path)) !== realpathSync(root) || stat.size !== asset.bytes) throw new Error('Asset is not a contained verified file.');
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256.toLowerCase()) throw new Error('Asset hash mismatch.');
  return bytes;
}

function waveformsFor(repoRoot, set) {
  if (!set?.waveforms) return null;
  try {
    const metadata = set.waveforms;
    if (!Number.isSafeInteger(metadata.bins) || metadata.bins < 1 || metadata.bins > 10000) throw new Error();
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(verifiedFile(resolve(repoRoot, 'reference-audio/stems'), metadata, 'json')));
    if (data.sourceId !== set.sourceId || data.sourceHash !== set.sourceHash || !Array.isArray(data.tracks) || data.tracks.length !== set.tracks.length) throw new Error();
    const ids = new Set();
    for (const track of data.tracks) {
      if (!set.tracks.some(item => item.id === track.id) || ids.has(track.id) || !Array.isArray(track.peaks) || track.peaks.length !== metadata.bins) throw new Error();
      ids.add(track.id);
      if (track.peaks.some(pair => !Array.isArray(pair) || pair.length !== 2 || !pair.every(value => typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1) || pair[0] > pair[1])) throw new Error();
    }
    return { sourceId: data.sourceId, sourceHash: data.sourceHash, tracks: data.tracks };
  } catch { fail(503, 'The waveform data does not match its verified source.'); }
}

function stemSetFor(repoRoot, source) {
  const root = resolve(repoRoot, 'reference-audio/stems'), path = resolve(root, 'manifest.json');
  if (!existsSync(path)) return null;
  try {
    const manifest = jsonFile(path);
    if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.stemSets)) throw new Error();
    const sets = manifest.stemSets.filter(set => set.sourceId === source.sourceId);
    if (sets.length > 1) throw new Error();
    if (!sets.length) return null;
    const set = sets[0];
    if (!UUID.test(set.id) || set.sourceHash !== source.sourceHash || !['full-source', 'excerpt'].includes(set.coverage) || !Number.isFinite(set.start) || !Number.isFinite(set.end) || set.start < 0 || set.end < set.start + .25 || set.end > source.duration || !Number.isSafeInteger(set.sampleRate) || set.sampleRate <= 0 || !Number.isSafeInteger(set.channels) || set.channels <= 0 || !Number.isSafeInteger(set.frames) || set.frames <= 0 || Math.abs(set.frames - (set.end - set.start) * set.sampleRate) > 1 || !Array.isArray(set.tracks) || !set.tracks.length || set.tracks.length > 16) throw new Error();
    if (set.coverage === 'full-source' && (set.start !== 0 || Math.abs(set.end - source.duration) > 1 / set.sampleRate)) throw new Error();
    const ids = new Set(), files = new Set();
    for (const track of set.tracks) {
      if (!object(track) || typeof track.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(track.id) || ids.has(track.id) || typeof track.label !== 'string' || !track.label.trim() || track.label !== track.label.trim() || track.label.length > 80 || typeof track.file !== 'string' || !/^[A-Za-z0-9_-]+\.(?:wav|flac)$/.test(track.file) || files.has(track.file) || !Number.isSafeInteger(track.bytes) || track.bytes <= 0 || typeof track.sha256 !== 'string' || !HASH.test(track.sha256)) throw new Error();
      ids.add(track.id); files.add(track.file);
      const wav = inspectStemAudio(root, track);
      if (wav.sampleRate !== set.sampleRate || wav.channels !== set.channels || wav.frames !== set.frames) throw new Error();
    }
    if (set.chunks !== undefined) {
      if (!Array.isArray(set.chunks) || !set.chunks.length || set.chunks.length > 10000) throw new Error();
      let nextFrame = 0;
      for (const chunk of set.chunks) {
        if (!object(chunk) || !Number.isSafeInteger(chunk.startFrame) || chunk.startFrame !== nextFrame || !Number.isSafeInteger(chunk.frameCount) || chunk.frameCount <= 0 || chunk.frameCount > set.sampleRate * 30 || nextFrame + chunk.frameCount > set.frames || !Array.isArray(chunk.files) || chunk.files.length !== set.tracks.length) throw new Error();
        const trackIds = new Set();
        for (const file of chunk.files) {
          if (!object(file) || !ids.has(file.trackId) || trackIds.has(file.trackId) || files.has(file.file)) throw new Error();
          trackIds.add(file.trackId); files.add(file.file);
          const actual = inspectStemAudio(root, file);
          if (actual.sampleRate !== set.sampleRate || actual.channels !== set.channels || actual.frames !== chunk.frameCount) throw new Error();
        }
        nextFrame += chunk.frameCount;
      }
      if (nextFrame !== set.frames) throw new Error();
    }
    waveformsFor(repoRoot, set);
    return set;
  } catch { fail(503, 'The stem files do not match their verified manifest.'); }
}

// Read-only build validation: never opens the practice database or creates directories.
export function readVerifiedStemSets(repoRoot) {
  const path = resolve(repoRoot, 'reference-audio/stems/manifest.json');
  if (!existsSync(path)) return [];
  let manifest;
  try { manifest = jsonFile(path); } catch { fail(503, 'The stem manifest is invalid.'); }
  if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.stemSets)) fail(503, 'The stem manifest is invalid.');
  const sources = new Set(), ids = new Set();
  return manifest.stemSets.map(set => {
    if (!object(set) || sources.has(set.sourceId) || ids.has(set.id)) fail(503, 'Duplicate or invalid stem set identity.');
    sources.add(set.sourceId); ids.add(set.id);
    return stemSetFor(repoRoot, sourceIdentity(repoRoot, set.sourceId));
  });
}

export function createPracticeStore({ repoRoot }) {
  const directory = resolve(repoRoot, 'private-data');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(resolve(directory, 'practice.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY, reference_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
      label TEXT NOT NULL, start_seconds REAL NOT NULL, end_seconds REAL NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS sections_source ON sections(reference_id);
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY, reference_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
      type TEXT NOT NULL, text TEXT NOT NULL, start_seconds REAL NOT NULL, end_seconds REAL NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS annotations_source ON annotations(reference_id);`);
  const get = db.prepare('SELECT * FROM sections WHERE id=?');
  const list = db.prepare('SELECT * FROM sections WHERE reference_id=? ORDER BY start_seconds, end_seconds, id');
  const getAnnotation = db.prepare('SELECT * FROM annotations WHERE id=?');
  const listAnnotations = db.prepare('SELECT * FROM annotations WHERE reference_id=? ORDER BY start_seconds, end_seconds, id');
  return {
    read(sourceId) {
      const source = sourceIdentity(repoRoot, sourceId), rows = list.all(source.referenceId);
      if (rows.some(row => row.source_sha256 !== source.sourceHash)) fail(409, 'Saved sections belong to an older source.');
      const annotations = listAnnotations.all(source.referenceId);
      if (annotations.some(row => row.source_sha256 !== source.sourceHash)) fail(409, 'Saved annotations belong to an older source.');
      const stemSet = stemSetFor(repoRoot, source);
      return { sourceId: source.sourceId, sourceHash: source.sourceHash, duration: source.duration, sections: rows.map(sectionView), annotations: annotations.map(annotationView), stemSet, waveforms: waveformsFor(repoRoot, stemSet) };
    },
    create(input) {
      const source = sourceIdentity(repoRoot, input?.sourceId);
      assertHash(input, source);
      if (list.all(source.referenceId).some(row => row.source_sha256 !== source.sourceHash)) fail(409, 'Saved sections belong to an older source.');
      const fields = rangeFields(input, source.duration), id = randomUUID();
      db.prepare('INSERT INTO sections(id,reference_id,source_sha256,label,start_seconds,end_seconds) VALUES(?,?,?,?,?,?)').run(id, source.referenceId, source.sourceHash, fields.label, fields.start, fields.end);
      return sectionView(get.get(id));
    },
    update(id, input) {
      if (typeof id !== 'string' || !UUID.test(id)) fail(400, 'Invalid section identity.');
      const source = sourceIdentity(repoRoot, input?.sourceId);
      assertHash(input, source);
      const row = get.get(id);
      if (!row || row.reference_id !== source.referenceId) fail(404, 'Section not found for this source.');
      if (row.source_sha256 !== source.sourceHash) fail(409, 'Saved sections belong to an older source.');
      if (!Number.isSafeInteger(input.revision) || input.revision < 1) fail(400, 'A section revision is required.');
      const fields = rangeFields(input, source.duration);
      const result = db.prepare('UPDATE sections SET label=?,start_seconds=?,end_seconds=?,revision=revision+1 WHERE id=? AND revision=? AND source_sha256=?').run(fields.label, fields.start, fields.end, id, input.revision, source.sourceHash);
      if (!result.changes) fail(409, 'This section was edited elsewhere. Reload before editing.');
      return sectionView(get.get(id));
    },
    createAnnotation(input) {
      const source = sourceIdentity(repoRoot, input?.sourceId);
      assertHash(input, source);
      if (listAnnotations.all(source.referenceId).some(row => row.source_sha256 !== source.sourceHash)) fail(409, 'Saved annotations belong to an older source.');
      const fields = annotationFields(input, source.duration), id = randomUUID();
      db.prepare('INSERT INTO annotations(id,reference_id,source_sha256,type,text,start_seconds,end_seconds) VALUES(?,?,?,?,?,?,?)').run(id, source.referenceId, source.sourceHash, fields.type, fields.text, fields.start, fields.end);
      return annotationView(getAnnotation.get(id));
    },
    updateAnnotation(id, input) {
      if (typeof id !== 'string' || !UUID.test(id)) fail(400, 'Invalid annotation identity.');
      const source = sourceIdentity(repoRoot, input?.sourceId);
      assertHash(input, source);
      const row = getAnnotation.get(id);
      if (!row || row.reference_id !== source.referenceId) fail(404, 'Annotation not found for this source.');
      if (row.source_sha256 !== source.sourceHash) fail(409, 'Saved annotations belong to an older source.');
      if (!Number.isSafeInteger(input.revision) || input.revision < 1) fail(400, 'An annotation revision is required.');
      const fields = annotationFields(input, source.duration);
      const result = db.prepare('UPDATE annotations SET type=?,text=?,start_seconds=?,end_seconds=?,revision=revision+1 WHERE id=? AND revision=? AND source_sha256=?').run(fields.type, fields.text, fields.start, fields.end, id, input.revision, source.sourceHash);
      if (!result.changes) fail(409, 'This annotation was edited elsewhere. Reload before editing.');
      return annotationView(getAnnotation.get(id));
    },
    close() { db.close(); },
  };
}

async function requestBody(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) fail(415, 'Send JSON with Content-Type application/json.');
  if (Number(req.headers['content-length']) > 16384) fail(413, 'The section request is too large.');
  let size = 0; const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16384) { req.resume(); fail(413, 'The section request is too large.'); }
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { fail(400, 'Invalid JSON.'); }
  if (!object(input)) fail(400, 'A JSON object is required.');
  return input;
}

export function createPracticeHandler({ repoRoot, allowedOrigins }) {
  const origins = new Set(allowedOrigins || []); let store;
  const handler = async (req, res, pathname) => {
    if (pathname !== '/api/practice' && !pathname.startsWith('/api/practice/')) return false;
    const respond = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      if (!['GET', 'POST', 'PUT'].includes(req.method)) fail(405, 'Method not supported.');
      if (req.method !== 'GET' && (typeof req.headers.origin !== 'string' || !origins.has(req.headers.origin))) fail(403, 'This origin cannot edit practice sections.');
      store ||= createPracticeStore({ repoRoot });
      if (req.method === 'GET') {
        if (pathname !== '/api/practice') fail(404, 'Practice endpoint not found.');
        const url = new URL(req.url, 'http://local.invalid');
        if (url.searchParams.getAll('source').length !== 1) fail(400, 'Choose exactly one source.');
        respond(200, store.read(url.searchParams.get('source')));
      } else {
        const input = await requestBody(req);
        if (req.method === 'POST') {
          if (pathname === '/api/practice/annotations') respond(201, { annotation: store.createAnnotation(input) });
          else {
            if (pathname !== '/api/practice') fail(404, 'Practice endpoint not found.');
            respond(201, { section: store.create(input) });
          }
        } else {
          const annotation = pathname.startsWith('/api/practice/annotations/');
          const id = pathname.slice(annotation ? '/api/practice/annotations/'.length : '/api/practice/'.length);
          if (pathname === '/api/practice' || id.includes('/')) fail(404, 'Practice endpoint not found.');
          respond(200, annotation ? { annotation: store.updateAnnotation(id, input) } : { section: store.update(id, input) });
        }
      }
    } catch (error) { respond(error.status || 503, { error: error.status ? error.message : 'Private practice data is unavailable.' }); }
    return true;
  };
  handler.close = () => { store?.close(); store = undefined; };
  return handler;
}
