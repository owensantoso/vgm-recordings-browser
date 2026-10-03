# VGM Recordings Browser

React + TypeScript browser for the 2026 music jam archive. The original 22
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

- `src/App.tsx`: archive loading, filtering, sorting, selection, URL restoration,
  downloads, and the responsive ledger.
- `src/Player.tsx`: selected-take controls and disposable YouTube/audio backends.
- `src/recordings.ts`: typed CSV boundary, search/sort, section bounds, and URLs.
- `src/styles.css`: ledger styling and separate desktop/mobile composition.
- `docs/DESIGN.md`: design review, intent, decisions, and outstanding acceptance.
- `interface-foundations.json`: scoped Interface Toolbox adoption decisions.

## Static hosting

`npm run build` writes `dist/` and refreshes the checked-in `assets/app.js` and
`assets/app.css`. Commit those generated files with source changes. This keeps
existing root/branch-based GitHub Pages serving working without changing its
settings. CI rebuilds and rejects stale bundles. A host with a build step may
instead serve `dist/`.

All asset URLs are relative, so repository subpaths continue to work. The
`?session=...#recording-stem` URL contract remains supported. Search and sort are
transient controls; they are not encoded in shared URLs.

A text-only checkout can build with a warning about missing media; it cannot
prove playback. The full-checkout CI additionally verifies every referenced
thumbnail/audio file. `npm run dev` builds assets once and watches TS/CSS;
restart it after changing the HTML or CSV.

## Validation limits

DOM lifecycle tests use fake media backends. They verify teardown, offset and
play-state transfer, filtering, selection, and deep links. The browser suite uses
generated WAV/WebM and a fake YouTube API to exercise media decoding, controls,
scrolling, responsive resizing, heading sorting, keyboard handling, and the
player lifecycle. Neither suite proves real YouTube availability, native IME
input, iOS behavior, production autoplay policy, or visual acceptance. See the
remaining browser/device checks in `docs/DESIGN.md` before merging the migration.
