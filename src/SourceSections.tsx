import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Pencil, Play, Plus } from 'lucide-react';
import { validateLoopRange } from './practice';
import type { LoopRange } from './practice';
import { createPracticeSection, updatePracticeSection } from './practiceData';
import type { PracticeSection, PracticeSource } from './practiceData';
import { formatTime } from './recordings';

export interface SourceSectionsProps {
  data: PracticeSource | null;
  loading: boolean;
  error: string;
  range: LoopRange;
  currentTime: number;
  activeId: string;
  onSelect(section: PracticeSection): void;
  onCopy(section: PracticeSection): void;
  onSaved(section: PracticeSection): void;
  onReload(): void;
}

function sectionTime(seconds: number): string {
  const rounded = Math.round(seconds * 1000) / 1000;
  const fraction = (rounded - Math.floor(rounded)).toFixed(3).slice(1).replace(/0+$/, '').replace(/\.$/, '');
  return formatTime(Math.floor(rounded)) + fraction;
}

export function SourceSections({ data, loading, error, range, currentTime, activeId, onSelect, onCopy, onSaved, onReload }: SourceSectionsProps) {
  const id = useId();
  const [editing, setEditing] = useState<PracticeSection | 'new' | null>(null);
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [draftError, setDraftError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const sourceKey = data ? `${data.sourceId}:${data.sourceHash}` : '';
  const sourceGeneration = useRef({ key: sourceKey, value: 0 });
  if (sourceGeneration.current.key !== sourceKey) {
    sourceGeneration.current = { key: sourceKey, value: sourceGeneration.current.value + 1 };
  }
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setEditing(null); setLabel(''); setStart(''); setEnd(''); setDraftError(''); setSaving(false); setSaveError(false);
  }, [sourceKey]);
  const available = Boolean(data && !loading && !error && Number.isFinite(data.duration) && data.duration >= .25);
  const clockAvailable = available && Number.isFinite(currentTime);

  function cancel() { setEditing(null); setDraftError(''); setSaveError(false); }
  function begin(section?: PracticeSection) {
    setEditing(section || 'new');
    setLabel(section?.label || '');
    setStart(String(section?.start ?? range.start));
    setEnd(String(section?.end ?? range.end));
    setDraftError(''); setSaveError(false);
  }
  async function save() {
    if (!available || !data || !editing || saving) return;
    const next = { start: start.trim() ? Number(start) : NaN, end: end.trim() ? Number(end) : NaN };
    const message = !label.trim() || label.trim().length > 80
      ? 'Use a section name from 1 to 80 characters.'
      : validateLoopRange(next, data.duration);
    if (message) { setDraftError(message); setSaveError(false); return; }
    const target = sourceGeneration.current.value;
    const input = { sourceId: data.sourceId, sourceHash: data.sourceHash, label: label.trim(), ...next };
    setSaving(true); setDraftError(''); setSaveError(false);
    try {
      const section = editing === 'new'
        ? await createPracticeSection(input)
        : await updatePracticeSection(editing.id, { ...input, revision: editing.revision });
      if (!mounted.current || sourceGeneration.current.value !== target) return;
      setEditing(null); onSaved(section);
    } catch (failure) {
      if (mounted.current && sourceGeneration.current.value === target) {
        setDraftError(failure instanceof Error ? failure.message : 'The section could not be saved.');
        setSaveError(true);
      }
    } finally {
      if (mounted.current && sourceGeneration.current.value === target) setSaving(false);
    }
  }
  const message = draftError || error;
  return (
    <section className="source-sections" aria-labelledby={`${id}-title`} aria-busy={loading || saving}>
      <header className="source-sections-header">
        <h3 id={`${id}-title`}>Sections</h3>
        <button type="button" disabled={!available || saving} onClick={() => begin()}><Plus size={14} aria-hidden="true" /> Add section</button>
      </header>
      {loading && <p className="section-note" role="status">Loading sections…</p>}
      {!loading && !error && !data && <p className="section-note">Sections are available in the private music workspace.</p>}
      {data && !loading && !error && data.sections.length === 0 && <p className="section-note">No sections saved yet. Name a range to return to it.</p>}
      {data && data.sections.length > 0 && (
        <ul className="section-list">
          {data.sections.map(section => (
            <li key={section.id} className={`section-row${activeId === section.id ? ' is-active' : ''}`}>
              <button type="button" aria-label={`Play ${section.label}`} aria-pressed={activeId === section.id} disabled={!available || saving} onClick={() => onSelect(section)}>
                <Play size={14} aria-hidden="true" /> <span>{section.label}</span>
              </button>
              <span className="section-times">{sectionTime(section.start)}–{sectionTime(section.end)}</span>
              <div className="section-actions">
                <button type="button" aria-label={`Copy ${section.label} link`} disabled={!available || saving} onClick={() => onCopy(section)}><Copy size={14} aria-hidden="true" /> Copy</button>
                <button type="button" aria-label={`Edit ${section.label}`} disabled={!available || saving} onClick={() => begin(section)}><Pencil size={14} aria-hidden="true" /> Edit</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && data && (
        <form className="section-form" noValidate aria-label={editing === 'new' ? 'Add section' : `Edit ${editing.label}`} onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="section-field">
            <label htmlFor={`${id}-name`}>Section name</label>
            <input id={`${id}-name`} type="text" maxLength={80} value={label} disabled={!available || saving} onChange={event => setLabel(event.target.value)} />
          </div>
          <div className="section-field">
            <label htmlFor={`${id}-start`}>Original start (seconds)</label>
            <input id={`${id}-start`} type="number" min="0" max={data.duration} step="any" value={start} disabled={!available || saving} onChange={event => setStart(event.target.value)} />
            <button type="button" disabled={!clockAvailable || saving} onClick={() => setStart(String(Math.max(0, Math.min(data.duration, currentTime))))}>Set start here</button>
          </div>
          <div className="section-field">
            <label htmlFor={`${id}-end`}>Original end (seconds)</label>
            <input id={`${id}-end`} type="number" min="0" max={data.duration} step="any" value={end} disabled={!available || saving} onChange={event => setEnd(event.target.value)} />
            <button type="button" disabled={!clockAvailable || saving} onClick={() => setEnd(String(Math.max(0, Math.min(data.duration, currentTime))))}>Set end here</button>
          </div>
          <div className="section-actions">
            <button type="submit" disabled={!available || saving}>{saving ? 'Saving…' : editing === 'new' ? 'Create section' : 'Update section'}</button>
            <button type="button" disabled={saving} onClick={cancel}>Cancel</button>
          </div>
          <p className="section-note">Times are seconds in the original recording.</p>
        </form>
      )}
      {message && <div className="section-error"><p role="alert">{message}</p>{(saveError || error) && <button type="button" disabled={loading || saving} onClick={() => { cancel(); onReload(); }}>Reload sections</button>}</div>}
    </section>
  );
}
