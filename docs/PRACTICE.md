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

## Proposed next increment: one reviewed original chart

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
These are proposed contracts, not currently accepted persisted schema or routes.

## Stems and storage decision

First audition a 60–90-second Logic Pro six-stem result using the existing app.
No documented public separation API was found; GUI/export suitability remains
untested. MVSEP registered free is the strongest hosted comparison without local
weights: current published limits are 50 jobs/day, one concurrent, <=10 minutes
and 100 MB per input. All 14 downloaded inputs meet those input limits; account,
model access, queue and quality need a pilot. No audio has been uploaded and no
models or separated outputs have been installed/generated.

Six four-minute stereo 44.1 kHz/16-bit WAV stems are roughly 254 MB per song,
3.56 GB for fourteen songs; storage is more consequential than modest model
weights. A 90-second pilot is roughly 95 MB. Preserve common time zero, duration,
sample rate/frame count and source hash, with separation provenance. Later stem
playback should use one Web Audio clock with per-stem gain, not independently
started HTML audio elements. Decode memory and physical phone behavior need a
pilot before full-track multitrack playback.

Primary references: [Logic Stem Splitter](https://support.apple.com/guide/logicpro/extract-vocal-instrumental-stems-stem-lgcp61bae908/mac),
[MVSEP plans](https://www.mvsep.com/en/plans), [MVSEP API](https://www.mvsep.com/en/full_api),
[MVSEP retention](https://www.mvsep.com/en/privacy-policy),
[Demucs caveats](https://github.com/facebookresearch/demucs),
[Web Audio scheduling](https://www.w3.org/TR/2021/REC-webaudio-20210617/#AudioBufferSourceNode).

## Evidence boundary

Automated tests can establish decoding, source ownership, paused links, loop
wraps, failures and browser layout. Audible seam quality, actual iPhone/keyboard
behavior and human design acceptance remain open. No named sections, bars,
chords, stems or guessed musical analysis are shipped in this slice.
