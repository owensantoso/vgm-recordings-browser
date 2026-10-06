import type { StemSet, StemChunk } from './practiceData';
import type { StemLoop, StemMix, StemPlaybackDependencies } from './StemPlaybackEngine';
import type { StemRateOutput } from './StemRateOutput';

export interface ChunkedStemStatus {
  state: 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';
  playing: boolean;
  buffering: boolean;
  error: string;
  decodedBytes: number;
  reservedBytes: number;
}
export interface ChunkedStemDependencies extends StemPlaybackDependencies {
  /** Tests drive render-clock ticks without real timers. */
  schedule?: (tick: () => void) => () => void;
}
interface Group { buffers: AudioBuffer[]; bytes: number }
interface ScheduledNode { node: AudioBufferSourceNode; group: number; end: number }
const MAX_BYTES = 300 * 1024 * 1024, MAX_GROUPS = 3, LEAD = 0.04, LOOKAHEAD = 0.5;
function cancelled(): DOMException { return new DOMException('Stem preparation was cancelled.', 'AbortError'); }

function validate(set: StemSet): StemChunk[] {
  if (!Number.isSafeInteger(set.sampleRate) || set.sampleRate <= 0 || !Number.isSafeInteger(set.channels) || set.channels < 1 || set.channels > 2 ||
      !Number.isSafeInteger(set.frames) || set.frames <= 0 || !Number.isFinite(set.start) || set.start < 0 || !Number.isFinite(set.end) ||
      Math.abs((set.end - set.start) * set.sampleRate - set.frames) > 1 || !set.tracks.length || set.tracks.length > 6 ||
      new Set(set.tracks.map(track => track.id)).size !== set.tracks.length || !set.chunks?.length) throw new Error('The chunked stem manifest is invalid.');
  let frame = 0, largest = 0;
  const names = new Set<string>();
  for (const chunk of set.chunks) {
    if (!Number.isSafeInteger(chunk.startFrame) || chunk.startFrame !== frame || !Number.isSafeInteger(chunk.frameCount) || chunk.frameCount < 1 ||
        chunk.frameCount > set.sampleRate * 30 || chunk.files.length !== set.tracks.length || new Set(chunk.files.map(file => file.trackId)).size !== set.tracks.length) {
      throw new Error('Stem chunks must share contiguous groups of at most 30 seconds.');
    }
    for (const file of chunk.files) {
      if (!set.tracks.some(track => track.id === file.trackId) || !/^[A-Za-z0-9_-]+\.(?:wav|flac)$/.test(file.file) || names.has(file.file) ||
          !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > chunk.frameCount * set.channels * 4 + 1024 * 1024 || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
        throw new Error('The chunk file metadata is invalid.');
      }
      names.add(file.file);
    }
    frame += chunk.frameCount;
    largest = Math.max(largest, chunk.frameCount * set.channels * 4 * set.tracks.length);
  }
  if (frame !== set.frames || largest * MAX_GROUPS >= MAX_BYTES) throw new Error('The stem chunk coverage or bounded memory budget is invalid.');
  return set.chunks;
}

/** One render clock schedules coherent groups; no entire song is decoded. */
export class ChunkedStemPlaybackEngine {
  private readonly chunks: StemChunk[];
  private readonly context: AudioContext;
  private readonly set: StemSet;
  private readonly dependencies: ChunkedStemDependencies;
  private readonly master: GainNode;
  private readonly gains: GainNode[];
  private readonly mixes: StemMix[];
  private readonly cache = new Map<number, Group>();
  private readonly pending = new Map<number, { promise: Promise<Group>; bytes: number }>();
  private readonly nodes = new Set<ScheduledNode>();
  private readonly listeners = new Set<(status: ChunkedStemStatus) => void>();
  private cancelTimer: () => void;
  private controller = new AbortController();
  private loadGeneration = 0;
  private timelineGeneration = 0;
  private intent = 0;
  private operation = 0;
  private wantedPlay = false;
  private playing = false;
  private position: number;
  private anchorTime = 0;
  private anchorPosition = 0;
  private cursorTime = 0;
  private cursorPosition = 0;
  private nativeLoop = false;
  private rate = 1;
  private output: StemRateOutput | null = null;
  private detachOutputError = () => {};
  private drainingGeneration = -1;
  private loop: StemLoop | null = null;
  private state: ChunkedStemStatus['state'] = 'loading';
  private error = '';
  private destroyed = false;
  private closing: Promise<void> | null = null;
  private preparation: Promise<void> = Promise.resolve();
  private detachAbort = () => {};

  constructor(set: StemSet, context: AudioContext, dependencies: ChunkedStemDependencies = {}) {
    this.chunks = validate(set); this.set = set; this.context = context; this.dependencies = dependencies; this.position = set.start;
    this.mixes = set.tracks.map(() => ({ level: 1, muted: false, solo: false }));
    this.master = context.createGain(); this.master.gain.value = 1; this.master.connect(context.destination);
    this.gains = set.tracks.map(() => { const gain = context.createGain(); gain.gain.value = 1; gain.connect(this.master); return gain; });
    this.cancelTimer = (dependencies.schedule ?? (tick => { const timer = setInterval(tick, 25); return () => clearInterval(timer); }))(() => this.tick());
  }
  subscribe(listener: (status: ChunkedStemStatus) => void): () => void {
    this.listeners.add(listener); listener(this.getStatus()); return () => this.listeners.delete(listener);
  }
  getStatus(): ChunkedStemStatus {
    return { state: this.state, playing: this.playing, buffering: this.state === 'buffering' || this.state === 'loading', error: this.error,
      decodedBytes: [...this.cache.values()].reduce((sum, group) => sum + group.bytes, 0),
      reservedBytes: [...this.pending.values()].reduce((sum, group) => sum + group.bytes, 0) };
  }
  time(): number {
    if (!this.playing) return this.position;
    const audibleTime = this.context.currentTime - (this.output?.latencySeconds ?? 0);
    if (audibleTime >= this.cursorTime) return this.cursorPosition;
    const elapsed = Math.max(0, Math.min(audibleTime, this.cursorTime) - this.anchorTime) * this.rate;
    if (this.loop) return this.loop.start + ((this.anchorPosition - this.loop.start + elapsed) % (this.loop.end - this.loop.start));
    return Math.min(this.set.end, this.anchorPosition + elapsed);
  }
  duration(): number { return this.set.end; }
  getRate(): number { return this.rate; }
  isBuffering(): boolean { return this.getStatus().buffering; }

  async initialize(signal: AbortSignal): Promise<void> {
    const abort = () => { void this.destroy().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true }); this.detachAbort = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) { await this.destroy(); throw cancelled(); }
    try {
      const createOutput = this.dependencies.createRateOutput ?? (await import('./StemRateOutput')).createStemRateOutput;
      this.output = await createOutput(this.context);
      if (this.destroyed || signal.aborted) { await this.output.destroy(); throw cancelled(); }
      this.master.disconnect(); this.master.connect(this.output.input);
      this.detachOutputError = this.output.onError(error => this.fail(error));
      await this.warm(this.position); if (this.destroyed || signal.aborted) throw cancelled(); this.notify('ready');
    }
    catch (error) {
      const failure = signal.aborted ? cancelled() : this.error ? new Error(this.error) : error;
      await this.destroy(); throw failure;
    }
  }
  async play(): Promise<void> {
    this.assertAlive(); if (this.playing) return;
    const operation = ++this.operation;
    const request = ++this.intent; this.wantedPlay = true;
    // Resume in the caller's gesture, before waiting for network preparation.
    const resumed = this.context.resume();
    try {
      if (this.error) this.preparation = this.prepare(this.position, request);
      await Promise.all([this.preparation, resumed]);
      if (this.destroyed || request !== this.intent || !this.wantedPlay) return;
      if (this.loop && (this.position < this.loop.start || this.position >= this.loop.end)) this.position = this.loop.start;
      else if (this.position >= this.set.end) this.position = this.set.start;
      this.notify('buffering'); await this.warm(this.position);
      if (this.destroyed || request !== this.intent || !this.wantedPlay) return;
      await this.output?.reset(this.rate);
      if (this.destroyed || request !== this.intent || !this.wantedPlay) return;
      this.startTimeline();
    } catch (error) {
      if (!this.destroyed && operation === this.operation) { if (request === this.intent && this.state !== 'error') this.fail(error); throw error; }
    }
  }
  pause(): void {
    if (this.destroyed) return;
    ++this.operation;
    ++this.intent; this.wantedPlay = false; this.position = this.time(); this.stopTimeline(); this.notify('paused');
  }
  async seek(originalSeconds: number): Promise<void> {
    this.assertAlive(); this.validatePosition(originalSeconds);
    const operation = ++this.operation;
    const resume = this.wantedPlay, request = ++this.intent;
    this.stopTimeline(); this.position = originalSeconds;
    if (resume && this.loop && (this.position < this.loop.start || this.position >= this.loop.end)) this.position = this.loop.start;
    const preparing = this.guardOperation(this.prepare(this.position, request), operation); this.preparation = preparing;
    await preparing;
    if (!this.destroyed && request === this.intent && resume && this.wantedPlay) await this.guardOperation(this.restart(request), operation);
  }
  async setRate(rate: number): Promise<void> {
    this.assertAlive();
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) throw new Error('Stem speed must be between 0.5 and 2.');
    if (rate === this.rate) return;
    const operation = ++this.operation;
    const position = this.time(), resume = this.wantedPlay, request = ++this.intent;
    this.stopTimeline(); this.position = position; this.rate = rate;
    // Decoded chunks and the mix survive rate changes; only the render timeline resets.
    const previous = this.preparation;
    const preparing = this.guardOperation((async () => {
      await previous;
      if (this.destroyed || request !== this.intent) return;
      await this.warm(this.position);
      if (this.destroyed || request !== this.intent) return;
      await this.output?.reset(rate);
    })(), operation);
    this.preparation = preparing; this.notify(resume ? 'buffering' : 'paused');
    try {
      await preparing;
      if (!this.destroyed && request === this.intent && resume && this.wantedPlay) this.startTimeline();
    } catch (error) { if (!this.destroyed && operation === this.operation) { if (request === this.intent) this.fail(error); throw error; } }
  }
  setLoop(loop: StemLoop | null): void {
    this.assertAlive();
    if (loop) { this.validatePosition(loop.start); this.validatePosition(loop.end); if (loop.end < loop.start + 0.25) throw new Error('Choose a stem loop of at least 0.25 seconds.'); }
    if (this.loop?.start === loop?.start && this.loop?.end === loop?.end) return;
    const operation = ++this.operation;
    const position = this.time(), resume = this.wantedPlay, request = ++this.intent;
    this.stopTimeline(); this.loop = loop ? { ...loop } : null;
    this.position = loop && (position < loop.start || position >= loop.end) ? loop.start : position;
    const preparing = this.guardOperation(this.prepare(this.position, request), operation); this.preparation = preparing;
    void preparing.then(async () => { if (!this.destroyed && request === this.intent && resume && this.wantedPlay) await this.restart(request); }).catch(error => {
      if (!this.destroyed && request === this.intent) this.fail(error);
    });
  }
  setMix(trackId: string, mix: StemMix): void {
    this.assertAlive();
    const index = this.set.tracks.findIndex(track => track.id === trackId);
    if (index < 0 || !Number.isFinite(mix.level) || mix.level < 0 || mix.level > 1 || typeof mix.muted !== 'boolean' || typeof mix.solo !== 'boolean') throw new Error('The stem mix setting is invalid.');
    this.mixes[index] = { ...mix }; const solo = this.mixes.some(value => value.solo);
    this.mixes.forEach((value, i) => { const parameter = this.gains[i].gain; parameter.cancelScheduledValues(this.context.currentTime);
      parameter.setTargetAtTime(value.muted || (solo && !value.solo) ? 0 : value.level, this.context.currentTime, 0.005); });
  }
  destroy(): Promise<void> {
    if (this.closing) return this.closing;
    this.pause(); this.destroyed = true; ++this.loadGeneration; this.controller.abort(); this.detachAbort(); this.cancelTimer();
    this.detachOutputError();
    this.cache.clear(); this.gains.forEach(gain => gain.disconnect()); this.master.disconnect(); this.listeners.clear();
    const pending = [...this.pending.values()].map(entry => entry.promise);
    const close = this.context.state === 'closed' ? Promise.resolve() : this.context.close();
    this.closing = Promise.all([close, this.output?.destroy(), Promise.allSettled(pending)]).then(() => {}); return this.closing;
  }
  private notify(state = this.state): void {
    if (this.destroyed) return;
    this.state = state; const snapshot = this.getStatus(); for (const listener of this.listeners) listener(snapshot);
  }
  private assertAlive(): void { if (this.destroyed) throw cancelled(); }
  private guardOperation(promise: Promise<void>, operation: number): Promise<void> {
    return promise.catch(error => { if (!this.destroyed && operation === this.operation) throw error; });
  }
  private validatePosition(value: number): void {
    if (!Number.isFinite(value) || value < this.set.start || value > this.set.end) throw new Error('The requested time is outside this stem source.');
  }
  private chunkStart(index: number): number { return this.set.start + this.chunks[index].startFrame / this.set.sampleRate; }
  private chunkEnd(index: number): number { return this.set.start + (this.chunks[index].startFrame + this.chunks[index].frameCount) / this.set.sampleRate; }
  private indexAt(position: number): number {
    if (position >= this.set.end) return this.chunks.length - 1;
    let frame = Math.max(0, (position - this.set.start) * this.set.sampleRate);
    if (Math.abs(frame - Math.round(frame)) < 1e-7) frame = Math.round(frame);
    return this.chunks.findIndex(chunk => frame < chunk.startFrame + chunk.frameCount);
  }
  private nextPosition(position: number): number | null {
    const end = Math.min(this.chunkEnd(this.indexAt(position)), this.loop?.end ?? this.set.end);
    if (this.loop && end >= this.loop.end) return this.loop.start;
    return end < this.set.end ? end : null;
  }
  private needed(position: number): Set<number> {
    const result = new Set([this.indexAt(position)]), next = this.nextPosition(position);
    if (next !== null) result.add(this.indexAt(next)); if (this.loop) result.add(this.indexAt(this.loop.start)); return result;
  }
  private trim(keep: Set<number>): void {
    const pinned = new Set([...this.nodes].map(node => node.group));
    for (const index of this.cache.keys()) if (!keep.has(index) && !pinned.has(index)) this.cache.delete(index);
  }
  private async prepare(position: number, request: number): Promise<void> {
    const generation = ++this.loadGeneration;
    this.controller.abort(); const pending = [...this.pending.values()].map(entry => entry.promise);
    this.cache.clear(); this.error = ''; this.notify('buffering');
    await Promise.allSettled(pending);
    if (this.destroyed || generation !== this.loadGeneration) return;
    this.controller = new AbortController();
    try { await this.warm(position); if (!this.destroyed && request === this.intent) this.notify('paused'); }
    catch (error) { if (!this.destroyed && generation === this.loadGeneration) { if (this.state !== 'error') this.fail(error); throw error; } }
  }
  private async warm(position: number): Promise<void> {
    this.assertAlive(); const needed = this.needed(position); this.trim(needed); await Promise.all([...needed].map(index => this.group(index)));
  }
  private group(index: number): Promise<Group> {
    const cached = this.cache.get(index); if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(index); if (pending) return pending.promise;
    this.assertAlive();
    const chunk = this.chunks[index], bytes = chunk.frameCount * this.set.channels * 4 * this.set.tracks.length, status = this.getStatus();
    if (this.cache.size + this.pending.size >= MAX_GROUPS || status.decodedBytes + status.reservedBytes + bytes >= MAX_BYTES) return Promise.reject(new Error('Stem preparation reached its bounded memory limit.'));
    const generation = this.loadGeneration, signal = this.controller.signal, fetchAudio = this.dependencies.fetch ?? fetch;
    const tasks = this.set.tracks.map(async track => {
      const file = chunk.files.find(file => file.trackId === track.id)!;
      const response = await fetchAudio(`reference-audio/stems/${encodeURIComponent(file.file)}`, { signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Could not load the ${track.label} stem chunk.`);
      const data = await response.arrayBuffer(); if (signal.aborted || this.destroyed) throw cancelled();
      if (data.byteLength !== file.bytes) throw new Error('A stem chunk changed since verification.');
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
      const hash = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
      if (hash !== file.sha256.toLowerCase()) throw new Error('A stem chunk does not match its verified hash.');
      if (signal.aborted || this.destroyed) throw cancelled();
      const buffer = await this.context.decodeAudioData(data);
      if (signal.aborted || this.destroyed || generation !== this.loadGeneration) throw cancelled();
      if (buffer.length !== chunk.frameCount || buffer.sampleRate !== this.set.sampleRate || buffer.numberOfChannels !== this.set.channels) throw new Error('A decoded stem chunk has the wrong frame count or audio format.');
      return buffer;
    });
    const promise = Promise.all(tasks).then(buffers => {
      if (signal.aborted || this.destroyed || generation !== this.loadGeneration) throw cancelled();
      const group = { buffers, bytes }; this.cache.set(index, group); return group;
    }).catch(async error => {
      // A failed track stops the entire group immediately, including pending siblings.
      if (!this.destroyed && generation === this.loadGeneration && this.state !== 'error') this.fail(error);
      await Promise.allSettled(tasks); throw error;
    }).finally(() => {
      if (this.pending.get(index)?.promise === promise) this.pending.delete(index); this.notify();
    });
    this.pending.set(index, { promise, bytes }); this.notify(); return promise;
  }
  private stopTimeline(): void {
    this.output?.pause();
    ++this.timelineGeneration; this.playing = false; this.nativeLoop = false;
    for (const entry of this.nodes) {
      entry.node.onended = null; try { entry.node.stop(); } catch { /* Single-use nodes may already have ended. */ }
      entry.node.disconnect(); entry.node.buffer = null;
    }
    this.nodes.clear();
  }
  private startTimeline(): void {
    if (this.destroyed || !this.wantedPlay) return;
    this.anchorTime = this.context.currentTime + LEAD; this.anchorPosition = this.position;
    this.cursorTime = this.anchorTime; this.cursorPosition = this.position; this.playing = true;
    this.drainingGeneration = -1;
    this.output?.start(this.anchorTime);
    const index = this.indexAt(this.position);
    if (this.loop && this.indexAt(this.loop.start) === index && this.loop.end <= this.chunkEnd(index)) {
      this.nativeLoop = true; this.scheduleGroup(index, this.position, this.loop.end, this.anchorTime, true); this.cursorTime = Infinity;
    } else this.fill();
    if (this.playing) this.notify('playing');
  }
  private scheduleGroup(index: number, start: number, end: number, when: number, native = false): void {
    const group = this.cache.get(index); if (!group) throw new Error('The next coherent stem group is not ready.');
    const generation = this.timelineGeneration;
    for (let i = 0; i < group.buffers.length; ++i) {
      const node = this.context.createBufferSource(); node.buffer = group.buffers[i]; node.connect(this.gains[i]);
      node.playbackRate.value = this.rate;
      if (native) { node.loop = true; node.loopStart = this.loop!.start - this.chunkStart(index); node.loopEnd = this.loop!.end - this.chunkStart(index); }
      const entry = { node, group: index, end: native ? Infinity : when + (end - start) / this.rate }; this.nodes.add(entry);
      node.onended = () => {
        node.disconnect(); node.buffer = null; this.nodes.delete(entry);
        if (generation === this.timelineGeneration && !this.destroyed) this.tick();
      };
      if (native) node.start(when, start - this.chunkStart(index)); else node.start(when, start - this.chunkStart(index), end - start);
    }
  }
  private fill(): void {
    while (this.playing && !this.nativeLoop && this.cursorTime < this.context.currentTime + LOOKAHEAD) {
      if (!this.loop && this.cursorPosition >= this.set.end) break;
      const index = this.indexAt(this.cursorPosition); if (!this.cache.has(index)) break;
      const end = Math.min(this.chunkEnd(index), this.loop?.end ?? this.set.end), length = end - this.cursorPosition;
      if (length <= 0) throw new Error('The stem scheduling boundary is invalid.');
      this.scheduleGroup(index, this.cursorPosition, end, this.cursorTime); this.cursorTime += length / this.rate;
      this.cursorPosition = this.loop && end >= this.loop.end ? this.loop.start : end;
    }
  }
  private tick(): void {
    if (this.destroyed || !this.playing) return;
    try {
      for (const entry of this.nodes) if (entry.end <= this.context.currentTime) {
        entry.node.onended = null; entry.node.disconnect(); entry.node.buffer = null; this.nodes.delete(entry);
      }
      // Never schedule a late successor in the past and let the clock drift through silence.
      if (!this.nativeLoop && this.context.currentTime >= this.cursorTime) {
        // Pending pitch-compensation output is still audible after input stops.
        if (this.output && this.drainingGeneration !== this.timelineGeneration) {
          const generation = this.timelineGeneration; this.drainingGeneration = generation;
          void this.output.drain(this.cursorTime).catch(error => {
            if (!this.destroyed && generation === this.timelineGeneration) this.fail(error);
          });
        }
        if (this.context.currentTime >= this.cursorTime + (this.output?.latencySeconds ?? 0)) this.reachedHorizon();
        return;
      }
      const inputElapsed = Math.max(0, this.context.currentTime - this.anchorTime) * this.rate;
      const inputPosition = this.loop ? this.loop.start + ((this.anchorPosition - this.loop.start + inputElapsed) % (this.loop.end - this.loop.start)) : Math.min(this.set.end, this.anchorPosition + inputElapsed);
      const needed = this.needed(inputPosition); this.trim(needed);
      for (const index of needed) if (!this.cache.has(index) && !this.pending.has(index)) {
        const generation = this.loadGeneration;
        void this.group(index).then(() => { if (generation === this.loadGeneration) this.tick(); }).catch(error => {
          if (!this.destroyed && generation === this.loadGeneration) this.fail(error);
        });
      }
      this.fill();
    } catch (error) { this.fail(error); }
  }
  private reachedHorizon(): void {
    const position = this.cursorPosition;
    if (!this.loop && position >= this.set.end) {
      this.position = this.set.end; this.wantedPlay = false; this.stopTimeline(); this.notify('ended');
    } else {
      const request = ++this.intent; this.stopTimeline(); this.position = position;
      const preparing = this.prepare(position, request); this.preparation = preparing;
      void preparing.then(async () => { if (!this.destroyed && request === this.intent && this.wantedPlay) await this.restart(request); }).catch(error => {
        if (!this.destroyed && request === this.intent) this.fail(error);
      });
    }
  }
  private async restart(request: number): Promise<void> {
    await this.output?.reset(this.rate);
    if (!this.destroyed && request === this.intent && this.wantedPlay) this.startTimeline();
  }
  private fail(error: unknown): void {
    if (this.destroyed || this.state === 'error') return;
    this.position = this.time(); ++this.intent; this.wantedPlay = false; this.stopTimeline(); this.controller.abort();
    this.error = error instanceof Error ? error.message : 'The synchronized stems could not load.'; this.notify('error');
  }
}

export async function loadChunkedStemPlayback(set: StemSet, signal: AbortSignal, dependencies: ChunkedStemDependencies = {}): Promise<ChunkedStemPlaybackEngine> {
  validate(set); if (signal.aborted) throw cancelled();
  const context = (dependencies.createContext ?? (options => new AudioContext(options)))({ sampleRate: set.sampleRate });
  let engine: ChunkedStemPlaybackEngine;
  try { engine = new ChunkedStemPlaybackEngine(set, context, dependencies); } catch (error) { await context.close(); throw error; }
  await engine.initialize(signal); return engine;
}
