/** Microphone-only MediaRecorder capture. Transport observations are estimates,
 * already on the audible source clock; no output latency is subtracted here. */
export const MAX_MIC_BYTES = 32 * 1024 * 1024;
export const MAX_MIC_SECONDS = 120;
export type CaptureEnd = 'stopped' | 'range-ended' | 'limit' | 'interrupted';
export type MicClock = { time: number; playing: boolean; buffering: boolean; error: string; end: number; rate: number };
export type MicTake = {
  blob: Blob; mimeType: string; elapsed: number; captureEnd: CaptureEnd;
  estimate: null | { sourceAtCaptureZero: number; rate: number; micStart: number; micEnd: number };
  notice: string;
};
export type CaptureDependencies = {
  Recorder?: typeof MediaRecorder;
  now?: () => number;
  interval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
};
export function releaseMicrophone(stream: MediaStream | null): void {
  stream?.getTracks().forEach(track => track.stop());
}
export function microphoneMime(Recorder: typeof MediaRecorder = MediaRecorder): string {
  return ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => Recorder.isTypeSupported(type)) || '';
}
export async function enableMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording is unavailable in this browser.');
  return navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
}

export function recordMicrophone(stream: MediaStream, options: {
  clock: (() => MicClock) | null;
  startBacking(): void;
  stopBacking(): void;
  onElapsed(seconds: number): void;
}, dependencies: CaptureDependencies = {}): { done: Promise<MicTake>; stop(reason?: CaptureEnd): Promise<MicTake> } {
  const Recorder = dependencies.Recorder ?? MediaRecorder;
  const now = dependencies.now ?? (() => performance.now());
  const interval = dependencies.interval ?? setInterval;
  const clear = dependencies.clearInterval ?? clearInterval;
  const mimeType = microphoneMime(Recorder);
  let recorder: MediaRecorder;
  try { recorder = new Recorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128000 }); }
  catch (error) { releaseMicrophone(stream); throw error; }
  const chunks: Blob[] = [];
  let size = 0, started = 0, began = false, stopping = false, finished = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let captureEnd: CaptureEnd = 'stopped', notice = '';
  let previous: { wall: number; source: number } | null = null;
  let estimate: MicTake['estimate'] = null;
  let resolve!: (take: MicTake) => void;
  const done = new Promise<MicTake>(accept => { resolve = accept; });
  const elapsed = () => began ? Math.max(0, (now() - started) / 1000) : 0;
  const finish = () => {
    if (finished) return;
    finished = true; if (timer !== undefined) clear(timer);
    releaseMicrophone(stream);
    for (const track of stream.getTracks()) track.removeEventListener('ended', ended);
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
    resolve({ blob, mimeType: blob.type, elapsed: elapsed(), captureEnd, estimate, notice });
  };
  const stop = (reason: CaptureEnd = 'stopped') => {
    if (stopping || finished) return done;
    stopping = true; captureEnd = reason;
    if (timer !== undefined) clear(timer);
    options.stopBacking();
    if (recorder.state !== 'inactive') recorder.stop();
    else finish();
    releaseMicrophone(stream);
    return done;
  };
  const ended = () => { notice = 'Microphone input ended. The captured prefix was retained.'; void stop('interrupted'); };
  for (const track of stream.getTracks()) track.addEventListener('ended', ended);
  recorder.ondataavailable = event => {
    if (!event.data.size) return;
    chunks.push(event.data); size += event.data.size;
    if (size >= MAX_MIC_BYTES) { notice = 'The microphone byte limit was reached.'; void stop('limit'); }
  };
  recorder.onerror = () => { notice = 'Recording was interrupted. The finalized bytes must decode before replay or saving.'; void stop('interrupted'); };
  recorder.onstop = finish;
  recorder.onstart = () => {
    if (stopping) return;
    began = true; started = now();
    try { options.startBacking(); } catch { notice = 'Backing could not start; microphone audio was retained.'; void stop('interrupted'); return; }
    timer = interval(() => {
      const wall = elapsed(); options.onElapsed(wall);
      if (wall >= MAX_MIC_SECONDS) { void stop('limit'); return; }
      const clock = options.clock?.(); if (!clock) return;
      if (clock.buffering || clock.error || !Number.isFinite(clock.time)) {
        notice = 'Backing stopped or buffered. Alignment ends at the last continuous observation.';
        void stop('interrupted'); return;
      }
      if (clock.time >= clock.end - .025) { void stop('range-ended'); return; }
      if (!previous) {
        if (clock.playing) previous = { wall, source: clock.time };
        else if (wall > 2) { notice = 'Backing did not start. Use microphone-only playback.'; void stop('interrupted'); }
        return;
      }
      const dt = wall - previous.wall, ds = clock.time - previous.source;
      if (!clock.playing || ds < -.025 || ds > dt * clock.rate + .25 || (dt > .5 && ds < .01)) {
        notice = 'Backing was interrupted. Alignment ends before the interruption.'; void stop('interrupted'); return;
      }
      if (ds > .01) {
        if (!estimate) estimate = { sourceAtCaptureZero: clock.time - wall * clock.rate, rate: clock.rate, micStart: 0, micEnd: wall };
        else estimate.micEnd = wall;
        previous = { wall, source: clock.time };
      }
    }, 50);
  };
  try { recorder.start(250); }
  catch (error) { releaseMicrophone(stream); for (const track of stream.getTracks()) track.removeEventListener('ended', ended); throw error; }
  return { done, stop };
}

export async function inspectMic(blob: Blob): Promise<{ duration: number; sampleRate: number; channels: number; frames: number }> {
  if (!blob.size || blob.size > MAX_MIC_BYTES) throw new Error('The mic file is empty or exceeds 32 MiB. Download the retained file.');
  // At most 120 s × 48 kHz × 2 float channels = 46.1 MB; caller budgets this
  // together with the stem cache. Release this decoder immediately afterwards.
  const context = new AudioContext({ sampleRate: 48000 });
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > MAX_MIC_SECONDS + .5 || decoded.numberOfChannels > 2 || decoded.duration <= 0) throw new Error('The decoded mic file exceeds the short-take limits. Download the retained file.');
    return { duration: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, frames: decoded.length };
  } finally { await context.close(); }
}

export function backedMicInterval(estimate: NonNullable<MicTake['estimate']>, duration: number, bounds: { start: number; end: number }, correction = 0) {
  const start = Math.max(0, estimate.micStart, (bounds.start - estimate.sourceAtCaptureZero) / estimate.rate + correction);
  const end = Math.min(duration, estimate.micEnd, (bounds.end - estimate.sourceAtCaptureZero) / estimate.rate + correction);
  return end > start ? { start, end } : null;
}

/** Only finalized whole blobs are persisted. No unfinished-fragment recovery claim. */
export type StoredMicDraft<T = unknown> = { id: string; songId: string; blob: Blob; metadata: T; notice: string };
let memoryDraft: StoredMicDraft | null = null;
function draftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('vgm-finalized-jam-draft', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function storeMicDraft<T>(draft: StoredMicDraft<T>): Promise<void> {
  memoryDraft = draft;
  const db = await draftDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put(draft, 'current');
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Draft storage failed.'));
  }); } finally { db.close(); }
}
export async function readMicDraft<T>(): Promise<StoredMicDraft<T> | null> {
  try {
    const db = await draftDatabase();
    try { return await new Promise<StoredMicDraft<T> | null>((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get('current');
      request.onsuccess = () => resolve((memoryDraft ?? request.result ?? null) as StoredMicDraft<T> | null);
      request.onerror = () => reject(request.error);
    }); } finally { db.close(); }
  } catch { return memoryDraft as StoredMicDraft<T> | null; }
}
export async function discardMicDraft(): Promise<void> {
  const db = await draftDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').delete('current');
    tx.oncomplete = () => { memoryDraft = null; resolve(); }; tx.onerror = tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
