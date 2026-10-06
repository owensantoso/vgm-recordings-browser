import { useEffect, useId, useState } from "react";
import { Copy, Repeat2 } from "lucide-react";
import { validateLoopRange } from "./practice";
import type { LoopRange } from "./practice";

export interface PracticeControlsProps {
  duration: number;
  currentTime: number;
  defaultRange: LoopRange;
  range: LoopRange;
  repeat: boolean;
  available: boolean;
  error?: string;
  unavailableReason?: string;
  onChange(range: LoopRange): void;
  onRepeat(value: boolean): void;
  onCopy(): void;
}

export function PracticeControls({
  duration,
  currentTime,
  defaultRange,
  range,
  repeat,
  available,
  error = "",
  unavailableReason,
  onChange,
  onRepeat,
  onCopy,
}: PracticeControlsProps) {
  const id = useId();
  const [a, setA] = useState(String(range.start));
  const [b, setB] = useState(String(range.end));
  const [draftError, setDraftError] = useState("");
  const enabled = available && Number.isFinite(duration) && duration >= 0.25;
  const rangeValid = enabled && !validateLoopRange(range, duration);
  const excerptValid = enabled && !validateLoopRange(defaultRange, duration);
  const clockValid = enabled && Number.isFinite(currentTime);
  useEffect(() => {
    setA(String(range.start));
    setB(String(range.end));
    setDraftError("");
  }, [range.start, range.end]);
  function apply() {
    const next = {
      start: a.trim() ? Number(a) : NaN,
      end: b.trim() ? Number(b) : NaN,
    };
    const message = validateLoopRange(next, duration);
    setDraftError(message);
    if (!message) onChange(next);
  }
  function selectedExcerpt() {
    setA(String(defaultRange.start));
    setB(String(defaultRange.end));
    setDraftError("");
    onChange(defaultRange);
  }
  const message = draftError || error;
  return (
    <section className="practice-controls" aria-label="Practice range">
      <header>
        <h3>Practice range</h3>
        <span>A → B</span>
      </header>
      {!enabled && (
        <p className="practice-note">
          {unavailableReason ||
            (available &&
            Number.isFinite(duration) &&
            duration > 0 &&
            duration < 0.25
              ? "This audio is too short for a practice range."
              : "Practice ranges need local audio with a known duration.")}
        </p>
      )}
      <form
        className="practice-range-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (enabled) apply();
        }}
      >
        <div className="practice-field">
          <label htmlFor={`${id}-a`}>A (seconds)</label>
          <input
            id={`${id}-a`}
            type="number"
            min="0"
            max={Number.isFinite(duration) ? duration : undefined}
            step="any"
            value={a}
            disabled={!enabled}
            onChange={(event) => setA(event.target.value)}
          />
          <button
            type="button"
            disabled={!clockValid}
            onClick={() =>
              setA(String(Math.max(0, Math.min(duration, currentTime))))
            }
          >
            Set A here
          </button>
        </div>
        <div className="practice-field">
          <label htmlFor={`${id}-b`}>B (seconds)</label>
          <input
            id={`${id}-b`}
            type="number"
            min="0"
            max={Number.isFinite(duration) ? duration : undefined}
            step="any"
            value={b}
            disabled={!enabled}
            onChange={(event) => setB(event.target.value)}
          />
          <button
            type="button"
            disabled={!clockValid}
            onClick={() =>
              setB(String(Math.max(0, Math.min(duration, currentTime))))
            }
          >
            Set B here
          </button>
        </div>
        <div className="practice-actions">
          <button type="submit" disabled={!enabled}>
            Apply range
          </button>
          <button
            type="button"
            disabled={!excerptValid}
            onClick={selectedExcerpt}
          >
            Use selected excerpt
          </button>
        </div>
      </form>
      <div className="practice-actions">
        <button
          className="practice-repeat"
          type="button"
          aria-pressed={repeat}
          disabled={!rangeValid}
          onClick={() => onRepeat(!repeat)}
        >
          <Repeat2 size={14} /> Repeat
        </button>
        <button type="button" disabled={!rangeValid} onClick={onCopy}>
          <Copy size={14} /> Copy practice link
        </button>
      </div>
      {message && (
        <p className="practice-error" role="alert">
          {message}
        </p>
      )}
      {enabled && (
        <p className="practice-note">Times are seconds in this recording.</p>
      )}
    </section>
  );
}
