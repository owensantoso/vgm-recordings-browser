# VGM Recordings Browser

React + TypeScript music workspace: songs, listening references, explicit
repertoire and the 2026 rehearsal archive. The original 22
recordings, CSV schema, thumbnails, audio paths, Drive links, and YouTube IDs
remain the source of truth.

## Develop

Node 24 is used in CI. Run `npm ci`, then `npm run dev`.
`npm run check` checks strict TypeScript, data/URL regression tests, React player
lifecycle tests, real-browser synthetic-media tests, and the production build.
The browser suite needs Chrome/Chromium (or a compatible Edge executable) and
FFmpeg. Set `CHROME_PATH` to the browser executable when it is not discovered
automatically, especially on Windows. Without a discovered browser the suite
skips; check the test totals before treating a run as browser validation.
On macOS with Chrome installed as an app, run
`CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run check`.
The app binary is not normally a shell command on PATH.

- `src/App.tsx`: shared shell, global search, browsing history/scroll, independently
  loaded catalog/archive and active playable identity.
- `src/Library.tsx`: Songs, Repertoire, Takes, Sessions and global search results.
- `src/musicLibrary.ts`: literal cross-library search and reference provider adapters.
- `src/Player.tsx`: one persistent transport for original/reference sources and
  our takes, with disposable YouTube/audio and synchronized stem backends.
- `src/practice.ts` and `src/PracticeControls.tsx`: source-bound A/B ranges, Repeat and paused-on-open practice links.
- `src/PracticeWorkspace.tsx` and `src/WaveformLane.tsx`: main-page timeline, real stem envelopes, source sections and timed chords/notes.
- `src/ChunkedStemPlaybackEngine.ts`: synchronized frame groups, bounded audio buffers, loops and asynchronous preparation.
- `src/recordings.ts`: typed CSV boundary, search/sort, section bounds, and URLs.
- `src/styles.css`: fixed shell, rail/dock comparison and reserved media regions.
- `src/Catalog.tsx`: catalog types and stable song/session/search routes.
- `data/catalog.sql`: reviewed identity, reference and repertoire source.
- `scripts/catalog.mjs`: SQLite materialization, foreign-key/archive checks and
  public JSON projection; see [catalog ownership](docs/SONG_CATALOG.md).
- `docs/DESIGN.md`: design review, intent, decisions, and outstanding acceptance.
- `interface-foundations.json`: scoped Interface Toolbox adoption decisions.

## Static hosting

`npm run build` validates/materializes the song catalog, writes `dist/` and refreshes the checked-in `assets/app.js` and
`assets/app.css`. Commit those generated files with source changes. This keeps
existing root/branch-based GitHub Pages serving working without changing its
settings. CI rebuilds and rejects stale bundles and catalog JSON. A host with a build step may
instead serve `dist/`.

All asset URLs are relative, so repository subpaths continue to work. The
`?session=...#recording-stem` URL contract remains supported. Global search is addressable with `?view=search&q=...`. The `play` parameter
identifies an independent take filename or `ref:reference-id`; normal browser
history restores browsing without replacing the currently playing source.
Reload cues that source without autoplay. Sorting/media choices are local to
the take page. `?layout=dock` retains the comparison route. The default is a persistent bottom
transport; each song opens its main-page Practice tab, with Overview available.

A text-only checkout can build with a warning about missing media; it cannot
prove playback. The full-checkout CI additionally verifies every referenced
thumbnail/audio file. `npm run dev` builds assets once and watches TS/CSS;
restart it after changing the HTML or CSV.

## Validation limits

DOM lifecycle tests use fake media backends. They verify teardown, offset and
play-state transfer, independent navigation, selection, and deep links. The browser suite uses
generated WAV/FLAC/WebM and a fake YouTube API to exercise media decoding, controls,
scrolling, responsive resizing, heading sorting, keyboard handling, and the
player lifecycle. Neither suite proves real YouTube availability, native IME
input, iOS behavior, production autoplay policy, or visual acceptance. See the
remaining browser/device checks in `docs/DESIGN.md` before merging the combined candidate.

Reference/played key and BPM are independent nullable catalog fields, with no
automatic analysis or metadata editor. All actual musical values remain unknown.
Listening links have bounded provenance in `docs/REFERENCE_SOURCES.md`.

## Private reference audio and practice

`npm run build:private` validates ignored `reference-audio/manifest.json` and
its local files, then stages `private-dist/` with audio symlinks and a private
catalog overlay. Normal builds retain null reference audio fields and do not
include originals. See [practice ownership and next model](docs/PRACTICE.md).

Open a song's Practice tab to follow real waveforms, seek, Apply an A/B range,
Repeat and copy a paused deep link. Named source sections and timed chords/notes
persist in private SQLite. Beneath the Mask has full-song Logic-separated stems,
losslessly encoded as FLAC and loaded in short synchronized chunks within a
300 MiB audio-buffer budget. Audio selects the instrument mix automatically;
use the speaker/headphone icons for mute/solo, or Original mix to compare.
Space toggles playback and arrows seek five seconds across button focus, while preserving text entry. Bars, staff notation,
automatic musical analysis and friend accounts remain deferred. The private
runtime must mount `createPracticeHandler` from `scripts/practice-store.mjs`;
static hosting alone cannot edit sections or notes. Downloaded originals,
stems, receipts and the practice database are ignored and excluded from public
builds.
