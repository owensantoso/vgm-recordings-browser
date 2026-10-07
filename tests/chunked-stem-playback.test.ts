import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadChunkedStemPlayback } from '../src/ChunkedStemPlaybackEngine.ts';
import type { ChunkedStemStatus } from '../src/ChunkedStemPlaybackEngine.ts';
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


const rate = 44100, frames = rate * 30, count = 6;
const payload = (group: number, track: number) => new Uint8Array([group, track, 7, 9]);
function fixture(extension = 'flac'): StemSet {
  const tracks = ['drums', 'bass', 'piano', 'guitar', 'other', 'vocals'].map(id => ({ id, label: id, file: `${id}.${extension}`, bytes: 4, sha256: 'a'.repeat(64) }));
  return { id: 'full', sourceId: 'ref:original', sourceHash: 'b'.repeat(64), coverage: 'full-source', start: 0, end: 120,
    sampleRate: rate, channels: 2, frames: frames * 4, tracks,
    chunks: Array.from({ length: 4 }, (_, group) => ({ startFrame: group * frames, frameCount: frames,
      files: tracks.map((track, index) => ({ trackId: track.id, file: `c${group}_${index}.${extension}`, bytes: 4,
        sha256: createHash('sha256').update(payload(group, index)).digest('hex') })) })) };
}
class Gain {
  targets: number[] = []; disconnected = false;
  gain = { value: 1, cancelScheduledValues: (_time: number) => {}, setTargetAtTime: (value: number) => { this.targets.push(value); } };
  connect(_node: unknown) {} disconnect() { this.disconnected = true; }
}
class Source {
  buffer: { group: number } | null = null; onended: (() => void) | null = null;
  playbackRate = { value: 1 };
  loop = false; loopStart = 0; loopEnd = 0; stopped = false; disconnected = false;
  started: [number, number, number | undefined] | null = null;
  connect(_gain: unknown) {}
  start(when: number, offset: number, duration?: number) { assert.equal(this.started, null); this.started = [when, offset, duration]; }
  stop() { this.stopped = true; this.onended?.(); }
  disconnect() { this.disconnected = true; }
}
class Context {
  currentTime = 5; state = 'suspended'; destination = {}; closed = 0; resumed = 0;
  sources: Source[] = []; gains: Gain[] = []; mismatch = ''; decoded = 0;
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  async resume() { ++this.resumed; this.state = 'running'; }
  async close() { ++this.closed; this.state = 'closed'; }
  async decodeAudioData(data: ArrayBuffer) {
    ++this.decoded;
    return { group: new Uint8Array(data)[0], length: this.mismatch === 'frames' ? frames - 1 : frames,
      sampleRate: this.mismatch === 'rate' ? 48000 : rate, numberOfChannels: this.mismatch === 'channels' ? 1 : 2 };
  }
}
function harness() {
  const output = new RateOutput();
  const context = new Context(), paths: string[] = [], statuses: ChunkedStemStatus[] = [];
  let tick = () => {}, timerClosed = false;
  const holds = new Map<number, Promise<void>>(), failGroups = new Set<number>();
  const dependencies = {
    createRateOutput: async () => output as StemRateOutput,
    createContext: () => context as unknown as AudioContext,
    schedule: (value: () => void) => { tick = value; return () => { timerClosed = true; }; },
    fetch: (async (path: string, options: RequestInit) => {
      paths.push(path); assert.equal(options.credentials, 'same-origin');
      const match = path.match(/c(\d+)_(\d+)\.(flac|wav)$/); assert.ok(match, 'never fetch whole-track files');
      const group = Number(match[1]), track = Number(match[2]);
      const hold = holds.get(group);
      if (hold) await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        options.signal!.addEventListener('abort', abort, { once: true });
        if (options.signal!.aborted) abort();
        hold.then(() => { options.signal!.removeEventListener('abort', abort); resolve(); });
      });
      return failGroups.has(group) ? new Response('', { status: 503 }) : new Response(payload(group, track));
    }) as typeof fetch,
  };
  return { output, context, paths, statuses, dependencies, holds, failGroups, tick: () => tick(), timerClosed: () => timerClosed };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 1000 && !predicate(); ++i) await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'asynchronous operation settled');
}
async function ready() {
  const h = harness(); const controller = new AbortController();
  const player = await loadChunkedStemPlayback(fixture(), controller.signal, h.dependencies);
  player.subscribe(status => h.statuses.push(status)); return { ...h, player, controller };
}

test('initial load decodes only the coherent current/next pair; scheduling shares time and offsets', async () => {
  const h = await ready();
  assert.equal(h.paths.length, count * 2); assert.equal(h.context.resumed, 0); assert.equal(h.context.sources.length, 0);
  assert.equal(h.player.getStatus().decodedBytes, frames * 2 * 4 * count * 2);
  await h.player.play();
  const first = h.context.sources.slice(); const anchor = first[0].started![0];
  assert.ok(anchor > h.context.currentTime);
  assert.ok(first.every(node => node.buffer!.group === 0 && node.started![0] === anchor && node.started![1] === 0 && node.started![2] === 30));
  h.context.currentTime = anchor + 29.6; h.tick();
  assert.equal(h.context.sources.length, count * 2);
  assert.ok(h.context.sources.slice(-count).every(node => node.buffer!.group === 1 && node.started![0] === anchor + 30));
  assert.equal(h.player.time(), 29.6);
  h.context.currentTime = anchor + 30.1; h.tick();
  await until(() => h.paths.some(path => path.includes('c2_')) && h.player.getStatus().reservedBytes === 0);
  assert.ok(first.every(node => node.buffer === null && node.disconnected));
  assert.ok(h.statuses.every(status => status.decodedBytes + status.reservedBytes <= frames * 2 * 4 * count * 3));
  await h.player.destroy(); assert.equal(h.context.closed, 1); assert.ok(h.timerClosed());
});

test('network seek stops every scheduled voice, warms new chunks and preserves original time', async () => {
  const h = await ready(); await h.player.play();
  const old = h.context.sources.slice(), stale = old[0].onended!;
  const anchor = old[0].started![0]; h.context.currentTime = anchor + 29.6; h.tick();
  await h.player.seek(95);
  assert.ok(h.context.sources.slice(0, 12).every(node => node.stopped || node.disconnected));
  assert.equal(h.player.time(), 95); assert.ok(h.player.getStatus().playing);
  assert.ok(h.context.sources.slice(-count).every(node => node.buffer!.group === 3 && node.started![1] === 5));
  stale(); assert.equal(h.player.time(), 95);
  h.player.pause(); const paused = h.player.time(); h.context.currentTime += 5; assert.equal(h.player.time(), paused);
  await assert.rejects(h.player.seek(-1)); await assert.rejects(h.player.seek(120.1));
  await h.player.destroy();
});

test('same-chunk short loop is native; mix changes never restart it and multiple solo/mute rules hold', async () => {
  const h = await ready(); h.player.setLoop({ start: 10, end: 10.25 }); await h.player.seek(10); await h.player.play();
  const nodes = h.context.sources.slice(-count), anchor = nodes[0].started![0];
  assert.ok(nodes.every(node => node.loop && node.loopStart === 10 && node.loopEnd === 10.25 && node.started![2] === undefined));
  h.context.currentTime = anchor + 8.1; h.tick(); assert.ok(Math.abs(h.player.time() - 10.1) < 1e-10);
  const length = h.context.sources.length;
  h.player.setMix('drums', { level: 0.4, muted: false, solo: true });
  h.player.setMix('bass', { level: 0.7, muted: false, solo: true });
  h.player.setMix('drums', { level: 0.4, muted: true, solo: true });
  assert.deepEqual(h.context.gains.slice(1).map(gain => gain.targets.at(-1)), [0, 0.7, 0, 0, 0, 0]);
  assert.equal(h.context.sources.length, length); assert.ok(nodes.every(node => !node.stopped));
  h.player.setLoop(null); await until(() => h.player.getStatus().playing);
  assert.ok(nodes.every(node => node.stopped)); assert.ok(h.context.sources.slice(-count).every(node => !node.loop));
  await h.player.destroy();
});

test('cross-chunk loop schedules all voices at exact B-to-A boundary on one clock', async () => {
  const h = await ready(); h.player.setLoop({ start: 29.9, end: 30.2 }); await h.player.seek(29.9); await h.player.play();
  const anchor = h.context.sources[0].started![0];
  // Lookahead crosses the chunk split and the loop boundary several times.
  const cohorts = Array.from({ length: h.context.sources.length / count }, (_, i) => h.context.sources.slice(i * count, (i + 1) * count));
  assert.ok(cohorts.length >= 3);
  for (const cohort of cohorts) assert.equal(new Set(cohort.map(node => node.started![0])).size, 1);
  assert.ok(Math.abs(cohorts[0][0].started![2]! - 0.1) < 1e-10);
  assert.ok(Math.abs(cohorts[1][0].started![0] - (anchor + 0.1)) < 1e-10);
  assert.ok(Math.abs(cohorts[2][0].started![0] - (anchor + 0.3)) < 1e-10);
  assert.equal(cohorts[2][0].started![1], 29.9);
  h.context.currentTime = anchor + 0.31; h.tick(); assert.ok(Math.abs(h.player.time() - 29.91) < 1e-10);
  const stale = cohorts.at(-1)![0].onended!;
  h.player.setLoop({ start: 60, end: 65 }); await until(() => h.player.getStatus().playing);
  stale(); assert.equal(h.player.time(), 60); assert.ok(h.context.sources.slice(-count).every(node => node.loop));
  await h.player.destroy();
});

test('loop-A cache plus current/next stays within three groups throughout a long loop', async () => {
  const h = await ready(); h.player.setLoop({ start: 5, end: 100 }); await h.player.seek(5); await h.player.play();
  const anchor = h.context.sources[0].started![0];
  for (const sourceTime of [29.6, 30.1, 59.6, 60.1, 89.6, 90.1, 99.6]) {
    h.context.currentTime = anchor + sourceTime - 5; h.tick(); await until(() => h.player.getStatus().reservedBytes === 0);
    assert.equal(h.player.getStatus().error, '');
  }
  assert.ok(h.statuses.every(status => status.decodedBytes + status.reservedBytes <= frames * 2 * 4 * count * 3));
  assert.ok(h.context.sources.some(node => node.started && Math.abs(node.started[0] - (anchor + 95)) < 1e-8 && node.started[1] === 5));
  await h.player.destroy();
});

test('missing successor freezes at the committed horizon and pauses every stem while buffering', async () => {
  const h = await ready(); let release!: () => void;
  h.holds.set(2, new Promise(resolve => { release = resolve; }));
  await h.player.play(); const anchor = h.context.sources[0].started![0];
  h.context.currentTime = anchor + 29.6; h.tick();
  h.context.currentTime = anchor + 30.1; h.tick();
  await until(() => h.paths.some(path => path.includes('c2_')));
  h.context.currentTime = anchor + 59.8; h.tick(); assert.ok(h.player.time() < 60);
  h.context.currentTime = anchor + 61; assert.equal(h.player.time(), 60, 'clock cannot run through unscheduled audio'); h.tick();
  assert.equal(h.player.getStatus().state, 'buffering'); assert.equal(h.player.time(), 60);
  assert.ok(h.context.sources.every(node => node.buffer === null));
  h.player.pause(); release(); await until(() => h.player.getStatus().reservedBytes === 0);
  assert.equal(h.player.getStatus().playing, false, 'Pause cancels buffering resume');
  assert.equal(h.player.time(), 60);
  await h.player.play(); assert.equal(h.player.time(), 60);
  await h.player.destroy();
});

test('delayed scheduler never starts an overdue cohort in the past', async () => {
  const h = await ready(); await h.player.play(); const anchor = h.context.sources[0].started![0];
  h.context.currentTime = anchor + 35; h.tick();
  assert.equal(h.player.time(), 30); assert.equal(h.player.getStatus().state, 'paused', 'cached horizon re-prepares without network buffering');
  await until(() => h.player.getStatus().playing);
  assert.equal(h.player.time(), 30);
  assert.ok(h.context.sources.slice(-count).every(node => node.started![0] > h.context.currentTime && node.started![1] === 0));
  await h.player.destroy();
});

test('async future chunk failure stops all voices and reports a recoverable error', async () => {
  const h = await ready(); h.failGroups.add(2); await h.player.play(); const anchor = h.context.sources[0].started![0];
  h.context.currentTime = anchor + 29.6; h.tick(); h.context.currentTime = anchor + 31; h.tick();
  await until(() => h.player.getStatus().state === 'error');
  assert.match(h.player.getStatus().error, /Could not load/);
  assert.ok(h.context.sources.every(node => node.buffer === null && node.disconnected));
  assert.equal(h.player.getStatus().playing, false); assert.equal(h.player.time(), 31);
  await until(() => h.player.getStatus().reservedBytes === 0);
  h.player.pause(); assert.match(h.player.getStatus().error, /Could not load/);
  h.failGroups.clear(); await h.player.play(); assert.ok(h.player.getStatus().playing); assert.equal(h.player.getStatus().error, '');
  await h.player.destroy();
});

test('initial load failures, corrupted hashes and decoded format mismatch close context', async () => {
  for (const failure of ['fetch', 'hash', 'frames', 'rate', 'channels']) {
    const h = harness(), set = fixture();
    if (failure === 'fetch') h.failGroups.add(0);
    if (failure === 'hash') set.chunks![0].files[0].sha256 = 'f'.repeat(64);
    if (['frames', 'rate', 'channels'].includes(failure)) h.context.mismatch = failure;
    await assert.rejects(loadChunkedStemPlayback(set, new AbortController().signal, h.dependencies), /load|verified hash|frame count/);
    assert.equal(h.context.closed, 1); assert.equal(h.context.sources.length, 0); assert.ok(h.timerClosed());
  }
});

test('replacement abort closes context during a pending seek and stale loads cannot create nodes', async () => {
  const h = await ready(); let release!: () => void; h.holds.set(3, new Promise(resolve => { release = resolve; }));
  const seeking = h.player.seek(95); await until(() => h.paths.some(path => path.includes('c3_')));
  h.controller.abort(); release(); await seeking; await h.player.destroy();
  assert.equal(h.context.closed, 1); assert.equal(h.context.sources.length, 0); assert.ok(h.timerClosed());
});

test('rapid seek/Play preparation uses latest position and end/replay does not duplicate voices', async () => {
  const h = await ready();
  const older = h.player.seek(35), latest = h.player.seek(95), playing = h.player.play();
  await Promise.all([older, latest, playing]);
  assert.equal(h.player.time(), 95); assert.equal(h.context.sources.length, count);
  const anchor = h.context.sources[0].started![0]; h.context.currentTime = anchor + 25; h.tick();
  assert.equal(h.player.getStatus().state, 'ended'); assert.equal(h.player.time(), 120);
  await h.player.play(); assert.equal(h.player.time(), 0); assert.equal(h.context.sources.length, count * 2);
  await h.player.destroy(); await h.player.destroy(); assert.equal(h.context.closed, 1);
});

test('invalid or oversize groups reject before allocating an audio context', async () => {
  for (const failure of ['gap', 'missing-track', 'big', 'unsafe']) {
    const h = harness(), set = fixture();
    if (failure === 'gap') set.chunks![1].startFrame++;
    if (failure === 'missing-track') set.chunks![0].files.pop();
    if (failure === 'big') set.chunks![0].frameCount++;
    if (failure === 'unsafe') set.chunks![0].files[0].file = '../private.flac';
    await assert.rejects(loadChunkedStemPlayback(set, new AbortController().signal, h.dependencies));
    assert.equal(h.context.gains.length, 0);
  }
});

test('speed scales the original clock and input horizons while short loops retain source boundaries', async () => {
  for (const rate of [0.5, 0.8, 1.2, 2]) {
    const h = await ready(); h.output.delay = 0.2;
    h.player.setLoop({ start: 10, end: 10.25 }); await h.player.seek(10);
    await h.player.setRate(rate); await h.player.play();
    const nodes = h.context.sources.slice(-count), anchor = nodes[0].started![0];
    assert.ok(nodes.every(node => node.playbackRate.value === rate && node.loopStart === 10 && node.loopEnd === 10.25));
    assert.equal(h.output.starts.at(-1), anchor);
    h.context.currentTime = anchor + 0.19; assert.equal(h.player.time(), 10, 'preroll is not audible source time');
    h.context.currentTime = anchor + 0.2 + 0.6 / rate;
    assert.ok(Math.abs(h.player.time() - 10.1) < 1e-9);
    const before = h.player.time(), paths = h.paths.length;
    h.player.setMix('bass', { level: 0.4, muted: false, solo: true });
    await h.player.setRate(rate === 2 ? 0.5 : 2);
    assert.ok(Math.abs(h.player.time() - before) < 1e-9);
    assert.ok(nodes.every(node => node.stopped)); assert.equal(h.paths.length, paths, 'rate changes retain decoded chunks');
    assert.equal(h.context.gains[2].targets.at(-1), 0.4);
    h.player.pause(); const paused = h.player.time(), length = h.context.sources.length;
    await h.player.setRate(1); h.context.currentTime += 10;
    assert.equal(h.player.time(), paused); assert.equal(h.context.sources.length, length);
    await assert.rejects(h.player.setRate(0.49)); await assert.rejects(h.player.setRate(2.01));
    await h.player.destroy(); assert.equal(h.output.destroyed, 1);
  }
});

test('cross-chunk rate scheduling divides wall duration once and waits for audible end tail', async () => {
  for (const rate of [0.5, 0.8, 1.2, 2]) {
    const h = await ready(); h.output.delay = 0.2;
    h.player.setLoop({ start: 29.9, end: 30.2 }); await h.player.seek(29.9);
    await h.player.setRate(rate); await h.player.play();
    const anchor = h.context.sources[0].started![0];
    assert.ok(Math.abs(h.context.sources[0].started![2]! - 0.1) < 1e-9, 'duration argument remains source seconds');
    assert.ok(Math.abs(h.context.sources[count].started![0] - (anchor + 0.1 / rate)) < 1e-9);
    h.context.currentTime = anchor + 0.15 / rate; h.tick();
    assert.ok(Math.abs(h.context.sources[count * 2].started![0] - (anchor + 0.3 / rate)) < 1e-9);
    h.player.pause(); h.player.setLoop(null); await h.player.seek(119); await h.player.play();
    const last = h.context.sources.at(-1)!, end = last.started![0] + 1 / rate;
    h.context.currentTime = end; h.tick();
    assert.equal(h.player.getStatus().state, 'playing', 'input end still has audible delayed output');
    assert.ok(h.player.time() < 120); assert.equal(h.output.drains.at(-1), end);
    h.context.currentTime = end + 0.2; h.tick();
    assert.equal(h.player.getStatus().state, 'ended'); assert.equal(h.player.time(), 120);
    assert.ok(h.statuses.every(status => status.decodedBytes + status.reservedBytes <= frames * 2 * 4 * count * 3));
    await h.player.destroy();
  }
});

test('speed change during deferred seek keeps the latest source position and Pause cancels reset completion', async () => {
  const h = await ready(); let release!: () => void;
  h.holds.set(3, new Promise(resolve => { release = resolve; }));
  await h.player.play();
  const seek = h.player.seek(95); await until(() => h.paths.some(path => path.includes('c3_')));
  const rate = h.player.setRate(2); release(); await Promise.all([seek, rate]);
  assert.equal(h.player.time(), 95); assert.ok(h.player.getStatus().playing);
  assert.ok(h.context.sources.slice(-count).every(node => node.playbackRate.value === 2 && node.started![1] === 5));
  h.output.resetGate = new Promise(resolve => { release = resolve; });
  const changing = h.player.setRate(0.5); await until(() => h.output.resets.at(-1) === 0.5);
  h.player.pause(); release(); await changing;
  assert.equal(h.player.getStatus().playing, false); assert.equal(h.player.time(), 95);
  await h.player.destroy();
});

test('double-speed lookahead traverses long loops without enlarging the three-group memory bound', async () => {
  const h = await ready(); h.output.delay = 0.2;
  h.player.setLoop({ start: 5, end: 100 }); await h.player.seek(5); await h.player.setRate(2); await h.player.play();
  const anchor = h.context.sources[0].started![0];
  for (const sourceTime of [29.4, 30.1, 59.4, 60.1, 89.4, 90.1, 99.4]) {
    h.context.currentTime = anchor + (sourceTime - 5) / 2; h.tick();
    await until(() => h.player.getStatus().reservedBytes === 0);
    assert.equal(h.player.getStatus().error, '');
  }
  assert.ok(h.statuses.every(status => status.decodedBytes + status.reservedBytes <= frames * 2 * 4 * count * 3));
  assert.ok(h.context.sources.some(node => node.started && Math.abs(node.started[0] - (anchor + 95 / 2)) < 1e-9 && node.started[1] === 5));
  await h.player.destroy();
});

test('abort while the async pitch output is being created destroys late output and closes context once', async () => {
  const h = harness(), controller = new AbortController(); let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), creating = new Promise<void>(resolve => { started = resolve; });
  const loading = loadChunkedStemPlayback(fixture(), controller.signal, { ...h.dependencies, createRateOutput: async () => { started(); await gate; return h.output as StemRateOutput; } });
  await creating; controller.abort(); release(); await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(h.context.closed, 1); assert.equal(h.output.destroyed, 1); assert.equal(h.context.sources.length, 0);
});

test('obsolete speed reset failure cannot reject into a newer successful seek', async () => {
  const h = await ready(); await h.player.play();
  let reject!: (error: Error) => void, started!: () => void;
  const resetting = new Promise<void>(resolve => { started = resolve; });
  const reset = h.output.reset.bind(h.output); let blocked = true;
  h.output.reset = async rate => {
    if (blocked) { blocked = false; started(); await new Promise<void>((_resolve, fail) => { reject = fail; }); return; }
    await reset(rate);
  };
  const changing = h.player.setRate(0.8); const result = changing.then(() => 'resolved', () => 'rejected');
  await resetting; await h.player.seek(95); reject(new Error('obsolete reset failure'));
  assert.equal(await result, 'resolved'); assert.equal(h.player.time(), 95);
  assert.equal(h.player.getStatus().state, 'playing'); assert.equal(h.player.getStatus().error, '');
  await h.player.destroy();
});

test('current speed reset failure remains visible and rejects instead of being mistaken for cancellation', async () => {
  const h = await ready(); await h.player.play();
  h.output.reset = async () => { throw new Error('current processor failure'); };
  await assert.rejects(h.player.setRate(0.8), /current processor failure/);
  assert.equal(h.player.getStatus().state, 'error'); assert.equal(h.player.getStatus().playing, false);
  assert.match(h.player.getStatus().error, /current processor failure/); await h.player.destroy();
});

test('cached playing and paused seeks reuse decoded groups without fetch, decode or buffering', async () => {
  const h = await ready(); await h.player.play();
  const paths = h.paths.length, decoded = h.context.decoded;
  h.statuses.length = 0;
  const old = h.context.sources.slice(); await h.player.seek(12); await h.player.seek(25);
  assert.equal(h.player.time(), 25); assert.ok(h.player.getStatus().playing);
  assert.ok(old.every(node => node.stopped && node.buffer === null));
  h.player.pause(); await h.player.seek(18); assert.equal(h.player.time(), 18);
  assert.equal(h.player.getStatus().playing, false); await h.player.play();
  await until(() => h.player.getStatus().reservedBytes === 0);
  assert.equal(h.paths.length, paths); assert.equal(h.context.decoded, decoded);
  assert.ok(h.statuses.every(status => !status.buffering));
  await h.player.destroy();
});

test('cached target resumes while uncached next group prefetches; an uncached target genuinely buffers', async () => {
  const h = await ready(); await h.player.play(); let releaseNext!: () => void;
  h.holds.set(2, new Promise(resolve => { releaseNext = resolve; })); h.statuses.length = 0;
  await h.player.seek(35);
  assert.equal(h.player.time(), 35); assert.ok(h.player.getStatus().playing);
  await until(() => h.paths.some(path => path.includes('c2_')));
  assert.ok(h.statuses.every(status => !status.buffering));
  assert.equal(h.paths.filter(path => /c[01]_/.test(path)).length, 12, 'cached chunks were not fetched again');
  let releaseTarget!: () => void; h.holds.set(3, new Promise(resolve => { releaseTarget = resolve; }));
  const seek = h.player.seek(95);
  await until(() => h.paths.some(path => path.includes('c3_')));
  assert.equal(h.player.getStatus().state, 'buffering'); assert.equal(h.player.getStatus().playing, false);
  assert.equal(h.player.time(), 95); releaseNext(); releaseTarget(); await seek;
  assert.ok(h.player.getStatus().playing); assert.equal(h.player.time(), 95);
  assert.ok(h.statuses.every(status => status.decodedBytes + status.reservedBytes <= frames * 2 * 4 * count * 3));
  await h.player.destroy();
});

test('instrument gain accepts 0–200%, defaults to unity, and boosted mute/solo retains level without restart', async () => {
  const h = await ready(); await h.player.play(); const nodes = h.context.sources.length;
  assert.ok(h.context.gains.slice(1).every(gain => gain.gain.value === 1));
  h.player.setMix('bass', { level: 2, muted: false, solo: true });
  assert.equal(h.context.gains[2].targets.at(-1), 2);
  h.player.setMix('bass', { level: 2, muted: true, solo: true });
  assert.equal(h.context.gains[2].targets.at(-1), 0);
  h.player.setMix('bass', { level: 2, muted: false, solo: false });
  assert.equal(h.context.gains[2].targets.at(-1), 2);
  h.player.setMix('bass', { level: 0, muted: false, solo: false });
  assert.equal(h.context.gains[2].targets.at(-1), 0);
  for (const level of [-0.01, 2.01, NaN, Infinity]) assert.throws(() => h.player.setMix('bass', { level, muted: false, solo: false }));
  assert.equal(h.context.sources.length, nodes); await h.player.destroy();
});

test('cached seek need not wait for an old decoder, but replacement allocations wait for its reservation', async () => {
  const h = await ready(); let release!: () => void, started = 0;
  const gate = new Promise<void>(resolve => { release = resolve; }), decode = h.context.decodeAudioData.bind(h.context);
  h.context.decodeAudioData = async data => {
    if (new Uint8Array(data)[0] === 2) { ++started; await gate; }
    return decode(data);
  };
  await h.player.play(); const anchor = h.context.sources[0].started![0];
  h.context.currentTime = anchor + 29.6; h.tick(); h.context.currentTime = anchor + 30.1; h.tick();
  await until(() => started === count);
  h.statuses.length = 0; await h.player.seek(35);
  assert.equal(h.player.time(), 35); assert.ok(h.player.getStatus().playing);
  assert.ok(h.statuses.every(status => !status.buffering));
  const uncached = h.player.seek(95);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(h.player.getStatus().state, 'buffering');
  assert.ok(!h.paths.some(path => path.includes('c3_')), 'replacement must not allocate before old decode settles');
  release(); await uncached;
  assert.equal(h.player.time(), 95); assert.ok(h.player.getStatus().playing);
  assert.ok(h.statuses.every(status => status.decodedBytes + status.reservedBytes <= frames * 2 * 4 * count * 3));
  await h.player.destroy();
});
