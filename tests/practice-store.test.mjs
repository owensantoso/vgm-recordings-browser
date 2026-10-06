import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createPracticeStore, createPracticeHandler, inspectWav, inspectFlac, readVerifiedStemSets } from '../scripts/practice-store.mjs';

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
  assert.deepEqual(store.read(f.input.sourceId), { sourceId: f.input.sourceId, sourceHash: f.input.sourceHash, duration: 20, sections: [], annotations: [], stemSet: null, waveforms: null });
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

test('chords and notes persist exact source ranges, retain IDs, and reject stale or cross-source edits', t => {
  const f=fixture(t), store=createPracticeStore(f), input={sourceId:f.input.sourceId,sourceHash:f.input.sourceHash,type:'chord',text:' Cmaj7 ',start:1.25,end:2.5};
  const chord=store.createAnnotation(input), note=store.createAnnotation({...input,type:'note',text:'Keep the bass quieter\nSecond line',start:3,end:4});
  assert.match(chord.id,/^[0-9a-f-]{36}$/);assert.equal(chord.text,'Cmaj7');assert.equal(chord.revision,1);
  const updated=store.updateAnnotation(chord.id,{...input,text:'Dm7',revision:1});assert.equal(updated.id,chord.id);assert.equal(updated.revision,2);
  assert.throws(()=>store.updateAnnotation(chord.id,{...input,revision:1}),status(409));
  assert.throws(()=>store.updateAnnotation(chord.id,{...input,sourceId:'ref:beta-original',revision:2}),status(404));
  assert.deepEqual(store.read('ref:beta-original').annotations,[]);
  store.close();const reopened=open(t,f);assert.deepEqual(reopened.read(input.sourceId).annotations,[updated,note]);
  for(const fields of [{type:'comment'},{text:''},{text:' '.repeat(3)},{text:'x'.repeat(81)},{start:-1},{end:20.1},{start:1,end:1.24},{start:NaN},{sourceHash:'0'.repeat(64)}])assert.throws(()=>reopened.createAnnotation({...input,...fields}));
  assert.equal(reopened.createAnnotation({...input,type:'note',text:'x'.repeat(2000)}).text.length,2000);
  assert.throws(()=>reopened.createAnnotation({...input,type:'note',text:'x'.repeat(2001)}),status(400));
  const bytes=Buffer.from('Verified replacement');writeFileSync(join(f.repoRoot,'reference-audio',f.asset.audio_file),bytes);f.asset.bytes=bytes.length;f.asset.sha256=hash(bytes);f.saveReceipt();
  assert.throws(()=>reopened.read(input.sourceId),status(409));
  assert.throws(()=>reopened.updateAnnotation(chord.id,{...input,sourceHash:f.asset.sha256,revision:2}),status(409));
});

test('annotation API enforces the same origin/body contract and returns database revisions',async t=>{
  const f=await serverFixture(t),input={sourceId:f.input.sourceId,sourceHash:f.input.sourceHash,type:'note',text:'Timestamp note',start:.5,end:1.5};
  let response=await f.request('/api/practice/annotations',input);assert.equal(response.status,201);const {annotation}=await response.json();
  response=await f.request('/api/practice/annotations/'+annotation.id,{...input,revision:1,text:'Edited'}, {method:'PUT'});assert.equal(response.status,200);assert.equal((await response.json()).annotation.revision,2);
  assert.equal((await f.request('/api/practice/annotations/'+annotation.id,{...input,revision:1},{method:'PUT'})).status,409);
  assert.equal((await f.request('/api/practice/annotations',input,{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await f.request('/api/practice/annotations',{...input,text:'x'.repeat(17000)})).status,413);
  response=await fetch(f.base+'/api/practice?source='+encodeURIComponent(input.sourceId));assert.equal((await response.json()).annotations[0].id,annotation.id);
});

test('version2 shared chunk tables verify exact contiguous source frames and actual WAV assets',t=>{
  const f=fixture(t),stem=stemFixture(f),store=open(t,f);
  stem.set.chunks=[0,4000].map((startFrame,index)=>{
    const file='vocals_'+index+'.wav',bytes=wav({frames:4000});writeFileSync(join(stem.root,file),bytes);
    return{startFrame,frameCount:4000,files:[{trackId:'vocals',file,bytes:bytes.length,sha256:hash(bytes)}]};
  });
  const save=()=>writeFileSync(join(stem.root,'manifest.json'),JSON.stringify({version:2,stemSets:[stem.set]}));save();
  assert.deepEqual(store.read(f.input.sourceId).stemSet.chunks,stem.set.chunks);
  const baseline=structuredClone(stem.set.chunks);
  for(const mutate of [
    chunks=>{chunks[1].startFrame++;},chunks=>{chunks.pop();},chunks=>{chunks[0].frameCount=0;},
    chunks=>{chunks[0].files[0].trackId='bass';},chunks=>{chunks[0].files=[];},
    chunks=>{chunks[0].files[0].file='../vocals.wav';},chunks=>{chunks[0].files[0].sha256='0'.repeat(64);},
    chunks=>{chunks[1].files[0].file=chunks[0].files[0].file;},
    chunks=>{chunks[0].frameCount=3999;chunks[1].startFrame=3999;chunks[1].frameCount=4001;},
  ]){stem.set.chunks=structuredClone(baseline);mutate(stem.set.chunks);save();assert.throws(()=>store.read(f.input.sourceId),status(503));}
});

test('verified waveform peaks match source hash and track identity with bounded numeric bins',t=>{
  const f=fixture(t),stem=stemFixture(f),store=open(t,f);
  const data={sourceId:f.input.sourceId,sourceHash:f.input.sourceHash,tracks:[{id:'vocals',peaks:[[-.5,.6],[-.3,.1]]}]};
  const save=()=>{const bytes=Buffer.from(JSON.stringify(data));writeFileSync(join(stem.root,'waveforms.json'),bytes);stem.set.waveforms={file:'waveforms.json',bytes:bytes.length,sha256:hash(bytes),bins:2};stem.save();};save();
  assert.deepEqual(store.read(f.input.sourceId).waveforms,data);
  const baseline=structuredClone(data);
  for(const mutate of [value=>{value.sourceHash='0'.repeat(64);},value=>{value.tracks[0].id='unknown';},value=>{value.tracks[0].peaks.pop();},value=>{value.tracks[0].peaks[0]=[-2,1];},value=>{value.tracks[0].peaks[0]=[.5,-.5];}]){
    Object.assign(data,structuredClone(baseline));mutate(data);save();assert.throws(()=>store.read(f.input.sourceId),status(503));
  }
  Object.assign(data,baseline);save();writeFileSync(join(stem.root,'waveforms.json'),'tampered');assert.throws(()=>store.read(f.input.sourceId),status(503));
});


test('build validation reads verified stems without creating a database and rejects unknown or duplicate sets',t=>{
  const f=fixture(t);
  assert.deepEqual(readVerifiedStemSets(f.repoRoot),[]);
  const stem=stemFixture(f);
  assert.deepEqual(readVerifiedStemSets(f.repoRoot),[stem.set]);assert.equal(existsSync(join(f.repoRoot,'private-data')),false);
  writeFileSync(join(stem.root,'manifest.json'),JSON.stringify({version:2,stemSets:[stem.set,stem.set]}));
  assert.throws(()=>readVerifiedStemSets(f.repoRoot),status(503));
  writeFileSync(join(stem.root,'manifest.json'),JSON.stringify({version:2,stemSets:[{...stem.set,sourceId:'ref:unknown'}]}));
  assert.throws(()=>readVerifiedStemSets(f.repoRoot),status(400));
  assert.equal(existsSync(join(f.repoRoot,'private-data')),false);
});


function flacHeader({sampleRate=8000,channels=2,frames=8000,bitsPerSample=16}={}) {
  const bytes=Buffer.alloc(42);bytes.write('fLaC');bytes[4]=0x80;bytes.writeUIntBE(34,5,3);
  bytes.writeUInt16BE(4096,8);bytes.writeUInt16BE(4096,10);
  bytes.writeBigUInt64BE((BigInt(sampleRate)<<44n)|(BigInt(channels-1)<<41n)|(BigInt(bitsPerSample-1)<<36n)|BigInt(frames),18);return bytes;
}

test('FLAC STREAMINFO preserves exact frame count, rate/channels and rejects malformed or unsupported headers',()=>{
  assert.deepEqual(inspectFlac(flacHeader()),{sampleRate:8000,channels:2,frames:8000,bitsPerSample:16});
  assert.equal(inspectFlac(flacHeader({frames:12254508,sampleRate:44100})).frames,12254508);
  for(const bytes of [Buffer.from('fLaC'),flacHeader({sampleRate:0}),flacHeader({frames:0}),flacHeader({bitsPerSample:24})])assert.throws(()=>inspectFlac(bytes));
  for(const mutate of [b=>{b.write('RIFF');},b=>{b[4]=0x81;},b=>{b.writeUIntBE(33,5,3);}]){const bytes=flacHeader();mutate(bytes);assert.throws(()=>inspectFlac(bytes));}
});

test('FLAC whole assets and shared chunks use the same verified source/frame/hash containment checks',t=>{
  const f=fixture(t),stem=stemFixture(f),store=open(t,f);
  function asset(file,frames){const bytes=flacHeader({frames});writeFileSync(join(stem.root,file),bytes);return{file,bytes:bytes.length,sha256:hash(bytes)};}
  stem.set.tracks=[{id:'vocals',label:'Vocals',...asset('vocals.flac',8000)}];
  stem.set.chunks=[0,4000].map((startFrame,i)=>({startFrame,frameCount:4000,files:[{trackId:'vocals',...asset('vocals_'+i+'.flac',4000)}]}));stem.save();
  assert.equal(store.read(f.input.sourceId).stemSet.tracks[0].file,'vocals.flac');
  const path=join(stem.root,'vocals_1.flac'),bytes=flacHeader({frames:3999});writeFileSync(path,bytes);Object.assign(stem.set.chunks[1].files[0],{bytes:bytes.length,sha256:hash(bytes)});stem.save();
  assert.throws(()=>store.read(f.input.sourceId),status(503));
  Object.assign(stem.set.chunks[1].files[0],asset('vocals_1.flac',4000));stem.save();writeFileSync(path,'corrupt');assert.throws(()=>store.read(f.input.sourceId),status(503));
});

test('actual ffmpeg lossless FLAC declares the original WAV dimensions and frame count',t=>{
  const f=fixture(t),input=join(f.repoRoot,'original.wav'),output=join(f.repoRoot,'compressed.flac');writeFileSync(input,wav({sampleRate:44100,frames:44100}));
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-c:a','flac',output],{stdio:'pipe'});
  if(result.error?.code==='ENOENT'){t.skip('ffmpeg unavailable');return;}
  assert.equal(result.status,0,result.stderr.toString());assert.deepEqual(inspectFlac(readFileSync(output)),{sampleRate:44100,channels:2,frames:44100,bitsPerSample:16});
});
