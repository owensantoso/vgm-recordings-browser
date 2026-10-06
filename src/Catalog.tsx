import { useMemo, useState } from 'react';
import type { Recording } from './recordings';
import { title, formatTime } from './recordings';

export type View = 'recordings' | 'songs' | 'repertoire';
export interface Song { id: string; title: string; game: string | null; franchise: string | null; composer: string | null }
export interface CatalogData {
  version: number;
  songs: Song[];
  sessions: { id: string; label: string; date: string }[];
  recordings: { file: string; session_id: string; song_id: string | null }[];
  references: { id: string; song_id: string; kind: string; label: string; url: string; artist: string | null }[];
  repertoire: { song_id: string; note: string; position: number }[];
}
export function route(href: string) {
  const url = new URL(href);
  const requested = url.searchParams.get('view');
  const view: View = requested === 'songs' || requested === 'repertoire' ? requested : 'recordings';
  return { view, song: view === 'recordings' ? '' : url.searchParams.get('song') || '' };
}
export function catalogHref(href: string, view: View, song = '') {
  const url = new URL(href);
  if (view === 'recordings') url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  if (song) url.searchParams.set('song', song);
  else url.searchParams.delete('song');
  return url.toString();
}
export function Exact({ value, query }: { value: string; query: string }) {
  const index = query.trim() ? value.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()) : -1;
  return index < 0 ? <>{value}</> : <>{value.slice(0, index)}<mark>{value.slice(index, index + query.trim().length)}</mark>{value.slice(index + query.trim().length)}</>;
}

export function SongCatalog({ catalog, rows, view, songId, navigate, play, selected }: {
  catalog: CatalogData; rows: Recording[]; view: View; songId: string;
  navigate(view: View, song?: string): void; play(row: Recording): void; selected?: string;
}) {
  const [query, setQuery] = useState('');
  const song = catalog.songs.find(item => item.id === songId);
  const byFile = useMemo(() => new Map(rows.map(row => [row.file, row])), [rows]);
  const memberIds = new Set(catalog.repertoire.map(item => item.song_id));
  const takes = (id: string) => catalog.recordings.filter(item => item.song_id === id).flatMap(item => byFile.get(item.file) ? [byFile.get(item.file)!] : []);
  const available = view === 'repertoire' ? catalog.repertoire.flatMap(item => catalog.songs.find(song => song.id === item.song_id) || []) : catalog.songs;
  const visible = available.filter(song => [song.title, song.game, song.franchise, song.composer].some(value => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const unidentified = catalog.recordings.filter(item => !item.song_id).flatMap(item => byFile.get(item.file) ? [byFile.get(item.file)!] : []);
  function takeList(records: Recording[]) {
    return <ol className="song-takes">{records.map(row => <li key={row.file}>
      <button className="song-take" onClick={() => play(row)} aria-current={selected === row.file ? 'true' : undefined}>
        <img src={row.thumbnail} alt="" width="72" height="45" />
        <span><strong>{title(row)}</strong><small>{row.recorded_create_date.slice(0, 10)} · {row.recorded_create_date.slice(11)}<br />{row.file}</small></span>
        <span className="duration">{row.length || formatTime(Number(row.duration_seconds))}</span>
      </button>
    </li>)}</ol>;
  }
  if (songId && !song) return <section id="songbook" tabIndex={-1} className="song-content"><h1>Song not found</h1><button onClick={() => navigate(view)}>Back to songs</button></section>;
  if (song) {
    const records = takes(song.id);
    const refs = catalog.references.filter(ref => ref.song_id === song.id);
    return <section id="songbook" tabIndex={-1} className="song-content" aria-labelledby="song-title">
      <a className="back-link" href={catalogHref(location.href, view)} onClick={e => { e.preventDefault(); navigate(view); }}>← {view === 'repertoire' ? 'Repertoire' : 'All songs'}</a>
      <header className="song-heading"><p className="eyebrow">{song.franchise || 'Song'}</p><h1 id="song-title" tabIndex={-1}>{song.title}</h1><p>{song.game || 'Game not recorded'}</p></header>
      <div className="song-summary"><span>{records.length} {records.length === 1 ? 'take' : 'takes'} · {new Set(records.map(row => row.session_id)).size} sessions</span>{memberIds.has(song.id) && <span>In repertoire</span>}</div>
      <dl className="song-credits"><dt>Composer</dt><dd>{song.composer || 'Not recorded yet'}</dd></dl>
      <section className="song-section"><h3>References</h3>{refs.length ? <ul className="reference-list">{refs.map(ref => <li key={ref.id}><a href={ref.url} target="_blank" rel="noopener noreferrer">{ref.label} ↗</a><small>{ref.kind}{ref.artist ? ` · ${ref.artist}` : ''}</small></li>)}</ul> : <p className="quiet-note">No original soundtrack, cover, or chart links added yet.</p>}</section>
      <section className="song-section"><h3>Our recordings <span>{records.length}</span></h3>{records.length ? takeList(records) : <p className="quiet-note">No recordings yet.</p>}</section>
      <details className="song-identity"><summary>Song identity</summary><code>{song.id}</code></details>
    </section>;
  }
  return <section id="songbook" tabIndex={-1} className="song-content" aria-labelledby="catalog-title">
    <header className="catalog-heading"><div><p className="eyebrow">{view === 'repertoire' ? 'Current selection' : 'The songbook'}</p><h1 id="catalog-title" tabIndex={-1}>{view === 'repertoire' ? 'Repertoire' : 'Songs'}</h1></div><span>{query.trim() ? `${visible.length} of ${available.length}` : available.length} songs</span></header>
    {view === 'repertoire' && !available.length ? <div className="catalog-empty"><h3>No repertoire selected yet.</h3><p>Recorded songs are in the songbook. The repertoire is reserved for the songs we choose to work on.</p><a href={catalogHref(location.href, 'songs')} onClick={e => {e.preventDefault(); navigate('songs');}}>Browse the songbook →</a></div> : <>
      <label className="catalog-search">Search songs<input type="search" placeholder="Song, game, or composer" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="song-list-heading"><span>Song / game</span><span>Recorded takes</span></div>
      <ul className="song-list">{visible.map(song => <li key={song.id}><a href={catalogHref(location.href, view, song.id)} onClick={e => {e.preventDefault();navigate(view, song.id);}}><span><strong><Exact value={song.title} query={query} /></strong><small><Exact value={song.game || song.franchise || 'Game not recorded'} query={query} /></small>{query.trim() && [song.franchise, song.composer].filter(Boolean).filter(value => ![song.title, song.game].some(shown => shown?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).map(value => value!.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ? <small key={value} className="match-context"><Exact value={value!} query={query} /></small> : null)}</span><span className="take-count">{takes(song.id).length}<span aria-hidden="true"> ↗</span></span></a></li>)}</ul>
      {!visible.length && <p className="quiet-note">No songs match “{query}”.</p>}
    </>}
    {view === 'songs' && !query && unidentified.length > 0 && <section className="song-section unidentified"><h3>Still to identify <span>{unidentified.length}</span></h3><p className="quiet-note">Original captions retained. These takes aren’t assigned a song ID yet.</p>{takeList(unidentified)}</section>}
  </section>;
}
