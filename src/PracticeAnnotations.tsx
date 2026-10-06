import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Pencil, Plus } from 'lucide-react';
import { validateLoopRange } from './practice';
import { formatTime } from './recordings';
import { createPracticeAnnotation, updatePracticeAnnotation } from './practiceData';
import type { PracticeAnnotation, PracticeSource } from './practiceData';

export interface PracticeAnnotationsProps {
  data: PracticeSource | null;
  loading: boolean;
  error: string;
  currentTime: number;
  onSeek(seconds: number): void;
  onSaved(annotation: PracticeAnnotation): void;
  onCopy?(annotation: PracticeAnnotation): void;
  onReload(): void;
}

function annotationTime(seconds: number): string {
  const rounded = Math.round(seconds * 1000) / 1000;
  const fraction = (rounded - Math.floor(rounded)).toFixed(3).slice(1).replace(/0+$/, '').replace(/\.$/, '');
  return formatTime(Math.floor(rounded)) + fraction;
}

export function PracticeAnnotations({ data, loading, error, currentTime, onSeek, onSaved, onCopy, onReload }: PracticeAnnotationsProps) {
  const id = useId();
  const [editing, setEditing] = useState<PracticeAnnotation | 'new' | null>(null);
  const [type, setType] = useState<'chord' | 'note'>('chord');
  const [text, setText] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [saveError, setSaveError] = useState(false);
  const sourceKey = data ? `${data.sourceId}:${data.sourceHash}` : '';
  const generation = useRef({ key: sourceKey, value: 0 });
  if (generation.current.key !== sourceKey) generation.current = { key: sourceKey, value: generation.current.value + 1 };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setEditing(null); setSaving(false); setDraftError(''); setSaveError(false); }, [sourceKey]);
  const available = Boolean(data && !loading && !error && data.duration >= .25 && Number.isFinite(data.duration));
  const clockAvailable = available && Number.isFinite(currentTime);
  function cancel() { setEditing(null); setDraftError(''); setSaveError(false); }
  function begin(nextType: 'chord' | 'note', annotation?: PracticeAnnotation) {
    const a = Math.max(0, Math.min(data ? data.duration - .25 : 0, Number.isFinite(currentTime) ? currentTime : 0));
    setEditing(annotation || 'new'); setType(annotation?.type ?? nextType); setText(annotation?.text ?? '');
    setStart(String(annotation?.start ?? a)); setEnd(String(annotation?.end ?? a + .25)); setDraftError(''); setSaveError(false);
  }
  async function save() {
    if (!available || !data || !editing || saving) return;
    const range = { start: start.trim() ? Number(start) : NaN, end: end.trim() ? Number(end) : NaN };
    const message = !text.trim() || text.trim().length > (type === 'chord' ? 80 : 2000)
      ? `Enter ${type === 'chord' ? 'a chord up to 80' : 'a note up to 2000'} characters.`
      : validateLoopRange(range, data.duration);
    if (message) { setDraftError(message); setSaveError(false); return; }
    const target = generation.current.value;
    const input = { sourceId: data.sourceId, sourceHash: data.sourceHash, type, text: text.trim(), ...range };
    setSaving(true); setDraftError(''); setSaveError(false);
    try {
      const annotation = editing === 'new' ? await createPracticeAnnotation(input) : await updatePracticeAnnotation(editing.id, { ...input, revision: editing.revision });
      if (!mounted.current || generation.current.value !== target) return;
      setEditing(null); onSaved(annotation);
    } catch (failure) {
      if (mounted.current && generation.current.value === target) { setDraftError(failure instanceof Error ? failure.message : 'The annotation could not be saved.'); setSaveError(true); }
    } finally { if (mounted.current && generation.current.value === target) setSaving(false); }
  }
  const message = draftError || error;
  return (
    <section className="practice-annotations" aria-labelledby={`${id}-title`} aria-busy={loading || saving}>
      <header className="annotation-header">
        <h3 id={`${id}-title`}>Chords &amp; notes</h3>
        <div className="annotation-actions">
          <button type="button" disabled={!available || saving} onClick={() => begin('chord')}><Plus size={14} aria-hidden="true" /> Add chord</button>
          <button type="button" disabled={!available || saving} onClick={() => begin('note')}><Plus size={14} aria-hidden="true" /> Add note</button>
        </div>
      </header>
      {loading && <p className="annotation-note" role="status">Loading chords and notes…</p>}
      {!loading && !error && !data && <p className="annotation-note">Chords and notes are available in the private music workspace.</p>}
      {data && !loading && !error && !data.annotations?.length && <p className="annotation-note">No chords or notes saved yet.</p>}
      {(['chord', 'note'] as const).map(kind => {
        const items = data?.annotations?.filter(annotation => annotation.type === kind) ?? [];
        return items.length ? <div className="annotation-group" key={kind}><h4>{kind === 'chord' ? 'Chords' : 'Notes'}</h4><ul className="annotation-list">
          {items.map(annotation => <li className="annotation-row" key={annotation.id}>
            <button className="annotation-time" type="button" aria-label={`Seek to ${kind} at ${annotationTime(annotation.start)}`} disabled={!available || saving} onClick={() => onSeek(annotation.start)}>{annotationTime(annotation.start)}–{annotationTime(annotation.end)}</button>
            <span className="annotation-text">{annotation.text}</span>
            {onCopy && <button type="button" aria-label={`Copy ${annotation.text} link`} title={`Copy ${annotation.text} link`} disabled={!available || saving} onClick={() => onCopy(annotation)}><Copy size={14} aria-hidden="true" /> Copy</button>}
            <button type="button" aria-label={`Edit ${kind} at ${annotationTime(annotation.start)}`} disabled={!available || saving} onClick={() => begin(kind, annotation)}><Pencil size={14} aria-hidden="true" /> Edit</button>
          </li>)}
        </ul></div> : null;
      })}
      {editing && data && <form className="annotation-form section-form" aria-label={editing === 'new' ? `Add ${type}` : `Edit ${type}`} noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="annotation-field section-field">
          <label htmlFor={`${id}-text`}>{type === 'chord' ? 'Chord' : 'Note'}</label>
          {type === 'chord' ? <input id={`${id}-text`} type="text" maxLength={80} value={text} disabled={!available || saving} onChange={event => setText(event.target.value)} /> : <textarea id={`${id}-text`} maxLength={2000} value={text} disabled={!available || saving} onChange={event => setText(event.target.value)} />}
        </div>
        <div className="annotation-field section-field"><label htmlFor={`${id}-start`}>Annotation start (seconds)</label><input id={`${id}-start`} type="number" min="0" max={data.duration} step="any" value={start} disabled={!available || saving} onChange={event => setStart(event.target.value)} /><button type="button" disabled={!clockAvailable || saving} onClick={() => setStart(String(Math.max(0, Math.min(data.duration, currentTime))))}>Set annotation start here</button></div>
        <div className="annotation-field section-field"><label htmlFor={`${id}-end`}>Annotation end (seconds)</label><input id={`${id}-end`} type="number" min="0" max={data.duration} step="any" value={end} disabled={!available || saving} onChange={event => setEnd(event.target.value)} /><button type="button" disabled={!clockAvailable || saving} onClick={() => setEnd(String(Math.max(0, Math.min(data.duration, currentTime))))}>Set annotation end here</button></div>
        <div className="annotation-actions section-actions"><button type="submit" disabled={!available || saving}>{saving ? 'Saving…' : editing === 'new' ? `Save ${type}` : `Update ${type}`}</button><button type="button" disabled={saving} onClick={cancel}>Cancel</button></div>
        <p className="annotation-note section-note">Times are seconds in the original recording.</p>
      </form>}
      {message && <div className="annotation-error"><p role="alert">{message}</p>{(error || saveError) && <button type="button" disabled={loading || saving} onClick={() => { cancel(); onReload(); }}>Reload annotations</button>}</div>}
    </section>
  );
}
