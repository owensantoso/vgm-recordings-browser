import { useId } from 'react';
import { formatTime } from './recordings';
import type { StemSet } from './practiceData';

export interface StemMixValue {
  level: number;
  muted: boolean;
  solo: boolean;
}
export interface StemMixerProps {
  stemSet: StemSet;
  mix: Record<string, StemMixValue>;
  enabled: boolean;
  onChange(id: string, value: StemMixValue): void;
}

export function StemMixer({ stemSet, mix, enabled, onChange }: StemMixerProps) {
  const id = useId();
  return (
    <section className="stem-mixer" aria-labelledby={`${id}-title`}>
      <header>
        <h3 id={`${id}-title`}>Instruments</h3>
        <span className="stem-coverage">{stemSet.coverage === 'excerpt' ? 'Stem preview' : 'Full source'} · {formatTime(stemSet.start)}–{formatTime(stemSet.end)} original</span>
      </header>
      {stemSet.tracks.map((track, index) => {
        const value = mix[track.id] || { level: 1, muted: false, solo: false };
        const percent = Math.round(Math.max(0, Math.min(1, Number.isFinite(value.level) ? value.level : 0)) * 100);
        return (
          <div className="stem-row" key={track.id}>
            <label htmlFor={`${id}-${index}`}>{track.label}</label>
            <div className="stem-gain">
              <input id={`${id}-${index}`} type="range" min="0" max="100" step="1" aria-label={`${track.label} volume`} value={percent} disabled={!enabled} onChange={event => onChange(track.id, { ...value, level: Number(event.target.value) / 100 })} />
              <output htmlFor={`${id}-${index}`}>{percent}%</output>
            </div>
            <div className="stem-actions">
              <button type="button" aria-label={`Mute ${track.label}`} aria-pressed={value.muted} disabled={!enabled} onClick={() => onChange(track.id, { ...value, muted: !value.muted })}>Mute</button>
              <button type="button" aria-label={`Solo ${track.label}`} aria-pressed={value.solo} disabled={!enabled} onClick={() => onChange(track.id, { ...value, solo: !value.solo })}>Solo</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
