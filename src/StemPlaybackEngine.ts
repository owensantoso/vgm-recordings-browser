import type { StemSet } from './practiceData';

export interface StemMix { level: number; muted: boolean; solo: boolean }
export interface StemLoop { start: number; end: number }
export interface StemPlaybackDependencies {
  createContext?: (options: AudioContextOptions) => AudioContext;
  fetch?: typeof fetch;
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
  private loop: StemLoop | null = null;
  private generation = 0;
  private playRequest = 0;
  private destroyed = false;
  private closing: Promise<void> | null = null;

  constructor(set: StemSet, context: AudioContext, buffers: AudioBuffer[]) {
    validateSet(set);
    validateBuffers(set, buffers);
    this.set = set;
    this.context = context;
    this.buffers = buffers;
    this.position = set.start;
    this.mixes = set.tracks.map(() => ({ level: 1, muted: false, solo: false }));
    this.master = context.createGain();
    this.master.gain.value = 1;
    this.master.connect(context.destination);
    this.gains = set.tracks.map(() => {
      const gain = context.createGain();
      gain.gain.value = 1;
      gain.connect(this.master);
      return gain;
    });
  }

  async play(): Promise<void> {
    this.assertAlive();
    if (this.playing) return;
    const request = ++this.playRequest;
    await this.context.resume();
    // Pause, replacement or destruction while resume is pending cancels its intent.
    if (this.destroyed || request !== this.playRequest || this.playing) return;
    if (this.loop && (this.position < this.loop.start || this.position >= this.loop.end)) this.position = this.loop.start;
    else if (this.position >= this.set.end) this.position = this.set.start;
    this.startSources();
  }

  pause(): void {
    if (this.destroyed) return;
    ++this.playRequest;
    this.position = this.time();
    this.stopSources();
  }

  seek(originalSeconds: number): void {
    this.assertAlive();
    this.validatePosition(originalSeconds);
    const wasPlaying = this.playing;
    this.stopSources();
    this.position = originalSeconds;
    // An active loop owns its playback interval; paused seeks retain their exact position.
    if (wasPlaying) {
      if (this.loop && (this.position < this.loop.start || this.position >= this.loop.end)) this.position = this.loop.start;
      if (this.position < this.set.end) this.startSources();
    }
  }

  time(): number {
    if (!this.playing) return this.position;
    const elapsed = Math.max(0, this.context.currentTime - this.anchor);
    if (this.loop) return this.loop.start + ((this.position - this.loop.start + elapsed) % (this.loop.end - this.loop.start));
    return Math.min(this.set.end, this.position + elapsed);
  }

  /** Coverage end on the original clock; the Player retains the full source duration. */
  duration(): number { return this.set.end; }

  setLoop(loop: StemLoop | null): void {
    this.assertAlive();
    if (loop) {
      this.validatePosition(loop.start);
      this.validatePosition(loop.end);
      if (loop.end <= loop.start) throw new Error('The stem loop must end after it starts.');
    }
    if (this.loop?.start === loop?.start && this.loop?.end === loop?.end) return;
    const wasPlaying = this.playing;
    const position = this.time();
    this.stopSources();
    this.loop = loop ? { ...loop } : null;
    this.position = loop && (position < loop.start || position >= loop.end) ? loop.start : position;
    if (wasPlaying && this.position < this.set.end) this.startSources();
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
    this.gains.forEach(gain => gain.disconnect());
    this.master.disconnect();
    this.buffers.length = 0;
    this.closing = this.context.state === 'closed' ? Promise.resolve() : this.context.close();
    return this.closing;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('This stem player has been closed.');
  }

  private validatePosition(position: number): void {
    if (!Number.isFinite(position) || position < this.set.start || position > this.set.end) {
      throw new Error(`Stems cover only source seconds ${this.set.start}–${this.set.end}. Use the full mix outside this excerpt.`);
    }
  }

  private stopSources(): void {
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

  private startSources(): void {
    const generation = ++this.generation;
    this.sources = this.buffers.map((buffer, i) => {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gains[i]);
      if (this.loop) {
        source.loop = true;
        source.loopStart = this.loop.start - this.set.start;
        source.loopEnd = this.loop.end - this.set.start;
      }
      source.onended = () => {
        if (generation !== this.generation || !this.playing || this.destroyed) return;
        this.position = this.set.end;
        this.stopSources();
      };
      return source;
    });
    this.anchor = this.context.currentTime + START_LEAD;
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
    return new StemPlaybackEngine(set, context, buffers);
  } catch (error) {
    controller.abort();
    await close();
    await Promise.allSettled(tasks);
    throw signal.aborted ? abortError() : error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
