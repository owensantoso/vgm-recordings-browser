// Private jam/comment wire contract. Raw mic audio and capture settings are immutable.
export type RecordingRef = { kind: 'reference' | 'archive' | 'jam'; id: string };
export interface ExactAudio { recording: RecordingRef; sha256: string; durationSeconds: number }
export type JamInstrument = { kind: 'custom'; label: string } | {
  kind: 'stem'; source: ExactAudio; stemSetId: string; stemSetRevision: string;
  trackId: string; labelSnapshot: string;
};
export interface JamBackingMix {
  schemaVersion: 1; source: ExactAudio; mode: 'original' | 'stems';
  playbackRate: number; masterGain: number;
  stems: null | { setId: string; revision: string; tracks: { id: string; assetHash: string; level: number; muted: boolean; solo: boolean }[] };
}
export interface JamAlignment {
  source: ExactAudio; sourceAtCaptureZero: number; sourceSecondsPerCaptureSecond: number;
  clockBasis: 'observed-media-time'; estimateProvenance: string;
  // Full immutable mic file may contain an unbacked lead-in/finalized tail.
  coverage: { micStart: number; micEnd: number; sourceStart: number; sourceEnd: number };
  correctionSeconds: number; correctionReviewed: boolean;
}
export interface JamSectionAssociation {
  source: ExactAudio; sectionId: string; sectionRevision: number; labelSnapshot: string;
}
export interface JamInput {
  schemaVersion: 1; captureId: string; songId: string; title: string;
  instrument: JamInstrument | null; sections: JamSectionAssociation[];
  // Null alignment with a saved mix means an interrupted, unaligned overdub (mic-only).
  alignment: JamAlignment | null; backingMix: JamBackingMix | null;
  captureEnd: 'stopped' | 'range-ended' | 'limit' | 'interrupted';
}
export interface Jam extends Omit<JamInput, 'captureId'> {
  id: string; createdAt: string; actor: { kind: 'local'; label: string }; revision: number;
  audio: { sha256: string; bytes: number; mimeType: string; sampleRate: number; channels: number; frames: number; durationSeconds: number };
  // Always relative to current app base, including its private Serve prefix.
  audioUrl: string;
  backingAvailability: { available: boolean; reason: string | null };
  sectionAvailability: { sectionId: string; current: boolean }[];
}
export interface JamContext {
  recording: RecordingRef; songIds: string[]; label: string; audio: ExactAudio | null;
  stemSet: null | { id: string; revision: string; start: number; end: number; tracks: { id: string; label: string; assetHash: string }[] };
  sections: { id: string; label: string; revision: number }[];
}
export type JamCommentTarget = { kind: 'song'; songId: string } | {
  kind: 'recording'; recording: RecordingRef;
  at: null | { kind: 'point'; seconds: number; audio: ExactAudio } | { kind: 'range'; start: number; end: number; audio: ExactAudio };
};
export interface JamCommentInput { id: string; songId: string | null; target: JamCommentTarget; instrument: JamInstrument | null; text: string }
export interface JamComment extends JamCommentInput { actor: { kind: 'local'; label: string }; createdAt: string; revision: number }
export class JamDataError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'JamDataError'; }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' }); }
  catch { throw new JamDataError('Private jam storage is unavailable. Your draft can be retried.', 0); }
  let data: unknown;
  try { data = await response.json(); } catch { throw new JamDataError('Private jam storage is unavailable.', response.status); }
  if (!response.ok) throw new JamDataError(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Private jam storage is unavailable.', response.status);
  return data as T;
}
export function fetchJamContext(recording: RecordingRef): Promise<JamContext> {
  return request(`api/jams/context?kind=${recording.kind}&id=${encodeURIComponent(recording.id)}`);
}
export async function saveJam(input: JamInput, audio: Blob): Promise<Jam> {
  const metadata = encodeURIComponent(JSON.stringify(input));
  if (metadata.length > 12000) throw new JamDataError('Jam metadata is too large.', 413);
  return (await request<{ jam: Jam }>('api/jams', { method: 'POST', headers: { 'Content-Type': audio.type, 'X-Jam-Metadata': metadata }, body: audio })).jam;
}
export async function fetchJams(songId: string): Promise<Jam[]> { return (await request<{ jams: Jam[] }>(`api/jams?song=${encodeURIComponent(songId)}`)).jams; }
export async function fetchJam(id: string): Promise<Jam> { return (await request<{ jam: Jam }>(`api/jams/${encodeURIComponent(id)}`)).jam; }
export async function updateJamCorrection(id: string, revision: number, correctionSeconds: number): Promise<Jam> {
  return (await request<{ jam: Jam }>(`api/jams/${encodeURIComponent(id)}/correction`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, correctionSeconds }) })).jam;
}
export async function createJamComment(input: JamCommentInput): Promise<JamComment> {
  return (await request<{ comment: JamComment }>('api/jam-comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).comment;
}
export async function fetchJamComments(target: JamCommentTarget, songId: string | null): Promise<JamComment[]> {
  const query = new URLSearchParams({ target: JSON.stringify(target), song: songId ?? '' });
  return (await request<{ comments: JamComment[] }>(`api/jam-comments?${query}`)).comments;
}
