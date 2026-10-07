# Jam model adversarial review

Status: review completed, 7 October 2026; implementation and human acceptance
remain unverified. Object of study: Owen's microphone jam/overdub request and
saved backing-settings/instrument clarification, as preserved verbatim in
`JAM_RECORDING_PLAN.md`, compared with `JAM_DOMAIN_PROPOSAL.md` and the current
practice transport/store. `JAM_DESIGN_PROPOSAL.md` did not exist at review time.
This review owns no code, deployment or publication changes.

## Verdict

**Revise the implementation contract; proceed with the core model.** Song-wide
jams, exact-recording backing alignment and independent semantic section links
are the right distinctions. Immutable recorded mix defaults, typed recording
targets, explicit comment clocks and local rather than authenticated authors
also fit the request. Do not add a second invisible foundation milestone before
the first useful mic take.

Choose **native MediaRecorder, estimated alignment and manual timing adjustment**
for the first usable proof. Include a constant selected practice rate from the
existing 0.5–2× range. Recording at 0.75× and replaying the mic at its natural 1×
with backing at 0.75× does not require stretching the mic. Mid-take changes and
replay at a different rate can wait. These are implementation decisions, not
another mechanism-choice question for Owen.

## Must Fix Now

1. **Represent aligned coverage separately from the entire mic file.** The
   proposal rejects a nominal capture interval extending beyond source/stem
   coverage. A recorder can retain a lead-in, codec padding or delayed Stop tail
   without making the performance invalid. Keep the whole immutable mic asset;
   store a bounded mic interval eligible for backing replay and a corresponding
   valid source interval. Intersect with those intervals and source coverage at
   replay. Reject false source claims, not the useful mic file. Test recording at
   the last source seconds and at B, including delayed finalization. Never
   silently label out-of-coverage audio as backed.
2. **Make the instrument invariant work on free jams and their comments.** A free
   jam can select the song's existing Piano stem as its playing-instrument label
   without having backing alignment. A comment on that jam can discuss the same
   played instrument without claiming the jam has separated piano audio. Allow
   an exact stem association from a source belonging to the song, or a custom
   label; retain the source/hash/revision. For a source-recording comment, a stem
   association should belong to that source. For a jam comment, the selected
   played instrument may refer to the jam's saved instrument association.
   Instrument association never creates timing or automatically changes the mix.
3. **Do not label encoded crash fragments as playable recovery.** MediaRecorder
   only guarantees the combined blobs of a completed recording are playable;
   individual chunks need not be. Persist flushed bytes and capture metadata,
   but validate recovered decoding before offering replay/save. Mark incomplete
   captures honestly; preserved bytes are not a promise of recovered audio.
   Finalized draft recovery, failed-save retry and download are required now.
   Guaranteed mid-recording crash recovery is deferred if the chosen container
   cannot provide it. [MediaStream Recording](https://www.w3.org/TR/mediastream-recording/#data-handling)
4. **Choose and test a concrete encoded upload validation path.** The existing
   store's validator measures WAV/FLAC; browser recording can produce encoded
   containers. Do a bounded capability probe, retain only supported formats,
   and use the already available local decoder to validate duration/channel/rate
   with byte, duration and resource limits. No downloaded dependency or new
   backend is justified. MIME type and browser-reported duration alone are not
   validation. Reuse the private runtime/SQLite owner and its origin allowlist;
   its current practice JSON parser is 16 KiB, not an audio-upload path.

## Contract-Stage Mismatch

* **Shared-context PCM as mandatory baseline.** An AudioWorklet supplies frame
  positions on an AudioContext clock, which helps digital scheduling. It does
  not measure microphone/output/room latency or eliminate the human timing
  adjustment. The proposed seam, exact interruption cutoff and Original-mix
  decoding adapter add work before the practical recording/replay test. Keep
  this as an upgrade triggered by demonstrated unacceptable drift or unstable
  initial offset, rather than a prerequisite for the personal proof.
  [Web Audio frame clock](https://www.w3.org/TR/webaudio/#AudioWorkletGlobalScope)
* **1×-only proof as a separate user milestone.** A short 1× developer smoke test
  is useful. Shipping it while saving an unsupported normal practice speed
  contradicts the clarified mix-settings outcome. Frozen non-1× rate belongs in
  this feature, tested before delivery; do not silently reset it. The current
  chunked engine's `time()` already accounts for its 200 ms output processing
  delay. An adapter reading that audible source clock must not subtract it again.
* **Frame-exact assertions on estimated capture.** MediaRecorder chunk timecodes
  are relative to its own first chunk, not a backing clock. An `onstart` callback
  or click timestamp can contribute to an estimate, never establish exact mic
  frame zero. Declare the estimate and leave adjustment available. Replace
  one-frame alignment acceptance with tested practical replay tolerance and a
  human verdict. [Recorder timecodes](https://www.w3.org/TR/mediastream-recording/#dom-blobevent-timecode)

## Minimal revised contract

* Every jam belongs to a song. A free jam has no alignment/mix and may have a
  section association. An overdub has exact backing asset identity, immutable
  original/stems mode, stem revision/hashes/gain/mute/solo state and fixed rate.
  Its existing/custom playing instrument is independent. No new universal
  recording table, catalogue migration or shared-package expansion.
* One capture owner beside Player. Explicit Record requests permission; prepare
  backing first, then a visible three-second countdown. No live mic monitoring,
  hidden recording, automatic permission request on page load or invented tempo.
  Mic input only is encoded; acoustic bleed remains possible.
* Capture one pass, maximum 120 seconds and 32 MiB encoded bytes. Prefer mono,
  validate actual channels, and cap decoding at two channels/48 kHz-equivalent
  allocation or an equivalent explicit byte budget. Budget mic playback buffers
  together with stem cache/reservations under the existing 300 MiB audio limit;
  the limit is not a guarantee of total phone process memory. Avoid full-original
  decoding by using the existing native Original-mix provider.
* Preserve an estimated mic-to-audible-source anchor, actual fixed rate, validated
  decoded mic duration, aligned coverage and `clockBasis='observed-media-time'`.
  Record estimate provenance. Compare paired monotonic observations with actual
  transport time, not React's displayed timeline. Clock samples during preparation
  or buffering cannot establish progressing backing. No sample-accuracy claim.
* Correction stays bounded at ±2 real seconds. Keep the proposal's sign:
  positive correction moves mic earlier; source movement is correction × saved
  rate. Raw bytes/hash and captured mix never change. Show Earlier/Later, reset,
  and the amount; a user's edit is not automatic calibration.
* Freeze provider/source/range/mix/rate while recording. Temporarily disable
  Repeat. Pause means Stop. Gaps, track termination, source change, suspension or
  failure stop capture and retain its result; never concatenate clock jumps.
  Preserve interrupted raw audio. Offer synced replay only for verified continuous
  coverage; uncertain timing offers mic-only with an explicit reason.
* Stop/cancel/error release every mic track promptly. Finalize before review;
  keep a finalized draft across component remounts and reload when storage succeeds.
  Show storage failure, preserve in-memory download, and never resume recording
  after reload. Saving is idempotent by capture ID; ambiguous responses retain
  the draft until lookup/retry confirms durable private audio plus metadata.
* Play with backing defaults to recorded mix/rate and exact source, with a separate
  mic gain. Mic only always remains accessible. Prepare links paused. Alternate
  audition mix does not edit the snapshot. Missing backing revision blocks synced
  replay with a reason, rather than substituting another mix/source.
* Comments cover Song, Recording, Point and Range on original/reference, archive
  and jam recordings; optional instrument follows the invariant above. Store time
  on the explicitly named target recording clock. A jam timestamp is not silently
  interpreted as an original timestamp. Unknown verified archive duration permits
  untimed comments now. Existing pedagogical chords/notes retain their owner.

## Deferred With Trigger / Outside Stage

| Classification | Item and trigger |
| --- | --- |
| Deferred With Trigger | Shared-context PCM when a short and full-limit real take show offset varying through time or correction cannot make replay usable. Keep the same domain relationships. |
| Deferred With Trigger | Guaranteed unfinished-capture recovery when loss on crash becomes a demonstrated burden; do not claim it from stored encoded fragments. |
| Deferred With Trigger | Timed archive comments after that exact archive asset has validated hash/duration; untimed comments remain available meanwhile. |
| Deferred With Trigger | Variable rate, loop passes or pauses inside one take after users need that behavior; requires segments, not the present single affine mapping. |
| Outside Stage | Authentication, membership, public sharing, verified ownership, MIDI, live collaboration, comping, musical bars/tempo, automatic latency calibration and composite-jam overdubbing. |

## Required checks and first human gate

Automated checks should prove these specific behaviors, rather than demand a
grand schema before a microphone can be tried:

1. Save/reload Piano 20%, Bass 150%, two solos, custom/existing instrument and
   0.75×; restore exactly, without automatic mute. Re-auditioning does not mutate
   the snapshot. Exercise 0.5× and 2× short captures and cross one chunk boundary.
2. Synthetic paired clocks and a captured test pulse exercise delayed starts,
   B/end tails and correction: +100 ms moves 75 ms earlier on a 0.75× source clock,
   with unchanged raw hash. A source-time comment and mic-time comment retain
   separate clocks after reload. Reject cross-song, nonfinite and invalid targets.
3. Deny permission, cancel countdown, stop twice, simulate a backing gap and mic
   ending: no live track remains, no fake saved take, no claimed alignment across
   the gap. Reload never arms the microphone. Decoding failure/quota failure has
   an honest recovery/download state.
4. Timeout after committed save returns one record on retry. Oversize/unsupported
   audio and forged path/origin fail. Existing practice endpoints work; public
   build contains neither private recordings nor comments. Missing source/stem
   revisions leave mic-only playback and comments intact.

**First gate:** on the private deployed page, headphones on, Piano reduced, choose
Piano or a custom instrument, record 10–20 seconds at 0.75×, save, reload and play
with backing. Judge sound, captured mix and timing; use adjustment if needed.
Then try a longer passage for drift. Mic-only playback proves no deliberate
digital backing mix was embedded. The first real take should happen as soon as
capture/save/replay are usable; comments and the remaining negative tests finish
before declaring the whole feature complete. Phone layout automation does not
establish a physical phone microphone or hearing verdict.

## Addendum: Opus design comparison

Reviewed `JAM_DESIGN_PROPOSAL.md` after it became available. Its root interpretation
already rejects device-local-only persistence and acknowledges the actual stem
engine. The arm/review panel, explicit microphone enable, visible Stop, mix summary,
instrument chips/custom label, recorded-mix reset and fixed slowed replay are
compatible with this contract. **Proceed after the following bounded overrides;
no further model-review milestone is needed.** The verbatim consultation is advice,
not an accepted implementation checklist.

### Must Fix Now

* **Countdown is not retained preroll.** For this proof, prepare input/backing,
  count three seconds visibly, then capture/start the backing with estimated
  timing. Do not begin recording at the Record click while showing a countdown
  that appears to precede capture. Omit trim handles and optional ticks initially.
  Retained musical preroll can be a later explicit feature. If implemented later,
  backing pre-roll distance must account for saved rate: three real seconds at
  0.75× spans 2.25 source seconds, not three.
* **A backing stall stops the take.** Override the advice to continue capturing
  with an unreliable-after marker. Stop/finalize, retain raw mic audio, and offer
  only established continuous aligned coverage. Do not make a delayed main-thread
  notification a frame-exact cutoff. Keep mic-only recovery available.
* **Source/stem drift never substitutes the backing.** Override full-mix fallback,
  “re-align by ear” onto a replacement and classification of a stale overdub as an
  originally free jam. Keep captured relationships/snapshot; mark unavailable
  backing explicitly. Mic-only is a playback option, not a rewritten association.
* **Draft/recovery wording reflects durable evidence.** Stop enters Finalizing;
  Review can follow durable finalized storage or an explicit storage-failed state.
  `beforeunload` cannot promise a completed flush, quota failure cannot promise
  “save what fits,” and stored unfinished encoded chunks cannot promise recovered
  playback. Keep the server-save and idempotent retry contract above. Retake must
  not silently discard an unsaved finalized take; retaining one previous take or
  explicit discard is enough, without an unbounded unsaved-takes library.
* **Keep clocks and feature coverage explicit.** A projected jam note says
  “mic 0:12 · [named backing recording] 1:24,” not a universal song time. Use
  paused links with jam/comment identity and an explicit clock; the proposed
  `?take=<id>&t=84` must not overload the existing source-range query contract.
  Free jam, existing semantic section association, range/instrument comments and
  archive recording comments may follow the first capture test, but remain part
  of feature completion rather than silently disappearing into the deferred list.

### Contract-Stage Mismatch

Do not implement a segments abstraction, automatic combined latency estimate,
mandatory device picker, trim, undo, wake lock or take waveform merely to satisfy
the consultation's full V1 list. The fixed-rate affine alignment plus explicit
coverage remains sufficient. Use ±2-second manual correction, rather than the
unmeasured ±500 ms restriction; output latency is not round-trip calibration.
Audition rate stays at captured speed while mic plays naturally. Changing rate
requires an explicit transition to mic-only/backing-only, never a silently
detached simultaneous replay. Automatic silence padding and a mandatory one-second
tail are unnecessary; natural finalized tails stay raw, outside backed coverage.

Verification additions: cancel countdown retains no captured take; a synthetic
stall leaves no aligned suffix; missing stem revision never plays all-on backing;
reloaded jam/comment links retain their named clock and prepare paused. Then use
the existing real 0.75× mic gate. No new schema-perfecting loop is warranted.
