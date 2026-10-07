# Cohesive music workspace — active redesign, October 6

Purpose: browse songs, chosen repertoire and rehearsal history while one
transport keeps playing. The user rejected the first songbook's cohesion and
authorized a full redesign. The following direction supersedes the historical
ledger-first composition below; the shown candidate was visually accepted on October 7; audible/device acceptance is separate.

## Feedback and correction

Confirmed: meaningful icons; one global search locus; fixed player coordinates
across destinations; no session/media dropdowns; Sessions as a distinct
navigation destination; nullable song reference key/BPM and take played key/BPM.
A universal bottom player is a proposed mechanism, not a firm user requirement.
Repertoire membership and shared/private scope remain unchosen.

Reflection: I extended an archive-owned composition with an independently
searched song page. Source: agent assumption. That preserved conflicting
search/toolbar geometry and list-derived playback. Correct this project's shell
and identity ownership; do not generalize it into a universal layout rule.

## Domain and reuse

Song is musical identity. A soundtrack/reference source and our rehearsal take
retain independent media identity, timings, provenance and credits. Adapt the
private Workbench's Song/Recording/Arrangement separation and one transport
contract; its current song selection stops media, so its routing is not copied.
No private catalog/media import is in scope. Songs and takes keep their IDs.
Song reference key/BPM and per-take played key/BPM are nullable and independent;
unknown never means inherited, measured or guessed. No analysis or edit backend.

Reuse the tested YouTube/local-audio provider and literal highlighting. Use
Lucide named React icons. Native pressed buttons suit simple filter choices;
Radix ToggleGroup was reviewed, but a roving toolbar adds little to these short
independent controls. Custom work addresses the missing shared shell/global
results and library relationships, not another media engine. No new menus.

## Structural experiment

Actual Opus 5.5 identified list-derived playback, page-owned player geometry and
view-owned search as the root couplings. It recommends a fixed right Now Playing
rail at wide widths because video needs a visible media region, then a compact
dock at smaller widths. Compare this against a global bottom dock for audio-first
use. Both use identical components/content and one active transport. Retain the
prior candidate as the rejected structural control, not a rejected palette.

App owns loaded library data, route/return scroll, the global query and active
playable identity. Library/Search/Sessions render those inputs. Player owns the
provider and clock, keyed by playable ID, at the shell root. Browsing, filters
and zero search results cannot change or dispose it. Only an explicit new media
selection can. A rendering adapter may reuse the provider without persisting
fake rehearsal takes. Time remains local, not a whole-app clock rerender.

Navigation: Songs, Repertoire, Takes and Sessions are peer destinations. Sessions
index/detail routes replace dropdowns and duplicated jump controls. Search is
always in the same shell region, with grouped Song/Take/Session results, literal
highlights and compact matching context. Escape/clear returns to browsing;
entity/result activation never changes playback. Media filters are buttons.
Retain legacy session/hash links as compatibility, not as visible dropdowns.

Content priority: song title/game; sourced originals or clearly labeled reference
versions; our takes; known musical values and optional source detail. Omit large
empty composer/reference placeholders. Repertoire remains explicit, including
zero-take songs. References are sourced; uploader is not automatically artist.

Fixed shell tokens define navigation, search and playing regions independently
of headings/filter rows. The media element is never reparented across routes or
breakpoints. Originals with private/local audio default to Audio; manual take
Play opens Video when present, while paused links retain the Audio default. Showing video
opens a stable visible player region; collapsing switches a take to audio or
pauses a YouTube-only reference. This preserves the provider's visible-player
requirement without pretending a collapsed YouTube frame is audio playback.

Practice controls and source-bound range ownership are documented in [PRACTICE.md](PRACTICE.md). The persistent player owns Apply/Repeat; browsing owns no playback clock.

## Original-first practice pilot — October 7

Operate surface: open the original, choose a named part, repeat it and adjust
instrument balance while the library remains browsable. Owen authorized the
first real stem/section pilot after seeing the current candidate. Preserve the
accepted shell and tokens; compare against the actual current app, not a new
mockup. Named sections initially belong to a source/hash in original seconds;
no bar chart, key, tempo, form or section labels are guessed.

Adapt PracticeControls' draft/apply pattern, native labeled inputs and pressed
buttons. SourceSections owns editing drafts, while Player owns the selected
section/range and sole transport. Persist stable section IDs in the private
SQLite store; public hosting stays read-only. Source metadata fetch does not
start audio. Saved time edits pause/reprepare; rename preserves transport.

StemMixer uses labeled instrument rows with native gain sliders and independent
Mute/Solo buttons. One Web Audio clock schedules every stem; gain changes do not
restart tracks. The Logic pilot covers original seconds 30–120 only, visibly
labeled; any section outside that coverage stays playable as original audio and
cannot be silently truncated for stems. Mixer/section tools live in expanded
player details, leaving the persistent browse shell and compact dock stable.
On phone, fields use at least 16px and tools scroll inside the details panel.

Actual Astra challenged partial coverage, section-vs-time URL conflicts, stale
editing and independent clocks. `section=<UUID>` and `t=A,B` are mutually exclusive;
manual A/B clears the semantic section. Browse/history preserve the current
source and target; source replacement clears both. Deep links resolve from the
same private database and open paused. Missing/stale API data stays visible and
must not invent or activate another section. The proof is a real six-stem pilot,
section save/reload/share and gain/mute/solo with loop/pause/navigation checks.

## Full-page practice correction — October 7

Confirmed feedback: playback works, but cramming sections and six instrument
controls into a sidebar misses the intended practice workspace. Source: agent
assumption that an expanded listening player could own the practice composition.
The prior visual acceptance applies to browsing, not this rejected practice
structure. This revision supersedes the pilot's expanded-sidebar tools.

Purpose Operate: follow and return to a passage while practising an instrument.
A song has Practice (default) and Overview; the main practice page uses the
available width for a common seconds ruler, named section/chord strip, moving
playhead and six aligned waveform lanes. Left controls label instrument, volume,
Mute and Solo. Actual peaks come from the exact rendered stems; decorative
waveforms and inferred tempo/bar/chord labels are prohibited. An unknown score
stays unknown. Timed editable chords/notes are source/hash-bound content, not
transcription claims. The private workspace can persist these now; shared
accounts, authorship, replies, visibility and friend access remain future work.

One mounted Player remains the controller. A React portal moves only its
practice presentation into the matching song's main host. The compact bottom
dock renders transport while browsing and has a return-to-practice action.
There is no second source/clock on route changes. Opening another song cannot
replace an already playing source. Opening practice without an active source
may prepare its original paused; an explicit source choice replaces playback.

Audio chooses verified full-source stems mixed together when available. Stems
are instrument controls within Audio, not a separate media version or button.
The actual original remains an explicit fallback/comparison, because separation
may introduce artifacts even with all gains at unity. Optional Video is a
visual source/provider toggle; it must not start a second audible source or
hide a YouTube provider that requires visible controls.

Full-song stems use contiguous verified 30-second lossless FLAC pieces and one Web Audio
clock. Decode current/next needed groups with a bounded transient third;
retain the 300 MiB cap. If a needed group is late, all instruments pause at the
same committed horizon, show buffering and resume only unchanged Play intent.
Waveform peak data is precomputed and small, so opening the practice page does
not decode the full song. Source/hash, chunks, annotations and sections share
one original-seconds clock; future bar maps can be attached after review.

Adopt native form controls, current paper/ink/line tokens and existing section
editing. Adapt the existing single-source Player via a presentation portal.
WaveSurfer's waveform/region examples and Songsterr's track/loop/score workflow
were inspected as working references. A custom SVG peak view reuses our clock
and avoids introducing a second player/controller for six annotated lanes.
Accepted Interface Toolbox reuse covers mobile text sizing; TSX range detection
remains unsupported. The initial decision declined wheel-based gain changes to
protect vertical browsing. Owen subsequently explicitly requested scrolling
and slimmer sliders: that decision is superseded by wheel adjustments scoped
to the hovered gain control, while ordinary page/timeline scrolling remains
native. Each stem has an instrument icon, a current-state speaker icon (sound
on versus red muted X), and a slim range track with a larger pointer/touch target.
Timeline hover previews a ghost position/time without altering the playhead.
Space and left/right arrows control transport after button or gain focus;
editable text and native video controls retain their own keys. Per-instrument
keyboard shortcuts remain undecided and are not assigned speculatively.

Small-screen lanes stack controls above their waveform rather than compressing
a desktop table. Editors stay below the shared timeline; one control locus per
section/annotation. No full-page introductory hero, six separate cards or
placeholder chord bars. Song artwork uses the reviewed original's YouTube
thumbnail, falling back to an icon only on missing/failed artwork.

Review: prepare a song paused → play → seek a waveform → loop across a chunk
boundary → mute/solo while navigating away/back; exact source and one clock
survive. Create a timed chord/note and reopen its range link paused. Compare
full stem playback with Original mix, including end of song. Test spacebar pause
from navigation/buttons, including starting paused playback and seeking, while
protecting text entry and native video keys. Exercise
375/768/1440 widths, late decode, failed metadata, changed source and empty score.
Rendered design and full-song sound need Owen's judgment; no old acceptance is
carried onto this new composition.

## Speed and library context increment — October 7

Confirmed: default speed is 1×, wheel steps are 0.1× for audio, and clicking the
speed control toggles 1× with the last chosen non-default rate. Original pitch
must remain unchanged. The control belongs beside the persistent transport and
survives browsing/source changes; editable text/native video keys remain owned
by those controls. Brackets adjust speed and backslash toggles normal/last rate.
YouTube supports provider-defined rates; its control displays confirmed speed
and wheels through actual supported values. Speed never changes source-time
section/loop identity. A later independent semitone transposition idea, excluding
percussion, is recorded in PRACTICE.md and remains deferred.

Adopt native media playbackRate/preservesPitch for original audio, and one small
SoundTouch processor after the synchronized stem mix. Its transport adapter owns
reset/stop/drain and bounded processing buffers; source schedulers account for
rate and audible latency. No new model or re-encoded speed variants are needed.

The supplied wide song-list screenshot demonstrates distant row actions rather
than missing content. Constrain Songs/Repertoire/search song lists to a readable
width, retaining the full Practice workspace for timelines. Our-take footage
thumbnails become Play controls; takes with video open Video on a manual Play,
while reference originals retain the Audio practice default. Deep links prepare
paused and retain existing audio/loop targets. Show distinct small original-song
art beside take identity, linked to the song page. Sticky session bands include
source-backed name/location as well as date/count. Do not invent context or add
filler panels to consume width.

## Transport feedback correction — October 7

User feedback identifies two execution defects: seeking discarded the decoded
cache, and a conditional buffering paragraph moved the score below it. Preserve
cached audio and show genuine loading in the fixed-width mix label, with the
same toolbar geometry at desktop and phone widths. Copy success belongs beside
the button that caused it, with a stable button width. Gain extends to 200%,
100% at a marked midpoint. Downloads belong in the persistent transport rather
than buried inside recording metadata; a native disclosure exposes only
available source files. Engine and browser regressions exercise cache reuse,
actual delayed loading, stable score bounds, copy success/denial, boosted gain,
and download availability while browsing.

## Review scenarios and acceptance

Play a take → search → another song → session → Back: same provider node,
continuing time, stable player bounds. Hide the active take via audio-only or
zero-result search: playback continues. Source kinds distinguish Original from
Our take. Unknown key/tempo remain unknown; a differing played key does not
rewrite the song reference. No selects, one searchbox, visible active filters.
Exercise original source errors, section/full bounds, zero-take songs, empty
repertoire, 375/768/1024/1440 widths, final-row access and reduced motion.
The main region owns scroll. Video reserves a right region on wide dock/tablet
layouts and a top region on taller compact screens; short layouts preserve a
side video region and shorten navigation/transport. The same provider node
survives these CSS changes. Closing a not-yet-ready reference clears its play
intent before readiness. Physical keyboard/safe-area behavior and human design
judgment remain open.

---

# Historical composition and evidence

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

## Song-entry correction — 7 October 2026

Owen rejected the default Bob-omb page's "Prepare original" gate. It merely
selected a recording paused, but sounded like unfinished download/separation
work and hid the actual practice workspace behind an empty introduction. Cause:
agent assumption that avoiding autoplay required a separate setup action.

Operate intent: opening a song should expose its timeline and instruments ready
to play. App owns source selection and route intent; Player retains one playback
clock and reports activity; SongPage hosts the existing workspace. Reuse the
actual practice components and tokens, with no new prototype or visual skin.
Paused navigation selects the song's original; active playback keeps running
while the other song's Overview is browsed. Explicit Practice switches paused.
Explicit source links and normal history traversal retain their source ownership.
Unavailable-source recovery says "Open original/reference/latest take" rather
than "Prepare". No model processing happens when opening a song.

Regression evidence: desktop/phone cold entry displays six original stem lanes
paused, reload stays paused, active playback survives song browsing, explicit
Practice switches sources paused, and range/link ownership survives browsing.
Rendered acceptance surface is the deployed private Bob-omb song URL without a
play token; physical-phone and human usability judgment remain separate.

## Timeline participation — confirmed 8 October 2026

Primary job: follow a recording while hearing and discussing its passages. The
header must reclaim real viewport height; transform-only shrinking was an agent
assumption and is superseded. Gain intensity is monotonic from0–200% using the
same dark ink. Identity, controls, transport and keyboard focus remain mounted.

One Jams row shows only exact-source, hash-matched aligned takes, with overlapping
clips stacked. Normal click seeks the original clock; Open jam explicitly opens
the saved mix. Comment mode selects a point or range directly on Song, instrument
or jam lanes. The adjacent composer names the recording, clock and instrument.
Keyboard/touch alternatives use playhead, A–B and editable times. On phone the
composer attaches above the transport. Wheel gestures remain volume/speed adjustment;
timeline range selection uses deliberate drag so ordinary page scrolling is
preserved. General song/recording comments and the legacy list remain available.

Reference tempo estimates require beat verification. Playback speed is separate
from reference BPM, and one BPM value does not establish a downbeat/bar map.
See TIMELINE_DESIGN_REVIEW.md and TEMPO_RESEARCH.md for reviewed rationale.
