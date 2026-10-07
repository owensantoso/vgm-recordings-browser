import test from 'node:test';
import assert from 'node:assert/strict';
import { correctedJamInterval, alignedJamSpans, commentSourceSpan, jamCommentSelection, sourceCommentSelection } from '../src/timelineProjection.ts';
import type { ExactAudio, Jam, JamComment, JamContext } from '../src/jamData.ts';
const source: ExactAudio = { recording: { kind: 'reference', id: 'original' }, sha256: 'a'.repeat(64), durationSeconds: 100 };
function jam(id = 'one', changes: Partial<Jam> = {}): Jam {
  return { id, schemaVersion: 1, songId: 'song', title: 'Piano jam', instrument: { kind: 'custom', label: 'Piano' }, sections: [], captureEnd: 'stopped', createdAt: '2026-10-08', actor: { kind: 'local', label: 'Local musician' }, revision: 1,
    audio: { sha256: 'b'.repeat(64), bytes: 100, mimeType: 'audio/webm', sampleRate: 48000, channels: 1, frames: 960000, durationSeconds: 20 }, audioUrl: 'api/jams/one/audio', backingAvailability: { available: true, reason: null }, sectionAvailability: [],
    alignment: { source, sourceAtCaptureZero: 10, sourceSecondsPerCaptureSecond: .5, clockBasis: 'observed-media-time', estimateProvenance: 'Test', coverage: { micStart: 2, micEnd: 14, sourceStart: 11, sourceEnd: 17 }, correctionSeconds: 1, correctionReviewed: true },
    backingMix: { schemaVersion: 1, source, mode: 'original', playbackRate: .5, masterGain: 1, stems: null }, ...changes };
}
const context: JamContext = { recording: source.recording, songIds: ['song'], label: 'Original recording', audio: source, sections: [], stemSet: { id: 'set', revision: 'revision', start: 0, end: 100, tracks: [{ id: 'piano', label: 'Piano', assetHash: 'c'.repeat(64) }] } };
test('jam span clips corrected mapping against exact source and backed mic coverage independently', () => {
  const [span] = alignedJamSpans([jam()], source);
  assert.equal(span.start, 11); assert.equal(span.end, 16.5); assert.equal(span.micStart, 3); assert.equal(span.micEnd, 14);
  const later = jam(); later.alignment!.correctionSeconds = -1;
  const [other] = alignedJamSpans([later], source);
  assert.equal(other.start, 11.5); assert.equal(other.end, 17); assert.equal(other.micEnd, 13);
});
test('free, other-version, changed-hash, stale and empty corrected jams never enter source timeline', () => {
  const version = jam('version'); version.alignment!.source = { ...source, recording: { kind: 'reference', id: 'other' } };
  const hash = jam('hash'); hash.alignment!.source = { ...source, sha256: 'd'.repeat(64) };
  const stale = jam('stale', { backingAvailability: { available: false, reason: 'Changed source' } });
  const empty = jam('empty'); empty.alignment!.correctionSeconds = 30;
  assert.deepEqual(alignedJamSpans([jam('free', { alignment: null }), version, hash, stale, empty], source), []);
});
test('overlapping jams occupy stacked sublanes while disjoint bars reuse a lane', () => {
  const a = jam('a'), b = jam('b'), c = jam('c');
  c.alignment = { ...c.alignment!, sourceAtCaptureZero: 25, coverage: { micStart: 2, micEnd: 14, sourceStart: 26, sourceEnd: 32 } };
  const spans = alignedJamSpans([c, b, a], source);
  assert.deepEqual(spans.map(span => [span.jam.id, span.lane]), [['a', 0], ['b', 1], ['c', 0]]);
});
test('jam timeline range stores natural mic clock and played instrument, never source timestamps', () => {
  const [span] = alignedJamSpans([jam()], source);
  const selection = jamCommentSelection(span, 'song', 12, 14)!;
  assert.equal(selection.target.kind, 'recording');
  if (selection.target.kind !== 'recording' || selection.target.at?.kind !== 'range') throw new Error('Expected range');
  assert.deepEqual(selection.target.recording, { kind: 'jam', id: 'one' });
  assert.equal(selection.target.at.start, 5); assert.equal(selection.target.at.end, 9);
  assert.equal(selection.target.at.audio.sha256, 'b'.repeat(64));
  assert.deepEqual(selection.instrument, { kind: 'custom', label: 'Piano' });
  assert.equal(jamCommentSelection(span, 'song', 10.9), null);
  assert.equal(jamCommentSelection(span, 'song', 15, 17), null);
});
test('source instrument comment pins exact stem revision; archive clock uses its own verified audio', () => {
  const selected = sourceCommentSelection(context, 'song', 24, 26, 'piano')!;
  assert.equal(selected.instrument?.kind, 'stem');
  if (selected.instrument?.kind !== 'stem') throw new Error('Expected stem');
  assert.equal(selected.instrument.source.sha256, source.sha256); assert.equal(selected.instrument.stemSetRevision, 'revision');
  assert.equal(sourceCommentSelection(context, 'song', 24, 24), null);
  assert.equal(sourceCommentSelection(context, 'song', 24, undefined, 'unknown'), null);
  const archiveAudio = { ...source, recording: { kind: 'archive' as const, id: 'take.mov' } };
  const archive = sourceCommentSelection({ ...context, audio: archiveAudio, recording: archiveAudio.recording, stemSet: null }, 'song', 8)!;
  assert.equal(archive.target.kind === 'recording' && archive.target.at?.audio.recording.kind, 'archive');
});
test('mic comments project only inside corrected valid coverage and with matching mic hash', () => {
  const spans = alignedJamSpans([jam()], source);
  const payload = jamCommentSelection(spans[0], 'song', 12, 14)!;
  const comment: JamComment = { ...payload, id: 'comment', text: 'Fill here', actor: { kind: 'local', label: 'Local' }, createdAt: 'now', revision: 1 };
  assert.deepEqual(commentSourceSpan(comment, source, spans), { start: 12, end: 14 });
  const out = structuredClone(comment);
  if (out.target.kind === 'recording' && out.target.at?.kind === 'range') out.target.at.start = 0;
  assert.equal(commentSourceSpan(out, source, spans), null);
  const changed = structuredClone(comment);
  if (changed.target.kind === 'recording' && changed.target.at) changed.target.at.audio.sha256 = 'd'.repeat(64);
  assert.equal(commentSourceSpan(changed, source, spans), null);
});

test('default replay and timeline share corrected coverage, while replay start and stem bounds narrow it', () => {
  const value = jam();
  const span = alignedJamSpans([value], source)[0];
  assert.deepEqual(correctedJamInterval(value.alignment!, value.audio.durationSeconds), { start: span.start, end: span.end, micStart: span.micStart, micEnd: span.micEnd });
  const later = correctedJamInterval(value.alignment!, value.audio.durationSeconds, {start: 12, end: 15}, 6)!;
  assert.equal(later.start, 12.5); assert.equal(later.end, 15);
  assert.equal(correctedJamInterval(value.alignment!, value.audio.durationSeconds, {start: 18, end: 20}), null);
});
