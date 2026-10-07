export interface PracticeAnnotation {
  id: string;
  type: 'chord' | 'note';
  text: string;
  start: number;
  end: number;
  revision: number;
}
export interface PracticeAnnotationInput {
  sourceId: string;
  sourceHash: string;
  type: 'chord' | 'note';
  text: string;
  start: number;
  end: number;
}
export interface PracticeWaveforms {
  sourceId: string;
  sourceHash: string;
  tracks: { id: string; peaks: [number, number][] }[];
}

export interface PracticeSection {
  id: string;
  label: string;
  start: number;
  end: number;
  revision: number;
}

export interface StemTrack {
  id: string;
  label: string;
  file: string;
  bytes: number;
  sha256: string;
}

export interface StemChunkFile {
  trackId: string;
  file: string;
  bytes: number;
  sha256: string;
}
export interface StemChunk {
  startFrame: number;
  frameCount: number;
  files: StemChunkFile[];
}

export interface StemSet {
  id: string;
  sourceId: string;
  sourceHash: string;
  coverage: 'full-source' | 'excerpt';
  start: number;
  end: number;
  sampleRate: number;
  channels: number;
  frames: number;
  tracks: StemTrack[];
  chunks?: StemChunk[];
  waveforms?: { file: string; bytes: number; sha256: string; bins: number };
}

export interface PracticeSource {
  sourceId: string;
  sourceHash: string;
  duration: number;
  sections: PracticeSection[];
  annotations: PracticeAnnotation[];
  waveforms: PracticeWaveforms | null;
  stemSet: StemSet | null;
}

export interface PracticeSectionInput {
  sourceId: string;
  sourceHash: string;
  label: string;
  start: number;
  end: number;
}

export class PracticeDataError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'PracticeDataError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' }); }
  catch { throw new PracticeDataError('Private practice data is unavailable. Check the connection and try again.', 0); }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new PracticeDataError('Practice sections are available in the private music workspace.', response.status); }
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? (data as { error: unknown }).error : null;
    throw new PracticeDataError(typeof error === 'string' ? error : 'Private practice data is unavailable.', response.status);
  }
  return data as T;
}

export function fetchPracticeSource(sourceId: string): Promise<PracticeSource> {
  return request(`api/practice?source=${encodeURIComponent(sourceId)}`);
}

export async function createPracticeSection(input: PracticeSectionInput): Promise<PracticeSection> {
  const result = await request<{ section: PracticeSection }>('api/practice', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  return result.section;
}

export async function updatePracticeSection(id: string, input: PracticeSectionInput & { revision: number }): Promise<PracticeSection> {
  const result = await request<{ section: PracticeSection }>(`api/practice/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  return result.section;
}


export async function createPracticeAnnotation(input: PracticeAnnotationInput): Promise<PracticeAnnotation> {
  const result = await request<{ annotation: PracticeAnnotation }>('api/practice/annotations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  return result.annotation;
}
export async function updatePracticeAnnotation(id: string, input: PracticeAnnotationInput & { revision: number }): Promise<PracticeAnnotation> {
  const result = await request<{ annotation: PracticeAnnotation }>(`api/practice/annotations/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  return result.annotation;
}
