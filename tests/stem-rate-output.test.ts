import test from 'node:test';
import assert from 'node:assert/strict';
import { createStemRateOutput } from '../src/StemRateOutput.ts';

class Gain {
  gain = { value: 0, cancelScheduledValues() {}, setValueAtTime() {} };
  connect() {}
  disconnect() {}
}
class Context {
  state = 'running'; currentTime = 0; destination = {};
  audioWorklet = { async addModule() {} };
  createGain() { return new Gain(); }
  addEventListener() {}
  removeEventListener() {}
}
class Worklet extends Gain {
  static latest: Worklet;
  hold = false;
  messages: { type: string; id?: number; generation: number }[] = [];
  onprocessorerror: (() => void) | null = null;
  port = {
    onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
    postMessage: (message: { type: string; id?: number; generation: number }) => {
      this.messages.push(message);
      if (message.id && !this.hold) queueMicrotask(() => this.emit({ type: 'ack', id: message.id }));
    },
    close() {},
  };
  constructor() { super(); Worklet.latest = this; }
  emit(data: Record<string, unknown>) { this.port.onmessage?.({ data }); }
  get generation() { return this.messages.at(-1)!.generation; }
}

function browserGlobals(t: { after(callback: () => void): void }) {
  for (const [name, value] of Object.entries({ AudioWorkletNode: Worklet, document: { baseURI: 'https://example.test/practice/' } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
}

test('recoverable worklet errors belong to their render generation; processor crashes stay fatal', async t => {
  browserGlobals(t);
  const output = await createStemRateOutput(new Context() as unknown as AudioContext);
  const node = Worklet.latest, failures: string[] = [];
  output.onError(error => failures.push(error.message));
  const old = node.generation;
  await output.reset(.8);
  node.emit({ type: 'error', generation: old, message: 'retired audio underrun' });
  assert.deepEqual(failures, []);
  assert.doesNotThrow(() => output.start(1));
  node.emit({ type: 'error', generation: node.generation, message: 'current underrun' });
  assert.deepEqual(failures, ['current underrun']);
  await output.reset(1);
  node.onprocessorerror?.();
  assert.match(failures.at(-1)!, /Pitch processing stopped/);
  await output.destroy();
});

test('a retired reset timeout rejects its own promise without poisoning a newer reset', async t => {
  browserGlobals(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const output = await createStemRateOutput(new Context() as unknown as AudioContext);
  const node = Worklet.latest, failures: string[] = [];
  output.onError(error => failures.push(error.message));
  node.hold = true;
  const oldReset = assert.rejects(output.reset(.8), /did not acknowledge/);
  node.hold = false;
  await output.reset(1.2);
  t.mock.timers.tick(3001);
  await oldReset;
  assert.deepEqual(failures, []);
  assert.doesNotThrow(() => output.start(1));
  node.hold = true;
  const currentReset = assert.rejects(output.reset(.9), /did not acknowledge/);
  t.mock.timers.tick(3001);
  await currentReset;
  assert.equal(failures.length, 1);
  await output.destroy();
});
