import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, PointerEvent } from 'react';
import { MessageSquare, Mic, Play, X } from 'lucide-react';
import { createJamComment, fetchJamComments, fetchJams } from './jamData';
import type { ExactAudio, Jam, JamComment, JamCommentInput, JamCommentTarget, JamContext } from './jamData';
import { alignedJamSpans, commentSourceSpan, instrumentLabel, jamCommentSelection, jamMicTime, sourceCommentSelection } from './timelineProjection';
import type { AlignedJamSpan } from './timelineProjection';
import { formatTime } from './recordings';
import './TimelineActivity.css';

export interface TimelineCommentMark { id: string; start: number; end?: number; label: string; onOpen(): void }
export interface TimelineActivityProps {
  songId: string; source: ExactAudio | null; context: JamContext | null; refresh: number;
  time: number; range: { start: number; end: number }; disabled: boolean;
  onSeek(seconds: number): void; onReplay(jam: Jam, micSeconds?: number): void;
  onCommentOpen(comment: JamComment, jam: Jam | null): void; onSaved(): void;
}
type Selection = Omit<JamCommentInput, 'id' | 'text'>;
const draftKey = 'vgm-timeline-comment-draft-v1';
interface CommentDraft { selection: Selection; label: string; text: string; attempt: { signature: string; id: string } | null }
function readDraft(): CommentDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
    return value && typeof value.text === 'string' && value.text.length <= 2000 && typeof value.label === 'string' && value.selection?.target && ['song', 'recording'].includes(value.selection.target.kind) ? value : null;
  } catch { return null; }
}

export function useTimelineActivity(props: TimelineActivityProps) {
  const [jams, setJams] = useState<Jam[]>([]), [comments, setComments] = useState<JamComment[]>([]);
  const [initialDraft] = useState(readDraft);
  const [commentMode, setCommentMode] = useState(false), [selection, setSelection] = useState<Selection | null>(initialDraft?.selection || null);
  const [selectionLabel, setSelectionLabel] = useState(initialDraft?.label || '');
  const [selectedJam, setSelectedJam] = useState<{ id: string; seconds: number } | null>(null);
  const [text, setText] = useState(initialDraft?.text || ''), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false), [version, setVersion] = useState(0);
  const composer = useRef<HTMLElement>(null), textarea = useRef<HTMLTextAreaElement>(null);
  const attempt = useRef<{ signature: string; id: string } | null>(initialDraft?.attempt || null);
  const sourceKey = props.source ? `${props.source.recording.kind}:${props.source.recording.id}:${props.source.sha256}` : '';
  const spans = useMemo(() => alignedJamSpans(jams, props.source), [jams, sourceKey]);
  const enabled = !!props.source && !!props.context?.audio && !props.disabled;
  useEffect(() => {
    if (!selection || !text.trim()) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ selection, label: selectionLabel, text, attempt: attempt.current })); }
    catch { setError('This draft cannot persist in browser storage. Keep the page open until it is saved.'); }
  }, [selection, selectionLabel, text]);
  useEffect(() => {
    setSelectedJam(null); setCommentMode(false); setError('');
    if (text.trim()) setStatus('Draft kept for its original recording. Save or close it before choosing another moment.');
    else { setSelection(null); setStatus(''); }
  }, [props.songId, sourceKey]);
  useEffect(() => {
    let disposed = false;
    setJams([]); setComments([]);
    const sourceTarget: JamCommentTarget | null = props.source ? { kind: 'recording', recording: props.source.recording, at: null } : null;
    async function load() {
      const records = await fetchJams(props.songId);
      if (disposed) return;
      setJams(records);
      const targets: JamCommentTarget[] = [{ kind: 'song', songId: props.songId }, ...(sourceTarget ? [sourceTarget] : []), ...alignedJamSpans(records, props.source).map(span => ({ kind: 'recording' as const, recording: { kind: 'jam' as const, id: span.jam.id }, at: null }))];
      const notes = await Promise.all(targets.map(target => fetchJamComments(target, props.songId)));
      if (!disposed) { setComments(notes.flat()); setError(''); }
    }
    void load().catch(failure => { if (!disposed) setError(failure instanceof Error ? failure.message : 'Comments could not be loaded.'); });
    return () => { disposed = true; };
  }, [props.songId, sourceKey, props.refresh, version]);
  useEffect(() => { if (selection) textarea.current?.focus({ preventScroll: true }); }, [selection]);
  function choose(value: Selection | null) {
    if (!value || props.disabled || saving) return false;
    if (text.trim() && JSON.stringify(value) !== JSON.stringify(selection)) { setError('Save or close this draft before choosing another moment.'); textarea.current?.focus({ preventScroll: true }); return false; }
    setSelection(value);
    setSelectionLabel(value.target.kind === 'song' ? 'Whole song' : value.target.recording.kind === 'jam' ? jams.find(jam => value.target.kind === 'recording' && jam.id === value.target.recording.id)?.title || 'Jam' : props.context?.label || 'Recording');
    setStatus(''); setError('');
    return true;
  }
  function selectRange(start: number, end?: number, trackId?: string) {
    if (!enabled || !props.context) return;
    choose(sourceCommentSelection(props.context, props.songId, start, end, trackId));
  }
  function openComment(comment: JamComment) {
    if (props.disabled) return;
    if (!choose({ songId: comment.songId, target: comment.target, instrument: comment.instrument })) return;
    props.onCommentOpen(comment, comment.target.kind === 'recording' && comment.target.recording.kind === 'jam' ? jams.find(jam => comment.target.kind === 'recording' && jam.id === comment.target.recording.id) || null : null);
  }
  function markersFor(trackId?: string): TimelineCommentMark[] {
    return comments.flatMap(comment => {
      const mapped = commentSourceSpan(comment, props.source, spans);
      if (!mapped) return [];
      if (trackId ? comment.instrument?.kind !== 'stem' || comment.instrument.trackId !== trackId || comment.target.kind !== 'recording' || comment.target.recording.kind === 'jam' : comment.instrument?.kind === 'stem' && !(comment.target.kind === 'recording' && comment.target.recording.kind === 'jam')) return [];
      const jam = comment.target.kind === 'recording' && comment.target.recording.kind === 'jam' ? jams.find(jam => comment.target.kind === 'recording' && jam.id === comment.target.recording.id) : null;
      return [{ id: comment.id, ...mapped, label: `${comment.text} · ${jam ? `${jam.title} · ${instrumentLabel(comment.instrument)} · Mic` : 'Recording'} time`, onOpen: () => openComment(comment) }];
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!selection || saving || props.disabled || !text.trim()) return;
    setSaving(true); setError(''); setStatus('');
    try {
      const payload = { ...selection, text: text.trim() }, signature = JSON.stringify(payload);
      if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() };
      try { sessionStorage.setItem(draftKey, JSON.stringify({ selection, label: selectionLabel, text, attempt: attempt.current })); } catch { /* Existing in-memory draft remains retryable. */ }
      await createJamComment({ ...payload, id: attempt.current.id });
      const stored = readDraft();
      if (stored && JSON.stringify({ ...stored.selection, text: stored.text.trim() }) === signature) { try { sessionStorage.removeItem(draftKey); } catch { /* Retry ID remains safe if browser storage fails. */ } }
      attempt.current = null; setText(''); setStatus('Comment saved'); setVersion(value => value + 1); props.onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Comment could not be saved.'); }
    finally { setSaving(false); }
  }
  const selectionTarget = selection?.target;
  const selectedRecord = selectionTarget?.kind === 'recording' ? selectionTarget.recording : null;
  const selectedIsJam = selectedRecord?.kind === 'jam';
  const targetLabel = selectionLabel;
  const clockLabel = selectedIsJam ? 'Mic time' : 'Recording time';
  const at = selectionTarget?.kind === 'recording' ? selectionTarget.at : null;
  const nearby = comments.filter(comment => {
    if (!selectionTarget || comment.target.kind !== selectionTarget.kind) return false;
    if (selectionTarget.kind === 'song') return comment.target.kind === 'song';
    if (comment.target.kind !== 'recording' || comment.target.recording.kind !== selectionTarget.recording.kind || comment.target.recording.id !== selectionTarget.recording.id) return false;
    if (!at) return !comment.target.at;
    if (!comment.target.at) return false;
    const position = comment.target.at.kind === 'point' ? comment.target.at.seconds : comment.target.at.start;
    const start = at.kind === 'point' ? at.seconds : at.start, end = at.kind === 'range' ? at.end : start;
    if (selection?.instrument && instrumentLabel(comment.instrument) !== instrumentLabel(selection.instrument)) return false;
    return position >= start - 3 && position <= end + 3;
  });
  function timing(value: number, edge: 'start' | 'end') {
    if (!selection || selection.target.kind !== 'recording' || !selection.target.at || !Number.isFinite(value)) return;
    const current = selection.target.at;
    let next = current;
    if (current.kind === 'point') next = { ...current, seconds: Math.max(0, Math.min(current.audio.durationSeconds, value)) };
    else if (edge === 'start') next = { ...current, start: Math.max(0, Math.min(current.end - .25, value)) };
    else next = { ...current, end: Math.max(current.start + .25, Math.min(current.audio.durationSeconds, value)) };
    setSelection({ ...selection, target: { ...selection.target, at: next } });
  }
  const toolbar = <div className="timeline-comment-toolbar" aria-label="Timeline comments">
    <button disabled={!enabled} aria-pressed={commentMode} onClick={() => setCommentMode(value => !value)}><MessageSquare size={15} /> {commentMode ? 'Comment mode on' : 'Comment mode'}</button>
    <button disabled={!enabled} onClick={() => selectRange(props.time)}>Comment at playhead</button>
    <button disabled={!enabled || !(props.range.end > props.range.start)} onClick={() => selectRange(props.range.start, props.range.end - props.range.start >= .25 ? props.range.end : undefined)}>Comment on A–B</button>
    <button disabled={!enabled} onClick={() => props.context && choose(sourceCommentSelection(props.context, props.songId))}>Whole recording</button>
    <button disabled={props.disabled} onClick={() => choose({ songId: props.songId, target: { kind: 'song', songId: props.songId }, instrument: null })}>Whole song</button>
    {commentMode && <span role="status">Click a point or drag a range on a track. Normal seek is off in this mode.</span>}
  </div>;
  const row = <div className="score-row timeline-jams-row"><span className="score-label"><Mic size={14} /> Jams</span><div className="timeline-jams-strip" style={{ height: Math.max(1, ...spans.map(span => span.lane + 1)) * 36 + 4 }}>
    {!spans.length && <span className="score-empty">No aligned jams on this recording yet</span>}
    {spans.map(span => <JamTimelineBar key={span.jam.id} span={span} duration={props.source?.durationSeconds || 0} commentMode={commentMode} disabled={props.disabled} selected={selectedJam?.id === span.jam.id} onSeek={seconds => { props.onSeek(seconds); setSelectedJam({ id: span.jam.id, seconds: jamMicTime(span.jam, seconds) }); }} onComment={(start, end) => choose(jamCommentSelection(span, props.songId, start, end))} />)}
    <span className="score-playhead" style={{ left: `${props.source?.durationSeconds ? props.time / props.source.durationSeconds * 100 : 0}%` }} />
  </div>{selectedJam && <div className="timeline-jam-open"><button disabled={props.disabled} onClick={() => { const jam = jams.find(value => value.id === selectedJam.id); if (jam) props.onReplay(jam, selectedJam.seconds); }}><Play size={14} /> Open jam</button><span>Opens paused · saved backing mix</span></div>}</div>;
  const pane = selection ? <aside ref={composer} className="timeline-comment-pane" aria-label="Timeline comment composer" onKeyDown={event => { if (event.key === 'Escape' && !text.trim()) { setSelection(null); event.stopPropagation(); } }}>
    <header><div><h3><MessageSquare size={17} /> {targetLabel}</h3><p>{at ? `${clockLabel} · ${formatTime(at.kind === 'point' ? at.seconds : at.start)}${at.kind === 'range' ? `–${formatTime(at.end)}` : ''}` : 'Untimed comment'} · {instrumentLabel(selection.instrument)}</p></div><button aria-label="Close timeline comments" disabled={saving} onClick={() => { if (!text.trim() || window.confirm('Discard this unsaved comment?')) { setSelection(null); setText(''); try { sessionStorage.removeItem(draftKey); } catch { /* No persistent draft to discard. */ } } }}><X size={16} /></button></header>
    <form onSubmit={event => void save(event)}>
      {at && <div className="timeline-comment-timing"><label>{at.kind === 'range' ? 'Start' : 'Time'} (seconds)<input aria-label={`${clockLabel} ${at.kind === 'range' ? 'start' : 'point'} seconds`} type="number" min={0} max={at.audio.durationSeconds} step="any" value={Math.round((at.kind === 'point' ? at.seconds : at.start) * 1000) / 1000} onChange={event => timing(Number(event.target.value), 'start')} /></label>{at.kind === 'range' && <label>End (seconds)<input aria-label={`${clockLabel} end seconds`} type="number" min={at.start} max={at.audio.durationSeconds} step="any" value={Math.round(at.end * 1000) / 1000} onChange={event => timing(Number(event.target.value), 'end')} /></label>}</div>}
      <textarea ref={textarea} aria-label="Timeline comment text" placeholder="What did you notice or try?" maxLength={2000} required value={text} onChange={event => setText(event.target.value)} disabled={props.disabled || saving} />
      <button type="submit" disabled={props.disabled || saving || !text.trim()}>{saving ? 'Saving…' : 'Save comment'}</button>
      <small>Local author label · not a verified account</small>
    </form>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    <div className="timeline-nearby-comments"><h4>{at ? 'Comments near this moment' : 'Comments here'}</h4>{!nearby.length && <p className="quiet-note">No comments here yet</p>}{nearby.map(comment => <article key={comment.id}><p>{comment.text}</p><small>{comment.actor.label} · {instrumentLabel(comment.instrument)}</small><button disabled={props.disabled} onClick={() => openComment(comment)}>Open comment</button></article>)}</div>
  </aside> : null;
  return { toolbar, row, composer: pane, commentMode, selectRange, markersFor, error };
}

function JamTimelineBar({ span, duration, commentMode, disabled, selected, onSeek, onComment }: {
  span: AlignedJamSpan; duration: number; commentMode: boolean; disabled: boolean; selected: boolean;
  onSeek(seconds: number): void; onComment(start: number, end?: number): void;
}) {
  const drag = useRef<{ start: number; x: number } | null>(null);
  function at(event: PointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(span.start, Math.min(span.end, span.start + (event.clientX - bounds.left) / bounds.width * (span.end - span.start)));
  }
  return <button className={`timeline-jam-bar${selected ? ' is-selected' : ''}`} style={{ left: `${span.start / duration * 100}%`, width: `${(span.end - span.start) / duration * 100}%`, top: span.lane * 36 + 2 }} aria-label={`${span.jam.title} · ${instrumentLabel(span.jam.instrument)} · ${formatTime(span.start)}–${formatTime(span.end)}`} title={`${span.jam.title} · ${instrumentLabel(span.jam.instrument)} · estimated alignment`} disabled={disabled}
    onPointerDown={event => { if (disabled || event.button !== 0) return; drag.current = { start: at(event), x: event.clientX }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }}
    onPointerUp={event => { const began = drag.current; drag.current = null; if (!began || disabled) return; const end = at(event); if (commentMode) { const isRange = Math.abs(event.clientX - began.x) >= 4 && Math.abs(end - began.start) / span.jam.alignment!.sourceSecondsPerCaptureSecond >= .25; onComment(Math.min(began.start, end), isRange ? Math.max(began.start, end) : undefined); } else onSeek(end); }}
    onClick={event => { if (event.detail !== 0 || disabled) return; if (commentMode) onComment(span.start); else onSeek(span.start); }}>
    <Mic size={12} /><span>{span.jam.title} · {instrumentLabel(span.jam.instrument)}</span>
  </button>;
}
