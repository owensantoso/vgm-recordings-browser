import type { StemSet } from './practiceData';
import type { StemRateOutput } from './StemRateOutput';

export interface StemMix { level: number; muted: boolean; solo: boolean }
export interface StemLoop { start: number; end: number }
export interface StemPlaybackDependencies {
  createContext?: (options: AudioContextOptions) => AudioContext;
  fetch?: typeof fetch;
  createRateOutput?: (context: AudioContext) => Promise<StemRateOutput>;
}

const MAX_DECODED_BYTES = 300 * 1024 * 1024;
const START_LEAD = 0.02;

function validateSet(set: StemSet): void {
  if (!Number.isFinite(set.start) || !Number.isFinite(set.end) || set.start < 0 || set.end <= set.start ||
      !Number.isSafeInteger(set.sampleRate) || set.sampleRate <= 0 ||
      !Number.isSafeInteger(set.channels) || set.channels < 1 || set.channels > 2 ||
      !Number.isSafeInteger(set.frames) || set.frames <= 0 ||
      Math.abs((set.end - set.start) * set.sampleRate - set.frames) > 1) {
    throw new Error('The stem coverage metadata is invalid.');
  }
  if (!set.tracks.length || set.tracks.length > 6 || new Set(set.tracks.map(track => track.id)).size !== set.tracks.length ||
      set.tracks.some(track => !track.id || !/^[A-Za-z0-9_-]+\.wav$/.test(track.file) ||
        !Number.isSafeInteger(track.bytes) || track.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(track.sha256))) {
    throw new Error('The stem tracks are invalid.');
  }
  if (set.frames * set.channels * 4 * set.tracks.length >= MAX_DECODED_BYTES) {
    throw new Error('This stem set is too large to decode for the practice pilot.');
  }
}

function validateBuffers(set: StemSet, buffers: AudioBuffer[]): void {
  if (buffers.length !== set.tracks.length || buffers.some(buffer =>
    buffer.length !== set.frames || buffer.sampleRate !== set.sampleRate || buffer.numberOfChannels !== set.channels)) {
    throw new Error('The decoded stems do not match their shared frame count, sample rate or channels.');
  }
}

function abortError(): DOMException { return new DOMException('Stem loading was cancelled.', 'AbortError'); }

/** All public positions are seconds in the original source, including excerpt stems. */
export class StemPlaybackEngine {
  private readonly context: AudioContext;
  private readonly set: StemSet;
  private readonly buffers: AudioBuffer[];
  private readonly gains: GainNode[];
  private readonly master: GainNode;
  private readonly mixes: StemMix[];
  private sources: AudioBufferSourceNode[] = [];
  private position: number;
  private anchor = 0;
  private playing = false;
  private wantedPlay = false;
  private loop: StemLoop | null = null;
  private generation = 0;
  private playRequest = 0;
  private operation = 0;
  private destroyed = false;
  private closing: Promise<void> | null = null;
  private rate = 1;
  private readonly output: StemRateOutput | null;
  private preparation: Promise<void> = Promise.resolve();
  private endingGeneration = -1;
  private detachOutputError = () => {};
  private outputError: Error | null = null;

  constructor(set: StemSet, context: AudioContext, buffers: AudioBuffer[], output: StemRateOutput | null = null) {
    validateSet(set);
    validateBuffers(set, buffers);
    this.set = set;
    this.context = context;
    this.buffers = buffers;
    this.position = set.start;
    this.output = output;
    if (output) this.detachOutputError = output.onError(error => {
      this.failOutput(error);
    });
    this.mixes = set.tracks.map(() => ({ level: 1, muted: false, solo: false }));
    this.master = context.createGain();
    this.master.gain.value = 1;
    this.master.connect(output?.input ?? context.destination);
    this.gains = set.tracks.map(() => {
      const gain = context.createGain();
      gain.gain.value = 1;
      gain.connect(this.master);
      return gain;
    });
  }

  async play(): Promise<void> {
    this.assertAlive();
    if (this.outputError) throw this.outputError;
    if (this.playing) return;
    this.wantedPlay = true;
    const operation = ++this.operation;
    const request = ++this.playRequest;
    try {
      await Promise.all([this.context.resume(), this.preparation]);
      if (this.outputError) throw this.outputError;
      // Pause, replacement or destruction while resume is pending cancels its intent.
      if (this.destroyed || request !== this.playRequest || this.playing) return;
      if (this.loop && (this.position < this.loop.start || this.position >= this.loop.end)) this.position = this.loop.start;
      else if (this.position >= this.set.end) this.position = this.set.start;
      await this.output?.reset(this.rate);
      if (this.destroyed || request !== this.playRequest || this.playing) return;
      this.startSources();
    } catch (error) {
      if (!this.destroyed && operation === this.operation) { this.wantedPlay = false; this.stopSources(); throw error; }
    }
  }

  pause(): void {
    if (this.destroyed) return;
    ++this.operation;
    ++this.playRequest;
    this.wantedPlay = false;
    this.position = this.time();
    this.stopSources();
  }

  seek(originalSeconds: number): void | Promise<void> {
    this.assertAlive();
    this.validatePosition(originalSeconds);
    ++this.operation; ++this.playRequest;
    const wasPlaying = this.wantedPlay;
    this.stopSources();
    this.position = originalSeconds;
    // An active loop owns its playback interval; paused seeks retain their exact position.
    if (wasPlaying) {
      if (this.loop && (this.position < this.loop.start || this.position >= this.loop.end)) this.position = this.loop.start;
      if (this.position < this.set.end) return this.restartSources();
    }
  }

  time(): number {
    if (!this.playing) return this.position;
    const elapsed = Math.max(0, this.context.currentTime - this.anchor - (this.output?.latencySeconds ?? 0)) * this.rate;
    if (this.loop) return this.loop.start + ((this.position - this.loop.start + elapsed) % (this.loop.end - this.loop.start));
    return Math.min(this.set.end, this.position + elapsed);
  }

  /** Coverage end on the original clock; the Player retains the full source duration. */
  duration(): number { return this.set.end; }
  getRate(): number { return this.rate; }
  async setRate(rate: number): Promise<void> {
    this.assertAlive();
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) throw new Error('Stem speed must be between 0.5 and 2.');
    if (rate === this.rate) return;
    if (!this.output && rate !== 1) throw new Error('Pitch-preserving stem output is unavailable.');
    const operation = ++this.operation;
    const position = this.time(), playing = this.wantedPlay;
    const request = ++this.playRequest;
    this.stopSources(); this.position = position; this.rate = rate;
    this.preparation = this.guardOperation(this.output?.reset(rate) ?? Promise.resolve(), operation);
    try { await this.preparation; }
    catch (error) { if (!this.destroyed && operation === this.operation) { this.failOutput(error); throw error; } }
    if (!this.destroyed && request === this.playRequest && playing) this.startSources();
  }

  setLoop(loop: StemLoop | null): void {
    this.assertAlive();
    if (loop) {
      this.validatePosition(loop.start);
      this.validatePosition(loop.end);
      if (loop.end <= loop.start) throw new Error('The stem loop must end after it starts.');
    }
    if (this.loop?.start === loop?.start && this.loop?.end === loop?.end) return;
    ++this.operation; ++this.playRequest;
    const wasPlaying = this.wantedPlay;
    const position = this.time();
    this.stopSources();
    this.loop = loop ? { ...loop } : null;
    this.position = loop && (position < loop.start || position >= loop.end) ? loop.start : position;
    if (wasPlaying && this.position < this.set.end) {
      const preparing = this.restartSources();
      if (preparing) {
        this.preparation = preparing;
        void preparing.catch(error => { if (!this.destroyed) this.failOutput(error); });
      }
    }
  }

  setMix(trackId: string, mix: StemMix): void {
    this.assertAlive();
    const index = this.set.tracks.findIndex(track => track.id === trackId);
    if (index < 0) throw new Error('This stem track is unavailable.');
    if (!Number.isFinite(mix.level) || mix.level < 0 || mix.level > 1 || typeof mix.muted !== 'boolean' || typeof mix.solo !== 'boolean') {
      throw new Error('Stem mix levels must be between zero and one.');
    }
    this.mixes[index] = { ...mix };
    const hasSolo = this.mixes.some(value => value.solo);
    this.mixes.forEach((value, i) => {
      const effective = value.muted || (hasSolo && !value.solo) ? 0 : value.level;
      const parameter = this.gains[i].gain;
      parameter.cancelScheduledValues(this.context.currentTime);
      parameter.setTargetAtTime(effective, this.context.currentTime, 0.005);
    });
  }

  destroy(): Promise<void> {
    if (this.closing) return this.closing;
    this.pause();
    this.destroyed = true;
    this.detachOutputError();
    this.gains.forEach(gain => gain.disconnect());
    this.master.disconnect();
    this.buffers.length = 0;
    this.closing = Promise.all([this.output?.destroy(), this.context.state === 'closed' ? Promise.resolve() : this.context.close()]).then(() => {});
    return this.closing;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('This stem player has been closed.');
  }
  private guardOperation(promise: Promise<void>, operation: number): Promise<void> {
    return promise.catch(error => { if (!this.destroyed && operation === this.operation) throw error; });
  }
  private failOutput(error: unknown): void {
    this.position = this.time(); ++this.playRequest; this.wantedPlay = false; this.stopSources();
    this.outputError = error instanceof Error ? error : new Error(String(error));
  }

  private validatePosition(position: number): void {
    if (!Number.isFinite(position) || position < this.set.start || position > this.set.end) {
      throw new Error(`Stems cover only source seconds ${this.set.start}–${this.set.end}. Use the full mix outside this excerpt.`);
    }
  }

  private stopSources(): void {
    this.output?.pause();
    ++this.generation;
    this.playing = false;
    const sources = this.sources;
    this.sources = [];
    sources.forEach(source => {
      source.onended = null;
      try { source.stop(); } catch { /* A source may have ended or not yet started. */ }
      source.disconnect();
    });
  }
  private restartSources(): void | Promise<void> {
    if (!this.output) { this.startSources(); return; }
    const request = ++this.playRequest;
    const operation = this.operation;
    const preparing = this.guardOperation(this.output.reset(this.rate).then(() => {
      if (!this.destroyed && request === this.playRequest && this.wantedPlay) this.startSources();
    }), operation).catch(error => {
      if (!this.destroyed && operation === this.operation) this.failOutput(error);
      throw error;
    });
    this.preparation = preparing; return preparing;
  }

  private startSources(): void {
    const generation = ++this.generation;
    this.sources = this.buffers.map((buffer, i) => {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = this.rate;
      source.connect(this.gains[i]);
      if (this.loop) {
        source.loop = true;
        source.loopStart = this.loop.start - this.set.start;
        source.loopEnd = this.loop.end - this.set.start;
      }
      source.onended = () => {
        if (generation !== this.generation || !this.playing || this.destroyed) return;
        if (this.endingGeneration === generation) return;
        this.endingGeneration = generation;
        const finish = () => {
          if (generation !== this.generation || !this.playing || this.destroyed) return;
          this.position = this.set.end; this.wantedPlay = false; this.stopSources();
        };
        if (this.output) void this.output.drain(this.anchor + (this.set.end - this.position) / this.rate).then(finish).catch(error => {
          if (generation === this.generation && !this.destroyed) this.failOutput(error);
        });
        else finish();
      };
      return source;
    });
    this.anchor = this.context.currentTime + START_LEAD;
    this.output?.start(this.anchor);
    this.playing = true;
    try {
      for (const source of this.sources) source.start(this.anchor, this.position - this.set.start);
    } catch (error) {
      this.stopSources();
      throw error;
    }
  }
}

export async function loadStemPlayback(set: StemSet, signal: AbortSignal, dependencies: StemPlaybackDependencies = {}): Promise<StemPlaybackEngine> {
  validateSet(set);
  if (signal.aborted) throw abortError();
  const context = (dependencies.createContext ?? (options => new AudioContext(options)))({ sampleRate: set.sampleRate });
  const controller = new AbortController();
  let closing: Promise<void> | undefined;
  const close = () => closing ??= context.state === 'closed' ? Promise.resolve() : context.close();
  const abort = () => { controller.abort(); void close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const fetchAudio = dependencies.fetch ?? fetch;
  let tasks: Promise<AudioBuffer>[] = [];
  let output: StemRateOutput | null = null;
  try {
    if (signal.aborted) throw abortError();
    // The manifest permits at most six tracks, bounding concurrent fetch/decode work.
    tasks = set.tracks.map(async track => {
      const response = await fetchAudio(`reference-audio/stems/${encodeURIComponent(track.file)}`, { signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Could not load the ${track.label} stem.`);
      const bytes = await response.arrayBuffer();
      if (controller.signal.aborted) throw abortError();
      if (bytes.byteLength !== track.bytes) throw new Error(`The ${track.label} stem has changed since verification.`);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hash = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
      if (hash !== track.sha256.toLowerCase()) throw new Error(`The ${track.label} stem does not match its verified hash.`);
      if (controller.signal.aborted) throw abortError();
      const buffer = await context.decodeAudioData(bytes);
      if (controller.signal.aborted) throw abortError();
      if (buffer.length !== set.frames || buffer.sampleRate !== set.sampleRate || buffer.numberOfChannels !== set.channels) {
        throw new Error(`The ${track.label} stem does not match the shared audio format.`);
      }
      return buffer;
    });
    const buffers = await Promise.all(tasks);
    if (signal.aborted) throw abortError();
    const createOutput = dependencies.createRateOutput ?? (await import('./StemRateOutput')).createStemRateOutput;
    output = await createOutput(context);
    if (signal.aborted) throw abortError();
    return new StemPlaybackEngine(set, context, buffers, output);
  } catch (error) {
    controller.abort();
    await output?.destroy();
    await close();
    await Promise.allSettled(tasks);
    throw signal.aborted ? abortError() : error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
