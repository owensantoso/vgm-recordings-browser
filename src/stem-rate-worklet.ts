import { SoundTouch } from '@soundtouchjs/core';

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; constructor(options?: unknown); }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

/** Transport adapter only: pitch DSP and its clear operation come from SoundTouch. */
class StemRateProcessor extends AudioWorkletProcessor {
  private readonly pipe = new SoundTouch({ sampleRate });
  private readonly delay: number;
  private generation = 0;
  private rate = 1;
  private startFrame = Infinity;
  private endFrame = Infinity;
  private drainId = 0;
  private stopped = false;
  private inputSamples = new Float32Array(256);
  private outputSamples = new Float32Array(256);

  constructor(options: { processorOptions?: { latencySeconds?: number } }) {
    super();
    this.delay = Math.ceil((options.processorOptions?.latencySeconds ?? .2) * sampleRate);
    this.port.onmessage = event => {
      const message = event.data;
      if (message.generation < this.generation) { this.ack(message.id); return; }
      this.generation = message.generation;
      if (message.type === 'reset' || message.type === 'pause' || message.type === 'destroy') {
        this.pipe.clear(); this.startFrame = this.endFrame = Infinity; this.ack(this.drainId); this.drainId = 0;
        if (message.type === 'reset') { this.rate = message.rate; this.pipe.pitch = 1 / this.rate; }
        if (message.type === 'destroy') this.stopped = true;
        this.ack(message.id);
      } else if (message.type === 'start') {
        this.startFrame = Math.round(message.when * sampleRate);
        this.endFrame = Infinity;
      } else if (message.type === 'drain') {
        this.endFrame = Math.round(message.when * sampleRate);
        this.drainId = message.id;
      }
    };
  }
  private ack(id: number | undefined) { if (id) this.port.postMessage({ type: 'ack', id }); }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output?.[0]) return !this.stopped;
    output.forEach(channel => channel.fill(0));
    if (this.stopped) return false;
    const frames = output[0].length, blockEnd = currentFrame + frames;
    const latency = this.rate === 1 ? 0 : this.delay;
    if (blockEnd <= this.startFrame) return true;
    try {
      if (this.rate !== 1) {
        if (this.inputSamples.length < frames * 2) {
          this.inputSamples = new Float32Array(frames * 2); this.outputSamples = new Float32Array(frames * 2);
        }
        const from = Math.max(0, this.startFrame - currentFrame);
        const until = Math.min(frames, this.endFrame + latency - currentFrame);
        const count = Math.max(0, until - from);
        const input = inputs[0];
        for (let i = 0; i < count; ++i) {
          const offset = i + from, audibleInput = currentFrame + offset < this.endFrame;
          this.inputSamples[i * 2] = audibleInput ? input?.[0]?.[offset] ?? 0 : 0;
          this.inputSamples[i * 2 + 1] = audibleInput ? (input?.[1] ?? input?.[0])?.[offset] ?? 0 : 0;
        }
        if (count) { this.pipe.inputBuffer.putSamples(this.inputSamples, 0, count); this.pipe.process(); }
        const outputFrom = Math.max(from, this.startFrame + latency - currentFrame);
        const needed = Math.max(0, until - outputFrom);
        if (needed > this.pipe.outputBuffer.frameCount) throw new Error('Pitch processing could not keep up. Playback paused.');
        if (this.pipe.inputBuffer.frameCount > sampleRate || this.pipe.outputBuffer.frameCount > sampleRate) throw new Error('Pitch processing exceeded its bounded audio buffer.');
        if (needed) {
          this.pipe.outputBuffer.extract(this.outputSamples, 0, needed); this.pipe.outputBuffer.receive(needed);
          for (let i = 0; i < needed; ++i) {
            if (!Number.isFinite(this.outputSamples[i * 2]) || !Number.isFinite(this.outputSamples[i * 2 + 1])) throw new Error('Pitch processing produced invalid audio.');
            output[0][i + outputFrom] = this.outputSamples[i * 2];
            if (output[1]) output[1][i + outputFrom] = this.outputSamples[i * 2 + 1];
          }
        }
      }
      if (blockEnd >= this.endFrame + latency) {
        this.ack(this.drainId); this.drainId = 0; this.pipe.clear(); this.startFrame = this.endFrame = Infinity;
      }
    } catch (error) {
      output.forEach(channel => channel.fill(0));
      this.pipe.clear(); this.startFrame = this.endFrame = Infinity;
      this.port.postMessage({ type: 'error', generation: this.generation, message: error instanceof Error ? error.message : 'Pitch processing failed.' });
    }
    return true;
  }
}

registerProcessor('vgm-stem-rate', StemRateProcessor);
