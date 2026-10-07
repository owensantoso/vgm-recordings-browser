import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync, linkSync, symlinkSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createJamStore, createJamHandler, validateJamAudio, JAM_LIMITS } from '../scripts/jam-store.mjs';
import { createPracticeStore } from '../scripts/practice-store.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const status = value => error => error.status === value;
function wav({ sampleRate = 8000, channels = 1, frames = 8000 } = {}) {
  const block = channels * 2, bytes = Buffer.alloc(44 + frames * block);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * block, 28); bytes.writeUInt16LE(block, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * block, 40); return bytes;
}
function fixture(t) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'vgm-jam-store-'));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(join(repoRoot, 'data')); mkdirSync(join(repoRoot, 'reference-audio'));
  const bytes = Buffer.from('Verified fixture reference supplied by source producer.');
  const asset = { reference_id:'alpha-original', youtube_id:'Fixture0001', audio_file:'Fixture0001.m4a', duration_seconds:20, audio_format:'m4a', bytes:bytes.length, sha256:hash(bytes) };
  writeFileSync(join(repoRoot, 'data/catalog.json'), JSON.stringify({ songs:[{id:'alpha',title:'Alpha'},{id:'beta',title:'Beta'}], references:[{id:asset.reference_id,youtube_id:asset.youtube_id,kind:'original',label:'Alpha original',song_id:'alpha'}], recordings:[{file:'take alpha.wav',song_id:'alpha'},{file:'take alpha.wav',song_id:'beta'},{file:'unknown.wav',song_id:null}] }));
  writeFileSync(join(repoRoot,'reference-audio',asset.audio_file),bytes);
  writeFileSync(join(repoRoot,'reference-audio/manifest.json'),JSON.stringify({version:1,checked_at:'2026-10-07T00:00:00Z',assets:[asset]}));
  const options = { repoRoot, storageGuard:()=>{}, archiveProbePreflight:()=>true, validateAudio:(path,type)=>validateJamAudio(path,type,{preflight:()=>true}) };
  const store=createJamStore(options); t.after(()=>store.close());
  const source={recording:{kind:'reference',id:asset.reference_id},sha256:asset.sha256,durationSeconds:20};
  const input={schemaVersion:1,captureId:randomUUID(),songId:'alpha',title:'Mic take',instrument:{kind:'custom',label:' Piano '},sections:[],alignment:null,backingMix:null,captureEnd:'stopped'};
  const put=(bytes=wav())=>{const path=join(store.audioRoot,`.test-${randomUUID()}.partial`);writeFileSync(path,bytes);return path;};
  const backing=(changes={})=>({ ...structuredClone(input),captureId:randomUUID(),alignment:{source,sourceAtCaptureZero:5,sourceSecondsPerCaptureSecond:.8,clockBasis:'observed-media-time',estimateProvenance:'Observed audible player time; start uncertainty remains.',coverage:{micStart:.1,micEnd:.8,sourceStart:5.08,sourceEnd:5.64},correctionSeconds:0,correctionReviewed:false},backingMix:{schemaVersion:1,source,mode:'original',playbackRate:.8,masterGain:1,stems:null},...changes });
  return {repoRoot,asset,store,source,input,put,backing,options};
}
function stems(f) {
  const root=join(f.repoRoot,'reference-audio/stems');mkdirSync(root);
  const bytes=wav({channels:2});writeFileSync(join(root,'piano.wav'),bytes);
  const set={id:randomUUID(),sourceId:'ref:alpha-original',sourceHash:f.source.sha256,coverage:'excerpt',start:5,end:6,sampleRate:8000,channels:2,frames:8000,tracks:[{id:'piano',label:'Piano',file:'piano.wav',bytes:bytes.length,sha256:hash(bytes)}]};
  const save=()=>writeFileSync(join(root,'manifest.json'),JSON.stringify({version:1,stemSets:[set]}));save();
  return {set,save,root};
}

test('real WAV decode supplies measured immutable mic metadata; durable retry and correction are separate',async t=>{
  const f=fixture(t),input=f.backing();input.alignment.correctionSeconds=.2;input.alignment.correctionReviewed=true;
  const path=f.put(),first=await f.store.saveFile(input,path,'audio/wav');
  assert.equal(first.id,input.captureId);assert.equal(first.audio.frames,8000);assert.equal(first.audio.durationSeconds,1);assert.equal(first.instrument.label,'Piano');assert.equal(first.alignment.correctionSeconds,.2);assert.equal(first.backingAvailability.available,true);
  const correction=f.store.correct(first.id,{revision:1,correctionSeconds:-.15});
  assert.equal(correction.revision,2);assert.equal(correction.audio.sha256,first.audio.sha256);assert.deepEqual(correction.backingMix,first.backingMix);assert.equal(correction.alignment.sourceAtCaptureZero,5);
  assert.throws(()=>f.store.correct(first.id,{revision:1,correctionSeconds:0}),status(409));assert.throws(()=>f.store.correct(first.id,{revision:2,correctionSeconds:2.01}),status(400));
  const retry=await f.store.saveFile(input,f.put(),'audio/wav');assert.equal(retry.revision,2);assert.equal(retry.alignment.correctionSeconds,-.15);assert.equal(f.store.list('alpha').length,1);
  await assert.rejects(f.store.saveFile({...input,title:'Different immutable title'},f.put(),'audio/wav'),status(409));
  const changed=wav();changed[100]=1;await assert.rejects(f.store.saveFile(input,f.put(changed),'audio/wav'),status(409));
  const second=createJamStore(f.options);assert.equal(second.read(first.id).revision,2);assert.equal(second.read(first.id).audio.sha256,first.audio.sha256);second.close();
});

test('interrupted unaligned overdub keeps its backing; free jam remains distinct, negative anchor permits bounded lead-in',async t=>{
  const f=fixture(t),intended=f.backing({alignment:null,captureEnd:'interrupted'});
  const interrupted=await f.store.saveFile(intended,f.put(),'audio/wav');assert.deepEqual(interrupted.backingMix,intended.backingMix);assert.equal(interrupted.backingAvailability.available,false);assert.match(interrupted.backingAvailability.reason,/No continuous alignment/);
  const free=await f.store.saveFile(f.input,f.put(),'audio/wav');assert.equal(free.backingMix,null);assert.match(free.backingAvailability.reason,/free jam/);assert.throws(()=>f.store.correct(free.id,{revision:1,correctionSeconds:.1}),status(400));
  const lead=f.backing();lead.alignment.sourceAtCaptureZero=-.08;lead.alignment.coverage={micStart:.1,micEnd:.8,sourceStart:0,sourceEnd:.56};assert.equal((await f.store.saveFile(lead,f.put(),'audio/wav')).alignment.sourceAtCaptureZero,-.08);
});

test('exact stem snapshots, bounded coverage and semantic section UUIDs are validated independently',async t=>{
  const f=fixture(t),stem=stems(f),practice=createPracticeStore(f.options);const section=practice.create({sourceId:'ref:alpha-original',sourceHash:f.source.sha256,label:'Verse',start:5,end:5.5});practice.close();
  const ctx=f.store.context(f.source.recording),input=f.backing();
  input.backingMix.mode='stems';input.backingMix.stems={setId:ctx.stemSet.id,revision:ctx.stemSet.revision,tracks:ctx.stemSet.tracks.map(track=>({id:track.id,assetHash:track.assetHash,level:1.75,muted:false,solo:true}))};
  input.instrument={kind:'stem',source:f.source,stemSetId:ctx.stemSet.id,stemSetRevision:ctx.stemSet.revision,trackId:'piano',labelSnapshot:'Piano'};input.sections=[{source:f.source,sectionId:section.id,sectionRevision:1,labelSnapshot:'Verse'}];
  const jam=await f.store.saveFile(input,f.put(),'audio/wav');assert.equal(jam.backingAvailability.available,true);assert.equal(jam.sectionAvailability[0].current,true);assert.equal(jam.sections[0].sectionId,section.id);
  for (const mutate of [i=>i.backingMix.stems.revision='0'.repeat(64),i=>i.backingMix.stems.tracks[0].assetHash='0'.repeat(64),i=>i.backingMix.stems.tracks[0].level=2.01,i=>i.alignment.coverage.sourceEnd=6.01,i=>i.sections[0].sectionRevision=2]) {const bad=structuredClone(input);bad.captureId=randomUUID();mutate(bad);await assert.rejects(f.store.saveFile(bad,f.put(),'audio/wav'));}
  const renamed=createPracticeStore(f.options);renamed.update(section.id,{sourceId:'ref:alpha-original',sourceHash:f.source.sha256,label:'Verse 1',start:5,end:5.5,revision:1});renamed.close();
  assert.equal(f.store.read(jam.id).sectionAvailability[0].current,false);assert.equal(f.store.read(jam.id).sections[0].labelSnapshot,'Verse');
  stem.set.tracks[0].label='Keyboard';stem.save();assert.equal(f.store.read(jam.id).backingAvailability.available,true); // labels alone do not change audio/mix revision.
});

test('stale backing is explicit mic-only, retries survive drift and mic bytes stay immutable',async t=>{
  const f=fixture(t),input=f.backing(),jam=await f.store.saveFile(input,f.put(),'audio/wav');
  writeFileSync(join(f.repoRoot,'reference-audio',f.asset.audio_file),'changed source');
  const current=f.store.read(jam.id);assert.equal(current.backingAvailability.available,false);assert.match(current.backingAvailability.reason,/unavailable|changed/);assert.equal(f.store.audio(jam.id).sha256,jam.audio.sha256);
  assert.equal((await f.store.saveFile(input,f.put(),'audio/wav')).id,jam.id);
  const bad=f.backing();await assert.rejects(f.store.saveFile(bad,f.put(),'audio/wav'),status(409));
  const raw=f.store.audio(jam.id).path;writeFileSync(raw,Buffer.from('changed mic'));assert.throws(()=>f.store.audio(jam.id),status(503));
});

test('same-content orphan after file publication recovers; incompatible orphan and client paths remain untouched',async t=>{
  const f=fixture(t),path=f.put(),destination=join(f.store.audioRoot,`${f.input.captureId}.wav`);linkSync(path,destination);
  const jam=await f.store.saveFile(f.input,f.put(),'audio/wav');assert.equal(jam.id,f.input.captureId);assert.equal(f.store.list('alpha').length,1);
  const other={...f.input,captureId:randomUUID()},otherFile=join(f.store.audioRoot,`${other.captureId}.wav`);writeFileSync(otherFile,'unknown orphan');await assert.rejects(f.store.saveFile(other,f.put(),'audio/wav'),status(409));assert.equal(readFileSync(otherFile,'utf8'),'unknown orphan');
  await assert.rejects(f.store.saveFile({...f.input,captureId:randomUUID(),audioPath:'../../secret'},f.put(),'audio/wav'),status(400));
  const outside=join(f.repoRoot,'outside.wav');writeFileSync(outside,wav());await assert.rejects(f.store.saveFile({...f.input,captureId:randomUUID()},outside,'audio/wav'),status(400));
  const link=join(f.store.audioRoot,'symlink.partial');symlinkSync(outside,link);await assert.rejects(f.store.saveFile({...f.input,captureId:randomUUID()},link,'audio/wav'),status(400));
});

test('actual encoded containers are decoded, with bounded codec tail, channels, format and decoded duration',async t=>{
  const f=fixture(t);
  for (const [extension,codec,type] of [['webm','libopus','audio/webm;codecs=opus'],['ogg','libopus','audio/ogg;codecs=opus'],['m4a','aac','audio/mp4']]) {
    const input=f.put(),output=join(f.store.audioRoot,`valid.${extension}`);const produced=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',input,'-c:a',codec,output]);assert.equal(produced.status,0,produced.stderr?.toString());
    const actual=await validateJamAudio(output,type,{preflight:()=>true});assert.ok(actual.durationSeconds>=.99&&actual.durationSeconds<=1.1);assert.equal(actual.channels,1);
  }
  const tail=await validateJamAudio(f.put(wav({frames:8000*120.25})),'audio/wav',{preflight:()=>true});assert.equal(tail.durationSeconds,120.25);
  await assert.rejects(validateJamAudio(f.put(wav({frames:8000*121})),'audio/wav',{preflight:()=>true}),status(422));
  await assert.rejects(validateJamAudio(f.put(wav({channels:3})),'audio/wav',{preflight:()=>true}),status(422));
  await assert.rejects(validateJamAudio(f.put(),'audio/webm',{preflight:()=>true}),status(422));
  await assert.rejects(validateJamAudio(f.put(Buffer.from('not encoded audio')),'audio/wav',{preflight:()=>true}),status(422));
  await assert.rejects(validateJamAudio(f.put(),'audio/mpeg',{preflight:()=>true}),status(415));
  const tooLarge=f.put();truncateSync(tooLarge,JAM_LIMITS.encodedBytes+1);await assert.rejects(f.store.saveFile(f.input,tooLarge,'audio/wav'),status(400));
});

test('comments retain song context, explicit recording clocks, all timestamps and idempotent UUIDs',async t=>{
  const f=fixture(t),jam=await f.store.saveFile(f.input,f.put(),'audio/wav'),mic=f.store.context({kind:'jam',id:jam.id}).audio;
  const target={kind:'recording',recording:f.source.recording,at:null};const input={id:randomUUID(),songId:'alpha',target,instrument:null,text:'Phrase shape'};
  const untimed=f.store.comment(input);assert.equal(f.store.comment(input).id,untimed.id);assert.throws(()=>f.store.comment({...input,text:'Changed'}),status(409));
  const point=f.store.comment({...input,id:randomUUID(),target:{...target,at:{kind:'point',seconds:5,audio:f.source}}});
  const range=f.store.comment({...input,id:randomUUID(),target:{...target,at:{kind:'range',start:4,end:6,audio:f.source}}});assert.equal(f.store.comments(target,'alpha').length,3);assert.equal(point.target.at.seconds,5);assert.equal(range.target.at.end,6);
  assert.throws(()=>f.store.comment({...input,id:randomUUID(),songId:'beta'}),status(400));
  assert.throws(()=>f.store.comment({...input,id:randomUUID(),target:{...target,at:{kind:'point',seconds:0,audio:mic}}}),status(400));
  assert.throws(()=>f.store.comment({...input,id:randomUUID(),target:{kind:'recording',recording:{kind:'archive',id:'take alpha.wav'},at:{kind:'point',seconds:0,audio:f.source}}}),status(400));
  const archive=f.store.comment({...input,id:randomUUID(),songId:'beta',target:{kind:'recording',recording:{kind:'archive',id:'take alpha.wav'},at:null}});assert.equal(archive.songId,'beta');
  assert.throws(()=>f.store.comment({...input,id:randomUUID(),songId:null,target:archive.target}),status(400));
  const unknown=f.store.comment({...input,id:randomUUID(),songId:null,target:{kind:'recording',recording:{kind:'archive',id:'unknown.wav'},at:null}});assert.equal(unknown.songId,null);
  const song=f.store.comment({...input,id:randomUUID(),target:{kind:'song',songId:'alpha'}});assert.equal(f.store.comments(song.target,'alpha').length,1);
  writeFileSync(join(f.repoRoot,'reference-audio',f.asset.audio_file),'changed');assert.equal(f.store.comment(input).id,untimed.id);assert.equal(f.store.comments(target,'alpha').length,3);
});

test('archive comments use measured local audio and hash; CSV duration and changed files cannot forge a clock',t=>{
  const f=fixture(t),ref={kind:'archive',id:'take alpha.wav'},root=join(f.repoRoot,'audio');mkdirSync(root);
  const writeCsv=(file='take, audio.wav')=>writeFileSync(join(f.repoRoot,'data/recordings.csv'),`file,audio_file,duration_seconds\n"take alpha.wav","${file}",999\n`);
  writeCsv();assert.equal(f.store.context(ref).audio,null);
  const bytes=wav({frames:16000}),path=join(root,'take, audio.wav');writeFileSync(path,bytes);
  const audio=f.store.context(ref).audio;
  assert.deepEqual(audio,{recording:ref,sha256:hash(bytes),durationSeconds:2});
  assert.deepEqual(f.store.context(ref).audio,audio);
  const target={kind:'recording',recording:ref,at:{kind:'point',seconds:1.5,audio}};
  const input={id:randomUUID(),songId:'alpha',target,instrument:{kind:'custom',label:'Piano'},text:'Our fill here'};
  const point=f.store.comment(input);assert.deepEqual(point.target,target);
  const range=f.store.comment({...input,id:randomUUID(),songId:'beta',target:{...target,at:{kind:'range',start:.5,end:1.5,audio}}});assert.equal(range.target.at.end,1.5);
  assert.throws(()=>f.store.comment({...input,id:randomUUID(),target:{...target,at:{kind:'point',seconds:2.1,audio}}}),status(400));
  assert.throws(()=>f.store.comment({...input,id:randomUUID(),target:{...target,at:{kind:'point',seconds:1,audio:{...audio,durationSeconds:999}}}}),status(409));
  const sameSize=Buffer.from(bytes);sameSize[100]=1;writeFileSync(path,sameSize);
  assert.deepEqual(f.store.context(ref).audio,{recording:ref,sha256:hash(sameSize),durationSeconds:2});
  assert.throws(()=>f.store.comment({...input,id:randomUUID()}),status(409));
  const changed=wav({frames:8000});writeFileSync(path,changed);
  assert.deepEqual(f.store.context(ref).audio,{recording:ref,sha256:hash(changed),durationSeconds:1});
  assert.throws(()=>f.store.comment({...input,id:randomUUID()}),status(409));
  assert.equal(f.store.comment(input).id,point.id); // A persisted retry remains the same historical comment.
  assert.equal(f.store.comments({...target,at:null},'alpha').length,1);
  writeCsv('missing.wav');assert.equal(f.store.context(ref).audio,null);
  assert.throws(()=>f.store.comment({...input,id:randomUUID()}),status(409));
});

test('archive local audio mapping rejects traversal, external paths, symlinks and malformed media',t=>{
  const f=fixture(t),ref={kind:'archive',id:'take alpha.wav'},root=join(f.repoRoot,'audio');mkdirSync(root);
  const outside=join(f.repoRoot,'outside.wav');writeFileSync(outside,wav());
  const map=file=>writeFileSync(join(f.repoRoot,'data/recordings.csv'),`file,audio_file\n"take alpha.wav","${file}"\n`);
  for(const name of ['../outside.wav',outside,'https://example.test/audio.wav','nested/file.wav','..\\outside.wav','.']) {map(name);assert.equal(f.store.context(ref).audio,null,name);}
  symlinkSync(outside,join(root,'linked.wav'));map('linked.wav');assert.equal(f.store.context(ref).audio,null);
  writeFileSync(join(root,'invalid.wav'),'not audio');map('invalid.wav');assert.equal(f.store.context(ref).audio,null);
  // Missing verification affects timing, not the archive's untimed note identity.
  const note=f.store.comment({id:randomUUID(),songId:'alpha',target:{kind:'recording',recording:ref,at:null},instrument:null,text:'Untimed rehearsal note'});assert.equal(note.target.at,null);
  rmSync(root,{recursive:true});mkdirSync(join(f.repoRoot,'external-audio'));writeFileSync(join(f.repoRoot,'external-audio/valid.wav'),wav());symlinkSync(join(f.repoRoot,'external-audio'),root);map('valid.wav');assert.equal(f.store.context(ref).audio,null);
});

test('free jam can name song-associated stem; its comment keeps saved instrument despite stem drift',async t=>{
  const f=fixture(t),stem=stems(f),ctx=f.store.context(f.source.recording);f.input.instrument={kind:'stem',source:f.source,stemSetId:ctx.stemSet.id,stemSetRevision:ctx.stemSet.revision,trackId:'piano',labelSnapshot:'Piano'};
  const jam=await f.store.saveFile(f.input,f.put(),'audio/wav');writeFileSync(join(stem.root,'piano.wav'),'changed');
  const comment=f.store.comment({id:randomUUID(),songId:'alpha',target:{kind:'recording',recording:{kind:'jam',id:jam.id},at:null},instrument:jam.instrument,text:'My piano take'});assert.deepEqual(comment.instrument,jam.instrument);
  assert.throws(()=>f.store.comment({...comment,id:randomUUID(),actor:undefined}),status(400));
});

async function serverFixture(t,changes={}) {
  const f=fixture(t),handler=createJamHandler({...f.options,allowedOrigins:['https://music.example'],...changes});
  const server=createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://local').pathname)){res.writeHead(404);res.end();}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));handler.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const upload=(input=f.input,bytes=wav(),headers={})=>fetch(base+'/api/jams',{method:'POST',headers:{Origin:'https://music.example','Content-Type':'audio/wav','X-Jam-Metadata':encodeURIComponent(JSON.stringify(input)),...headers},body:bytes});
  return {...f,base,upload};
}
test('private HTTP upload/list/context/detail and exact single byte Range work without public CORS',async t=>{
  const f=await serverFixture(t);let response=await f.upload();assert.equal(response.status,201);const {jam}=await response.json();
  assert.equal((await f.upload()).status,201);assert.equal((await(await fetch(f.base+'/api/jams?song=alpha')).json()).jams.length,1);
  response=await fetch(f.base+`/api/jams/${jam.id}`);assert.equal((await response.json()).jam.id,jam.id);assert.equal(response.headers.get('access-control-allow-origin'),null);
  response=await fetch(f.base+'/api/jams/context?kind=reference&id=alpha-original');assert.deepEqual((await response.json()).songIds,['alpha']);
  const url=f.base+`/api/jams/${jam.id}/audio`;response=await fetch(url,{headers:{Range:'bytes=0-11'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 0-11/${wav().length}`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),wav().subarray(0,12));
  response=await fetch(url,{headers:{Range:'bytes=-4'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,4);
  response=await fetch(url,{method:'HEAD'});assert.equal(response.status,200);assert.equal(response.headers.get('content-length'),String(wav().length));
  for(const Range of ['bytes=999999-','bytes=2-1','bytes=1-2,4-5','bytes=-0']){response=await fetch(url,{headers:{Range}});assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),`bytes */${wav().length}`);}
  assert.equal(readdirSync(f.store.audioRoot).filter(x=>x.startsWith('.upload-')).length,0);
});

test('HTTP rejects forged/missing origins, client paths, metadata and streaming size limits; storage fails closed',async t=>{
  const f=await serverFixture(t);
  for(const Origin of ['','null','https://music.example.evil','http://music.example'])assert.equal((await f.upload(undefined,undefined,{Origin})).status,403);
  assert.equal((await f.upload({...f.input,audioPath:'/tmp/private'})).status,400);
  assert.equal((await f.upload(undefined,Buffer.from('invalid encoded'))).status,422);
  assert.equal((await f.upload(undefined,undefined,{'X-Jam-Metadata':'{bad'})).status,400);
  assert.equal((await f.upload(undefined,undefined,{'Content-Type':'audio/mpeg'})).status,415);
  assert.equal((await fetch(f.base+'/api/jams',{method:'DELETE'})).status,405);
  assert.equal((await fetch(f.base+'/api/jams?song=alpha',{headers:{Origin:'https://evil.example'}})).status,403);
  const declared=await new Promise((done,reject)=>{const req=httpRequest(f.base+'/api/jams',{agent:false,method:'POST',headers:{Origin:'https://music.example','Content-Type':'audio/wav','X-Jam-Metadata':encodeURIComponent(JSON.stringify(f.input)),'Content-Length':JAM_LIMITS.encodedBytes+1}},res=>{res.resume();res.on('end',()=>done(res.statusCode));});req.on('error',error=>reject(new Error('declared: '+error.message)));req.write(Buffer.from('x'));req.end();});assert.equal(declared,413);
  const streamed=await new Promise((done,reject)=>{const req=httpRequest(f.base+'/api/jams',{agent:false,method:'POST',headers:{Origin:'https://music.example','Content-Type':'audio/wav','X-Jam-Metadata':encodeURIComponent(JSON.stringify(f.input))}},res=>{res.resume();res.on('end',()=>done(res.statusCode));});req.on('error',error=>reject(new Error('streamed: '+error.message)));const block=Buffer.alloc(1024*1024);for(let i=0;i<33;i++)req.write(block);req.end();});assert.equal(streamed,413);
  assert.equal(readdirSync(f.store.audioRoot).filter(x=>x.startsWith('.upload-')).length,0);
  const blocked=await serverFixture(t,{storageGuard:()=>{throw Object.assign(new Error('Guard blocked'),{status:507});}});assert.equal((await blocked.upload()).status,507);assert.equal(readdirSync(blocked.store.audioRoot).length,0);
});

test('HTTP comment retries preserve UUID and initial reviewed correction saves then edits with revisions',async t=>{
  const f=await serverFixture(t),input=f.backing();input.alignment.correctionSeconds=.15;input.alignment.correctionReviewed=true;
  let response=await f.upload(input);assert.equal(response.status,201);const {jam}=await response.json();assert.equal(jam.alignment.correctionSeconds,.15);
  response=await fetch(f.base+`/api/jams/${jam.id}/correction`,{method:'PUT',headers:{Origin:'https://music.example','Content-Type':'application/json'},body:JSON.stringify({revision:1,correctionSeconds:-.1})});assert.equal(response.status,200);assert.equal((await response.json()).jam.alignment.correctionSeconds,-.1);
  const comment={id:randomUUID(),songId:'alpha',target:{kind:'recording',recording:{kind:'jam',id:jam.id},at:{kind:'point',seconds:.5,audio:{recording:{kind:'jam',id:jam.id},sha256:jam.audio.sha256,durationSeconds:jam.audio.durationSeconds}}},instrument:null,text:'Phrase here'};
  const post=()=>fetch(f.base+'/api/jam-comments',{method:'POST',headers:{Origin:'https://music.example','Content-Type':'application/json'},body:JSON.stringify(comment)});
  assert.equal((await post()).status,201);assert.equal((await post()).status,201);
  const query=new URLSearchParams({target:JSON.stringify({...comment.target,at:null}),song:'alpha'});response=await fetch(f.base+'/api/jam-comments?'+query);assert.equal((await response.json()).comments.length,1);
});


test('Mac decoder capability works with launchd-like system PATH', {skip:process.platform!=='darwin'},async t=>{
  const f=fixture(t),path=f.put(),previous=process.env.PATH;
  process.env.PATH='/usr/bin:/bin';
  try {const decoded=await validateJamAudio(path,'audio/wav');assert.equal(decoded.frames,8000);}
  finally {if(previous===undefined)delete process.env.PATH;else process.env.PATH=previous;}
});
