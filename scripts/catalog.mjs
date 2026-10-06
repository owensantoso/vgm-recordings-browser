import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseCsv } from '../src/recordings.ts';

export function referenceYoutubeId(url) {
  const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
  let id;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.match(/^\/([^/]+)\/?$/)?.[1];
  } else if (hosts.includes(url.hostname)) {
    id = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1];
  } else {
    return null;
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('Invalid YouTube reference URL.');
  return id;
}

export function buildCatalog(sql, csv, databasePath = ':memory:') {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    db.exec(sql);
    const recordings = parseCsv(csv);
    const links = db.prepare('SELECT file, session_id, song_id, played_key, played_bpm FROM recordings ORDER BY file').all();
    const byFile = new Map(recordings.map(row => [row.file, row]));
    if (links.length !== recordings.length) throw new Error('Catalog must cover every archive take exactly once.');
    for (const link of links) {
      const row = byFile.get(link.file);
      if (!row || row.session_id !== link.session_id) throw new Error(`Archive/catalog mismatch: ${link.file}`);
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Dangling catalog relationship.');
    const references = db.prepare('SELECT id, song_id, kind, label, url, artist FROM song_references ORDER BY id').all();
    for (const ref of references) {
      const url = new URL(ref.url);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`Invalid reference URL: ${ref.id}`);
      ref.youtube_id = referenceYoutubeId(url);
    }
    const songs = db.prepare('SELECT id, title, game, franchise, composer, reference_key, reference_bpm FROM songs ORDER BY title COLLATE NOCASE, id').all();
    if ([...songs.map(song => song.reference_bpm), ...links.map(take => take.played_bpm)].some(bpm => bpm !== null && !Number.isFinite(bpm))) {
      throw new Error('Tempo must be a finite positive number.');
    }
    return {
      version: 2,
      songs,
      sessions: db.prepare('SELECT id, label, date FROM sessions ORDER BY date DESC').all(),
      recordings: links,
      references,
      repertoire: db.prepare('SELECT song_id, note, position FROM repertoire ORDER BY position, song_id').all(),
    };
  } finally { db.close(); }
}

if (process.argv[1]?.endsWith('/catalog.mjs') || process.argv[1] === 'scripts/catalog.mjs') {
  const sql = readFileSync('data/catalog.sql', 'utf8');
  const csv = readFileSync('data/recordings.csv', 'utf8');
  mkdirSync('.catalog-build', { recursive: true });
  // A new in-memory database validates the complete reviewed source each run.
  const catalog = buildCatalog(sql, csv);
  const { rmSync } = await import('node:fs');
  rmSync('.catalog-build/catalog.sqlite', { force: true });
  buildCatalog(sql, csv, '.catalog-build/catalog.sqlite');
  writeFileSync('data/catalog.json', JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Catalog: ${catalog.songs.length} songs, ${catalog.recordings.length} archive associations, ${catalog.repertoire.length} repertoire entries.`);
}
