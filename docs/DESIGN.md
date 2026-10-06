# React ledger review — 2026-09-08

## Intent and authority

Help session participants find a take, listen to a relevant section, and share
or download it while retaining session context. This is primarily an operating
surface, with the character of a rehearsal setlist.

The approved July 26 Setlist Ledger spec is the product-local design authority.
The current request authorizes React/TypeScript migration and UI review/redesign.
The Visual Design Director skill and Interface Toolbox README/accepted-example
index were read. The skill's linked preference-profile and component-reuse
resources were unavailable; no preferences were inferred from their contents.

Confirmed direction: continuous ruled list; restrained red and teal accents;
serif title with plain text and monospace times; a player beside the archive;
separate compact mobile playback. New composition choices remain proposals,
not newly accepted taste evidence.

## Source review and implementation decisions

| Finding | Classification | Response |
| --- | --- | --- |
| The shell and 55 KB imperative script intermingle rendering, filtering, and media lifetime. Filter renders recreate selected media. | Implementation defect | React owns rendered state; the player is keyed by file and stays mounted when filters retain it. |
| The old empty-result path returns before media teardown. | Implementation defect | Empty results unmount the player and dispose the backend. |
| Song, caption, file ID, game, and performers compete across many columns. | Unverified hierarchy hypothesis | Keep caption/title, game, performers, and time in ruled rows; show file details on demand. Hidden-field search matches expose a labeled snippet. |
| Archive title, kicker, and subhead repeat framing. | Unverified hierarchy hypothesis | Compact identity and count/export utility; no explanatory subhead. |
| Handwritten instrument pictograms need provenance work. | Implementation concern | Use explicit instrument and performer labels in the player. No new icon pack or pictograms. Existing files remain untouched. |
| Media backend switching and stale callbacks require explicit ownership. | Implementation defect risk | Scoped effect teardown and stale-callback guards; native HTML audio streams the same M4A instead of decoding the entire file in Web Audio. |

The main viewing sequence is search/filter → session band → song rows → selected
take/player. The overview owns session identity and counts. Selection-specific
performers, source links, timelines, and metadata live with the player. Source
metadata uses native details disclosure. Session jump controls preserve the
all-session browsing path; filters remain native selects.

## Component and state ownership

`App` owns loaded records, filters, sort, selected file, and batch downloads.
`Player` owns playback mode, expansion, time, readiness, and provider errors.
`recordings.ts` owns the typed source boundary and pure domain functions.
`Highlight` renders exact literal query occurrences as React nodes. Search is
per-field rather than inventing matches across adjacent field boundaries.
No HTML-string rendering, global imperative app state, router, or UI framework
was retained or introduced. YouTube alone receives an isolated provider-owned
DOM host inside React.

Desktop uses the shared ledger/player surface. Expanding hides the ledger and
widens the same player without remounting it. Mobile uses a bottom transport and
an expandable detail region; body space reserves access to the final row.
Browser focus and actual safe-area behavior still require device verification.

## Interface Toolbox decisions

The existing native controls fit this compact archive. Adopt mobile text-entry
sizing and normal zoom behavior from the accepted behavioral example; no visual
approval of that example is implied. Use custom product composition on native
controls. The machine-readable record distinguishes implemented-but-unverified
work from deferred full-contract work.

- Addressability retains session query and full filename stem hashes, including
  spaces and legacy exact names. Invalid sessions and malformed hashes recover.
- Search is local and literal, with exact visible highlights and labeled hidden
  metadata matches. Full structured match ranges and latency receipts are deferred.
- Semantic theme tokens begin with ink/paper/rule/muted/selection; remaining
  fixed state colors and locale string extraction are explicitly deferred.
- Buttons have focus, pressed, and settled states; media/copy/download failures
  have user-visible feedback. No control-feedback runtime certification is claimed.
- No multiple-appearance UI ships.

## Evidence and remaining acceptance

Local `npm run check` passes strict TypeScript, 10 domain/URL tests, one React DOM
lifecycle scenario, and production build. The DOM scenario verifies restoration
of the May session and Beneath the Mask section, video/audio time and play-state
transfer, reselecting a paused take, retaining a player through filtering, batch
selection, and teardown on zero results. These use fake providers.

`npm run test:browser` (part of `npm test`) drives the production bundle in a
real headless Chrome at 1280 and 375 CSS pixels via `playwright-core`, against
synthetic media generated at test time (`tests/browser/fixture.mjs`: sine-wave
WAV, ffmpeg test-pattern WebM, and a fake `YT.Player` backed by a real
`<video>`). It covers selection, filter retention and empty teardown, reload /
hash / back / forward, video-audio offset handoff, seek, section stop and
replay, natural end, failed audio and video with fallback, keyboard transport,
skip-link focus, and `prefers-reduced-motion`. It asserts exactly one media
element holds a source at any time and that callbacks from destroyed providers
cannot change the current player. Screenshots land in `.test-artifacts/browser/`.
The test skips (not fails) when no Chrome binary is found.

Synthetic providers do not prove real YouTube availability, iOS behaviour, or
human visual acceptance. Before merge, exercise the real app at 375, 768,
1024, and 1440 CSS pixels:

1. Inspect initial, filtered, selected, empty, loading-error, and expanded states;
   check long filenames, long game names, text enlargement, focus, and overflow.
2. On iOS portrait and landscape with keyboard visible, verify 16px search focus,
   pinch zoom, compact transport, expansion, safe area, and final-row reachability.
3. Play actual YouTube and local audio; switch while paused and playing, rapidly
   change takes/modes, seek section/full clip, and confirm section stop and replay.
4. Test source failures, copy fallback, batch download blocking, and individual
   fallback links. Check Space/arrows outside interactive controls and Escape.
5. Verify both session URLs, sort directions, audio-only filtering, browser
   history, and shared recording links on the actual GitHub Pages subpath.

These are review gates for this migration, not claims of human acceptance.

## October 6 songbook extension (private candidate, not accepted)

Purpose: move between a song, the band's chosen repertoire and its rehearsal
history without losing the current take. Confirmed: left navigation, at least a
song/repertoire list, linked IDs/database, current visual character acceptable.
Scope of personal versus shared repertoire is still awaiting clarification; no
membership is invented and this candidate is privately previewed only.

The relational model and source ownership live in [SONG_CATALOG.md](SONG_CATALOG.md).
`App` owns view/song URLs, archive controls, selected recording and return scroll.
`SongCatalog` owns its separate query and presents song-specific detail. `Player`
keeps its filename key and backend across navigation; a navigation key collapses
only expanded presentation so requested content remains visible. Song browsing
never selects or autoplays a take. Taking a recording action explicitly does.

Actual Claude Opus 5.5 (`claude-opus-5-5`, response metadata verified) independently
challenged the draft brief. Three alternatives were considered:

1. **Ledger + rail:** existing visual system; songs get a full main-area detail
   and recordings retain their ledger/player. Selected for the first candidate.
2. **Master/detail + bottom player:** keeps a song index beside detail, but changes
   the accepted desktop player position and needs stronger tablet composition.
3. **Song index in the rail:** directly jumps among song takes, but gives songs
   with no recordings a weak home and competes with session navigation.

The selected candidate adapts the existing tokens, Highlight concept, Player and
native links/inputs; no dialog/menu library or new icon pack is needed. A real
app preview is more faithful than a disconnected mockup for media continuity.
Desktop rail remains global, the main pane owns song title/game/credits/references
and joined takes, the player owns selected-take information. Phones have top
navigation above the archive controls and retain the bottom player. The original
migration is preserved as a separate baseline for review.

The Interface Toolbox adoption record validates. The range-consideration scanner
supports HTML/Swift only: index.html has zero lexical range matches; React's
existing range controls are outside its detection coverage. No consideration
completeness is claimed. The [continuity map](song-continuity.json) validates ten
mappings; this is declared coverage, not human acceptance.

Independent source review found two defects, corrected with tests/checks: an
expanded player could obscure Songs navigation; and CI did not reject a stale
committed catalog projection. Repertoire is an explicit SQL-backed selection;
no button pretends to edit shared data in a static browser. Original soundtrack
references, artist/composer credits and membership stay empty until evidenced.
Human design and iPhone acceptance are still pending.

Current agent evidence is recorded in [October 6 validation](VALIDATION-2026-10-06.md).
Real YouTube testing also found cued-seek autoplay; the combined candidate fixes
it. The unmodified migration baseline must not be merged alone on the strength
of its synthetic provider checks.
