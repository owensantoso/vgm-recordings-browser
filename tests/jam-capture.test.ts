import test from 'node:test';
import assert from 'node:assert/strict';
import { recordMicrophone, backedMicInterval } from '../src/jamCapture.ts';

function harness(clock: boolean = true) {
  let now = 0, tick = () => {}, stopped = 0, backingStarts = 0, backingStops = 0;
  const track = { stop() { stopped++; }, addEventListener() {}, removeEventListener() {} };
  let recorder: FakeRecorder;
  class FakeRecorder {
    static isTypeSupported() { return true; }
    mimeType = 'audio/webm'; state = 'inactive'; onstart?: () => void; onstop?: () => void; ondataavailable?: (event: {data: Blob}) => void;
    constructor() { recorder = this; }
    start() { this.state = 'recording'; queueMicrotask(() => this.onstart?.()); }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({data:new Blob(['complete-file'])}); this.onstop?.(); }); }
  }
  const source = {time:10,playing:false,buffering:false,error:'',end:100,rate:.8};
  const capture = recordMicrophone({getTracks:()=>[track]} as unknown as MediaStream, {
    clock:clock ? ()=>source : null, startBacking(){backingStarts++;},stopBacking(){backingStops++;},onElapsed(){},
  }, {Recorder:FakeRecorder as unknown as typeof MediaRecorder,now:()=>now,interval:((fn:()=>void)=>{tick=fn;return 1;}) as unknown as typeof setInterval,clearInterval:(()=>{}) as typeof clearInterval});
  return {capture,source,advance(wall:number,time:number){now=wall;source.time=time;tick();},counts:()=>({stopped,backingStarts,backingStops}),recorder:()=>recorder!};
}

test('microphone waits for recorder start, retains onset, and ends coverage before discontinuity', async()=>{
  const h=harness(); assert.equal(h.counts().backingStarts,0); await Promise.resolve();
  assert.equal(h.counts().backingStarts,1);h.source.playing=true;
  h.advance(50,10);h.advance(100,10.04);h.advance(200,10.12);h.advance(250,20);
  const take=await h.capture.done;
  assert.equal(take.captureEnd,'interrupted');assert.equal(take.estimate?.micStart,0);assert.equal(take.estimate?.micEnd,.2);
  assert.ok(Math.abs(take.estimate!.sourceAtCaptureZero-9.96)<.00001);
  assert.equal(await take.blob.text(),'complete-file');assert.ok(h.counts().stopped>0);
  assert.equal(h.counts().backingStops,1);
});
test('free capture finalizes exactly once and its duration limit releases microphone',async()=>{
  const h=harness(false);await Promise.resolve();h.advance(120000,0);
  const take=await h.capture.done;assert.equal(take.captureEnd,'limit');assert.equal(take.estimate,null);
  assert.equal(await h.capture.stop('interrupted'),take);assert.equal(h.counts().backingStops,1);
});
test('buffering retains only the preceding continuous prefix',async()=>{
  const h=harness();await Promise.resolve();h.source.playing=true;h.advance(50,10);h.advance(100,10.04);
  h.source.buffering=true;h.advance(150,10.04);const take=await h.capture.done;
  assert.equal(take.captureEnd,'interrupted');assert.equal(take.estimate?.micEnd,.1);
});
test('manual correction intersects exact excerpt coverage and raw mic duration',()=>{
  const estimate={sourceAtCaptureZero:29,rate:.5,micStart:0,micEnd:12};
  assert.deepEqual(backedMicInterval(estimate,10,{start:30,end:32},1),{start:3,end:7});
  assert.equal(backedMicInterval(estimate,2,{start:30,end:32},1),null);
});
