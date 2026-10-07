import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, lstatSync, realpathSync, openSync, closeSync, readSync, linkSync, unlinkSync, statfsSync, fsyncSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createPracticeStore } from './practice-store.mjs';

export const JAM_LIMITS = Object.freeze({ encodedBytes: 32 * 1024 ** 2, durationSeconds: 120.5, captureSeconds: 120, decodedBytes: 120.5 * 48000 * 2 * 4, metadataBytes: 12000 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MIME = new Map([['audio/webm', 'webm'], ['audio/ogg', 'ogg'], ['audio/mp4', 'm4a'], ['audio/wav', 'wav']]);
const actor = { kind: 'local', label: 'Local practice' };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const equal = (a, b) => canonical(a) === canonical(b);
function canonical(x) { return JSON.stringify(sort(x)); }
function sort(x) { return Array.isArray(x) ? x.map(sort) : object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x; }
function fields(x, required) {
  if (!object(x) || Object.keys(x).length !== required.length || required.some(k => !Object.hasOwn(x, k))) fail(400, 'Unexpected or missing fields. Client file paths are never accepted.');
}
function label(x, max = 80) { if (typeof x !== 'string' || !x.trim() || x.trim().length > max) fail(400, `Use text from 1 to ${max} characters.`); return x.trim(); }
function uuid(x) { if (typeof x !== 'string' || !UUID.test(x)) fail(400, 'Invalid UUID identity.'); return x.toLowerCase(); }
function recording(x) { fields(x, ['kind', 'id']); if (!['reference', 'archive', 'jam'].includes(x.kind) || typeof x.id !== 'string' || !x.id || x.id.length > 300) fail(400, 'Invalid recording identity.'); if (x.kind === 'jam' && uuid(x.id) !== x.id) fail(400,'Use the canonical lower-case jam UUID.'); return x; }
function exact(x) { fields(x, ['recording', 'sha256', 'durationSeconds']); recording(x.recording); if (!HASH.test(x.sha256 || '') || !finite(x.durationSeconds) || x.durationSeconds <= 0) fail(400, 'Invalid exact audio identity.'); return x; }
function mime(value) {
  if (typeof value !== 'string' || !/^audio\/(?:webm|ogg|mp4|wav)(?:\s*;\s*codecs=(?:"?(?:opus|vorbis|mp4a\.40\.2)"?))?$/i.test(value)) fail(415, 'Use supported WebM/Opus, Ogg, MP4/AAC or WAV microphone audio.');
  return value.split(';')[0].trim().toLowerCase();
}
function fileHash(path) {
  const fd = openSync(path, 'r'), buffer = Buffer.allocUnsafe(1024 * 1024), hash = createHash('sha256');
  try { for (let n; (n = readSync(fd, buffer)) > 0;) hash.update(buffer.subarray(0, n)); } finally { closeSync(fd); }
  return hash.digest('hex');
}
// Revision v1: canonical JSON of this immutable, source-scoped subset; no manifest-wide hash.
export function stemRevision(set) {
  return createHash('sha256').update(canonical({ sourceHash: set.sourceHash, coverage: set.coverage, start: set.start, end: set.end, sampleRate: set.sampleRate, channels: set.channels, frames: set.frames,
    tracks: set.tracks.map(t => ({ id: t.id, sha256: t.sha256 })).sort((a,b) => a.id.localeCompare(b.id)),
    chunks: set.chunks?.map(g => ({ startFrame: g.startFrame, frameCount: g.frameCount, files: g.files.map(f => ({ trackId: f.trackId, sha256: f.sha256 })).sort((a,b) => a.trackId.localeCompare(b.trackId)) })) ?? null })).digest('hex');
}
export function jamStorageGuard() {
  const guard = resolve(process.env.HOME, '.local/bin/owen-storage-history');
  const result = spawnSync(guard, ['pressure-status', '--quiet'], { timeout: 10000, stdio: 'ignore' });
  if (![0, 11].includes(result.status)) fail(507, 'Microphone upload is paused by the storage guard. Keep or download your draft.');
  const disk = statfsSync('/System/Volumes/Data');
  if (Number(disk.bavail) * Number(disk.bsize) < 5 * 1024 ** 3 + JAM_LIMITS.encodedBytes) fail(507, 'Not enough private storage headroom. Keep or download your draft.');
}
function processPreflight(scope) {
  const result = spawnSync('python3', [resolve(process.env.HOME, '.codex/skills/critical-incident-response/scripts/incident_lock.py'), 'preflight', '--action', 'process-control', '--scope', scope], { timeout: 10000, stdio: 'ignore' });
  return result.status === 0;
}
function runTool(command, args, { byteLimit = 1024 ** 2, countOnly = false, preflight = processPreflight } = {}) {
  const macTool=resolve('/opt/homebrew/bin',command);
  if (process.platform==='darwin' && existsSync(macTool)) command=macTool;
  return new Promise((resolveResult, reject) => {
    // This handle owns one validation child; launch identity and the two-attempt budget stay local.
    const workingRoot = process.cwd(), child = spawn(command, args, { cwd: workingRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0, stderr = '', chunks = [], terminalError, identity, escalation;
    const snapshot = () => {
      const current=spawnSync('ps', ['-p', String(child.pid), '-o', 'lstart=', '-o', 'ppid=', '-o', 'stat=', '-o', 'command='], { encoding:'utf8', timeout:2000 });
      const parts=/^(.+?\d{4})\s+(\d+)\s+(\S+)\s+(.+)$/.exec(current.stdout?.trim() ?? '');
      if (!parts || parts[3].startsWith('Z')) return null;
      return canonical({birth:parts[1],parent:Number(parts[2]),command:parts[4],workingRoot});
    };
    child.once('spawn', () => { identity = snapshot(); });
    const timer = setTimeout(() => stop('Audio validation timed out.'), 15000);
    function permitted() {
      const current=snapshot();
      if (!current || child.exitCode !== null || child.signalCode !== null) return null;
      return Boolean(identity && identity === current && preflight(`jam-audio-validation-${child.pid}`));
    }
    function stop(message) {
      if (terminalError || child.exitCode !== null || child.signalCode !== null) return;
      terminalError = Object.assign(new Error(message), { status: 422 });
      const permission=permitted();
      if (permission === null) return;
      if (!permission) { reject(Object.assign(new Error('Audio validation cancellation is blocked by the process-control guard.'), { status: 503 })); return; }
      child.kill('SIGTERM');
      escalation = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const permission=permitted();
        if (permission === null) return;
        if (permission) child.kill('SIGKILL');
        else reject(Object.assign(new Error('Audio validation escalation is blocked by the process-control guard.'), { status: 503 }));
      }, 5000);
    }
    child.stdout.on('data', data => { bytes += data.length; if (bytes > byteLimit) stop('Decoded audio exceeds the microphone recording limits.'); else if (!countOnly) chunks.push(data); });
    child.stderr.on('data', data => { if (stderr.length < 4096) stderr += data.toString().slice(0, 4096 - stderr.length); });
    child.on('error', error => { clearTimeout(timer); clearTimeout(escalation); reject(Object.assign(new Error(error.code==='ENOENT'?'Private microphone decoding is unavailable on this server. Keep or download your draft.':'Microphone validation could not start.'), { status:503 })); });
    child.on('close', code => { clearTimeout(timer); clearTimeout(escalation); if (terminalError) reject(terminalError); else if (code !== 0) reject(Object.assign(new Error('Microphone audio could not be decoded.'), { status: 422 })); else resolveResult(countOnly ? bytes : Buffer.concat(chunks)); });
  });
}
export async function validateJamAudio(path, contentType, options = {}) {
  const type = mime(contentType);
  const format={'audio/webm':'matroska','audio/ogg':'ogg','audio/mp4':'mov','audio/wav':'wav'}[type];
  const demuxer=['-max_alloc','67108864','-threads','1','-protocol_whitelist','file,pipe','-f',format,...(type==='audio/mp4'?['-enable_drefs','0','-use_absolute_path','0']:[])];
  let info;
  try { info = JSON.parse((await runTool('ffprobe', ['-v','error',...demuxer,'-show_entries','format=format_name:stream=codec_type,codec_name,sample_rate,channels','-of','json',path], options)).toString()); }
  catch (error) { if (error.status) throw error; fail(422, 'Invalid microphone container.'); }
  if (info.streams?.length !== 1 || info.streams[0].codec_type !== 'audio') fail(422, 'Upload one audio stream without video or extra streams.');
  const stream = info.streams[0], sampleRate = Number(stream.sample_rate), channels = Number(stream.channels), formats = info.format?.format_name?.split(',') || [];
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000 || ![1, 2].includes(channels)) fail(422, 'Mic audio must use one or two channels at 8–48 kHz.');
  const expected = { 'audio/webm': ['matroska','webm'], 'audio/ogg': ['ogg'], 'audio/mp4': ['mov','mp4','m4a'], 'audio/wav': ['wav'] }[type];
  if (!expected.some(f => formats.includes(f)) || !['opus','vorbis','aac','pcm_s16le','pcm_s24le','pcm_f32le'].includes(stream.codec_name)) fail(422, 'Container or codec does not match the supported microphone format.');
  const bytes = await runTool('ffmpeg', ['-hide_banner','-loglevel','error','-xerror',...demuxer,'-i',path,'-map','0:a:0','-t',String(JAM_LIMITS.durationSeconds + .01),'-f','f32le','-c:a','pcm_f32le','pipe:1'], { ...options, byteLimit: Math.min(JAM_LIMITS.decodedBytes, sampleRate * channels * 4 * JAM_LIMITS.durationSeconds), countOnly: true });
  const frames = bytes / (channels * 4);
  if (!Number.isSafeInteger(frames) || frames < 1 || frames / sampleRate > JAM_LIMITS.durationSeconds) fail(422, 'Mic duration must be positive and at most 120.5 seconds (including codec finalization).');
  return { mimeType: type, sampleRate, channels, frames, durationSeconds: frames / sampleRate };
}

export function createJamStore({ repoRoot, storageGuard = jamStorageGuard, validateAudio = validateJamAudio }) {
  const root = resolve(repoRoot, 'private-data'), audioRoot = resolve(root, 'jam-audio');
  mkdirSync(audioRoot, { recursive: true });
  const db = new DatabaseSync(resolve(root, 'jams.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS jams(id TEXT PRIMARY KEY, song_id TEXT NOT NULL, capture_json TEXT NOT NULL, audio_json TEXT NOT NULL, audio_file TEXT NOT NULL, created_at TEXT NOT NULL, correction REAL NOT NULL DEFAULT 0, correction_reviewed INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS jams_song ON jams(song_id);
    CREATE TABLE IF NOT EXISTS jam_comments(id TEXT PRIMARY KEY, song_id TEXT, target_key TEXT NOT NULL, body_json TEXT NOT NULL, created_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS jam_comments_target ON jam_comments(target_key, song_id);`);
  const get = db.prepare('SELECT * FROM jams WHERE id=?');
  const practice = createPracticeStore({ repoRoot });
  function catalog() { return JSON.parse(readFileSync(resolve(repoRoot, 'data/catalog.json'), 'utf8')); }
  function song(id) { if (typeof id !== 'string' || !catalog().songs?.some(s => s.id === id)) fail(400, 'Choose an existing song.'); }
  function audioFile(row) {
    if (!row || !new RegExp(`^${row.id}\\.(?:webm|ogg|m4a|wav)$`).test(row.audio_file)) fail(503, 'Saved microphone audio is unavailable.');
    const path = resolve(audioRoot, row.audio_file), data = JSON.parse(row.audio_json);
    try { const stat = lstatSync(path); if (!stat.isFile() || dirname(realpathSync(path)) !== realpathSync(audioRoot) || stat.size !== data.bytes || fileHash(path) !== data.sha256) throw new Error(); }
    catch { fail(503, 'Saved microphone audio is unavailable or changed.'); }
    return path;
  }
  function context(ref) {
    recording(ref); const data = catalog();
    if (ref.kind === 'reference') {
      const item = data.references?.find(r => r.id === ref.id); if (!item) fail(404, 'Reference not found.');
      let source = null;
      try { source = practice.read('ref:' + ref.id); } catch { /* Untimed comments still belong to this recording. */ }
      return { recording: ref, songIds: [item.song_id], label: item.label, audio: source ? { recording: ref, sha256: source.sourceHash, durationSeconds: source.duration } : null,
        stemSet: source?.stemSet ? { id: source.stemSet.id, revision: stemRevision(source.stemSet), start: source.stemSet.start, end: source.stemSet.end, tracks: source.stemSet.tracks.map(t => ({ id: t.id, label: t.label, assetHash: t.sha256 })) } : null,
        sections: source?.sections.map(s => ({ id: s.id, label: s.label, revision: s.revision })) ?? [] };
    }
    if (ref.kind === 'archive') {
      const rows = data.recordings?.filter(r => r.file === ref.id) ?? []; if (!rows.length) fail(404, 'Archive recording not found.');
      return { recording: ref, songIds: [...new Set(rows.map(r => r.song_id).filter(Boolean))], label: ref.id, audio: null, stemSet: null, sections: [] };
    }
    const row = get.get(uuid(ref.id)); if (!row) fail(404, 'Jam not found.');
    let audio = null;
    try { audioFile(row); const a = JSON.parse(row.audio_json); audio = { recording: ref, sha256: a.sha256, durationSeconds: a.durationSeconds }; } catch {}
    return { recording: ref, songIds: [row.song_id], label: JSON.parse(row.capture_json).title, audio, stemSet: null, sections: [] };
  }
  function assertAudio(value, songId, { backing = false } = {}) {
    exact(value); const c = context(value.recording);
    if (songId !== null && !c.songIds.includes(songId)) fail(400, 'The recording belongs to a different song.');
    if (backing && value.recording.kind !== 'reference') fail(400, 'Use a verified local reference for backing capture.');
    if (!c.audio || !equal(c.audio, value)) fail(409, 'Exact source audio is unavailable or changed.');
    return c;
  }
  function instrument(value, songId, target = null) {
    if (value === null) return null;
    if (!object(value)) fail(400, 'Invalid playing instrument.');
    if (value.kind === 'custom') { fields(value,['kind','label']); return { kind:'custom', label:label(value.label) }; }
    fields(value,['kind','source','stemSetId','stemSetRevision','trackId','labelSnapshot']);
    if (value.kind !== 'stem' || songId === null) fail(400, 'Choose a song-associated stem instrument or a custom label.');
    if (target?.kind === 'jam') {
      const saved = get.get(uuid(target.id));
      if (saved && equal(JSON.parse(saved.capture_json).instrument, value)) return value;
      fail(400, 'A jam comment may use its saved played instrument or a custom label.');
    }
    const c = assertAudio(value.source, songId);
    if (target && !equal(target, value.source.recording)) fail(400, 'This stem instrument belongs to another recording.');
    const track = c.stemSet?.tracks.find(t => t.id === value.trackId);
    if (!track || c.stemSet.id !== value.stemSetId || c.stemSet.revision !== value.stemSetRevision || track.label !== value.labelSnapshot) fail(409, 'The stem instrument snapshot is unavailable or changed.');
    return value;
  }
  function normalize(input) {
    fields(input,['schemaVersion','captureId','songId','title','instrument','sections','alignment','backingMix','captureEnd']);
    if (input.schemaVersion !== 1 || !['stopped','range-ended','limit','interrupted'].includes(input.captureEnd)) fail(400, 'Invalid jam capture version or end reason.');
    uuid(input.captureId); song(input.songId);
    if (input.alignment !== null && (!object(input.alignment) || !finite(input.alignment.correctionSeconds) || Math.abs(input.alignment.correctionSeconds) > 2 || typeof input.alignment.correctionReviewed !== 'boolean' || (!input.alignment.correctionReviewed && input.alignment.correctionSeconds !== 0))) fail(400,'Use a reviewed timing correction within two real seconds.');
    return structuredClone({ ...input, captureId:input.captureId.toLowerCase(), title:label(input.title), instrument: input.instrument?.kind === 'custom' ? { ...input.instrument, label:label(input.instrument.label) } : input.instrument,
      alignment: input.alignment ? {...input.alignment,correctionSeconds:0,correctionReviewed:false} : null });
  }
  function validateCapture(input, audio) {
    const result = { ...input, instrument: instrument(input.instrument,input.songId) };
    if (!Array.isArray(input.sections) || input.sections.length > 20) fail(400, 'Use at most 20 semantic section associations.');
    const ids = new Set();
    for (const section of input.sections) {
      fields(section,['source','sectionId','sectionRevision','labelSnapshot']); uuid(section.sectionId);
      if (ids.has(section.sectionId)) fail(400, 'Duplicate semantic section association.'); ids.add(section.sectionId);
      const c = assertAudio(section.source,input.songId), found = c.sections.find(s => s.id === section.sectionId);
      if (!found || found.revision !== section.sectionRevision || found.label !== section.labelSnapshot) fail(409, 'Semantic section changed. Reload before saving.');
    }
    if (input.backingMix === null) { if (input.alignment !== null) fail(400, 'Backing alignment requires its captured mix.'); return result; }
    const a=input.alignment, mix=input.backingMix;
    if (a !== null) fields(a,['source','sourceAtCaptureZero','sourceSecondsPerCaptureSecond','clockBasis','estimateProvenance','coverage','correctionSeconds','correctionReviewed']);
    fields(mix,['schemaVersion','source','mode','playbackRate','masterGain','stems']);
    if (mix.schemaVersion !== 1 || !['original','stems'].includes(mix.mode) || !finite(mix.playbackRate) || mix.playbackRate < .5 || mix.playbackRate > 2 || !finite(mix.masterGain) || mix.masterGain < 0 || mix.masterGain > 2 || (a !== null && (!equal(a.source,mix.source) || a.sourceSecondsPerCaptureSecond !== mix.playbackRate || !finite(a.sourceAtCaptureZero) || a.clockBasis !== 'observed-media-time' || a.correctionSeconds !== 0 || a.correctionReviewed !== false))) fail(400, 'Invalid immutable backing settings or estimated alignment.');
    if (a !== null) label(a.estimateProvenance,500);
    const c=assertAudio(mix.source,input.songId,{backing:true}); let bounds={start:0,end:c.audio.durationSeconds};
    if (mix.mode==='original') { if(mix.stems!==null) fail(400,'Original mix cannot claim stem settings.'); }
    else {
      fields(mix.stems,['setId','revision','tracks']); const set=c.stemSet;
      if (!set || mix.stems.setId!==set.id || mix.stems.revision!==set.revision) fail(409,'The recorded stem revision is unavailable or changed.');
      if(!Array.isArray(mix.stems.tracks) || mix.stems.tracks.length!==set.tracks.length) fail(400,'Capture every stem setting exactly once.');
      const seen=new Set();
      for(const t of mix.stems.tracks) {
        fields(t,['id','assetHash','level','muted','solo']); const actual=set.tracks.find(x=>x.id===t.id);
        if(!actual || seen.has(t.id) || t.assetHash!==actual.assetHash) fail(409,'Stem track identity is unavailable or changed.'); seen.add(t.id);
        if(!finite(t.level)||t.level<0||t.level>2||typeof t.muted!=='boolean'||typeof t.solo!=='boolean') fail(400,'Invalid captured stem gain/mute/solo settings.');
      }
      bounds=set;
    }
    if (a === null) return result;
    const cov=a.coverage; fields(cov,['micStart','micEnd','sourceStart','sourceEnd']);
    if(!Object.values(cov).every(finite)||cov.micStart<0||cov.micEnd<=cov.micStart||cov.micEnd>audio.durationSeconds+1/audio.sampleRate||cov.micEnd-cov.micStart>JAM_LIMITS.captureSeconds||cov.sourceStart<bounds.start||cov.sourceEnd<=cov.sourceStart||cov.sourceEnd>bounds.end) fail(400,'Aligned coverage must lie inside the mic file and exact backing coverage. Raw finalized tails remain mic-only.');
    const tolerance=1/audio.sampleRate*mix.playbackRate+1e-7;
    if(Math.abs(cov.sourceStart-(a.sourceAtCaptureZero+cov.micStart*mix.playbackRate))>tolerance || Math.abs(cov.sourceEnd-(a.sourceAtCaptureZero+cov.micEnd*mix.playbackRate))>tolerance) fail(400,'Aligned source and mic intervals disagree with the saved estimated anchor/rate.');
    return result;
  }
  function availability(input) {
    if(!input.backingMix) return {available:false,reason:'This is a free jam; play the microphone recording alone.'};
    if (!input.alignment) return {available:false,reason:'No continuous alignment was established. The intended backing mix is retained; play the mic recording alone.'};
    try {
      const c=assertAudio(input.backingMix.source,input.songId,{backing:true}), saved=input.backingMix.stems;
      if(saved && (!c.stemSet || c.stemSet.id!==saved.setId || c.stemSet.revision!==saved.revision || !saved.tracks.every(t=>c.stemSet.tracks.some(x=>x.id===t.id&&x.assetHash===t.assetHash)))) fail(409,'The captured stem revision is unavailable or changed.');
      return {available:true,reason:null};
    } catch(error) {return {available:false,reason:error.status?error.message:'The exact recorded backing is unavailable. Mic-only playback remains available.'};}
  }
  function view(row) {
    const input=JSON.parse(row.capture_json), audio=JSON.parse(row.audio_json), {captureId,...metadata}=input;
    return {...metadata,id:row.id,createdAt:row.created_at,actor,revision:row.revision,audio,audioUrl:`api/jams/${row.id}/audio`, alignment:input.alignment?{...input.alignment,correctionSeconds:row.correction,correctionReviewed:Boolean(row.correction_reviewed)}:null,backingAvailability:availability(input),sectionAvailability:input.sections.map(s=>{let current=false;try{const c=assertAudio(s.source,input.songId);current=c.sections.some(x=>x.id===s.sectionId&&x.revision===s.sectionRevision);}catch{}return{sectionId:s.sectionId,current};})};
  }
  function retry(row,input,asset) {
    if(!equal(JSON.parse(row.capture_json),input)||!equal(JSON.parse(row.audio_json),asset)) fail(409,'This capture UUID already owns different immutable audio or settings.');
    audioFile(row); return view(row);
  }
  const store = {
    audioRoot, storageGuard, context,
    async saveFile(rawInput,path,contentType) {
      const input=normalize(rawInput), type=mime(contentType), stat=lstatSync(path);
      if(!stat.isFile() || stat.size<1 || stat.size>JAM_LIMITS.encodedBytes || dirname(realpathSync(path))!==realpathSync(audioRoot)) fail(400,'Upload staging file is not contained.');
      const hash=fileHash(path), existing=get.get(input.captureId);
      if(existing) {
        const old=JSON.parse(existing.audio_json); if(old.sha256!==hash || old.bytes!==stat.size || old.mimeType!==type) fail(409,'This capture UUID already owns different immutable audio.');
        return retry(existing,input,old);
      }
      const measured=await validateAudio(path,type), asset={...measured,bytes:stat.size,sha256:hash};
      const normalized=validateCapture(input,asset), again=get.get(input.captureId); if(again) return retry(again,normalized,asset);
      const name=`${input.captureId}.${MIME.get(type)}`, destination=resolve(audioRoot,name);
      const recovering = existsSync(destination);
      if (recovering) {
        const previous=lstatSync(destination);
        if (!previous.isFile() || dirname(realpathSync(destination)) !== realpathSync(audioRoot) || previous.size !== asset.bytes || fileHash(destination) !== asset.sha256) fail(409,'An incompatible uncommitted file already occupies this capture. Keep your draft.');
      } else linkSync(path,destination);
      const directory = openSync(audioRoot, 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
      try {db.prepare('INSERT INTO jams(id,song_id,capture_json,audio_json,audio_file,created_at,correction,correction_reviewed) VALUES(?,?,?,?,?,?,?,?)').run(input.captureId,input.songId,canonical(normalized),canonical(asset),name,new Date().toISOString(),rawInput.alignment?.correctionSeconds ?? 0,rawInput.alignment?.correctionReviewed ? 1 : 0);}
      catch(error) {if(!recovering)unlinkSync(destination);throw error;}
      return view(get.get(input.captureId));
    },
    read(id) {const row=get.get(uuid(id));if(!row) fail(404,'Jam not found.');return view(row);},
    list(songId) {song(songId);return db.prepare('SELECT * FROM jams WHERE song_id=? ORDER BY created_at DESC,id').all(songId).map(view);},
    audio(id) {const row=get.get(uuid(id));if(!row) fail(404,'Jam not found.');return{path:audioFile(row),...JSON.parse(row.audio_json)};},
    correct(id,input) {
      fields(input,['revision','correctionSeconds']);const row=get.get(uuid(id));if(!row) fail(404,'Jam not found.');
      if(!JSON.parse(row.capture_json).alignment) fail(400,'A free jam has no backing alignment to correct.');
      if(!Number.isSafeInteger(input.revision)||input.revision<1||!finite(input.correctionSeconds)||Math.abs(input.correctionSeconds)>2) fail(400,'Use a current revision and a timing correction within two real seconds.');
      const result=db.prepare('UPDATE jams SET correction=?,correction_reviewed=1,revision=revision+1 WHERE id=? AND revision=?').run(input.correctionSeconds,row.id,input.revision);
      if(!result.changes) fail(409,'This jam was adjusted elsewhere. Reload before editing.');return view(get.get(row.id));
    },
    comment(input) {
      fields(input,['id','songId','target','instrument','text']);uuid(input.id);
      const retryInput={...input,id:input.id.toLowerCase(),text:label(input.text,2000),instrument:input.instrument?.kind==='custom'?{...input.instrument,label:label(input.instrument.label)}:input.instrument};
      const savedComment=db.prepare('SELECT * FROM jam_comments WHERE id=?').get(retryInput.id);
      if(savedComment){if(!equal(JSON.parse(savedComment.body_json),retryInput)) fail(409,'This comment UUID already owns different content.');return commentView(savedComment);}
      if(input.songId!==null) song(input.songId);
      const target=input.target;let key,inst;
      if(target?.kind==='song') {fields(target,['kind','songId']);song(target.songId);if(input.songId!==target.songId) fail(400,'Song comment context does not match.');key=canonical({kind:'song',songId:target.songId});inst=instrument(input.instrument,input.songId);}
      else {
        fields(target,['kind','recording','at']);if(target.kind!=='recording') fail(400,'Invalid comment target.');const c=context(target.recording);
        if(input.songId===null ? c.songIds.length>0 : !c.songIds.includes(input.songId)) fail(400,'Select the recording’s actual song context; unassigned archive comments use no song.');
        key=canonical({kind:'recording',recording:target.recording});
        if(target.at!==null) {
          const at=target.at;fields(at,at?.kind==='point'?['kind','seconds','audio']:['kind','start','end','audio']);
          if(!equal(at.audio?.recording,target.recording)) fail(400,'Comment timestamps use the named target recording clock.');assertAudio(at.audio,input.songId);
          if(at.kind==='point') {if(!finite(at.seconds)||at.seconds<0||at.seconds>at.audio.durationSeconds) fail(400,'Invalid comment point.');}
          else if(at.kind!=='range'||!finite(at.start)||!finite(at.end)||at.start<0||at.end<at.start+.25||at.end>at.audio.durationSeconds) fail(400,'Invalid comment range.');
        }
        inst=instrument(input.instrument,input.songId,target.recording);
      }
      const normalized={...input,id:input.id.toLowerCase(),text:label(input.text,2000),instrument:inst}, existing=db.prepare('SELECT * FROM jam_comments WHERE id=?').get(normalized.id);
      if(existing) {if(!equal(JSON.parse(existing.body_json),normalized)) fail(409,'This comment UUID already owns different content.');return commentView(existing);}
      db.prepare('INSERT INTO jam_comments(id,song_id,target_key,body_json,created_at) VALUES(?,?,?,?,?)').run(normalized.id,input.songId,key,canonical(normalized),new Date().toISOString());return commentView(db.prepare('SELECT * FROM jam_comments WHERE id=?').get(normalized.id));
    },
    comments(target,songId) {
      let key;
      if(target?.kind==='song') {song(target.songId);if(target.songId!==songId) fail(400,'Comment song context does not match.');key=canonical({kind:'song',songId});}
      else {if (target?.kind !== 'recording') fail(400,'Invalid comment target.'); recording(target?.recording);const c=context(target.recording);if(songId===null?c.songIds.length>0:!c.songIds.includes(songId)) fail(400,'Comment recording/song context does not match.');key=canonical({kind:'recording',recording:target.recording});}
      return db.prepare('SELECT * FROM jam_comments WHERE target_key=? AND song_id IS ? ORDER BY created_at,id').all(key,songId).map(commentView);
    },
    close(){practice.close();db.close();},
  };
  function commentView(row){return{...JSON.parse(row.body_json),actor,createdAt:row.created_at,revision:row.revision};}
  return store;
}

async function jsonBody(req) {
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')) fail(415,'Send JSON.');
  if(Number(req.headers['content-length'])>16384) fail(413,'Comment metadata is too large.');
  let bytes=0;const chunks=[];
  for await(const chunk of req.iterator({destroyOnReturn:false})){bytes+=chunk.length;if(bytes>16384){req.resume();fail(413,'Comment metadata is too large.');}chunks.push(chunk);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{fail(400,'Invalid JSON.');}
}
async function streamUpload(req,store) {
  const type=mime(req.headers['content-type']), encoded=req.headers['x-jam-metadata'];
  if(typeof encoded!=='string'||encoded.length>JAM_LIMITS.metadataBytes) fail(413,'Jam metadata is missing or too large.');
  let input;try{input=JSON.parse(decodeURIComponent(encoded));}catch{fail(400,'Invalid jam metadata.');}
  if(Number(req.headers['content-length'])>JAM_LIMITS.encodedBytes) fail(413,'Microphone upload exceeds32MiB.');
  store.storageGuard();const path=resolve(store.audioRoot,`.upload-${randomUUID()}.partial`), handle=await open(path,'wx',0o600);let bytes=0;
  const previousTimeout=req.timeout;req.setTimeout?.(60000);
  try {
    for await(const chunk of req.iterator({destroyOnReturn:false})){
      bytes+=chunk.length;if(bytes>JAM_LIMITS.encodedBytes){req.resume();fail(413,'Microphone upload exceeds32MiB.');}
      let offset=0;while(offset<chunk.length){const result=await handle.write(chunk,offset,chunk.length-offset);offset+=result.bytesWritten;}
    }
    if(!bytes) fail(422,'Microphone upload is empty.');await handle.sync();await handle.close();
    return await store.saveFile(input,path,type);
  } finally {await handle.close().catch(()=>{});if(existsSync(path)) unlinkSync(path);if(previousTimeout!==undefined)req.setTimeout?.(previousTimeout);}
}
export function createJamHandler(options) {
  const origins=new Set(options.allowedOrigins||[]);let store,uploading=false;
  const handler=async(req,res,pathname)=>{
    if(pathname!=='/api/jams'&&!pathname.startsWith('/api/jams/')&&pathname!=='/api/jam-comments')return false;
    const respond=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));};
    try {
      if(!['GET','HEAD','POST','PUT'].includes(req.method))fail(405,'Method not supported.');
      if((req.method!=='GET'&&req.method!=='HEAD')&&(typeof req.headers.origin!=='string'||!origins.has(req.headers.origin)))fail(403,'This origin cannot save microphone recordings or comments.');
      if(req.headers.origin&&!origins.has(req.headers.origin))fail(403,'This origin cannot access private jam data.');
      store ||= createJamStore(options);const url=new URL(req.url,'http://local.invalid');
      if(pathname==='/api/jam-comments') {
        if(req.method==='POST')respond(201,{comment:store.comment(await jsonBody(req))});
        else if(req.method==='GET'){let target;try{target=JSON.parse(url.searchParams.get('target'));}catch{fail(400,'Choose a comment target.');}respond(200,{comments:store.comments(target,url.searchParams.get('song')||null)});}
        else fail(405,'Method not supported.');
      }else if(pathname==='/api/jams/context'&&req.method==='GET')respond(200,store.context({kind:url.searchParams.get('kind'),id:url.searchParams.get('id')}));
      else if(pathname==='/api/jams') {
        if(req.method==='POST'){if(uploading)fail(503,'Another microphone upload is finalizing. Keep your draft and retry.');uploading=true;try{respond(201,{jam:await streamUpload(req,store)});}finally{uploading=false;}}
        else if(req.method==='GET')respond(200,{jams:store.list(url.searchParams.get('song'))});else fail(405,'Method not supported.');
      }else {
        const match=/^\/api\/jams\/([a-f0-9-]+)(?:\/(audio|correction))?$/i.exec(pathname);if(!match)fail(404,'Jam endpoint not found.');const[,id,action]=match;
        if(action==='correction'&&req.method==='PUT')respond(200,{jam:store.correct(id,await jsonBody(req))});
        else if(!action&&req.method==='GET')respond(200,{jam:store.read(id)});
        else if(action==='audio'&&['GET','HEAD'].includes(req.method)) {
          const asset=store.audio(id);let start=0,end=asset.bytes-1,status=200;
          if(req.headers.range){const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!range||(!range[1]&&!range[2])){respond(416,{error:'Invalid microphone byte range.'},{'Content-Range':`bytes */${asset.bytes}`});return true;}
            if(!range[1]){const suffix=Number(range[2]);if(!Number.isSafeInteger(suffix)||suffix<=0){respond(416,{error:'Invalid microphone byte range.'},{'Content-Range':`bytes */${asset.bytes}`});return true;}start=Math.max(0,asset.bytes-suffix);}
            else{start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;}
            if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start> end||start>=asset.bytes){respond(416,{error:'Range is outside the mic file.'},{'Content-Range':`bytes */${asset.bytes}`});return true;}status=206;
          }
          res.writeHead(status,{'Content-Type':asset.mimeType,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...(status===206?{'Content-Range':`bytes ${start}-${end}/${asset.bytes}`}:{})});
          if(req.method==='HEAD')res.end();else{const file=await open(asset.path,'r');try{for await(const chunk of file.createReadStream({start,end,autoClose:false})){if(!res.write(chunk))await new Promise(resolveDrain=>{const done=()=>{res.off('drain',done);res.off('close',done);resolveDrain();};res.once('drain',done);res.once('close',done);});if(res.destroyed)break;}res.end();}finally{await file.close();}}
        }else fail(405,'Method not supported.');
      }
    }catch(error){req.resume();if(!res.headersSent)respond(error.status||503,{error:error.status?error.message:'Private jam storage is unavailable. Keep your draft.'});else res.destroy();}
    return true;
  };
  handler.close=()=>{store?.close();store=undefined;};return handler;
}
