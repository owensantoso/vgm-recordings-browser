# Practice along: current slice and next model

Confirmed request, 6 October 2026: original/reference audio alongside our takes;
sections, looping, and deep links to each song, section and bar; eventual linked
chord-per-bar view and synchronized stem levels/mute/solo. React + TypeScript
remains the interface. No key, BPM, chord or form is inferred from source titles.

The later cross-product discussion and current Astra comparison are captured in
[Shared practice capabilities](SHARED_PRACTICE_CORE.md). This is a proposed next
stage. Its first data-contract package is now consumed by both apps; shared
playback and broader catalogue changes remain outside the first-slice scope.

## Implemented first slice

The initial 14 reviewed listening references have verified local M4A files in the ignored
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
default to Audio. Manually playing a take with video now opens Video; paused
deep links retain their audio-first behavior. Video explicitly switches provider
at the retained position and play intent. Player owns source duration, range and Repeat; draft
A/B fields are local to PracticeControls. Only Apply changes the active range.
The song Practice page holds the timeline, fractional A/B fields, sections and
notes; the persistent bottom player handles transport while browsing. Repeat
and Copy practice link have one locus in the practice toolbar. Unavailable
audio cannot enable repeat.

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

## Seek, copy and download feedback — October 7

Confirmed correction: a seek must retain already decoded instrument chunks;
only an uncached current group requires buffering. The next group remains a
bounded background prefetch. Cancellation still releases old reservations before
new allocations, and the three-group / 300 MiB limits remain in place. Loading
feedback occupies the existing mix label so score and instrument positions do
not change while seeking.

Copy practice link acknowledges success beside the clicked button with a
checkmark and “Copied!”, then returns to its normal label. Clipboard denial
shows “Copy failed” and retains the manual-link fallback. Instrument gain is
0–200%, with 100% as the original level at the slider midpoint; mute and solo
retain each track's gain. Boost is ordinary linear gain and can make a dense
mix clip; it is not automatic loudness normalization.

Download files is available beside Audio/Video in the persistent player.
It exposes the source's actual audio and video files, including private local
reference audio. A YouTube source link alone does not imply a downloadable
video file. Recording metadata retains its lower-page disclosure.

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

## October 7 source-owned section and stem pilot (historical)

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

## October 7 full-song practice increment

Owen accepted the initial stem playback, then rejected the compressed player
layout: following and practicing a song belongs in the main page. The default
song tab is now Practice, with Overview retaining song/reference/take details.
Opening a song with no active playback selects its original recording paused
(otherwise its first reference or latest take), so the workbench opens directly.
A direct URL with an explicit recording retains that source. Opening another
song while audio is playing shows Overview and preserves playback; selecting
Practice explicitly switches to that song's source paused. No download or stem
processing is triggered by opening a song. History traversal retains the live
source rather than restoring an old player selection.
One persistent Player owns the transport and portals its practice workspace
into the current source's main page. Waveform lanes, section/chord ranges and
playhead all use original recording seconds. The bottom dock remains available
while browsing. Source rows use original YouTube thumbnails with a fallback.
Each instrument has a label icon. Speaker icons show sound on or a red muted X;
Solo uses an accessible pressed headphone icon. Gain sliders have a 3px track,
12px thumb and larger hit area; wheel input over a gain changes it by 2% and
leaves ordinary page scrolling intact. Waveform hover previews position/time
without seeking. Space toggles playback and left/right seek five seconds even
with a button or gain focused; text entry and native media controls retain their
keys. Held Space is latched until release or window blur; seeks clamp at source
boundaries and disable Repeat only when leaving its selected range.

The full Beneath the Mask original was processed in a separate task-owned
Logic Pro 12.3.1 project using Separate All Stems. All six raw outputs have
12,254,508 stereo frames at 44.1 kHz/16-bit (277.88 seconds). Raw files total
294,108,192 bytes. Lossless FLAC full tracks total 60,875,976 bytes; the ten
shared frame groups per instrument total 61,314,149 bytes. Both retained copies
occupy 122,190,125 bytes in the ignored private asset directory. The task-owned
Logic project retains the raw outputs. Existing 30–120 section links remain
valid; no new Verse/Chorus boundaries have been invented.

Manifest version 2 declares full-source coverage, exact contiguous chunk frame
ranges, all six track IDs, file sizes/hashes and verified min/max waveform
peaks. Builds and the private API validate the source hash and asset dimensions.
The browser verifies each fetched chunk's hash and decoded dimensions. Audio
automatically uses the instrument mix when available, with all stems enabled;
Original mix is an explicit fallback for separation artifacts. Video remains
optional. Other songs continue to use their original audio.

`ChunkedStemPlaybackEngine` uses one Web Audio clock to schedule all six tracks
in shared groups of at most 30 seconds. Current, next and loop-start groups are
bounded to three, including pending decode reservations, under the existing
300 MiB decoded budget. Two 30-second groups use about 121 MiB and three about
182 MiB; these are audio buffer totals, not total browser process memory. A late
successor pauses the coherent group at the scheduled horizon, exposes buffering
and resumes only for unchanged play intent. Seeks abort obsolete preparation;
Pause and source changes cannot restart stale audio. Short loops inside one
chunk use native buffer looping; cross-chunk loops schedule exact frame ranges.
Audible seam quality remains a listening gate. Two-second raw recombination
checks at source 50, 180 and 265 seconds found zero-lag correlations of
0.999893, 0.999913 and 0.999911. This supports combined timing/mix consistency,
not the quality of any isolated instrument.

Re-encoding to a lossy codec can further reduce disk/network bytes but does not
reduce these decoded float buffers. A native Chrome 30-second stereo bass probe
used 822,910 bytes as FLAC and 601,382 bytes as 160 kbps MP3. Both decoded to
1,323,000 frames at 44.1 kHz. MP3 was evaluated, not installed as the playback
format; current assets remain lossless FLAC.

Private source-owned timed chords and notes now persist in SQLite. They use
stable UUIDs, exact source SHA-256, original start/end seconds and optimistic
revisions. `POST api/practice/annotations` and `PUT api/practice/annotations/<UUID>`
validate bounds, type, text and exact mutation origin. Chords appear in the
timeline; copied links target their exact source/range and open paused. Musical
content is entered by the user. This is a timed chord/notes view, not a fabricated
bar grid or staff score. Authentication, friend membership, author attribution,
sharing permissions and annotation alignment onto cover takes remain deferred.

## Pitch-preserving speed controls

Confirmed October 7: practice speed preserves the original pitch. The bottom
transport defaults to 1× and supports 0.5–2× audio playback. Scrolling over its
speed button adjusts by 0.1×; click toggles 1× and the last changed speed.
`[` and `]` adjust speed and `\` toggles. Text entry retains these keys. Speed
and remembered speed belong to the shared App transport and survive browsing
and source changes during this page session. Initial remembered speed is 1×.

Native audio uses `preservesPitch`. Synchronized stem sources change rate on
one source clock, followed by one shared SoundTouchJS output that compensates
pitch for the entire mix. Original-speed audio bypasses processing. Non-1×
processing uses a 200 ms preroll, accounted for in the visible source clock;
sections, loops, annotations and deep links remain in original source seconds.
Rate changes reset the render timeline without redownloading decoded chunks
or changing gains/mute/solo. Pause and newer seek/rate requests supersede older
pending starts. Reset, drain and teardown are acknowledged; processing queues
are bounded and processor failures pause with an explicit fallback.

Video uses YouTube's supported rates and shows its confirmed playback rate,
which may differ from the requested audio rate. Wheel/keyboard steps select a
supported video rate. The audio rate is retained when returning to Audio.
SoundTouchJS is a small bundled processor, not an offline separation model.
Audible artifacts at changed speeds remain a listening acceptance gate.

## Ideas: karaoke-style transposition (deferred)

Confirmed October 7: adjustable practice speed must preserve original pitch.
A later, lower-priority feature should independently transpose playback in whole
semitone steps, like a karaoke key changer. Apply the pitch change to pitched
stems and exclude percussion by default. Separation makes this possible without
shifting drum transients along with vocals/harmony. Mixed Other stems need
reviewed classification rather than an assumed pitched/percussive category.

This is an idea, not current implementation. Transposition must not overwrite
the catalog's original/reference key or a take's played key; it is a playback
choice. Sections, loops and deep links keep the original source clock. Future
chart/chord display transposition can reflect the playback choice after the
chart model exists. No pitch controls or automatic musical analysis are part
of the current speed increment.

## Evidence boundary

Automated tests can establish decoding, source ownership, paused links, loop
wraps, failures and browser layout. Audible seam quality, actual iPhone/keyboard
behavior and human design acceptance remain open. Bar identity, staff notation and automatic musical analysis remain unimplemented. Full-source stems, source sections and user-entered timed chords/notes are implemented; audible quality, human design acceptance and physical phone behavior remain open.

## Overnight stem batch — 7 October 2026

Confirmed: separate all existing downloaded references and newly sourced repertoire originals in Logic Pro. Prefer original soundtrack recordings; preserve useful existing covers. Owen authorized the T7 for temporary offload. Task-owned new projects and WAV inputs are under `/Volumes/T7/Codex-VGM-Stems-2026-10-07/`; playable compressed assets stay in the private repository media directory. The T7 is processing/provenance storage, not a required serving dependency after packaging.

The initial user's unsaved Logic project was preserved as `/Users/macintoso/Music/Logic/Untitled 1 - preserved 2026-10-07.logicx` before switching projects. No user tracks were edited or discarded. The first additional Bob-omb cover split uses a separate task-owned project under `work/overnight-stems/`.

Task-local `work/overnight-stems/download-new-references.py` preserves and atomically updates original-audio receipts. `prepare-song.py` validates exact source identity, input frames and all six generated Logic WAVs, produces full/30-second FLAC assets and waveforms, validates the complete candidate manifest with the normal reader, then publishes atomically. Each source has a resumable receipt in `work/overnight-stems/staging/<reference-id>/receipt.json`. Storage and incident preflights remain active. Numerical source/mix alignment is checked separately from human listening quality.

Open: manually authored section boundaries remain preferable to invented form labels; an easier section-marking interface is a later product improvement. This batch does not invent sections, chords, keys or tempo values. Completed: all 20 identified reference recordings have six full-source Logic stems, synchronized playback chunks and waveforms. This includes 19 new sets and the retained Beneath the Mask pilot. All runtime assets resolve to local repository storage; T7 is not a playback dependency. This initial batch retained two unidentified repertoire entries; both were identified and completed in the follow-up below. See [batch validation](VALIDATION-STEM-BATCH-2026-10-07.md) for exact coverage, bytes and evidence boundaries.

## Confirmed repertoire follow-up — 7 October 2026

Owen confirmed Splattack! and supplied `https://youtube.com/watch?v=SYTS2sJWcIs`, which identifies HeartGold & SoulSilver Champion & Red Battle. Existing provisional song IDs and repertoire order were retained. Both exact reference recordings are downloaded and processed with Logic Separate All Stems; the Pokémon upload is labeled as uploader EQ-enhanced.

Current total: 22 reference recordings, 132 full stems, 954 synchronized chunk files in 159 groups, 22 waveform files and 22 source M4As. All 1,130 runtime files total 2,287,251,442 bytes and resolve inside internal repository storage. Both new sets have exact full-source frame coverage, stable source hashes, and six instruments. `work/overnight-stems/batch-receipt-22.json` retains independent verification and authority hashes; the original 20-source receipt remains historical evidence.

Logic procedure correction: close Event List and verify List Editors is off before importing or splitting. Its competing selection can target an older region despite the visible new track selection. A fresh full AX observation must confirm exactly one selected audio region with the expected input basename before Apply. A batch-only wrong-region split was undone before correct processing; no published media changed during the correction. The preserved user project was restored stopped.

Storage briefly reached critical pressure; internal packaging waited until the guard returned warning and the per-source allocation plus 5 GiB reserve passed. A metadata-preserving T7 ZIP backup of the initial Bob-omb raw folder was created and its file contents verified, but no internal raw files were removed or relocated. The other planned offloads were not performed once storage recovered. Runtime serving remains independent of T7.
