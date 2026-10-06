import { useEffect, useMemo, useRef } from "react";
import { AudioLines, Copy, Drum, Guitar, MicVocal, Music2, Piano, Repeat2, Volume2, VolumeX, Headphones } from "lucide-react";
import type { PracticeAnnotation, PracticeSection, PracticeSource } from "./practiceData";
import type { StemMixValue } from "./StemMixer";
import type { LoopRange } from "./practice";
import { formatTime } from "./recordings";
import { WaveformLane } from "./WaveformLane";
import { SourceSections } from "./SourceSections";
import { PracticeAnnotations } from "./PracticeAnnotations";
import { PracticeControls } from "./PracticeControls";

export interface PracticeWorkspaceProps {
  data: PracticeSource | null;
  loading: boolean;
  error: string;
  time: number;
  duration: number;
  range: LoopRange;
  defaultRange: LoopRange;
  repeat: boolean;
  activeSectionId: string;
  available: boolean;
  stemsActive: boolean;
  mix: Record<string, StemMixValue>;
  notice: string;
  practiceError: string;
  onSeek(seconds: number): void;
  onRange(range: LoopRange): void;
  onRepeat(enabled: boolean): void;
  onCopy(): void;
  onSection(section: PracticeSection): void;
  onCopySection(section: PracticeSection): void;
  onSavedSection(section: PracticeSection): void;
  onSavedAnnotation(annotation: PracticeAnnotation): void;
  onCopyAnnotation(annotation: PracticeAnnotation): void;
  onReload(): void;
  onMix(id: string, value: StemMixValue): void;
  onOriginal(): void;
  onInstrumentMix(): void;
}

function InstrumentIcon({ label }: { label: string }) {
  const name = label.toLowerCase();
  const Icon = name.includes("vocal") ? MicVocal : name.includes("drum") ? Drum : name.includes("guitar") || name.includes("bass") ? Guitar : name.includes("piano") || name.includes("key") ? Piano : AudioLines;
  return <Icon size={15} aria-hidden="true" />;
}

function InstrumentGain({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange(value: number): void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      if (disabled || event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      onChange(Math.max(0, Math.min(1, value - Math.sign(event.deltaY) * .02)));
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [value, disabled, onChange]);
  return <input ref={input} className="instrument-gain" aria-label={`${label} volume`} title="Scroll to adjust volume" type="range" min="0" max="100" step="1" value={Math.round(value * 100)} disabled={disabled} onChange={event => onChange(Number(event.target.value) / 100)} />;
}

export function PracticeWorkspace(props: PracticeWorkspaceProps) {
  const { data, time, duration, range, repeat, available, mix, onSeek } = props;
  const tracks = data?.stemSet?.tracks || [];
  const anySolo = Object.values(mix).some(value => value.solo);
  const chords = (data?.annotations || []).filter(item => item.type === "chord").sort((a, b) => a.start - b.start);
  const overview = useMemo(() => {
    const waves = data?.waveforms?.tracks || [];
    if (!waves.length) return undefined;
    return waves[0].peaks.map((_, i) => [Math.min(...waves.map(wave => wave.peaks[i]?.[0] ?? 0)), Math.max(...waves.map(wave => wave.peaks[i]?.[1] ?? 0))] as [number, number]);
  }, [data?.waveforms]);
  const position = (seconds: number) => `${Math.max(0, Math.min(100, duration ? seconds / duration * 100 : 0))}%`;
  const ticks = Array.from({ length: 6 }, (_, i) => duration * i / 5);
  return <section className="practice-workspace" aria-label="Song practice">
    <div className="practice-source-line"><span><AudioLines size={16} /> {props.stemsActive ? "Instrument mix" : "Original mix"}</span><span>{formatTime(time)} <span className="dim">/ {formatTime(duration)}</span></span><div className="practice-toolbar-actions"><button aria-label="Repeat selected excerpt" aria-pressed={repeat} disabled={!available} onClick={() => props.onRepeat(!repeat)}><Repeat2 size={15} /> Repeat</button><button onClick={props.onCopy} disabled={!available}><Copy size={15} /> Copy practice link</button></div></div>
    {props.notice && <p className="practice-status" role="status">{props.notice}</p>}
    <div className="practice-score">
      <div className="score-row ruler-row"><span className="score-label">Original time</span><div className="time-ruler">{ticks.map((tick, i) => <span key={i} style={{ left: position(tick) }}>{formatTime(tick)}</span>)}</div></div>
      <div className="score-row overview-row"><span className="score-label">Song</span><WaveformLane peaks={overview} duration={duration} time={time} range={range} repeat={repeat} label="song timeline" onSeek={onSeek} disabled={!available} /></div>
      <div className="score-row section-score-row"><span className="score-label">Sections</span><div className="section-score-strip">{data?.sections.map(section => <button key={section.id} className={props.activeSectionId === section.id ? "is-active" : ""} title={`${section.label} · ${formatTime(section.start)}–${formatTime(section.end)}`} style={{ left: position(section.start), width: position(section.end - section.start) }} onClick={() => props.onSection(section)} disabled={!available}>{section.label}</button>)}{!data?.sections.length && <span className="score-empty">Add a named range below</span>}<span className="score-playhead" style={{ left: position(time) }} /></div></div>
      <div className="score-row chord-score-row"><span className="score-label"><Music2 size={14} /> Chords</span><div className="chord-score-strip">{chords.map(chord => <button key={chord.id} className={time >= chord.start && time < chord.end ? "is-current" : ""} style={{ left: position(chord.start), width: position(chord.end - chord.start) }} title={`${chord.text} · ${formatTime(chord.start)}–${formatTime(chord.end)}`} onClick={() => onSeek(chord.start)} disabled={!available}>{chord.text}</button>)}{!chords.length && <span className="score-empty">No chords added yet · enter a chord below</span>}<span className="score-playhead" style={{ left: position(time) }} /></div></div>
      {tracks.map(track => {
        const value = mix[track.id] || { level: 1, muted: false, solo: false };
        const silenced = value.muted || (anySolo && !value.solo);
        return <div className={`score-row instrument-lane${silenced ? " is-muted" : ""}`} key={track.id}>
          <div className="instrument-controls"><strong><InstrumentIcon label={track.label} />{track.label}</strong><div className="instrument-buttons"><button className="instrument-mute" title={`${value.muted ? "Unmute" : "Mute"} ${track.label}`} aria-label={`${value.muted ? "Unmute" : "Mute"} ${track.label}`} aria-pressed={value.muted} disabled={!props.stemsActive || !available} onClick={() => props.onMix(track.id, { ...value, muted: !value.muted })}>{value.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button><button title={`Solo ${track.label}`} aria-label={`Solo ${track.label}`} aria-pressed={value.solo} disabled={!props.stemsActive || !available} onClick={() => props.onMix(track.id, { ...value, solo: !value.solo })}><Headphones size={16} /></button><InstrumentGain label={track.label} value={value.level} disabled={!props.stemsActive || !available} onChange={level => props.onMix(track.id, { ...value, level })} /><output>{Math.round(value.level * 100)}%</output></div></div>
          <WaveformLane peaks={data?.waveforms?.tracks.find(wave => wave.id === track.id)?.peaks} duration={duration} time={time} range={range} repeat={repeat} muted={silenced} label={`${track.label} timeline`} onSeek={onSeek} disabled={!available} />
        </div>;
      })}
    </div>
    {tracks.length > 0 && <div className="mix-provenance"><p>Instrument separation can introduce artifacts.</p>{props.stemsActive ? <button onClick={props.onOriginal}>Original mix</button> : <button onClick={props.onInstrumentMix}>Instrument mix</button>}</div>}
    <div className="practice-editors"><div><PracticeControls showActions={false} duration={duration} currentTime={time} defaultRange={props.defaultRange} range={range} repeat={repeat} available={available} error={props.practiceError} unavailableReason={props.loading ? "Preparing audio…" : "Press Audio to prepare this recording."} onChange={props.onRange} onRepeat={props.onRepeat} onCopy={props.onCopy} /><SourceSections data={data} loading={props.loading} error={props.error} range={range} currentTime={time} activeId={props.activeSectionId} onSelect={props.onSection} onCopy={props.onCopySection} onSaved={props.onSavedSection} onReload={props.onReload} /></div><PracticeAnnotations data={data} loading={props.loading} error={props.error} currentTime={time} onSeek={onSeek} onSaved={props.onSavedAnnotation} onCopy={props.onCopyAnnotation} onReload={props.onReload} /></div>
  </section>;
}
