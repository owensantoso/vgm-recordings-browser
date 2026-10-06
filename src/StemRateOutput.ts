/** One pitch-preserving output for the already synchronized instrument mix. */
export interface StemRateOutput {
  readonly input: AudioNode;
  readonly latencySeconds: number;
  reset(rate?: number): Promise<void>;
  start(when: number): void;
  pause(): void;
  drain(atContextTime: number): Promise<void>;
  onError(listener: (error: Error) => void): () => void;
  destroy(): Promise<void>;
}

const PROCESSOR = 'vgm-stem-rate';
const LATENCY = .2;
const registrations = new WeakMap<AudioContext, Promise<void>>();

export async function createStemRateOutput(context: AudioContext): Promise<StemRateOutput> {
  let registration = registrations.get(context);
  if (!registration) {
    registration = context.audioWorklet.addModule(new URL('assets/stem-rate-worklet.js', document.baseURI).href);
    registrations.set(context, registration);
    void registration.catch(() => registrations.delete(context));
  }
  await registration;
  const input = context.createGain();
  const direct = context.createGain();
  const processed = context.createGain();
  const node = new AudioWorkletNode(context, PROCESSOR, {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    channelCount: 2, channelCountMode: 'explicit', processorOptions: { latencySeconds: LATENCY },
  });
  input.connect(direct); direct.connect(context.destination);
  input.connect(node); node.connect(processed); processed.connect(context.destination);
  direct.gain.value = processed.gain.value = 0;
  let rate = 1, generation = 0, serial = 0, destroyed = false;
  let failure: Error | null = null;
  const pending = new Map<number, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> | null; drain: boolean }>();
  const listeners = new Set<(error: Error) => void>();
  function silence() {
    for (const gain of [direct.gain, processed.gain]) {
      gain.cancelScheduledValues(context.currentTime);
      gain.setValueAtTime(0, context.currentTime);
    }
  }
  function settle(id: number, error?: Error) {
    const request = pending.get(id); if (!request) return;
    if (request.timer) clearTimeout(request.timer);
    pending.delete(id); if (error) request.reject(error); else request.resolve();
  }
  function cancelDrains() { for (const [id, request] of pending) if (request.drain) settle(id); }
  function fail(error: Error) {
    if (destroyed) return;
    failure = error; silence();
    for (const id of pending.keys()) settle(id, error);
    for (const listener of listeners) listener(error);
  }
  function command(type: string, fields: Record<string, number> = {}, drain = false): Promise<void> {
    const id = ++serial;
    const requestGeneration = generation;
    return new Promise((resolve, reject) => {
      const timer = drain ? null : setTimeout(() => {
        const error = new Error('Pitch processor did not acknowledge its reset.');
        settle(id, error);
        if (requestGeneration === generation) fail(error);
      }, 3000);
      pending.set(id, { resolve, reject, timer, drain });
      node.port.postMessage({ type, id, generation: requestGeneration, ...fields });
    });
  }
  node.port.onmessage = event => {
    if (event.data.type === 'ack') settle(event.data.id);
    else if (event.data.type === 'error' && event.data.generation === generation) fail(new Error(event.data.message || 'Pitch processing failed.'));
  };
  node.onprocessorerror = () => fail(new Error('Pitch processing stopped. Reload this recording.'));
  function stateChanged() {
    if (context.state !== 'running') cancelDrains();
    if (context.state === 'closed') {
      for (const id of pending.keys()) settle(id, destroyed ? undefined : new Error('The pitch audio context was closed.'));
    }
  }
  context.addEventListener('statechange', stateChanged);
  const output: StemRateOutput = {
    input,
    get latencySeconds() { return rate === 1 ? 0 : LATENCY; },
    async reset(nextRate = rate) {
      if (destroyed) throw new Error('The pitch output has been closed.');
      if (!Number.isFinite(nextRate) || nextRate < .5 || nextRate > 2) throw new Error('Practice speed must be between 0.5× and 2×.');
      ++generation; rate = nextRate; failure = null; silence(); cancelDrains();
      await command('reset', { rate });
    },
    start(when) {
      if (destroyed || failure) throw failure || new Error('The pitch output has been closed.');
      if (!Number.isFinite(when) || when < context.currentTime) throw new Error('The pitch output start time is in the past.');
      silence();
      node.port.postMessage({ type: 'start', generation, when });
      (rate === 1 ? direct : processed).gain.setValueAtTime(1, when);
    },
    pause() {
      if (destroyed) return;
      ++generation; silence(); cancelDrains();
      node.port.postMessage({ type: 'pause', generation });
    },
    drain(atContextTime) {
      if (destroyed || context.state !== 'running') return Promise.resolve();
      if (!Number.isFinite(atContextTime)) return Promise.reject(new Error('The pitch output end time is invalid.'));
      if (failure) return Promise.reject(failure);
      const end = Math.max(context.currentTime, atContextTime + output.latencySeconds);
      (rate === 1 ? direct : processed).gain.setValueAtTime(0, end);
      return command('drain', { when: atContextTime }, true);
    },
    onError(listener) { listeners.add(listener); if (failure) listener(failure); return () => listeners.delete(listener); },
    async destroy() {
      if (destroyed) return;
      ++generation; destroyed = true; silence(); cancelDrains();
      // A stopped processor returns false; disconnecting alone does not end it.
      for (const id of pending.keys()) settle(id);
      if (context.state !== 'closed' && !failure) {
        try { await command('destroy'); } catch { /* The engine also owns context closure. */ }
      } else node.port.postMessage({ type: 'destroy', generation });
      context.removeEventListener('statechange', stateChanged);
      node.onprocessorerror = null; node.port.onmessage = null; node.port.close();
      input.disconnect(); direct.disconnect(); node.disconnect(); processed.disconnect(); listeners.clear();
    },
  };
  try { await output.reset(); }
  catch (error) { await output.destroy(); throw error; }
  return output;
}
