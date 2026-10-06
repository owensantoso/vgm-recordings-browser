# Practice along: current slice and next model

Confirmed request, 6 October 2026: original/reference audio alongside our takes;
sections, looping, and deep links to each song, section and bar; eventual linked
chord-per-bar view and synchronized stem levels/mute/solo. React + TypeScript
remains the interface. No key, BPM, chord or form is inferred from source titles.

## Implemented first slice

All 14 reviewed listening references have verified local M4A files in the ignored
`reference-audio/` directory. They occupy 48,747,455 bytes. FFmpeg fully decoded
every download; the private manifest records source ID, YouTube ID, duration,
bytes and SHA-256. No cookies or account credentials were used for downloads.

Public `data/catalog.json` retains nullable audio fields. `npm run build:private`
validates the manifest against contained regular files, bytes and hashes, then
builds `private-dist` with the private catalog and asset symlinks. It stages the
result before replacing the previous generated build, so ordinary public builds
do not remove private audio. No downloaded originals are committed or published
on GitHub Pages. Missing receipt files stay unavailable; malformed or mismatched
receipt data fails the build. The private preview runtime serves `private-dist`.

The shell retains one active source while browsing/searching. Local references
and takes default to Audio; Video explicitly switches provider at the retained
position and play intent. Player owns source duration, range and Repeat; draft
A/B fields are local to PracticeControls. Only Apply changes the active range.
The quick Repeat control uses the selected excerpt; expanded player controls
allow fractional A/B seconds, resetting to the archive excerpt and copying a
practice link. Unavailable audio cannot enable repeat.

Links retain the existing song route and exact `play` identity, with
`t=start,end&repeat=1`. Copy practice link targets the playing song even while
browsing another song. Direct load prepares the target paused. Bounds must be
finite, nonnegative, ordered, at least 0.25 seconds and inside known duration;
practice parameters must belong to the exact active source. Invalid targets show
an error rather than silently playing another source. Selecting another source
clears the previous range/repeat; normal navigation, search and Back/Forward
preserve the current transport rather than restoring old playback snapshots.

Repeat currently uses native audio seeking and an end-event handler. It is a
practice convenience, not sample-accurate or gapless playback. Video does not
promise repeat timing. Full-recording seeking disables Repeat. Pausing stays
paused at a boundary; a stale source callback cannot restart a different source.

## Priority clarification: original-first practice

Confirmed by Owen: the primary job is practicing the original recording, selecting
Verse/Chorus/Pre-chorus, navigating there, looping it and sharing that target.
Named sections and their source-time ranges should first belong to the selected
original/reference version. Alignment onto rehearsal takes is a secondary later
ability, not a prerequisite for this original practice flow. Repeated choruses
need distinct stable occurrence IDs. Use musical labels only after reviewing
the actual source boundaries; no labels have been fabricated.

## Deferred chart model: bars and chords

Actual GPT-6 Astra reviewed VGM and the Song Practice Workbench source. Workbench
implements section/time targets and transport validation, but has no implemented
bar/chord chart. Its constant-offset alignment cannot represent rehearsal drift,
skipped bars or changed form. Adapt its contracts, not private song packs or its
route assumptions. Do not extract a shared package for this first slice.

| Object | Ownership and link identity |
| --- | --- |
| Song | Existing song ID, work identity and repertoire grouping |
| Practice version | Stable ID for one form/key/meter/chart |
| Section | Stable version-scoped occurrence ID; editable label/order |
| Bar | Stable version-scoped occurrence ID; display number is not identity |
| Playable source | Existing `ref:<reference-id>` or exact legacy take filename |
| Source alignment | Reviewed chart-to-source anchors, covered segments/gaps and source content revision |
| Stem set | One exact source hash, instrument assets and separation recipe |

Use rational quarter-note positions and actual bar lengths so pickups, meter
changes and repeated occurrences remain representable. Chords attach to a bar
ID and within-bar offset with provenance/review status. Start with a React chord
grid; ChordPro may inform interchange, while VexFlow or OpenSheetMusicDisplay
can wait until actual staff scores exist. alphaTab is a later score-plus-external
media candidate; it must follow the same transport, not start a second player.

Source seconds are mapped through reviewed ordered anchors; interpolate only
inside contiguous covered segments. Unknown mappings remain unavailable. Never
reuse original timestamps on a differently paced cover. Future links can add
`practice=<version-id>&section=<section-id>` or `bar=<bar-id>` after these IDs and
mappings exist. Conflicting semantic/time targets need explicit validation.
These chart contracts remain proposed. The October 7 source-owned section pilot below supersedes the need for a practice-version/chart before naming an original passage.

## October 7 source-owned section and stem pilot

Confirmed increment: name and return to parts of an original; audition one real
Logic-separated original before deciding on full-song or batch processing.
Sections use stable UUIDs, a source ID and exact source SHA-256, editable labels,
original start/end seconds and optimistic revisions. The private SQLite store
is `private-data/practice.sqlite`; it is not a browser-local approximation or
part of the public catalog. Source/hash drift and stale edits fail visibly.
`GET/POST api/practice` and `PUT api/practice/<UUID>` validate verified audio,
finite bounds and an exact mutation-origin allowlist. The durable private runtime
must mount `createPracticeHandler` from `scripts/practice-store.mjs` before its
static file handler. A static public host does not provide section editing.

Saved links use `play=ref:<reference-id>&section=<UUID>&repeat=1` and resolve
against private data, preparing paused. A UUID survives a rename or retiming;
manual A/B changes replace the semantic target with `t=start,end`. Conflicting
`section` and `t` parameters are invalid. These source-time sections do not claim
bar identity or alignment onto rehearsal takes. Labels and boundaries are user
reviewed; no Verse/Chorus labels have been guessed.

Logic Pro 12.3.1's actual GUI separated a task-owned 90-second WAV excerpt of
Beneath the Mask (Lyn), original seconds **30–120**, with Separate All Stems.
The six raw outputs are Vocals, Drums, Bass, Guitar, Piano and Other. Each is
stereo 44.1 kHz/16-bit PCM, exactly 3,969,000 frames (90 seconds), 15,907,140 bytes.
The six assets total **95,442,840 bytes** (91.0 MiB). Existing Logic processed the
pilot without downloading a new model or uploading audio. A separate project
preserved the user's open project. Input extraction used accurate output seek;
no normalized export, effects or project tail was added.

`reference-audio/stems/manifest.json` records the exact original hash, explicit
excerpt coverage, stem IDs/files/bytes/hashes/common frames and Logic provenance.
Private builds verify and symlink only those files. Public builds include no
stem metadata, sources, database or generated audio. Browser loading verifies
bytes/hash and decoded frame count/rate/channels; failure leaves original Audio
available. The pilot uses one Web Audio context and a shared scheduled start,
with per-instrument gain ramps, mute and multiple solo selection. Instrument
changes do not recreate sources. Native buffer loops share the same clock.
Every displayed/linked position remains on the full original clock; only the
engine subtracts the excerpt's 30-second offset.

Stems have an explicit coverage boundary. Entering the pilot prepares playback
paused, retaining a compatible range or visibly preparing the 30–120 excerpt.
A named section crossing that boundary is not clamped. Original Audio remains
the full-song practice path. Active section timing edits pause and reprepare;
renaming preserves playback. The six decoded buffers occupy about 190.5 MB;
loading is bounded to six tracks and a 300 MiB decoded budget. Full-song and
phone-memory suitability require this pilot's result before expansion.

Numerical alignment of recombined stems over source seconds 50–55 found zero
sample lag and 0.999908 correlation to the extracted input. This establishes
timing/recombination evidence only; instrument bleed/artifacts and usefulness
still require listening. MVSEP and local models remain researched alternatives,
with no account, upload, model download or batch job performed.

Primary references: [Logic Stem Splitter](https://support.apple.com/guide/logicpro/extract-vocal-instrumental-stems-stem-lgcp61bae908/mac),
[MVSEP plans](https://www.mvsep.com/en/plans), [MVSEP API](https://www.mvsep.com/en/full_api),
[MVSEP retention](https://www.mvsep.com/en/privacy-policy),
[Demucs caveats](https://github.com/facebookresearch/demucs),
[Web Audio scheduling](https://www.w3.org/TR/2021/REC-webaudio-20210617/#AudioBufferSourceNode).

## Evidence boundary

Automated tests can establish decoding, source ownership, paused links, loop
wraps, failures and browser layout. Audible seam quality, actual iPhone/keyboard
behavior and human design acceptance remain open. Bars, chords and guessed musical analysis remain unimplemented. Named source sections and the explicitly bounded real stem pilot are the October 7 increment; audible quality and physical phone acceptance remain open.
