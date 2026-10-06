import { useMemo, useState } from "react";
import type { LoopRange } from "./practice";

export function WaveformLane({ peaks, duration, time, label, range, repeat = false, muted = false, onSeek, disabled = false }: {
  peaks?: [number, number][];
  duration: number;
  time: number;
  label: string;
  range?: LoopRange;
  repeat?: boolean;
  muted?: boolean;
  disabled?: boolean;
  onSeek(seconds: number): void;
}) {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const path = useMemo(() => {
    if (!peaks?.length) return "";
    const point = (index: number, amplitude: number) => `${index / Math.max(1, peaks.length - 1) * 1000},${36 - Math.max(-1, Math.min(1, amplitude)) * 30}`;
    return `M${peaks.map((pair, index) => point(index, pair[1])).join(" L")} L${peaks.map((pair, index) => point(index, pair[0])).reverse().join(" L")} Z`;
  }, [peaks]);
  const percent = (value: number) => `${Math.max(0, Math.min(100, duration ? value / duration * 100 : 0))}%`;
  const preview = disabled || !duration ? null : hoverTime ?? (keyboardFocus ? time : null);
  const previewTenths = Math.round((preview ?? 0) * 10);
  const previewLabel = `${Math.floor(previewTenths / 600)}:${((previewTenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
  return <div className={`waveform-lane${muted ? " is-muted" : ""}${repeat ? " is-repeating" : ""}`} onPointerMove={event => {
    if (disabled || !duration || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width) setHoverTime(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * duration);
  }} onPointerLeave={() => setHoverTime(null)}>
    {range && duration > 0 && <span className="waveform-range" style={{ left: percent(range.start), width: percent(range.end - range.start) }} />}
    <svg viewBox="0 0 1000 72" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="1000" y1="36" y2="36" className="waveform-zero" />{path && <path d={path} />}</svg>
    {!path && <span className="waveform-empty">Waveform not available</span>}
    <span className="waveform-playhead" style={{ left: percent(time) }} aria-hidden="true" />
    {preview !== null && <span className="waveform-hover-cursor" style={{ left: percent(preview) }}><output className={`waveform-hover-time${preview > duration / 2 ? " align-end" : ""}`} aria-live="off" aria-label={`Preview time for ${label}`}>{previewLabel}</output></span>}
    <input type="range" className="waveform-seek" aria-label={`Seek ${label}`} min="0" max={duration || 0} step="any" value={Math.max(0, Math.min(duration || 0, time))} disabled={disabled || !duration} onFocus={event => setKeyboardFocus(event.currentTarget.matches(":focus-visible"))} onBlur={() => { setKeyboardFocus(false); setHoverTime(null); }} onKeyDown={() => setKeyboardFocus(true)} onChange={event => onSeek(Number(event.target.value))} />
  </div>;
}
