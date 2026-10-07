import type { ExactAudio, Jam, JamComment, JamCommentInput, JamContext, JamInstrument } from './jamData';

export interface AlignedJamSpan { jam: Jam; start: number; end: number; micStart: number; micEnd: number; lane: number }
export function sameAudio(a: ExactAudio | null | undefined, b: ExactAudio | null | undefined): boolean {
  return !!a && !!b && a.recording.kind === b.recording.kind && a.recording.id === b.recording.id && a.sha256 === b.sha256 && a.durationSeconds === b.durationSeconds;
}
export function jamSourceTime(jam: Jam, mic: number): number {
  const a = jam.alignment!;
  return a.sourceAtCaptureZero + (mic - a.correctionSeconds) * a.sourceSecondsPerCaptureSecond;
}
export function jamMicTime(jam: Jam, source: number): number {
  const a = jam.alignment!;
  return (source - a.sourceAtCaptureZero) / a.sourceSecondsPerCaptureSecond + a.correctionSeconds;
}
export function correctedJamInterval(alignment: NonNullable<Jam['alignment']>, duration: number, bounds = { start: 0, end: alignment.source.durationSeconds }, replayStart = 0): { start: number; end: number; micStart: number; micEnd: number } | null {
  const rate = alignment.sourceSecondsPerCaptureSecond;
  if (!(rate > 0)) return null;
  const inverse = (value: number) => (value - alignment.sourceAtCaptureZero) / rate + alignment.correctionSeconds;
  const forward = (value: number) => alignment.sourceAtCaptureZero + (value - alignment.correctionSeconds) * rate;
  const micStart = Math.max(0, replayStart, alignment.coverage.micStart, inverse(Math.max(0, bounds.start, alignment.coverage.sourceStart)));
  const micEnd = Math.min(duration, alignment.coverage.micEnd, inverse(Math.min(alignment.source.durationSeconds, bounds.end, alignment.coverage.sourceEnd)));
  if (!Number.isFinite(micStart) || !Number.isFinite(micEnd) || micEnd <= micStart) return null;
  return { start: forward(micStart), end: forward(micEnd), micStart, micEnd };
}
export function alignedJamSpans(jams: Jam[], source: ExactAudio | null): AlignedJamSpan[] {
  if (!source) return [];
  const spans: AlignedJamSpan[] = [];
  for (const jam of jams) {
    const a = jam.alignment;
    if (!a || !jam.backingAvailability.available || !sameAudio(a.source, source) || !(a.sourceSecondsPerCaptureSecond > 0)) continue;
    const interval = correctedJamInterval(a, jam.audio.durationSeconds);
    if (interval) spans.push({ jam, ...interval, lane: 0 });
  }
  spans.sort((a, b) => a.start - b.start || a.jam.id.localeCompare(b.jam.id));
  const ends: number[] = [];
  for (const span of spans) { let lane = ends.findIndex(end => end <= span.start); if (lane < 0) lane = ends.length; span.lane = lane; ends[lane] = span.end; }
  return spans;
}
export function instrumentLabel(instrument: JamInstrument | null): string {
  return instrument?.kind === 'custom' ? instrument.label : instrument?.labelSnapshot || 'Any instrument';
}
export function sourceCommentSelection(context: JamContext, songId: string, start?: number, end?: number, trackId?: string): Omit<JamCommentInput, 'id' | 'text'> | null {
  if (!context.audio) return null;
  const audio = context.audio;
  const track = context.stemSet?.tracks.find(value => value.id === trackId);
  if (trackId && !track) return null;
  if (start !== undefined && (!Number.isFinite(start) || start < 0 || start > audio.durationSeconds || (end !== undefined && (!Number.isFinite(end) || end <= start || end > audio.durationSeconds)))) return null;
  return { songId, target: { kind: 'recording', recording: audio.recording, at: start === undefined ? null : end === undefined ? { kind: 'point', seconds: start, audio } : { kind: 'range', start, end, audio } }, instrument: track && context.stemSet ? { kind: 'stem', source: audio, stemSetId: context.stemSet.id, stemSetRevision: context.stemSet.revision, trackId: track.id, labelSnapshot: track.label } : null };
}
export function jamCommentSelection(span: AlignedJamSpan, songId: string, start: number, end?: number): Omit<JamCommentInput, 'id' | 'text'> | null {
  if (!Number.isFinite(start) || start < span.start || start > span.end || (end !== undefined && (!Number.isFinite(end) || end <= start || end > span.end))) return null;
  const jam = span.jam, seconds = jamMicTime(jam, start), audio: ExactAudio = { recording: { kind: 'jam', id: jam.id }, sha256: jam.audio.sha256, durationSeconds: jam.audio.durationSeconds };
  return { songId, target: { kind: 'recording', recording: audio.recording, at: end === undefined ? { kind: 'point', seconds, audio } : { kind: 'range', start: seconds, end: jamMicTime(jam, end), audio } }, instrument: jam.instrument };
}
export function commentSourceSpan(comment: JamComment, source: ExactAudio | null, spans: AlignedJamSpan[]): { start: number; end?: number } | null {
  if (comment.target.kind !== 'recording' || !comment.target.at || !source) return null;
  const at = comment.target.at, start = at.kind === 'point' ? at.seconds : at.start, end = at.kind === 'range' ? at.end : undefined;
  if (sameAudio(at.audio, source)) return { start, end };
  const aligned = spans.find(value => value.jam.id === at.audio.recording.id && at.audio.recording.kind === 'jam' && value.jam.audio.sha256 === at.audio.sha256);
  if (!aligned || start < aligned.micStart || start > aligned.micEnd || (end !== undefined && (end < aligned.micStart || end > aligned.micEnd))) return null;
  return { start: jamSourceTime(aligned.jam, start), end: end === undefined ? undefined : jamSourceTime(aligned.jam, end) };
}
