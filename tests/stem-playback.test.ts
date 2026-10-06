import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { StemPlaybackEngine, loadStemPlayback } from '../src/StemPlaybackEngine.ts';
import type { StemSet } from '../src/practiceData.ts';
import type { StemRateOutput } from '../src/StemRateOutput.ts';

class RateOutput {
  input = {} as AudioNode; rate = 1; delay = 0; paused = 0; destroyed = 0; starts: number[] = []; resets: number[] = []; drains: number[] = [];
  resetGate: Promise<void> | null = null; drainGate: Promise<void> | null = null;
  get latencySeconds() { return this.rate === 1 ? 0 : this.delay; }
  async reset(rate = this.rate) { this.resets.push(rate); this.rate = rate; await this.resetGate; }
  start(when: number) { this.starts.push(when); }
  pause() { ++this.paused; }
  async drain(when: number) { this.drains.push(when); await this.drainGate; }
  async destroy() { ++this.destroyed; }
  onError(_listener: (error: Error) => void) { return () => {}; }
}


const payload = new Uint8Array([1, 2, 3, 4]);
const hash = createHash('sha256').update(payload).digest('hex');
function fixture(): StemSet {
  return { id: 'pilot', sourceId: 'ref:original', sourceHash: 'a'.repeat(64), coverage: 'excerpt',
    start: 30, end: 120, sampleRate: 44100, channels: 2, frames: 3969000,
    tracks: ['drums', 'bass', 'piano', 'guitar', 'other', 'vocals'].map(id => ({ id, label: id, file: `${id}.wav`, bytes: payload.length, sha256: hash })) };
}

class FakeGain {
  disconnected = false;
  connections: unknown[] = [];
  targets: number[] = [];
  gain = {
    value: 1,
    cancelScheduledValues: (_time: number) => {},
    setTargetAtTime: (value: number, _time: number, constant: number) => { assert.ok(constant > 0); this.targets.push(value); },
  };
  connect(node: unknown) { this.connections.push(node); }
  disconnect() { this.disconnected = true; }
}
class FakeSource {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  started: [number, number] | null = null;
  stopped = 0;
  disconnected = false;
  connect(_gain: unknown) {}
  start(when: number, offset: number) { assert.equal(this.started, null); this.started = [when, offset]; }
  stop() { ++this.stopped; this.onended?.(); }
  disconnect() { this.disconnected = true; }
}
class FakeContext {
  currentTime = 10;
  state = 'suspended';
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  closed = 0;
  resumed = 0;
  resumeGate: Promise<void> | null = null;
  decode = { length: 3969000, sampleRate: 44100, numberOfChannels: 2 };
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
  async resume() { ++this.resumed; await this.resumeGate; this.state = 'running'; }
  async close() { ++this.closed; this.state = 'closed'; }
  async decodeAudioData(_bytes: ArrayBuffer) { return { ...this.decode }; }
}
function engine() {
  const set = fixture(), context = new FakeContext();
  const buffers = set.tracks.map(() => ({ ...context.decode }) as AudioBuffer);
  return { context, player: new StemPlaybackEngine(set, context as unknown as AudioContext, buffers) };
}
function advance(context: FakeContext, seconds: number) {
  context.currentTime = context.sources.at(-1)!.started![0] + seconds;
}
function gains(context: FakeContext) { return context.gains.slice(1).map(gain => gain.targets.at(-1)); }

test('stems share one scheduled start and original-to-buffer offset', async () => {
  const { player, context } = engine();
  assert.equal(player.time(), 30);
  assert.equal(player.duration(), 120);
  player.seek(45);
  await player.play();
  assert.equal(context.sources.length, 6);
  assert.equal(new Set(context.sources.map(source => source.started![0])).size, 1);
  assert.ok(context.sources[0].started![0] > context.currentTime);
  assert.deepEqual(context.sources.map(source => source.started![1]), Array(6).fill(15));
  assert.equal(player.time(), 45, 'scheduled lead does not move the source clock early');
  advance(context, 2.75);
  assert.equal(player.time(), 47.75);
  await player.play();
  assert.equal(context.sources.length, 6, 'Play while playing creates no duplicate nodes');
  await player.destroy();
});

test('levels, mute and simultaneous solos alter gain without restarting sources', async () => {
  const { player, context } = engine();
  await player.play();
  advance(context, 3);
  player.setMix('drums', { level: 0.4, muted: false, solo: true });
  assert.deepEqual(gains(context), [0.4, 0, 0, 0, 0, 0]);
  player.setMix('bass', { level: 0.7, muted: false, solo: true });
  assert.deepEqual(gains(context), [0.4, 0.7, 0, 0, 0, 0]);
  player.setMix('drums', { level: 0.4, muted: true, solo: true });
  assert.deepEqual(gains(context), [0, 0.7, 0, 0, 0, 0], 'mute wins over solo');
  player.setMix('drums', { level: 0.4, muted: true, solo: false });
  player.setMix('bass', { level: 0.7, muted: false, solo: false });
  assert.deepEqual(gains(context), [0, 0.7, 1, 1, 1, 1]);
  player.setMix('drums', { level: 0.4, muted: false, solo: false });
  assert.deepEqual(gains(context), [0.4, 0.7, 1, 1, 1, 1], 'muting retained its level');
  assert.equal(player.time(), 33);
  assert.equal(context.sources.length, 6);
  assert.ok(context.sources.every(source => source.stopped === 0));
  assert.throws(() => player.setMix('absent', { level: 1, muted: false, solo: false }));
  assert.throws(() => player.setMix('drums', { level: 2.01, muted: false, solo: false }));
  await player.destroy();
});

test('pause, seek and resume dispose owned nodes and ignore replaced end callbacks', async () => {
  const { player, context } = engine();
  await player.play();
  const staleEnd = context.sources[0].onended!;
  advance(context, 5);
  player.pause();
  assert.equal(player.time(), 35);
  assert.ok(context.sources.every(source => source.stopped === 1 && source.disconnected));
  context.currentTime += 10;
  assert.equal(player.time(), 35, 'paused clock stays fixed');
  player.seek(50);
  await player.play();
  staleEnd();
  assert.equal(player.time(), 50);
  advance(context, 1);
  player.seek(80);
  assert.equal(player.time(), 80);
  assert.equal(context.sources.length, 18);
  assert.deepEqual(context.sources.slice(-6).map(source => source.started![1]), Array(6).fill(50));
  assert.throws(() => player.seek(29.999));
  assert.throws(() => player.seek(120.001));
  assert.throws(() => player.seek(NaN));
  assert.equal(player.time(), 80, 'rejected seeks leave playback unchanged');
  await player.destroy();
  await player.destroy();
  assert.equal(context.closed, 1);
  assert.ok(context.sources.every(source => source.stopped === 1 && source.disconnected));
  assert.ok(context.gains.every(gain => gain.disconnected));
});

test('native loop uses shared local boundaries and clock survives loop replacement', async () => {
  const { player, context } = engine();
  player.seek(62);
  player.setLoop({ start: 60, end: 70 });
  await player.play();
  assert.ok(context.sources.every(source => source.loop && source.loopStart === 30 && source.loopEnd === 40));
  advance(context, 19);
  assert.equal(player.time(), 61, 'elapsed wraps on original seconds');
  const staleEnd = context.sources[0].onended!;
  player.setLoop({ start: 60, end: 65 });
  assert.equal(player.time(), 61, 'loop replacement preserves an in-range position');
  assert.deepEqual(context.sources.slice(-6).map(source => source.started![1]), Array(6).fill(31));
  staleEnd();
  assert.equal(player.time(), 61);
  assert.throws(() => player.setLoop({ start: 29, end: 65 }));
  assert.throws(() => player.setLoop({ start: 65, end: 65 }));
  assert.equal(player.time(), 61);
  player.setLoop(null);
  assert.ok(context.sources.slice(-6).every(source => !source.loop));
  player.pause();
  const count = context.sources.length;
  player.setLoop({ start: 80, end: 90 });
  assert.equal(player.time(), 80, 'out-of-loop position prepares at A without autoplay');
  assert.equal(context.sources.length, count);
  player.seek(90);
  await player.play();
  assert.equal(player.time(), 80, 'Play at B restarts at A');
  await player.destroy();
});

test('natural end has one current generation and replay starts at coverage A', async () => {
  const { player, context } = engine();
  await player.play();
  const end = context.sources[0].onended!;
  advance(context, 90);
  assert.equal(player.time(), 120);
  end();
  assert.equal(player.time(), 120);
  assert.ok(context.sources.every(source => source.stopped === 1));
  await player.play();
  end();
  assert.equal(player.time(), 30);
  assert.equal(context.sources.length, 12);
  await player.destroy();
});

test('pause or destroy cancels pending resume, and concurrent Play creates only one set', async () => {
  const { player, context } = engine();
  let resume!: () => void;
  context.resumeGate = new Promise(resolve => { resume = resolve; });
  const pending = player.play();
  player.pause();
  resume();
  await pending;
  assert.equal(context.sources.length, 0);
  context.resumeGate = null;
  await Promise.all([player.play(), player.play()]);
  assert.equal(context.sources.length, 6);
  player.pause();
  context.resumeGate = new Promise(resolve => { resume = resolve; });
  const closingPlay = player.play();
  await player.destroy();
  resume();
  await closingPlay;
  assert.equal(context.sources.length, 6);
  assert.equal(context.closed, 1);
  await assert.rejects(player.play(), /closed/);
});

test('loader fetches exact stem paths, verifies payload and decoded metadata', async () => {
  const context = new FakeContext(), paths: string[] = [], set = fixture();
  const player = await loadStemPlayback(set, new AbortController().signal, {
    createRateOutput: async () => new RateOutput() as StemRateOutput,
    createContext: options => { assert.equal(options.sampleRate, 44100); return context as unknown as AudioContext; },
    fetch: (async (path: string, options: RequestInit) => { paths.push(path); assert.equal(options.credentials, 'same-origin'); return new Response(payload); }) as typeof fetch,
  });
  assert.deepEqual(paths, set.tracks.map(track => `reference-audio/stems/${track.file}`));
  assert.equal(context.resumed, 0, 'load does not autoplay or unlock audio');
  assert.equal(context.sources.length, 0);
  assert.equal(context.closed, 0);
  await player.destroy();
});

test('loader closes context on fetch, hash, length and each decoded format mismatch', async () => {
  for (const failure of ['fetch', 'hash', 'bytes', 'frames', 'rate', 'channels']) {
    const context = new FakeContext();
    if (failure === 'frames') --context.decode.length;
    if (failure === 'rate') context.decode.sampleRate = 48000;
    if (failure === 'channels') context.decode.numberOfChannels = 1;
    await assert.rejects(loadStemPlayback(fixture(), new AbortController().signal, {
      createRateOutput: async () => new RateOutput() as StemRateOutput,
    createContext: () => context as unknown as AudioContext,
      fetch: (async () => failure === 'fetch' ? new Response('', { status: 503 }) : new Response(
        failure === 'hash' ? new Uint8Array([4, 3, 2, 1]) : failure === 'bytes' ? new Uint8Array([1]) : payload)) as typeof fetch,
    }), /load|hash|verification|shared audio format/);
    assert.equal(context.closed, 1, failure);
    assert.equal(context.sources.length, 0);
  }
});

test('aborted loads close their context and abort every outstanding fetch', async () => {
  const context = new FakeContext(), controller = new AbortController();
  let started = 0, aborted = 0;
  const loading = loadStemPlayback(fixture(), controller.signal, {
    createRateOutput: async () => new RateOutput() as StemRateOutput,
    createContext: () => context as unknown as AudioContext,
    fetch: ((_path: string, options: RequestInit) => new Promise((_resolve, reject) => {
      ++started;
      options.signal!.addEventListener('abort', () => { ++aborted; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    })) as typeof fetch,
  });
  controller.abort();
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(started, 6);
  assert.equal(aborted, 6);
  assert.equal(context.closed, 1);
  let created = false;
  await assert.rejects(loadStemPlayback(fixture(), controller.signal, { createContext: () => { created = true; return context as unknown as AudioContext; } }), { name: 'AbortError' });
  assert.equal(created, false);
});

test('abort during decode cannot return a live engine after asynchronous decoding finishes', async () => {
  const context = new FakeContext(), controller = new AbortController();
  let release!: () => void, decoded = 0, reached!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const decoding = new Promise<void>(resolve => { reached = resolve; });
  context.decodeAudioData = async () => {
    if (++decoded === 6) reached();
    await gate;
    return { ...context.decode };
  };
  const loading = loadStemPlayback(fixture(), controller.signal, {
    createRateOutput: async () => new RateOutput() as StemRateOutput,
    createContext: () => context as unknown as AudioContext,
    fetch: (async () => new Response(payload)) as typeof fetch,
  });
  await decoding;
  controller.abort();
  assert.equal(context.closed, 1, 'abort closes immediately even though decoding is pending');
  release();
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(context.closed, 1);
  assert.equal(context.gains.length, 0, 'no engine was constructed after cancellation');
});

test('decoded memory, track identity and coverage bounds fail before allocating a context', async () => {
  for (const variant of ['memory', 'tracks', 'coverage']) {
    const set = fixture();
    if (variant === 'memory') { set.frames *= 2; set.end = set.start + set.frames / set.sampleRate; }
    if (variant === 'tracks') set.tracks[1].id = set.tracks[0].id;
    if (variant === 'coverage') set.end += 0.01;
    let created = false;
    await assert.rejects(loadStemPlayback(set, new AbortController().signal, { createContext: () => { created = true; return new FakeContext() as unknown as AudioContext; } }));
    assert.equal(created, false);
  }
});

test('excerpt speed uses the original clock, preserves loop/mix, and waits for reset before resuming', async () => {
  for (const rate of [0.5, 0.8, 1.2, 2]) {
    const set = fixture(), context = new FakeContext(), output = new RateOutput(); output.delay = 0.2;
    const player = new StemPlaybackEngine(set, context as unknown as AudioContext, set.tracks.map(() => ({ ...context.decode }) as AudioBuffer), output as StemRateOutput);
    player.setLoop({ start: 60, end: 60.25 }); player.seek(60); await player.setRate(rate); await player.play();
    assert.ok(context.sources.every(source => source.playbackRate.value === rate && source.loopStart === 30 && source.loopEnd === 30.25));
    advance(context, 0.19); assert.equal(player.time(), 60);
    advance(context, 0.2 + 0.6 / rate); assert.ok(Math.abs(player.time() - 60.1) < 1e-9);
    player.setMix('bass', { level: 0.3, muted: false, solo: true });
    const before = player.time(), nodes = context.sources.slice(); await player.setRate(rate === 2 ? 0.5 : 2);
    assert.ok(Math.abs(player.time() - before) < 1e-9); assert.ok(nodes.every(node => node.stopped === 1));
    assert.equal(gains(context)[1], 0.3);
    player.pause(); const paused = player.time(), length = context.sources.length; await player.setRate(1);
    context.currentTime += 5; assert.equal(player.time(), paused); assert.equal(context.sources.length, length);
    await assert.rejects(player.setRate(0.49)); await assert.rejects(player.setRate(2.01));
    await player.destroy(); assert.equal(output.destroyed, 1);
  }
});

test('excerpt delayed output drains once; stale tail and rate reset cannot resurrect paused sources', async () => {
  const set = fixture(), context = new FakeContext(), output = new RateOutput(); output.delay = 0.2;
  const player = new StemPlaybackEngine(set, context as unknown as AudioContext, set.tracks.map(() => ({ ...context.decode }) as AudioBuffer), output as StemRateOutput);
  let release!: () => void; output.drainGate = new Promise(resolve => { release = resolve; });
  player.seek(119); await player.setRate(2); await player.play();
  const nodes = context.sources.slice(), end = nodes[0].started![0] + 0.5;
  context.currentTime = end; nodes.forEach(source => source.onended?.());
  assert.equal(output.drains.length, 1); assert.equal(output.drains[0], end); assert.ok(player.time() < 120);
  player.pause(); const paused = player.time(); release(); await Promise.resolve();
  assert.equal(player.time(), paused);
  await player.play(); output.resetGate = new Promise(resolve => { release = resolve; });
  const changing = player.setRate(0.5); player.pause(); const count = context.sources.length; release(); await changing;
  assert.equal(context.sources.length, count); await player.destroy();
});

test('obsolete excerpt speed reset failure cannot reject into a newer successful seek', async () => {
  const set = fixture(), context = new FakeContext(), output = new RateOutput();
  const player = new StemPlaybackEngine(set, context as unknown as AudioContext, set.tracks.map(() => ({ ...context.decode }) as AudioBuffer), output as StemRateOutput);
  await player.play(); let reject!: (error: Error) => void, started!: () => void;
  const resetting = new Promise<void>(resolve => { started = resolve; });
  const reset = output.reset.bind(output); let blocked = true;
  output.reset = async rate => {
    if (blocked) { blocked = false; started(); await new Promise<void>((_resolve, fail) => { reject = fail; }); return; }
    await reset(rate);
  };
  const changing = player.setRate(0.8); const result = changing.then(() => 'resolved', () => 'rejected');
  await resetting; await player.seek(95); reject(new Error('obsolete reset failure'));
  assert.equal(await result, 'resolved'); assert.equal(player.time(), 95);
  assert.ok(context.sources.slice(-6).every(node => node.started![1] === 65 && node.stopped === 0));
  await player.destroy();
});

test('current excerpt speed reset failure rejects and clears playback intent', async () => {
  const set = fixture(), context = new FakeContext(), output = new RateOutput();
  const player = new StemPlaybackEngine(set, context as unknown as AudioContext, set.tracks.map(() => ({ ...context.decode }) as AudioBuffer), output as StemRateOutput);
  await player.play(); output.reset = async () => { throw new Error('current processor failure'); };
  await assert.rejects(player.setRate(0.8), /current processor failure/);
  const count = context.sources.length; await player.seek(95); assert.equal(context.sources.length, count);
  await assert.rejects(player.play(), /current processor failure/); await player.destroy();
});

test('excerpt gain accepts 200% with unity default and boosted mute/solo without restarting', async () => {
  const { player, context } = engine(); await player.play(); const nodes = context.sources.length;
  assert.ok(context.gains.slice(1).every(gain => gain.gain.value === 1));
  player.setMix('bass', { level: 2, muted: false, solo: true }); assert.equal(gains(context)[1], 2);
  player.setMix('bass', { level: 2, muted: true, solo: true }); assert.equal(gains(context)[1], 0);
  player.setMix('bass', { level: 2, muted: false, solo: false }); assert.equal(gains(context)[1], 2);
  player.setMix('bass', { level: 0, muted: false, solo: false }); assert.equal(gains(context)[1], 0);
  for (const level of [-0.01, 2.01, NaN, Infinity]) assert.throws(() => player.setMix('bass', { level, muted: false, solo: false }));
  assert.equal(context.sources.length, nodes); await player.destroy();
});
