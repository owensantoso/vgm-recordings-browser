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

The supervised preview started, but the cloud browser could not reach its
approved address (`ERR_BLOCKED_BY_CLIENT`). No rendered screenshots or actual
media playback were obtained. The design has been reviewed from source only;
rendered acceptance is outstanding. Do not label the UI visually verified.

Before merge, exercise the real app at 375, 768, 1024, and 1440 CSS pixels:

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
