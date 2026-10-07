import { useMemo, useRef, useState } from "react";
import type { TimelineCommentMark } from "./TimelineActivity";
import type { LoopRange } from "./practice";

export function WaveformLane({ peaks, duration, time, label, range, repeat = false, muted = false, onSeek, disabled = false, commentMode = false, onComment, marks = [] }: {
  peaks?: [number, number][];
  duration: number;
  time: number;
  label: string;
  range?: LoopRange;
  repeat?: boolean;
  muted?: boolean;
  disabled?: boolean;
  commentMode?: boolean;
  onComment?(range: { start: number; end?: number }): void;
  marks?: TimelineCommentMark[];
  onSeek(seconds: number): void;
}) {
  const drag = useRef<{ time: number; x: number } | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const pointAt = (element: HTMLElement, x: number) => { const rect = element.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * duration; };
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
    {selection && <span className="waveform-comment-selection" style={{ left: percent(selection.start), width: percent(selection.end - selection.start) }} />}
    {range && duration > 0 && <span className="waveform-range" style={{ left: percent(range.start), width: percent(range.end - range.start) }} />}
    <svg viewBox="0 0 1000 72" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="1000" y1="36" y2="36" className="waveform-zero" />{path && <path d={path} />}</svg>
    {!path && <span className="waveform-empty">Waveform not available</span>}
    <span className="waveform-playhead" style={{ left: percent(time) }} aria-hidden="true" />
    {preview !== null && <span className="waveform-hover-cursor" style={{ left: percent(preview) }}><output className={`waveform-hover-time${preview > duration / 2 ? " align-end" : ""}`} aria-live="off" aria-label={`Preview time for ${label}`}>{previewLabel}</output></span>}
    {marks.map(mark => <button key={mark.id} className="waveform-comment-mark" aria-label={`Comment: ${mark.label}`} title={mark.label} style={{ left: percent(mark.start), width: mark.end === undefined ? undefined : percent(mark.end - mark.start) }} disabled={disabled} onClick={mark.onOpen}>•</button>)}
    {commentMode ? <button className="waveform-comment-surface" aria-label={`Comment on ${label}`} disabled={disabled || !duration} onPointerDown={event => {
      if (event.button !== 0) return;
      drag.current = { time: pointAt(event.currentTarget, event.clientX), x: event.clientX };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      if (!drag.current) return;
      const next = pointAt(event.currentTarget, event.clientX);
      setSelection({ start: Math.min(drag.current.time, next), end: Math.max(drag.current.time, next) });
    }} onPointerUp={event => {
      const from = drag.current; drag.current = null; setSelection(null);
      if (!from) return;
      const next = pointAt(event.currentTarget, event.clientX);
      if (Math.abs(event.clientX - from.x) < 5 || Math.abs(next - from.time) < .25) onComment?.({ start: from.time });
      else onComment?.({ start: Math.min(from.time, next), end: Math.max(from.time, next) });
    }} onPointerCancel={() => { drag.current = null; setSelection(null); }} onClick={event => { if (event.detail === 0) onComment?.({ start: time }); }} /> : <input type="range" className="waveform-seek" aria-label={`Seek ${label}`} min="0" max={duration || 0} step="any" value={Math.max(0, Math.min(duration || 0, time))} disabled={disabled || !duration} onFocus={event => setKeyboardFocus(event.currentTarget.matches(":focus-visible"))} onBlur={() => { setKeyboardFocus(false); setHoverTime(null); }} onKeyDown={() => setKeyboardFocus(true)} onChange={event => onSeek(Number(event.target.value))} />}
  </div>;
}
