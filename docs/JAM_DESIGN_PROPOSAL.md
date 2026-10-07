# Jam recording design — proposed, not implemented

Actual Claude Opus 5.5 (`claude-opus-5-5`) gave a bounded read-only consultation
against the original prompt and capture-mix/instrument clarification in
[JAM_RECORDING_PLAN.md](JAM_RECORDING_PLAN.md). Session:
`5c5708f5-e00a-41e1-8bb6-d70f747cdff2`. Authenticated first-party response metadata
and persistent transcript were verified; no tools, edits or browser integration.
Provider receipt: `work/jam-opus-receipt.json` in the parent task workspace.

## Product interpretation and decisions still open

The proposed interface should let someone lower the piano, identify their own
instrument, record a short play-along, keep it privately, then return to that exact
source with the original backing settings. The main practice workspace owns
waveforms and jam discovery; one persistent transport owns playback and capture.
No second player or setup destination should appear.

Promising proposal: one Jam entry opens a compact arm/review panel; explicit mic
enable, input meter, existing-stem/custom instrument choices, current-mix summary,
seconds-based lead-in; clearly visible Recording/Stop state; durable draft before
review; offset nudge; Keep/Retake/Discard; replay defaults to the frozen capture
mix with transient audition and Reset. Instrument selection itself never mutes
the corresponding backing stem.

Opus's storage recommendation is **not adopted**: device-local IndexedDB cannot
provide cross-device or future friend access; existing private server persistence
and upload contracts need Astra/root review. Opus's suggestion that pitch-
preserving playback implies HTML media is also **not a project fact**: current
stems are synchronized Web Audio with SoundTouch. A shared sample clock still
cannot prove acoustic/output latency. The ±500 ms/10 ms nudge proposal is not
human acceptance or a measured hardware requirement.

The smallest capture proof may omit device picker, free-jam entry, trimming,
undo, crash recovery, wake lock and timeline bars if these are explicitly deferred
and the proof still preserves stopped drafts, source alignment, saved mix, instrument
identity and linked notes. Do not silently treat the full recommendation below
as an approved feature checklist. Semantic section association, timestamp alignment
and song membership are separate relationships, including before capture. Do not
make a source replacement erase the recording or relabel it as originally free.

## Immediate visual transition contract

Purpose: **Operate** — recognize the current source while scrolling a practice
score, and see each instrument's effective contribution without weakening controls.

`SongPage` owns one sticky identity (artwork, title/game, back link and view tabs).
The header keeps fixed layout geometry; artwork and title scale continuously from
scroll 0 to 96 px (60→40.8 px art, title 100→86%). Reverse and interrupted scroll
use the current scroll position, with no completion callbacks or duplicate owners.
The main pane's actual padding determines its sticky edge on resize. The media
engine, source, focus, tabs and score offset stay unchanged. Reduced Motion has
no timed transition: the same derived end geometry applies immediately.

Active reference thumbnail wins, then this song's original/reference artwork; an
active linked take uses its footage thumbnail. Missing/failed reference art falls
back to the existing song icon. No unrelated playing source supplies this song's art.

Waveform opacity: 18% at effective zero, 34.4% at 20% gain, 59% at 50%, 100% at unity.
Above unity, brightness/saturation increases through 200%; labels, controls, numeric
percentages, playhead and seek/focus feedback retain normal readability. Mute/solo
compute effective silence without altering saved levels. Original-mix mode displays
unity contribution rather than pretending retained inactive stem controls apply.

Focused verification: desktop, 375 px phone and Reduced Motion; before/midpoint/
compact/reverse/interruption geometry, single owner, gain levels 20/50/100/150/200,
mute/non-solo/reset and overflow. Source detector cannot scan TSX; Interface Toolbox
interaction-considerations coverage remains unsupported, not complete. Existing
native sliders/wheel behavior was reused.

## Read-only Opus recommendation (verbatim advice)

No tools used, per the read-only instruction. The plan-mode file and ExitPlanMode were also skipped. Advice only, for the Codex root orchestrator.

# VGM microphone jam: design proposal (Opus 5.5)

## 0. Ambiguities to resolve before building

1. **Playback engine decides how precise alignment can be.** Two cases:
   - If stems play through Web Audio, record through an `AudioWorklet` in the same `AudioContext`. Both sides then share one sample clock, which is the strongest alignment you can get.
   - If stems play through `HTMLMediaElement` (likely, given the pitch-preserving speed), log anchor pairs at punch-in: `(audioCtx.currentTime, media.currentTime, performance.now())`.
   - In both cases, expect roughly 10–50 ms of error plus Bluetooth delay. The user nudge control is therefore required, not optional.
2. **Where takes live.** Device-local IndexedDB means a take recorded on the phone does not appear on desktop. A private Tailnet server makes sync work but needs an upload path and server storage, and the storage guard is already at warning.
   - Recommendation: IndexedDB for V1, with Export. Ask Owen whether phone→desktop visibility is part of the first gate.
3. **"Linked to that specific part."** V1 reads this as an *aligned time range*, never as a section. Semantic section tags are deferred and are always explicit.
4. **Disabled-Play regression blocks this work.** Record must stay disabled until the backing is buffered and playable. Fix that gate first, or the jam path inherits it.

## 1. Entry point

- Add a **Jam** button to the persistent bottom transport, beside Play. It is present on every song page. There is no separate setup page.
- Pressing it opens an **arm sheet** that rises above the transport. It is a bottom sheet on mobile and an inline panel about 320 px tall on desktop. The main pane stays visible and scrollable, so there is no cramped sidebar.
- The sticky identity header (thumbnail and title) gains a small "Jams · 3" count. It also shows a red ● REC chip while recording.

## 2. Arm sheet (capture preparation)

One compact panel, top to bottom:

1. **Microphone.** The browser's permission prompt fires only when the user presses an explicit **Enable microphone** button, never on page load. Section 3 covers the denied and unavailable states.
2. **Input.** After permission is granted, show a device picker and a live level meter.
   - Request `echoCancellation`, `noiseSuppression` and `autoGainControl` all set to false.
   - Store the settings the browser actually returns via `getSettings()`.
3. **Instrument.** Chips for the six source stems plus **Custom…** (free-text label). Selecting one never changes the mixer.
   - Next to the chips, show a hint: "Piano stem audible at 100%" with an explicit **Mute piano** link. The user chooses; nothing mutes implicitly.
4. **Backing.** A read-only summary of the current mix and speed, e.g. "6 stems · piano 20% · 75% speed", with a link to the mixer. The mixer stays live while the sheet is open.
5. **Start from.** Current playhead (default) or loop start, when a loop is set.
6. **Lead-in.** 0 / 3 / 5 / 8 seconds (default 3). Optional **second ticks**, labelled as ticks and never as beats.
7. **Headphones advisory.** One line: "Speakers will bleed into the mic. Bluetooth adds delay."
8. **Record** (primary) and **Close**.

Accidental-recording guard: recording always takes two steps, Jam then Record. No single keystroke starts a take.

## 3. Permission boundary (user-owned)

- **Prompting:** the sheet shows "Your browser is asking for microphone access".
- **Denied:** show static instructions for re-enabling access in browser or site settings, plus a **Try again** button that calls `getUserMedia` once per press. No automatic retry loop.
- **Unavailable** (insecure context or no device): explain why and disable Record.
- The app never auto-selects a device the user did not choose, and never simulates approval.

## 4. Count-in without a known tempo (BPM = beats per minute)

The lead-in is a **pre-roll**, not a musical count-in:

- Backing starts at `start − lead` seconds.
- A countdown ring shows 3 · 2 · 1 in seconds, then turns red with **REC**.
- If `start − lead < 0`, pad silence before the source starts and show "lead-in padded".

**Capture starts when Record is pressed, not at the punch-in point.** The pre-roll audio is kept as a handle, and the take's in-point marker sits at punch-in. Early playing is therefore never lost, and the user can trim the in-point later.

Escape or **Cancel** during pre-roll discards. Nothing worth keeping exists yet.

## 5. Recording state (must be unmistakable)

- The transport becomes a red-edged **REC bar** showing:
  - an elapsed take timer and the source time;
  - the live input meter;
  - the instrument label;
  - **Stop** (primary) and **Cancel** (secondary; it becomes stop-and-save after 3 s of audio).
- Also: document title prefix `● REC`, red chip in the sticky header, and `navigator.wakeLock` on mobile.
- **Locked during the take:** seek, speed, source switch, song navigation (confirmation required) and mixer changes. Locked controls appear dimmed with a lock glyph, so the backing snapshot stays truthful.
- Space bar = **Stop**, never Cancel.
- `beforeunload` warns the user and also triggers a flush of saved chunks.

## 6. Stop / cancel / retry / save

- **Stop** immediately persists the take as a **draft**, then opens the review panel in the same sheet. Review contains:
  - Play take with backing, using the capture mix.
  - **Offset nudge**: ±500 ms slider plus ±10 ms steps, auditioned live.
  - Trim in/out (handles from the pre-roll).
  - Instrument, title, and an optional first note.
  - **Keep**, **Retake** and **Discard**.
- **Retake** keeps the previous draft under "Unsaved takes" until the user explicitly discards it.
- **Discard** shows a 10 s undo toast.
- **Crash or tab-kill recovery:** chunks go to IndexedDB every second (`MediaRecorder` timeslice or worklet PCM blocks). On next load, show "1 interrupted take recovered" with links to review or discard it.

## 7. Backing snapshot and replay

- At punch-in, freeze a snapshot: `{sourceId, sourceFingerprint, stem gains/mute/solo, speed, startSourceTime, loop}`.
- Replay defaults to that snapshot.
- The take appears as a **seventh lane** ("Your take · Piano (custom)"). It uses the same 0–200% gain and brightness rules as the stems.
- Audition edits are **transient**. Show a **Reset to recorded mix** chip whenever the mix deviates. A "save as default" option is deferred.

## 8. Alignment and latency honesty

Store alignment as **segments** `[{takeStart, sourceStart, duration, rate}]`. V1 always writes a single segment, so loop or stall support can be added later without a migration.

Alongside the segments, store:
- `latencyEstimateMs` (from `outputLatency`, `baseLatency`, and the track's latency where available);
- `userOffsetMs`;
- `confidence`: `estimated` or `adjusted-by-ear`.

User-facing labels: "Aligned (estimated)" or "Aligned (adjusted by ear)". The UI never says "synced". A loopback click-calibration test is deferred.

**Loop wrap.** V1 has no continuous looping while recording. If a loop is set, Start-from = loop start offers "record one pass": the take stops automatically at loop end, with a 1 s tail. Multi-pass loop takes, where each pass is a segment or candidate take, are deferred.

**Speed.** Recording below 100% is allowed; slow practice is the point. Store `rate`.
- Replay locks to the capture speed, labelled "Recorded at 75%".
- Changing speed during replay detaches the take into free listen, with a clear label.
- Time-stretching the take itself is deferred.

**Stalls.** If backing fires `waiting`/`stalled` during capture, store an issue `{at: sourceTime}` and mark alignment after that point "unreliable after 1:23". Never silently re-map.

**Device drift** on long takes is a known unknown. Measure it during acceptance before adding correction.

**Source replacement.**
- If the reference source changes (fingerprint mismatch), alignment becomes **stale**. The take stays playable as a free jam, and the UI offers "re-align by ear".
- If stems are re-separated from the same source, the time base is still valid. Missing stem IDs fall back to the full mix, with a label saying so.

## 9. Three association kinds (never conflated)

| Kind | Stored as | V1? |
|---|---|---|
| Free jam | Take with `songId`, no alignment (no-backing record, or stale alignment) | Yes |
| Aligned play-along | `alignment` (sourceId + segments) | Yes, primary |
| Section association | Explicit user tag referencing an **existing saved section** | Deferred |

In V1, overlap with existing sections is **derived for display only** ("overlaps: saved loop 'intro run'") and never stored. No section is ever inferred or invented.

## 10. Anchored notes

- **Target:** song, reference source, or take.
- **Anchor:** none, instant, or range, measured in the target's own clock.
- **Instrument (optional):** stem ID or the take's instrument.
- A note on an aligned take projects onto source time through the alignment. Show both times: "take 0:12 · song 1:24".
- **Composer:** a **Note @ 1:24** button in the transport captures the current playhead.
- Markers appear on the timeline and lanes. Clicking a note seeks to it. Deep link format: `?take=<id>&t=84`.
- Author shown as a local display label, "Owen (local, unverified)". Nothing implies an account.

## 11. Discovery

- Song page main pane gets a **Jams** section: take cards showing instrument, date, duration, status ("aligned 0:42–1:30 @75%", "free jam", "stale"), note count, and Play.
- Aligned takes also appear as thin bars above the waveforms at their source range. Clicking a bar loads the take lane.
- **Notes** section below Jams, filterable by song, source, or take.

## 12. Information hierarchy (song page)

1. Sticky identity header: thumbnail, title, game, source switch, jam count / REC chip. It shrinks on scroll.
2. Main pane, top to bottom:
   - waveforms (six stems, plus the take lane when a take is loaded);
   - aligned-take bars and note markers;
   - sections and loops;
   - Jams;
   - Notes.
3. Persistent transport: Play, time, speed, loop, **Note @**, **Jam**. The arm, REC and review states expand from it.

## 13. State sketch

```
idle ─Jam→ arming{mic: unknown|prompting|denied|unavailable|ready}
arming ─Record (mic ready ∧ backing buffered)→ preroll
preroll ─countdown done→ recording      preroll ─cancel→ arming
recording ─stop→ finalizing → review(draft persisted)
recording ─device ended | hidden(mobile) | quota | fatal→ interrupted → review(partial draft, flagged)
review ─keep→ kept   ─retake→ arming (prior draft retained)   ─discard→ undo-toast → gone
take replay: aligned | aligned-unreliable-after(t) | free | stale
```

## 14. Error and data-loss table

| Event | Behaviour |
|---|---|
| Mic unplugged (`track.ended`) | Stop, save partial draft, banner |
| Mobile tab backgrounded (`visibilitychange`) | Stop, save, flag "interrupted" |
| Quota exceeded | Stop, save what fits, show storage message; call `navigator.storage.persist()` on first Keep |
| Backing stall | Continue capture, flag the alignment issue at that time |
| Navigation or song switch | Blocked with a confirm; on confirm, stop and save the draft |
| Encoder unsupported (Safari `MediaRecorder` mime type) | Feature-detect the type, fall back to WAV via worklet |

## 15. Smallest first release vs deferred

**V1 (personal proof):**
- Jam button and arm sheet; explicit mic enable; device picker and meter.
- Instrument chips plus Custom.
- Start from playhead or one loop pass.
- Seconds lead-in with visual countdown and optional ticks; pre-roll handles.
- Locked REC bar; linear capture at any speed.
- Chunked IndexedDB storage with crash recovery.
- Review with nudge, trim, Keep / Retake / Discard (undo).
- Take lane with snapshot replay, transient audition, and Reset.
- Stale and stall flags.
- Jams list and take bars.
- Notes (song/source/take, optional instant anchor) with markers and deep links.
- Headphone advisory and wake lock.
- Record-without-backing as a free jam (the same pipeline with backing off).

**Deferred:**
- MIDI.
- Accounts, sharing, and other people's comments or threads.
- Explicit section tags.
- Range notes and instrument-targeted notes, if V1 runs long.
- Multi-pass loop takes.
- Mixer automation during a take.
- Replay at a different speed (take time-stretch).
- Loopback latency calibration and auto-alignment by audio correlation.
- Take-to-take alignment and group recordings. The segment schema keeps these possible.
- Server sync and export polish.

## 16. Human acceptance gate (not yet met; nothing fabricated)

1. Owen records a real take on desktop with wired headphones, keeps it, and replays it.
2. Owen judges by ear whether alignment is acceptable after the nudge, and whether the ±500 ms range and 10 ms steps are adequate.
3. Repeat once on the phone over Tailnet.
4. Log the measured offset and the drift over a take of at least 2 minutes.

Browser simulation cannot establish any of these.
