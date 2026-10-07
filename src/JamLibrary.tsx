import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Copy, Download, MessageSquare, Mic, Play } from 'lucide-react';
import type { CatalogData } from './Catalog';
import type { Recording } from './recordings';
import { formatTime } from './recordings';
import { createJamComment, fetchJamComments, fetchJamContext, fetchJams } from './jamData';
import type { Jam, JamComment, JamCommentTarget, JamContext, JamInstrument, RecordingRef } from './jamData';

export function jamLink(href: string, songId: string, jam: Jam | null, comment?: JamComment) {
  const url = new URL(href);
  ['t', 'section', 'repeat', 'tab', 'at', 'clock', 'jam', 'comment'].forEach(key => url.searchParams.delete(key));
  url.searchParams.set('view', 'songs'); url.searchParams.set('song', songId);
  if (jam) {
    url.searchParams.set('jam', jam.id);
    const backing = jam.backingMix?.source.recording;
    if (backing) url.searchParams.set('play', backing.kind === 'reference' ? `ref:${backing.id}` : backing.id);
    else url.searchParams.delete('play');
  }
  if (comment) {
    url.searchParams.set('comment', comment.id);
    const target = comment.target;
    if (target.kind === 'recording') {
      if (target.recording.kind === 'jam') url.searchParams.set('jam', target.recording.id);
      else url.searchParams.set('play', target.recording.kind === 'reference' ? `ref:${target.recording.id}` : target.recording.id);
      if (target.at) {
        url.searchParams.set('clock', target.recording.kind === 'jam' ? 'mic' : 'source');
        url.searchParams.set('at', String(target.at.kind === 'point' ? target.at.seconds : target.at.start));
      }
    }
  }
  url.hash = ''; return url.toString();
}

export interface JamLibraryProps {
  songId: string; catalog: CatalogData; rows: Recording[]; activeRecording: RecordingRef | null;
  refresh: number; highlightedComment?: string;
  onReplay(jam: Jam, seconds?: number): void;
  onCommentOpen(comment: JamComment, jam: Jam | null): void;
}
export function JamLibrary(props: JamLibraryProps) {
  const [jams, setJams] = useState<Jam[]>([]), [comments, setComments] = useState<JamComment[]>([]);
  const [targetKey, setTargetKey] = useState('song'), [context, setContext] = useState<JamContext | null>(null);
  const [anchor, setAnchor] = useState<'none' | 'point' | 'range'>('none');
  const [start, setStart] = useState('0'), [end, setEnd] = useState('5');
  const [instrumentKey, setInstrumentKey] = useState(''), [customInstrument, setCustomInstrument] = useState('');
  const [text, setText] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [revision, setRevision] = useState(0);
  const commentAttempt = useRef<{ payload: string; id: string } | null>(null);
  const targets = useMemo(() => [
    { key: 'song', label: 'Whole song', recording: null as RecordingRef | null },
    ...props.catalog.references.filter(ref => ref.song_id === props.songId).map(ref => ({ key: `reference:${ref.id}`, label: `Reference · ${ref.label}`, recording: { kind: 'reference', id: ref.id } as RecordingRef })),
    ...props.rows.filter(row => props.catalog.recordings.some(link => link.file === row.file && link.song_id === props.songId)).map(row => ({ key: `archive:${row.file}`, label: `Our take · ${row.session_label} · ${row.file}`, recording: { kind: 'archive', id: row.file } as RecordingRef })),
    ...jams.map(jam => ({ key: `jam:${jam.id}`, label: `Jam · ${jam.title}`, recording: { kind: 'jam', id: jam.id } as RecordingRef })),
  ], [props.catalog, props.rows, props.songId, jams]);
  const selected = targets.find(target => target.key === targetKey) || targets[0];
  const target: JamCommentTarget = selected.recording ? { kind: 'recording', recording: selected.recording, at: null } : { kind: 'song', songId: props.songId };
  useEffect(() => { setTargetKey('song'); setText(''); setError(''); setStatus(''); }, [props.songId]);
  useEffect(() => {
    if (!props.highlightedComment) return;
    const url = new URL(location.href), jamId = url.searchParams.get('jam'), source = url.searchParams.get('play');
    setTargetKey(jamId ? `jam:${jamId}` : source ? source.startsWith('ref:') ? `reference:${source.slice(4)}` : `archive:${source}` : 'song');
  }, [props.highlightedComment]);
  useEffect(() => {
    let disposed = false; setLoading(true);
    fetchJams(props.songId).then(value => { if (!disposed) setJams(value); }).catch(failure => { if (!disposed) setError(failure.message); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [props.songId, props.refresh, revision]);
  const targetIdentity = selected.key;
  const instrumentSource = selected.recording || targets.find(target => target.recording?.kind === props.activeRecording?.kind && target.recording?.id === props.activeRecording?.id)?.recording || targets.find(target => target.recording?.kind === 'reference')?.recording || null;
  useEffect(() => {
    let disposed = false; setContext(null); setAnchor('none'); setInstrumentKey(''); setComments([]);
    Promise.all([fetchJamComments(target, props.songId), instrumentSource ? fetchJamContext(instrumentSource) : Promise.resolve(null)])
      .then(([notes, data]) => { if (!disposed) { setComments(notes); setContext(data); } })
      .catch(failure => { if (!disposed) setError(failure.message); });
    return () => { disposed = true; };
  }, [props.songId, targetIdentity, instrumentSource?.kind, instrumentSource?.id, revision, props.refresh]);
  const selectedJam = selected.recording?.kind === 'jam' ? jams.find(jam => jam.id === selected.recording?.id) || null : null;
  function instrument(): JamInstrument | null {
    if (instrumentKey === 'custom') return { kind: 'custom', label: customInstrument.trim() };
    if (instrumentKey === 'played') return selectedJam?.instrument || null;
    const track = context?.stemSet?.tracks.find(track => track.id === instrumentKey);
    return track && context?.audio && context.stemSet ? { kind: 'stem', source: context.audio, stemSetId: context.stemSet.id, stemSetRevision: context.stemSet.revision, trackId: track.id, labelSnapshot: track.label } : null;
  }
  async function saveComment(event: FormEvent) {
    event.preventDefault(); if (saving) return; setError(''); setStatus('');
    let anchored = target;
    if (anchor !== 'none' && target.kind === 'recording') {
      if (!context?.audio) { setError('This recording has no verified timing. Add an untimed note.'); return; }
      const a = Number(start), b = Number(end);
      if (!start.trim() || !Number.isFinite(a) || a < 0 || a > context.audio.durationSeconds || (anchor === 'range' && (!end.trim() || !Number.isFinite(b) || b <= a || b > context.audio.durationSeconds))) {
        setError('Use seconds within this recording; a range must end after it starts.'); return;
      }
      anchored = { ...target, at: anchor === 'point' ? { kind: 'point', seconds: a, audio: context.audio } : { kind: 'range', start: a, end: b, audio: context.audio } };
    }
    setSaving(true);
    try {
      const payload = { songId: props.songId, target: anchored, instrument: instrument(), text: text.trim() };
      const signature = JSON.stringify(payload);
      if (commentAttempt.current?.payload !== signature) commentAttempt.current = { payload: signature, id: crypto.randomUUID() };
      await createJamComment({ id: commentAttempt.current.id, ...payload });
      commentAttempt.current = null;
      setText(''); setStatus('Note saved'); setRevision(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Note could not be saved.'); }
    finally { setSaving(false); }
  }
  async function copy(href: string) {
    try { await navigator.clipboard.writeText(href); setStatus('Link copied'); }
    catch { setError('Copy failed. Use the note or jam link directly.'); }
  }
  return <section className="jam-library" aria-label="Jams and comments">
    <div className="jam-section-heading"><h2><Mic size={18} /> Jams <small>{jams.length}</small></h2><p className="quiet-note">Record from the player. Saved takes keep their backing mix.</p></div>
    {loading && <p role="status">Loading jams…</p>}
    {!loading && !jams.length && <p className="quiet-note">No jams yet. Lower an instrument and record your own part, or record without backing.</p>}
    <ul className="jam-list">{jams.map(jam => {
      const label = jam.instrument?.kind === 'custom' ? jam.instrument.label : jam.instrument?.labelSnapshot;
      return <li key={jam.id} className="jam-card"><div><strong>{jam.title}</strong><p>{label || 'Instrument not specified'} · {formatTime(jam.audio.durationSeconds)} · {new Date(jam.createdAt).toLocaleDateString()}</p><p className="quiet-note">{jam.alignment ? `Play-along · ${formatTime(jam.alignment.coverage.sourceStart)}–${formatTime(jam.alignment.coverage.sourceEnd)} · ${jam.backingMix?.playbackRate}× · estimated alignment` : 'Free jam'}{jam.sections.length ? ` · ${jam.sections.map(section => section.labelSnapshot).join(', ')}` : ''}</p>{jam.alignment && !jam.backingAvailability.available && <p className="quiet-note">{jam.backingAvailability.reason} Mic-only playback remains available.</p>}</div><div className="jam-card-actions"><button onClick={() => props.onReplay(jam)}><Play size={15} /> {jam.alignment && jam.backingAvailability.available ? 'Play with recorded mix' : 'Listen to mic'}</button><button aria-label={`Copy ${jam.title} jam link`} onClick={() => void copy(jamLink(location.href, props.songId, jam))}><Copy size={15} /></button><a href={jam.audioUrl} download><Download size={15} /> Mic audio</a><button onClick={() => setTargetKey(`jam:${jam.id}`)}><MessageSquare size={15} /> Notes</button></div></li>;
    })}</ul>
    <h2><MessageSquare size={18} /> Comments</h2>
    <label className="jam-target-picker">About<select aria-label="Comment target" value={selected.key} onChange={event => setTargetKey(event.target.value)}>{targets.map(target => <option key={target.key} value={target.key}>{target.label}</option>)}</select></label>
    {props.activeRecording && targets.some(target => target.recording?.kind === props.activeRecording?.kind && target.recording?.id === props.activeRecording?.id) && <button onClick={() => setTargetKey(`${props.activeRecording?.kind}:${props.activeRecording?.id}`)}>Comment on the current recording</button>}
    <p className="quiet-note">{selected.recording?.kind === 'jam' ? 'Times refer to this mic recording.' : selected.recording ? 'Times refer to this specific recording, not a universal song clock.' : 'Song-wide notes apply without a timestamp.'} Authors are local labels, unverified.</p>
    <form onSubmit={event => void saveComment(event)} className="jam-comment-form">
      {selected.recording && <div className="jam-comment-anchor"><label>Link to<select aria-label="Comment timing" value={anchor} onChange={event => setAnchor(event.target.value as typeof anchor)}><option value="none">Whole recording</option><option value="point" disabled={!context?.audio}>Timestamp</option><option value="range" disabled={!context?.audio}>Time range</option></select></label>{anchor !== 'none' && <label>{anchor === 'range' ? 'Start seconds' : 'Seconds'}<input aria-label="Comment start seconds" type="number" min="0" step="0.1" value={start} onChange={event => setStart(event.target.value)} /></label>}{anchor === 'range' && <label>End seconds<input aria-label="Comment end seconds" type="number" min="0" step="0.1" value={end} onChange={event => setEnd(event.target.value)} /></label>}</div>}
      <label>Instrument (optional)<select aria-label="Comment instrument" value={instrumentKey} onChange={event => setInstrumentKey(event.target.value)}><option value="">Any instrument</option>{selectedJam?.instrument && <option value="played">Played instrument · {selectedJam.instrument.kind === 'custom' ? selectedJam.instrument.label : selectedJam.instrument.labelSnapshot}</option>}{context?.stemSet?.tracks.map(track => <option key={track.id} value={track.id}>{track.label}</option>)}<option value="custom">Custom instrument…</option></select></label>
      {instrumentKey === 'custom' && <input aria-label="Custom comment instrument" value={customInstrument} maxLength={80} onChange={event => setCustomInstrument(event.target.value)} placeholder="e.g. Saxophone" required />}
      <textarea aria-label="Comment text" value={text} maxLength={2000} onChange={event => setText(event.target.value)} placeholder="What did you notice or try?" required />
      <button type="submit" disabled={saving || !text.trim()}>{saving ? 'Saving…' : 'Add comment'}</button>
    </form>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    <ol className="jam-comments">{comments.map(comment => {
      const at = comment.target.kind === 'recording' ? comment.target.at : null;
      const clock = comment.target.kind === 'recording' && comment.target.recording.kind === 'jam' ? 'Mic' : 'Recording';
      const timestamp = at ? `${clock} ${formatTime(at.kind === 'point' ? at.seconds : at.start)}${at.kind === 'range' ? `–${formatTime(at.end)}` : ''}` : 'Untimed';
      const recording = comment.target.kind === 'recording' ? comment.target.recording : null;
      const jam = recording?.kind === 'jam' ? jams.find(jam => jam.id === recording.id) || null : null;
      const micTime = at ? at.kind === 'point' ? at.seconds : at.start : null;
      const aligned = jam?.alignment;
      const sourceTime = aligned && micTime !== null ? aligned.sourceAtCaptureZero + (micTime - aligned.correctionSeconds) * aligned.sourceSecondsPerCaptureSecond : null;
      const sourceLabel = aligned?.source.recording.kind === 'reference' ? props.catalog.references.find(ref => ref.id === aligned.source.recording.id)?.label || 'Captured backing' : 'Captured backing';
      const projected = aligned && micTime !== null && sourceTime !== null && micTime >= aligned.coverage.micStart && micTime <= aligned.coverage.micEnd && sourceTime >= aligned.coverage.sourceStart && sourceTime <= aligned.coverage.sourceEnd;
      return <li key={comment.id} id={`comment-${comment.id}`} className={props.highlightedComment === comment.id ? 'is-highlighted' : ''}><p>{comment.text}</p><small>{comment.actor.label} (local) · {timestamp}{projected ? ` · ${sourceLabel} ${formatTime(sourceTime!)} (estimated)` : ''}{comment.instrument ? ` · ${comment.instrument.kind === 'custom' ? comment.instrument.label : comment.instrument.labelSnapshot}` : ''}</small><div><a href={jamLink(location.href, props.songId, jam, comment)} onClick={event => { event.preventDefault(); props.onCommentOpen(comment, jam); }}>{at ? 'Open this moment' : 'Link to note'}</a><button aria-label="Copy comment link" onClick={() => void copy(jamLink(location.href, props.songId, jam, comment))}><Copy size={14} /></button></div></li>;
    })}</ol>
  </section>;
}
