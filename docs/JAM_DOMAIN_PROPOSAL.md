# Personal jams, overdubs and linked comments — domain proposal

Status: proposed, 7 October 2026. Prepared for a fresh adversarial review before
capture implementation. This document does not claim implemented functionality.
The complete verbatim request, later mix/instrument clarification, interpretation,
current deployment and concurrent-work boundary are in
[JAM_RECORDING_PLAN.md](JAM_RECORDING_PLAN.md). Read that document first.

## Recommendation

Keep existing song, reference and archive-take identities. Add a private **jam
recording**, optional **backing alignment**, independent **section associations**,
and **comments**. An overdub is a jam with backing alignment; it is not a new song,
a stem replacement, or a new kind of composition. Do not migrate the whole
catalogue or expand the experimental shared package to deliver this feature.

An original, a group take and a personal jam are all recordings in the conceptual
model. They can retain their existing storage owners and different product views.
Reference is a role a recording plays in practice. “Personal” describes capture
context here; it does not establish authenticated ownership or exclude several
people being audible in one microphone recording.

The first proof should capture one uninterrupted mic performance, save it privately,
reopen it, restore the backing mix by default, and add comments on the song,
backing recording or jam. It must also save a free jam under a song without
inventing backing alignment. Real microphone timing and sound remain a human gate.

## Existing authority and mechanisms

Reviewed current sources: `docs/SONG_CATALOG.md`, `docs/PRACTICE.md`,
`docs/SHARED_PRACTICE_CORE.md`, `scripts/practice-store.mjs`, `src/practiceData.ts`,
`src/Player.tsx`, `src/PracticeWorkspace.tsx`, `src/StemPlaybackEngine.ts`,
`src/ChunkedStemPlaybackEngine.ts`, `src/StemRateOutput.ts`.

* Song relationships are reviewed SQL/CSV; generated catalogues are projections.
  Do not insert private mic files or transient captures into that authority.
* Existing sections and pedagogical chord/note annotations live in private SQLite,
  with exact reference hashes, revisions, range checks and an origin allowlist.
  They currently support verified local references only.
* Player owns the active transport. Stem engines own their AudioContext and source
  clock; at changed speed the output has an explicitly accounted 200 ms processing
  delay. Native original audio and YouTube are separate providers today. A component
  reading Player's displayed time does not acquire the engine's clock contract.
* Logic Pro is the existing multitrack recording/editing option. Adopt it when
  producing or editing music is the job. It does not currently supply this app's
  song-linked replay, discussion or captured web mix, so requiring a Logic export
  for every practice attempt would leave the requested gap.
* Browser `getUserMedia` supplies permissioned microphone input. `MediaRecorder`
  is the simplest encoded recording mechanism, but its chunk timecodes are relative
  to its own first chunk; they do not establish a shared source sample clock.
  AudioWorklet exposes audio-context frame/time data, useful for a small PCM capture
  adapter when predictable alignment matters. Adopt these platform mechanisms,
  adapt the existing transport, and build only the jam relationships and UI.
  No recorder framework, DAW framework, new package, native app or backend service
  is justified for this proof. DAW means digital audio workstation, a music
  recording/editing application.

Platform references: [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/),
[MediaStream Recording](https://www.w3.org/TR/mediastream-recording/),
[Web Audio](https://www.w3.org/TR/webaudio/). The timing recommendation is an
engineering inference from those contracts and the inspected engine code, not a
claim that any browser/device combination has passed recording acceptance.

## Small vocabulary and field shapes

Application-local TypeScript below describes the contract, not an invitation to
publish another library. UUID means universally unique identifier; use UUIDs for
new private records. SHA-256 is the content fingerprint already used by this app.

```ts
type RecordingRef =
  | { kind: 'reference'; id: string } // existing reference id, without ref:
  | { kind: 'archive'; id: string }   // exact existing legacy filename
  | { kind: 'jam'; id: string };      // new private UUID

type Actor = { kind: 'local'; label: string };
// Server writes {kind:'local', label:'Local practice'} initially.
// No userId, ownerId, membership, authentication or authorization claim.

type ExactAudio = {
  recording: RecordingRef;
  sha256: string;
  durationSeconds: number;
};

type Instrument =
  | { kind: 'custom'; label: string }
  | {
      kind: 'stem'; source: ExactAudio;
      stemSetId: string; stemSetRevision: string;
      trackId: string; labelSnapshot: string;
    };

type BackingMix = {
  schemaVersion: 1;
  source: ExactAudio;
  mode: 'original' | 'stems';
  playbackRate: number; // frozen source-seconds / real second
  masterGain: number;   // app gain only; initially 1 if no master control exists
  stems: null | {
    setId: string; revision: string;
    tracks: { id: string; assetHash: string;
      level: number; muted: boolean; solo: boolean }[];
  };
};

type BackingAlignment = {
  source: ExactAudio;
  sourceAtCaptureZero: number;
  sourceSecondsPerCaptureSecond: number;
  capturedDurationSeconds: number;
  clockBasis: 'audio-context' | 'observed-media-time';
  correctionSeconds: number; // positive means move mic audio earlier
  correctionReviewed: boolean;
};

type SectionAssociation = {
  source: ExactAudio;
  sectionId: string;
  sectionRevision: number;
  labelSnapshot: string;
};
// Means “this jam relates to this named passage”; no timing correspondence.

type Jam = {
  schemaVersion: 1;
  id: string; songId: string; title: string;
  createdAt: string; actor: Actor; revision: number;
  audio: { sha256: string; bytes: number; mimeType: string;
    sampleRate: number; channels: number; frames: number };
  instrument: Instrument | null;
  sections: SectionAssociation[];
  alignment: BackingAlignment | null;
  backingMix: BackingMix | null;
  captureEnd: 'stopped' | 'range-ended' | 'limit' | 'interrupted';
};

type CommentTarget =
  | { kind: 'song'; songId: string }
  | { kind: 'recording'; recording: RecordingRef;
      at: null | { kind: 'point'; seconds: number; audio: ExactAudio }
               | { kind: 'range'; start: number; end: number; audio: ExactAudio } };

type Comment = {
  id: string; songId: string | null; target: CommentTarget;
  instrument: Instrument | null;
  text: string; actor: Actor; createdAt: string; revision: number;
};
```

`stemSetRevision`/`revision` above is a content digest of the immutable subset of
the existing set: source hash, coverage, sample rate/frame count, track IDs and
track hashes. Compute it server-side with a documented deterministic encoding.
Do not hash the whole mutable 22-source manifest and invalidate unrelated jams.
Do not treat the existing set UUID alone as a content revision. Preserve the
snapshot after a newer set is published; never silently substitute it at replay.

No new universal recording table is required. A resolver validates each
RecordingRef using its actual catalogue/store and returns its song association,
label, available media and exact asset identity where known. Existing `ref:`
URLs and archive filenames retain their meanings. `jam:<UUID>` may be the local
player adapter ID; the serialized reference remains unambiguous.

### Invariants and examples

* Every new jam belongs to an existing song. A free jam has `alignment=null` and
  `backingMix=null`; it plays alone. Section links may still be present.
* A v1 overdub has both alignment and backingMix, with identical source identity,
  hash and fixed rate. The mic asset contains mic input only. Do not digitally
  mix backing into it, and do not describe it as isolated from acoustic bleed.
* Each instrument is optional. “Piano” from a source stem and custom “Melodica”
  are both valid. Selecting an instrument never automatically mutes, replaces,
  solos or normalizes anything. Those are separate visible mixer actions.
* Source, song, section and instrument references must agree. For a comment on a
  recording, a stem instrument belongs to that recording; for a song-wide comment,
  an optional stem reference must belong to a recording associated with the song.
  A jam's playing instrument may reference its backing source's stem. Its own
  recording does not acquire a stem set merely because that association exists.
* A section link never gives permission to seek into a free jam at the section's
  backing timestamps. Rename/retime preserves semantic identity but marks the
  stored revision outdated; retain the snapshot and offer the current section.
  Do not fabricate a song-wide chorus ID from equal text labels. Arbitrary
  song-level form and bar identity are deferred until their existing proposal is
  implemented; source-owned section associations satisfy the immediate use case.
* A comment “I like the fill at 0:24” has a **point** target on a chosen recording,
  not an artificial 250 ms range. A song-wide comment has no seconds. A comment on
  the mic recording uses its own file clock, not the backing clock. The interface
  labels that basis when showing both. A recording-wide comment does not need an
  audio hash; a timed target does. Unknown duration/hash permits only untimed
  comments, including archive takes with no verified local media identity yet.
* Comments can target every reference, archive take or jam via the resolver.
  If an archive take has several song associations, select and validate the song
  context explicitly; do not guess from filename/title. An unassigned archive
  recording accepts recording comments with `songId=null`; never create a fake
  song. Song targets require a matching non-null song ID. A null song context
  cannot target a song or borrow a stem from another recording.
* Existing `chord`/`note` annotations are authored practice material. New comments
  are discussion about a target. Keep their table and APIs intact for this slice;
  show both honestly, without copying one into the other's storage. They may share
  target helpers later. Do not call both separate things “notes” in the same UI.
* First version has plain text comments, with no automatic timestamp-text parsing,
  replies, reactions, mentions, rich text or public sharing. A jam description can
  simply be a recording-wide comment; no duplicate description field is needed.

Validate all numbers as finite. Audio has positive integer frames/sampleRate and
supported channel count; measured duration is `frames/sampleRate`. Gain is 0–2,
flags are booleans, IDs/track sets are exact with no unknown or duplicate entries.
Point bounds are `0 <= t <= duration`; range bounds are
`0 <= start < end <= duration`, minimum 0.25 s, matching existing practice ranges.
Use a declared one-frame tolerance only for measured audio end rounding. Titles
and custom instruments use 1–80 trimmed characters; comments 1–2000.
For backing alignment, measured capture duration must equal mic frame duration;
rate must match the mix and the allowed capture rate, and the nominal interval
from capture zero through measured end must lie within the exact source and stem
coverage. Reject claimed intervals that exceed that coverage; do not silently
clamp metadata. Correction may move its playback intersection as described below.

## Capture and playback clock contract

For mic file time `j` in seconds, the nominal backing time is:

```text
sourceTime(j) = sourceAtCaptureZero
              + (j - correctionSeconds) * sourceSecondsPerCaptureSecond
```

Positive correction moves a delayed microphone performance earlier; +0.1 means
100 ms earlier in real performance time, multiplied by the capture rate on the
source clock. Correction changes alignment metadata, never edits the raw file.
Start at zero with `correctionReviewed=false`; label it “Adjust timing” in review.
Use small earlier/later steps and reset, with a finite bounded edit range (±2 s
is a reasonable proof default). Updating correction uses optimistic revision.
Clamp **playback coverage**, not stored facts: replay only the intersection of
the corrected mic interval and backing asset bounds. Raw mic playback/download
retains all frames, including material outside backing coverage.

Digital scheduling and acoustic alignment are different. Driver input/output
latency, speakers, headphones and human performance can require correction.
Do not claim that browser output latency alone measures round-trip acoustic
latency or that automatic correction has occurred.

### Preferred bounded implementation

Use `getUserMedia` and a tiny AudioWorklet to collect mono PCM (pulse-code
modulation, raw audio samples) in the **same AudioContext** used for scheduled
backing playback. Record exact frame intervals, produce a PCM WAV file, and use
the existing WAV validator server-side. This avoids codec/container duration and
encoder-delay inference during the first alignment proof. Mic audio must not be
connected audibly to speakers. A silent output may keep the processing graph
active; the input stream remains visibly armed/recording and is stopped promptly.

The engine exposes a narrow capture seam: context, confirmed scheduled start
frame/source position, rate, output delay, generation, and discontinuity/end
notification. It need not expose mutable internal nodes publicly. Use a small
app-local adapter, not a generic transport framework. Never derive capture zero
from a button click, a React update, an animation frame, or MediaRecorder's
`onstart` delivery time.

For the first independently testable commit, capture at **1× only**, one pass,
maximum 120 seconds, mono WAV, maximum 32 MiB upload. Explain that limitation
before Record and retain the user's pre-capture speed for normal practice.
Do not silently reset speed. These are recommended proof limits, not confirmed
user requirements. A second increment can allow any fixed supported capture
rate: save it, account for the existing pitch processor's output delay, play the
mic at its natural 1× while backing replays at the captured rate. Changing replay
rate away from capture rate requires equivalent pitch-preserving time stretch
of mic audio, so it is not part of this proof.

Stem mode already has scheduled AudioBufferSource nodes. Original-mix capture
needs its own bounded decoded-audio adapter on that same context (or an explicitly
less precise observed media-time adapter); do not secretly recombine stems and
label that “Original mix”. Charge original decoding and mic buffers against a
declared total memory bound; fail preparation before arming if the source is too
large. No full-source stem decode is needed. YouTube cannot supply this clock
contract: require available local Audio or Instrument mix for aligned capture.

An encoded MediaRecorder implementation is an acceptable alternate proof **only
if** it declares `clockBasis='observed-media-time'`, preserves a measured/estimated
start offset, verifies decoded duration, offers manual correction, and never
claims sample-accurate synchronization. Root/reviewer should choose explicitly;
the schema permits the honest distinction without forcing a rewrite. Shared-
context PCM is the recommended baseline because timing is the feature being proved.

### Count-in, ranges and discontinuities

Default: visible three-second countdown, clearly seconds rather than musical
beats. A silent countdown needs no BPM (beats per minute). Arm permission and
prepare backing before the countdown. At its end, schedule backing and recording
against the confirmed clock; distinguish “Preparing”, “Starting” and “Recording”.
Do not run the countdown while audio is still downloading. Optional beeps may be
added outside the retained mic interval; musical count-in and preroll playback
are deferred rather than inventing tempo or secretly retaining pre-count audio.

An active A–B range means record from A through B once; otherwise choose current
source position through end, capped by the visible time limit. Snapshot the actual
start/end request, but measured capture duration governs what was obtained.
Repeat is temporarily off during recording; its previous setting can be restored
after the capture session ends. Lock source, provider, range, seek, mix and rate
while capturing so one immutable snapshot remains truthful. A pause action means
Stop recording, visibly labeled. Never stitch loop passes into one linear map.

Any buffering gap, source replacement, seek, rate change, AudioContext suspension,
mic track ending/muting, hidden-page interruption, processing failure or unexpected
clock discontinuity finalizes the known contiguous prefix as an interrupted take.
Stop mic capture, pause backing, retain what was captured, and require a fresh
Record action for another take. In the engine, cutoff must use the recorded frame
of the discontinuity; a delayed main-thread notification must not bless later
frames as continuous. If continuity cannot be proved, retain a free jam with an
explicit “Backing timing unavailable” review choice instead of guessing alignment.

## Lifecycle, persistence and recovery

UI states: `idle -> requesting-permission -> preparing -> countdown -> recording
-> finalizing -> review -> saving -> saved`. Permission denial/error returns to
an actionable state. Cancel before recording releases input and saves nothing.
Stop is idempotent. `saving -> save-error -> saving` retries the **same** capture,
not a new recording. An interrupted capture enters review with a visible reason.

Keep one capture owner adjacent to Player so browsing does not create another
microphone session or playback transport. A source-changing action during capture
must stop/finalize first; it must not silently lose the result. Finalized drafts
survive component remounts. To survive reload, write bounded chunks plus immutable
capture metadata into IndexedDB (the browser's local database), then finalize the
WAV from those frames. Mark incomplete crash-recovered drafts; never advertise
unflushed frames as saved. Await durable local storage before saying “Draft kept”.
On quota failure stop and retain the in-memory file for download/save; explain
that closing the page would lose it. No background microphone capture resumes on
reload, and no mic permission is requested merely by opening the practice page.

Recommended private store additions:

* `jams`: UUID, song ID, metadata JSON with schema version, actor, revision,
  created timestamp and private verified asset fields; index song ID and backing
  reference/hash for song lists and “jams here”.
* `comments`: UUID, song context, validated target JSON, optional instrument JSON,
  text, actor, revision and timestamps; index song and recording target.
* `private-data/jams/<server UUID>.wav`: immutable audio, outside both public and
  private static build assets. Serve through the private handler by verified ID.

Keep these additions in the existing private runtime/SQLite ownership, optionally
in `jam-store.mjs` mounted beside practice routes. No second server, auth service,
catalogue rebuild or shared-core change. Client labels/hashes/durations are claims:
the server validates the source resolver, measured WAV frames and bytes, computes
the saved SHA-256 itself, and never accepts a client file path or remote fetch URL.

Suggested HTTP contract (application programming interface, API):

```text
GET  api/jams?song=<id>                  list saved jams
GET  api/jams/<id>                       metadata and availability
POST api/jams                           metadata + audio; idempotent capture UUID
PUT  api/jams/<id>                       title/instrument/sections/correction + revision
GET  api/jams/<id>/audio                 verified private audio; Range support
GET  api/comments?song=<id>              comments, target filters optional
GET  api/comments?recording=<typed-id>   includes unassigned archive recordings
POST api/comments                       validated target + text + instrument
PUT  api/comments/<id>                   edited text/target/instrument + revision
```

Use bounded multipart parsing or a small explicit metadata+binary protocol; do
not base64-embed audio in the existing 8 KiB JSON body parser. Reuse the exact
origin allowlist and same-origin request policy on mutations. Origin checking is
not identity or authorization; describe this as a trusted private workspace.
No new public or multi-person write access is enabled by this feature.

Publish a jam only after bounded upload, audio validation, and durable file
finalization succeed, then commit its metadata row. The staging path is not a
playable jam. A crash between rename and SQL commit can leave an unlisted orphan;
recovery reconciles that exact capture ID/hash. Same-ID/same-content retries return
the saved record; different payloads conflict. A successful save response means
audio and metadata are both durable. Keep the local draft until a confirmed
response or idempotent lookup establishes success. Do not delete the sole copy
after an ambiguous request failure. Download microphone audio is the escape path.

Suggested codes: 400 invalid target/format, 404 unknown identity, 409 stale
revision/source/content conflict, 413 size limit, 503 unavailable source/store.
Source mismatch blocks synced replay/editing its alignment, but must not make a
saved mic asset or its comments disappear.

## Replay and UI seam

The PracticeWorkspace gets controls and a jams/comments list; Player's capture
coordinator and transport own effects. Keep API types/resolvers in practice data
or a small app-local jam module. Do not move archive/catalogue models into the
capture component. A JamRecorder component owns only the form/review interaction;
it does not create a competing player.

“Play with backing” explicitly selects the exact source and captured mix/rate,
starts at the captured coverage, and adds the mic through a separate gain. Only
one selected jam plays at a time. “Mic only” plays its own file from zero. Opening
a saved jam/deep link prepares paused. The saved backing mix is immutable;
auditioning another mix changes only the current replay state. Provide “Recorded
mix” reset. Never overwrite a capture snapshot when the user moves a playback
slider. Mic level is a replay preference, not a remembered backing instrument gain.

Default replay restores original/stems choice, exact stem revision, every stored
gain/mute/solo flag, app master gain and captured speed. Effective gain follows
the existing solo/mute semantics. It cannot restore operating-system volume,
physical output device, room acoustics or unknown browser processing. If the
exact backing/stem revision is unavailable, show that reason and keep mic-only
playback/download; do not fall back to a different original or all-on stem mix.

On the backing timeline, show aligned jams intersecting the visible range. On the
song page, show all its jams, including unaligned ones. Section-linked free jams
appear under that association without a false timestamp marker. Comments offer
Song / This recording / Here / Selected range, plus optional instrument. A timed
comment on a jam can be highlighted against backing only through its explicit
mapping; it remains stored on the jam clock. Copied links retain jam/comment ID
and context, load paused, and fail visibly on conflicting source parameters.

## Acceptance packet and implementation order

1. Commit validated domain/store additions and tests independently; preserve all
   dirty shared-core work. Verify existing practice endpoints and public build
   isolation before browser capture work.
2. Implement free mic capture, bounded durable draft, save/reload/mic-only replay.
   Deny permission, cancel countdown, stop twice and simulate failed upload.
3. Implement one-pass 1× backing capture with frozen mix and clock anchor; first
   prove on a short passage inside one prepared stem chunk, then cross a chunk
   boundary. Add Original mix through its explicit clock adapter. A stems-only
   checkpoint is useful but does not complete original-mix scope.
4. Implement timing review, replay, semantic section association and comments on
   song/reference/archive/jam. Exercise saved links after a full page reload.
5. Add fixed non-1× capture only after its processing-delay tests pass; absent
   that, state the visible 1× limitation. Do not hide an unsupported saved speed.

Compact automated acceptance scenarios:

| Scenario | Required observation |
| --- | --- |
| Free jam associated with a chorus | Song and section list include it; no backing timestamp or auto-seek is invented. |
| Piano 20%, Bass 150%, two solos | Save/reload restores exact flags and gains; choosing custom instrument does not change them. |
| Known test pulse, 1× shared clock | Stored mic frame maps to expected source time within the declared render-frame tolerance; no click-time anchor. |
| +100 ms correction | Pulse moves earlier by 100 ms at 1×; raw file/hash unchanged; revision conflict rejected. |
| Capture at 0.75×, if enabled | Natural mic duration replays with 0.75× backing; processing delay accounted exactly once. |
| End, gap, pause, seek, rate change, tab suspension | No silent concatenation; only a proven contiguous prefix is aligned; input tracks stop. |
| Permission denied/cancelled; repeated Stop | No fake saved recording; no live mic left behind. |
| Save times out after server commit | Retry produces one jam; draft remains until confirmed; metadata and audio recover together. |
| Page reload after draft flush | Recoverable draft appears; mic remains off; incomplete tail is marked. |
| Backing/section/stem content changes | No silent retargeting; stale semantic revision is visible; raw jam still accessible. |
| Song, recording, point, range, instrument comments | Each validates and reloads with its correct time basis; nonfinite/out-of-range/cross-song targets fail. |
| Public build and forged upload path/origin | No private jam/comment/media exposure; forbidden mutation/path rejected. |

Human packet after private desktop and phone-sized browser verification: use
headphones, reduce/mute Piano, pick Piano or a custom instrument, record 10–20
seconds, save, reload and play with backing. Judge that recorded mix, count-in,
audible timing (adjust if needed), capture quality and latency are usable. Compare
mic-only playback to prove no deliberate backing render was baked into the file.
Acoustic bleed can still occur. Physical phone/mic and hearing acceptance cannot
be replaced by synthetic capture or DOM tests.

## Decisions, limits and review challenges

Confirmed: mic first; song-wide versus exact-source-time versus semantic section
associations; comments on original/other recordings; optional instrument; saved
backing settings default on replay; identity/authentication later.

Routine recommended defaults: UUIDs, private existing SQLite/runtime, mono WAV,
no live mic monitoring, plain text comments, three-second silent countdown,
single-pass interruption semantics, paused links, explicit local actor marker,
immutable snapshots, optimistic edits and idempotent save.

Implementation decisions requiring reviewer resolution, not another broad user
question: PCM shared clock versus explicitly approximate MediaRecorder capture;
how original audio enters that clock; the proof's duration/memory/upload bounds;
whether fixed non-1× capture fits this delivery; how drafts survive reload without
exceeding quota. Resolve them with a small capability/timing test before broad UI.

Deferred: MIDI (Musical Instrument Digital Interface) input, accounts, verified
authors, membership/access rules, public links, replies, multi-take comping,
loop-pass capture, overdubbing another composite jam, destructive audio edits,
audio export mixed with backing, automatic latency calibration, general form/bar
alignment and live collaboration. Do not put pretend user IDs or permission
fields into the proof schema as substitutes for those decisions.

Fresh reviewer should challenge: whether every requested attachment can be
represented without false alignment; where known-duration/hash evidence for
archive comments comes from; capture/gap clock truth; restored mix revision;
save/crash recovery; ownership of microphone teardown; memory on phone; and
whether any proposed abstraction costs more than the first useful jam.
