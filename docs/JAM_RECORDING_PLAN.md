# Practice jams and linked annotations — active work

## User request (verbatim, 7 October 2026)

small thing thats easy rn, id like you to add showing the vid thumbnail or whatever on each of the practice pages too please like next to the title or whatever. and then have it sticky and maybe morph a bit smaller as you scroll down

as well, making a track brighter or dimmer when its louder or softer would be good. rn when we mute it dims but itd be nice to have it like also if i make it 50% or 20% then it also gets dimmer you know what i mean? same with making it above 100% like 150 or 200% then its brighter or whatever.

im thinking as well. one really sick think could do for example, is to play along with the original/stem separated/whatever, and record your jam over it? so for example if i wanted to practice piano jamming, i can turn off the piano or turn it down or whatever, itd save my playback settings, and then start recording when i want to (or with a count in or smth though that might require the bpm lol, maybe better is just playing like a few seconds before then visually indicating when it starts recording? or just a tick and visual 3 2 1 count in? maybe make it a setting or smth?)

then when it starts recording you start playing along and itd record it. could add support to plug in midi or smth eventually but if its hard not now just mic.

then yeah the idea is that recording would be linked to that specific part, and other ppl could then when listening to the song, see your jam over that recording. and you can add comment/note or smth too like "was playing around with xyz..." or something? the concept of a general 'annotation' or comment or smth that can be linked to a specific timestamp or even instrument potentially could be good? or could also just be like song-wide too but then you could like link to specific point like "i like the fill at 0:24" or something. if the comments can be on either the original song as well as any recordings and such thatd be sick too. does that make sense? recording being either, a group recording, or also like if someone's doing a recording linked to an original? an individual's recording could then maybe either be just generally under a song as a whole if youre just jamming in general, or you can have it time-linked to the actual original if youre playing along with it. or could also be linked to specific sections but not necessarily linked in time... does that make sense?

maybe is better generally but dont know how the concept of a recording or smth combines with that..

this would have to mean we add users and auth and stuff eventually i think but maybe for first version just testing the functionality would be good.

i said a lot of stuff so please discuss with astra in terms of the ontology or domain shit and data model and how it should all link together, and when you come up with something then get another fresh reviewer, hand it my original prompt as well as your interpretation and the proposed models and get it to adversarially review it to see if its missing things or whatnot.

in any case this is a big big feature update so if you could make sure to like save where we up to and then when working on things make sure to commit frequently, use prs and whatnot to review and such, get opus 5.5 to weigh in or lead the design component too, and id like you to act as the overall orchestrator of this seeing it through to the end.

## Interpretation and current delivery stage

Additional user clarification (verbatim): "also for the overdub, it should save
the settings that you recorded over, and default to that maybe when ppl play it,
but the idea then is also you could set what instrument youre playing as, which
could either be one that already exists in the stem separation, or just a custom
one or smth. does that make sense?"

Confirmed: retain a capture-time backing mix snapshot and default overdub replay
to that mix; instrument association can reference an existing source stem or a
custom label. It does not itself replace or mute that backing instrument.

Personal usable proof: record microphone audio while playing a chosen reference
with a saved backing mix, retain the jam privately, replay it against its backing
source, and add linked notes. Accounts, identity verification, permissions for
public sharing and MIDI input are deferred. A local displayed author identity
must not imply authenticated ownership. No invented tempo or musical sections.

Distinct requested associations: recording belongs to a song; optionally relates
to sections semantically; optionally aligns in source time to another exact
recording; comments can target songs, any recording, time/ranges, and optionally
instruments. Alignment and section relevance must not be conflated.

Immediate visual changes: existing practice page artwork beside title; sticky
header contracts gently as the main pane scrolls with reduced-motion support;
waveform brightness follows effective audible gain from 0–200%, keeping labels
and controls legible and accounting for mute/solo.

The Astra proposal and independent adversarial review are complete. The accepted
implementation contract below governs their differences; neither consultation is
an implementation or human acceptance receipt. First human gate is a real mic jam
at 0.75×, saved/reloaded/replayed, including acoustic latency and longer-take drift.
Browser simulation alone will not establish that gate.

## Accepted implementation contract — 7 October 2026

- Reuse the private runtime and catalogue authorities; add bounded private jam
  persistence and linked comments. Do not migrate existing reference/archive
  recordings or expand the unrelated shared-core extraction.
- Native MediaRecorder captures microphone input after explicit permission and
  an honest three-second countdown. No capture during the countdown, automatic
  permission request, live mic monitoring, or fabricated musical count-in.
- Overdubs freeze the exact backing source/hash, original/stems mode, stem
  revision and gains/mute/solo, range and fixed 0.5–2× speed. Instrument selection
  can reference a source stem or a custom label without changing that mix.
- Keep raw finalized mic audio and its measured duration independently from the
  valid aligned mic/source interval. Alignment uses estimated audible media time
  with provenance and manual ±2 real-second Earlier/Later correction; no sample
  accuracy claim. A positive correction moves mic earlier by correction × rate
  on the source clock. Never subtract the engine's output delay twice.
- One pass, maximum 120 seconds / 32 MiB. Freeze transport/mix changes during
  recording; Space/Pause stops. A stall, clock jump, hidden page or ended track
  stops/finalizes raw audio rather than claiming alignment across a gap. Release
  mic tracks on Stop/Cancel/error. Preserve natural codec/finalization tails.
- Persist finalized drafts locally, with honest quota/error state and Download;
  encoded unfinished fragments are preserved bytes, not guaranteed playable
  recovery. Server saves are idempotent by capture ID, validate encoded audio
  using existing local tooling, and retain drafts until durable save is confirmed.
- Replay defaults to captured backing settings/rate, mic naturally at 1× and
  independent mic gain. Alternate mix audition does not mutate the snapshot.
  Missing backing revisions retain the association and permit mic-only playback
  with a reason; never silently substitute a source or all-on mix.
- Free jams belong to a song without alignment. Explicit existing-section
  associations are independent of alignment. Comments target song or exact
  reference/archive/jam recording with an optional point/range and instrument;
  clocks are named and deep links prepare paused. Existing authored chords and
  practice notes keep their own owner. Local displayed authors are unverified.
- Accounts, public sharing, MIDI, variable-rate takes, multi-pass loops, trimming,
  automatic latency calibration and guaranteed unfinished crash recovery are
  deferred. Shared-context PCM becomes justified only if measured timing/drift
  prevents useful replay after manual correction.

References: JAM_DOMAIN_PROPOSAL.md, JAM_MODEL_REVIEW.md (including Opus addendum),
and JAM_DESIGN_PROPOSAL.md. The first usable capture test precedes polishing, but
free jams, section associations and range/instrument/archive comments remain in
the full requested feature scope.

## Checkpoint before this feature

- Worktree: `/Users/macintoso/Documents/Codex/2026-10-06/where-is-my-video-game-music/work/vgm-repertoire`, branch `feat/song-repertoire`.
- Private preview: `https://macnos.tailafa155.ts.net/vgm-preview/`.
- All 22 reference sources downloaded and separated: 132 full stems; current
  repertoire includes Splattack! and exact selected Champion & Red Battle upload.
- Full song-entry `npm run check` passed: 74 browser checks, 97 domain/store checks,
  one UI lifecycle check, four shared-core checks, typecheck and public build.
- Bob-omb cold entry/phone and background browsing checks passed on Tailnet.
  Extended actual-new-source playback check found a disabled Play control; this
  is an active regression gate, not accepted completion.
- All 1,130 declared media files passed served size/type/hash/coverage checks.
- Raw task sources remain on T7/internal original paths. A T7 ZIP backup was made;
  no internal raw copies were removed. Storage guard is warning; check each new
  material allocation and avoid dependency/model downloads.
- Previous shared-core extraction remains dirty and unintegrated. Preserve it;
  do not roll it back or include it accidentally in a checkpoint commit.

## Live frontier / ownership

1. Finish disabled-Play diagnosis and checkpoint scoped completed work.
2. Astra: minimal domain model, recording synchronization and storage contracts.
3. Design worker: artwork/header/gain feedback, bounded Opus consultation.
4. Fresh adversarial review of model against verbatim request before implementing
   capture/persistence and synced jam playback.
5. Implement a microphone vertical slice, then notes/linking; review contract
   compliance and code, commit independently useful slices, create/update draft PR.
6. Actual private deployment plus desktop/phone browser checks; request the
   smallest real mic acceptance packet only after the path is usable.

Capture permission remains user-owned: do not select an OS privacy picker resource,
record silently, or synthesize microphone approval. Existing backing assets remain
private; no media belongs in Git or public deployment.
