import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Square, Play, Download } from 'lucide-react';
import { enableMicrophone, releaseMicrophone, recordMicrophone, inspectMic, backedMicInterval, storeMicDraft, readMicDraft, discardMicDraft } from './jamCapture';
import type { MicClock, StoredMicDraft, CaptureEnd } from './jamCapture';
import { fetchJamContext, saveJam, updateJamCorrection } from './jamData';
import type { Jam, JamInput, JamBackingMix, JamContext, RecordingRef, JamInstrument } from './jamData';
import { correctedJamInterval } from './timelineProjection';
import { formatTime } from './recordings';

type DraftData = { input: JamInput; duration: number; decoded: boolean };
export interface JamRecorderProps {
  host: HTMLElement | null; songId: string; recording: RecordingRef;
  sourceMode: 'audio' | 'stems' | 'video'; ready: boolean;
  activeSectionId: string; rate: number;
  mix: Record<string, { level: number; muted: boolean; solo: boolean }>;
  getClock(): MicClock;
  prepareCapture(): Promise<{ start: number; end: number }>;
  suspendBackingForDecode(): Promise<() => void>;
  prepareReplay(mix: JamBackingMix, at: number): Promise<void>;
  playBacking(): void; pauseBacking(): void;
  onLocked(value: boolean): void;
  onMixAudition(value: boolean): void;
  registerStop(stop: (() => void) | null): void;
  jamToReplay?: Jam | null; jamReplayRequest?: number; jamReplayStart?: number;
  onJamSaved?(jam: Jam): void;
}
export function JamRecorder(props: JamRecorderProps) {
  const latest = useRef(props); latest.current = props;
  const [open, setOpen] = useState(false), [phase, setPhase] = useState('idle');
  const [context, setContext] = useState<JamContext | null>(null);
  const [free, setFree] = useState(false), [instrument, setInstrument] = useState(''), [custom, setCustom] = useState('');
  const [section, setSection] = useState(false), [name, setName] = useState('');
  const [count, setCount] = useState(3), [elapsed, setElapsed] = useState(0), [message, setMessage] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draft, setDraft] = useState<StoredMicDraft<DraftData> | null>(null);
  const [saved, setSaved] = useState<Jam | null>(null), [micGain, setMicGain] = useState(1), [replaying, setReplaying] = useState(false);
  const [url, setUrl] = useState('');
  const stream = useRef<MediaStream | null>(null), capture = useRef<ReturnType<typeof recordMicrophone> | null>(null);
  const countdown = useRef<ReturnType<typeof setInterval> | null>(null), replayTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mic = useRef<HTMLAudioElement | null>(null), generation = useRef(0), mounted = useRef(true), locked = useRef(false), finalizing = useRef(false);
  const lock = (value: boolean) => { locked.current = value; latest.current.onLocked(value); };
  const stopReplay = () => {
    ++generation.current;
    if (replayTimer.current) clearInterval(replayTimer.current); replayTimer.current = null;
    mic.current?.pause(); latest.current.pauseBacking(); latest.current.onMixAudition(false);
    if (mounted.current) setReplaying(false); lock(false);
  };
  const stop = (reason: CaptureEnd = 'stopped') => {
    if (finalizing.current) return;
    ++generation.current;
    if (countdown.current) { clearInterval(countdown.current); countdown.current = null; }
    if (!capture.current) releaseMicrophone(stream.current); stream.current = null;
    if (capture.current) { if (mounted.current) setPhase('finalizing'); void capture.current.stop(reason); }
    else { if (mounted.current) setPhase('idle'); stopReplay(); }
  };
  useEffect(() => {
    mounted.current = true; props.registerStop(() => stop());
    void readMicDraft<DraftData>().then(value => { if (mounted.current) { if (value) { setDraft(value); setOpen(true); setMessage(value.notice); } setDraftLoaded(true); } });
    const hide = () => { if (document.hidden && locked.current) stop('interrupted'); };
    const unload = (event: BeforeUnloadEvent) => { if (locked.current || capture.current) { stop('interrupted'); event.preventDefault(); event.returnValue = ''; } };
    document.addEventListener('visibilitychange', hide); window.addEventListener('beforeunload', unload);
    return () => { mounted.current = false; stop('interrupted'); props.registerStop(null); document.removeEventListener('visibilitychange', hide); window.removeEventListener('beforeunload', unload); };
  }, []);
  useEffect(() => { if (!props.host && locked.current) stop('interrupted'); }, [props.host]);
  useEffect(() => {
    let active = true;
    void fetchJamContext(props.recording).then(value => { if (active) setContext(value); }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [props.recording.kind, props.recording.id]);
  useEffect(() => {
    if (!props.jamToReplay || !draftLoaded) return;
    if (draft) { setOpen(true); setMessage('Save or discard the current unsaved draft before opening another jam.'); return; }
    stop(); setSaved(props.jamToReplay); setOpen(true); setMessage('Saved jam prepared paused.');
  }, [props.jamToReplay?.id, props.jamReplayRequest, draftLoaded]);
  useEffect(() => {
    if (draft && !saved) { const local = URL.createObjectURL(draft.blob); setUrl(local); return () => URL.revokeObjectURL(local); }
    setUrl(saved?.audioUrl || '');
  }, [draft?.blob, saved?.id]);
  useEffect(() => { if (mic.current) mic.current.volume = micGain; }, [micGain, url]);
  const busy = ['arming', 'preparing', 'countdown', 'recording', 'finalizing', 'saving'].includes(phase);
  function snapshot(): JamBackingMix | null {
    if (free) return null;
    if (!context?.audio || props.sourceMode === 'video') throw new Error('Choose verified local Audio before recording with backing.');
    if (props.sourceMode === 'stems' && !context.stemSet) throw new Error('The current stem revision is unavailable.');
    return { schemaVersion: 1, source: context.audio, mode: props.sourceMode === 'stems' ? 'stems' : 'original', playbackRate: props.rate, masterGain: 1,
      stems: props.sourceMode === 'stems' && context.stemSet ? { setId: context.stemSet.id, revision: context.stemSet.revision,
        tracks: context.stemSet.tracks.map(track => ({ id: track.id, assetHash: track.assetHash, ...(props.mix[track.id] || { level: 1, muted: false, solo: false }) })) } : null };
  }
  function selectedInstrument(): JamInstrument | null {
    if (instrument === 'custom') { if (!custom.trim()) throw new Error('Name the instrument you are playing.'); return { kind: 'custom', label: custom.trim() }; }
    if (!instrument) return null;
    const track = context?.stemSet?.tracks.find(track => track.id === instrument);
    if (!track || !context?.audio || !context.stemSet) throw new Error('Instrument source is unavailable.');
    return { kind: 'stem', source: context.audio, stemSetId: context.stemSet.id, stemSetRevision: context.stemSet.revision, trackId: track.id, labelSnapshot: track.label };
  }
  async function arm() {
    if (!draftLoaded) return;
    if (draft) { setMessage('Save or explicitly discard the existing draft before another take.'); return; }
    const token = ++generation.current; setPhase('arming'); setMessage(''); lock(true);
    try {
      const input = await enableMicrophone();
      if (token !== generation.current || !mounted.current) { releaseMicrophone(input); return; }
      stream.current = input; setPhase('armed');
    } catch (error) { if (mounted.current && token === generation.current) { setMessage(String(error instanceof Error ? error.message : error)); setPhase('idle'); lock(false); } }
  }
  async function begin() {
    if (!stream.current || capture.current) return;
    const token = ++generation.current; setPhase('preparing');
    try {
      const backing = snapshot(), playedInstrument = selectedInstrument();
      const association = context?.sections.find(value => value.id === props.activeSectionId);
      const input: JamInput = { schemaVersion: 1, captureId: crypto.randomUUID(), songId: props.songId, title: name.trim() || 'Practice jam', instrument: playedInstrument,
        sections: section && association && context?.audio ? [{ source: context.audio, sectionId: association.id, sectionRevision: association.revision, labelSnapshot: association.label }] : [],
        alignment: null, backingMix: backing, captureEnd: 'stopped' };
      latest.current.pauseBacking(); const captureBounds = backing ? await latest.current.prepareCapture() : null;
      if (token !== generation.current || !stream.current || !mounted.current) return;
      setPhase('countdown'); setCount(3); let remaining = 3;
      countdown.current = setInterval(() => {
        --remaining; setCount(remaining);
        if (remaining > 0) return;
        clearInterval(countdown.current!); countdown.current = null;
        if (token !== generation.current || !stream.current) return;
        setPhase('recording'); setElapsed(0);
        try {
          const recording = recordMicrophone(stream.current, { clock: backing ? () => latest.current.getClock() : null,
            startBacking: () => { if (backing) latest.current.playBacking(); }, stopBacking: () => latest.current.pauseBacking(), onElapsed: setElapsed });
          capture.current = recording;
          void recording.done.then(async take => {
            finalizing.current = true; capture.current = null; stream.current = null;
            if (mounted.current) setPhase('finalizing');
            input.captureEnd = take.captureEnd;
            let duration = 0, decoded = false, notice = take.notice;
            try {
              const resumeBacking = await latest.current.suspendBackingForDecode();
              let audio;
              try { audio = await inspectMic(take.blob); } finally { if (mounted.current) resumeBacking(); }
              duration = audio.duration; decoded = true;
              if (backing && take.estimate) {
                const bounds = backing.mode === 'stems' && context?.stemSet ? context.stemSet : { start: 0, end: backing.source.durationSeconds };
                const covered = backedMicInterval(take.estimate, duration, { start: Math.max(bounds.start, captureBounds?.start ?? bounds.start), end: Math.min(bounds.end, captureBounds?.end ?? bounds.end) });
                if (covered) input.alignment = { source: backing.source, sourceAtCaptureZero: take.estimate.sourceAtCaptureZero, sourceSecondsPerCaptureSecond: backing.playbackRate,
                  clockBasis: 'observed-media-time', estimateProvenance: 'MediaRecorder start delivery and paired performance.now()/audible transport observations; manual correction required for acoustic latency.',
                  coverage: { micStart: covered.start, micEnd: covered.end, sourceStart: take.estimate.sourceAtCaptureZero + covered.start * backing.playbackRate, sourceEnd: take.estimate.sourceAtCaptureZero + covered.end * backing.playbackRate }, correctionSeconds: 0, correctionReviewed: false };
              }
            } catch (error) { notice += ` ${error instanceof Error ? error.message : error}`; }
            if (backing && !input.alignment) notice += ' No continuous backing alignment was established; microphone-only replay is available.';
            const value = { id: input.captureId, songId: input.songId, blob: take.blob, metadata: { input, duration, decoded }, notice: notice.trim() };
            try { await storeMicDraft(value); }
            catch { value.notice += ' Browser draft storage failed. Keep this page open and download or save the take.'; }
            if (mounted.current) { setDraft(value); setSaved(null); setMessage(value.notice); setPhase('review'); }
            finalizing.current = false; lock(false);
          }).catch(error => { finalizing.current = false; if (mounted.current) { setMessage(String(error)); setPhase('idle'); } lock(false); });
        } catch (error) { releaseMicrophone(stream.current); stream.current = null; setMessage(String(error)); setPhase('idle'); lock(false); }
      }, 1000);
    } catch (error) { if (token === generation.current && mounted.current) { setMessage(error instanceof Error ? error.message : String(error)); setPhase('armed'); } }
  }
  async function save() {
    if (!draft?.metadata.decoded) return;
    setPhase('saving'); setMessage('Saving privately…');
    try {
      const value = await saveJam(draft.metadata.input, draft.blob);
      setSaved(value); props.onJamSaved?.(value);
      let notice = 'Saved privately. Timing is estimated; adjust it by ear if needed.';
      try { await discardMicDraft(); setDraft(null); } catch { notice += ' The local recovery copy could not be cleared.'; }
      setPhase('review'); setMessage(notice);
    } catch (error) { setPhase('review'); setMessage(`${error instanceof Error ? error.message : error} Your draft and retry ID are retained.`); }
  }
  const take = saved || draft?.metadata.input;
  const alignment = take?.alignment, backing = take?.backingMix;
  const replayStart = saved && saved.id === props.jamToReplay?.id ? props.jamReplayStart || 0 : 0;
  useEffect(() => {
    if (!saved || saved.id !== props.jamToReplay?.id || locked.current || !mic.current || mic.current.readyState < 1) return;
    mic.current.pause(); mic.current.currentTime = Math.max(0, Math.min(saved.audio.durationSeconds, replayStart));
  }, [saved?.id, props.jamToReplay?.id, props.jamReplayRequest, replayStart, url]);
  async function correction(value: number) {
    if (!take || !alignment || !Number.isFinite(value) || Math.abs(value) > 2) return;
    stopReplay();
    try {
      if (saved) { const updated = await updateJamCorrection(saved.id, saved.revision, value); setSaved(updated); props.onJamSaved?.(updated); }
      else if (draft) { const next = { ...draft, metadata: { ...draft.metadata, input: { ...draft.metadata.input, alignment: { ...alignment, correctionSeconds: value, correctionReviewed: true } } } }; await storeMicDraft(next); setDraft(next); setMessage('Timing saved in this browser.'); }
    } catch (error) { setMessage(`${error instanceof Error ? error.message : error} Timing changes are not confirmed saved.`); }
  }
  async function replay(withBacking: boolean) {
    if (!mic.current || !take) return;
    stopReplay(); const token = generation.current; setMessage('');
    try {
      mic.current.playbackRate = 1; mic.current.volume = micGain;
      if (!withBacking) { lock(true); mic.current.currentTime = replayStart; await mic.current.play(); if (token === generation.current) setReplaying(true); return; }
      if (!alignment || !backing) throw new Error('This take has no established backing alignment. Play microphone only.');
      if (saved && !saved.backingAvailability.available) throw new Error(saved.backingAvailability.reason || 'The captured backing revision is unavailable. Play microphone only.');
      const current = await fetchJamContext(backing.source.recording);
      if (token !== generation.current || !mounted.current) return;
      if (current.audio?.sha256 !== backing.source.sha256 || (backing.stems && (current.stemSet?.id !== backing.stems.setId || current.stemSet?.revision !== backing.stems.revision))) throw new Error('The exact captured backing revision is unavailable. Play microphone only.');
      const bounds = backing.stems && current.stemSet ? current.stemSet : { start: 0, end: backing.source.durationSeconds };
      const interval = correctedJamInterval(alignment, saved?.audio.durationSeconds || draft?.metadata.duration || 0, bounds, replayStart);
      if (!interval) throw new Error('The corrected take has no backed interval. Play microphone only.');
      const { micStart: start, micEnd: end } = interval;
      lock(true);
      const sourceStart = alignment.sourceAtCaptureZero + (start - alignment.correctionSeconds) * backing.playbackRate;
      await latest.current.prepareReplay(backing, sourceStart);
      if (token !== generation.current) return;
      mic.current.currentTime = start; latest.current.onMixAudition(true); latest.current.playBacking();
      // Wait for the already-latency-adjusted audible source clock to advance.
      const began = performance.now();
      replayTimer.current = setInterval(() => {
        const clock = latest.current.getClock();
        if (clock.error || clock.buffering || performance.now() - began > 3000) { stopReplay(); setMessage('Backing interrupted; microphone-only playback remains available.'); return; }
        if (clock.playing && clock.time > sourceStart + .005) {
          clearInterval(replayTimer.current!); replayTimer.current = null;
          if (token !== generation.current || !mic.current) return;
          mic.current.currentTime = start + (clock.time - sourceStart) / backing.playbackRate;
          void mic.current.play().then(() => { if (token === generation.current) setReplaying(true); }).catch(error => { if (token === generation.current) { stopReplay(); setMessage(String(error)); } });
          replayTimer.current = setInterval(() => {
            const current = latest.current.getClock();
            if (!mic.current || mic.current.ended || mic.current.currentTime >= end || !current.playing || current.buffering || current.error) stopReplay();
          }, 50);
        }
      }, 25);
    } catch (error) { if (token === generation.current) { stopReplay(); setMessage(error instanceof Error ? error.message : String(error)); } }
  }
  async function resetRecordedMix() {
    if (!backing || !alignment) return;
    stopReplay(); const token = generation.current; lock(true);
    try {
      const current = await fetchJamContext(backing.source.recording);
      if (token !== generation.current || !mounted.current) return;
      if (current.audio?.sha256 !== backing.source.sha256 || (backing.stems && (current.stemSet?.id !== backing.stems.setId || current.stemSet?.revision !== backing.stems.revision))) throw new Error('The captured backing revision is unavailable.');
      const bounds = backing.stems && current.stemSet ? current.stemSet : { start: 0, end: backing.source.durationSeconds };
      const interval = correctedJamInterval(alignment, saved?.audio.durationSeconds || draft?.metadata.duration || 0, bounds);
      if (!interval) throw new Error('The corrected take has no backed interval. Play microphone only.');
      await latest.current.prepareReplay(backing, interval.start); setMessage('Recorded mix restored, paused.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (token === generation.current) lock(false); }
  }
  const mime = saved?.audio.mimeType || draft?.blob.type || '';
  const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  const panel = <section className="jam-recorder" aria-label="Record a jam">
    <button type="button" disabled={busy || phase === 'armed'} onClick={() => setOpen(value => !value)} aria-expanded={open}><Mic size={16} /> Jam recording</button>
    {open && <div className="jam-recorder-body">
      {!take && <fieldset disabled={busy || phase === 'armed'}><legend>Record your part</legend>
        <label>Title <input maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="Practice jam" /></label>
        <label><input type="checkbox" checked={free} onChange={event => setFree(event.target.checked)} /> Free jam · no backing alignment</label>
        <label>Playing instrument <select value={instrument} onChange={event => setInstrument(event.target.value)}><option value="">Not specified</option>{context?.stemSet?.tracks.map(track => <option value={track.id} key={track.id}>{track.label}</option>)}<option value="custom">Custom instrument</option></select></label>
        {instrument === 'custom' && <input aria-label="Custom instrument" maxLength={80} value={custom} onChange={event => setCustom(event.target.value)} />}
        {props.activeSectionId && <label><input type="checkbox" checked={section} onChange={event => setSection(event.target.checked)} /> Relates to selected section (independent of timing)</label>}
      </fieldset>}
      {!take && !busy && phase !== 'armed' && <button onClick={() => void arm()} disabled={!draftLoaded || !props.songId || (!free && (!props.ready || props.sourceMode === 'video' || !context?.audio))}><Mic size={16} /> Enable microphone</button>}
      {phase === 'armed' && <><p>Microphone enabled · headphones recommended. {free ? 'Free jam' : `${props.rate}× backing; mix settings will be saved.`}</p><button onClick={() => void begin()}>Record after 3 seconds</button><button onClick={() => stop()}>Cancel</button></>}
      {phase === 'countdown' && <p role="status">Recording starts in {count}…</p>}
      {phase === 'recording' && <p role="status">Recording microphone · {formatTime(elapsed)} / 2:00</p>}
      {(busy || phase === 'armed' || replaying) && <button className="jam-stop" onClick={() => stop()} disabled={phase === 'saving' || phase === 'finalizing'}><Square size={16} /> {phase === 'countdown' ? 'Cancel countdown' : 'Stop'}</button>}
      {phase === 'finalizing' && <p role="status">Finalizing microphone audio…</p>}
      {take && <div className="jam-review"><h3>{take.title}</h3><p>{backing ? `Recorded over ${backing.playbackRate}× ${backing.mode === 'stems' ? 'instrument mix' : 'original mix'}` : 'Free jam'} · {saved ? 'Saved privately' : 'Unsaved draft'}</p>
        {url && <audio ref={mic} src={url} preload="metadata" controls={!replaying} onLoadedMetadata={event => {
          const duration = saved?.audio.durationSeconds ?? draft?.metadata.duration ?? 0;
          event.currentTarget.currentTime = Math.max(0, Math.min(duration, replayStart));
        }} onPlay={() => { if (!locked.current) { latest.current.pauseBacking(); lock(true); setReplaying(true); } }} onEnded={() => { if (replaying) stopReplay(); }} />}
        <div><button onClick={() => void replay(false)} disabled={busy || !!draft && !draft.metadata.decoded}><Play size={14} /> Mic only</button><button onClick={() => void replay(true)} disabled={busy || !alignment || !!saved && !saved.backingAvailability.available}><Play size={14} /> Play with recorded mix</button><button onClick={() => void resetRecordedMix()} disabled={busy || !alignment || !!saved && !saved.backingAvailability.available}>Reset recorded mix</button></div>
        {saved?.backingAvailability.reason && <p role="status">{saved.backingAvailability.reason} Mic only remains available.</p>}
        <label>Microphone level <input type="range" min="0" max="1" step=".05" value={micGain} onChange={event => setMicGain(Number(event.target.value))} /></label>
        {alignment && <div><span>Adjust timing · {alignment.correctionSeconds.toFixed(2)} s earlier (estimated)</span><button disabled={busy} onClick={() => void correction(Math.min(2, alignment.correctionSeconds + .05))}>Earlier</button><button disabled={busy} onClick={() => void correction(Math.max(-2, alignment.correctionSeconds - .05))}>Later</button><button disabled={busy} onClick={() => void correction(0)}>Reset timing</button></div>}
        {url && <a href={url} download={`jam-${saved?.id || draft?.id}.${extension}`}><Download size={14} /> Download microphone</a>}
        {draft && <><button onClick={() => void save()} disabled={busy || !draft.metadata.decoded}>Save privately</button><button disabled={busy} onClick={() => { if (confirm('Discard this unsaved microphone take?')) void discardMicDraft().then(() => { stopReplay(); setDraft(null); setSaved(null); setPhase('idle'); }).catch(() => setMessage('Could not clear the saved draft. Download it before leaving.')); }}>Discard draft</button></>}
        {saved && !draft && <button disabled={busy} onClick={() => { stopReplay(); setSaved(null); setPhase('idle'); }}>New jam</button>}
      </div>}
      {message && <p role="status">{message}</p>}
      <small>Mic only is recorded. Alignment is estimated; use timing adjustment. One pass, up to 2 minutes. No live microphone monitoring.</small>
    </div>}
  </section>;
  return props.host ? createPortal(panel, props.host) : null;
}
