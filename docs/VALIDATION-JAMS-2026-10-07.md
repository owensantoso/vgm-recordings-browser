# Jam implementation validation — 7 October 2026

Implementation checkpoint: `c1d63d1` on `feat/song-repertoire`.
Private entry: https://macnos.tailafa155.ts.net/vgm-preview/?view=songs&song=vgm-beneath-the-mask

## Agent-verified

- The independently staged source slice excludes the preserved dirty shared-core
  package experiment. `npm run check` with installed Chrome passed TypeScript,
  111 domain/store/engine checks, one React lifecycle case and all 80 real Chrome
  cases with zero failures/skips, followed by production build.
- The full check first exposed two ambiguous **Add note** selectors after adding
  conversational comments. The composer now says **Add comment**, preserving the
  distinction from authored practice notes; repeated full check passed.
- Final paused mic-seek refinement then passed TypeScript and all three focused
  jam browser cases on the staged slice, followed by fresh public/private builds.
  Both cold links and same-loaded-file mic comments at 2s→1s seek paused.
- Capture uses actual browser MediaRecorder/Opus from a generated oscillator
  stream, without acquiring a real microphone. Tests cover explicit denial,
  three-second countdown cancellation/track release,0.8× captured settings,
  current-position capture, finalized draft reload, timing nudge/save, ambiguous
  committed-save retry, recorded-mix audition/reset, next-take seeking and short
  native backing stalls. Four independent capture-clock cases also pass.
- Twelve store cases cover real WAV/WebM/Ogg/MP4 decoding, source/stem identity,
  immutable mix and mic bytes, mutable correction, retry/orphan recovery, named
  comment clocks, Range responses, invalid origin/path/metadata/audio/size,
  finalized duration tails and launchd-style decoder PATH.
- Public catalogue/build have no downloaded reference audio, stems, jam files or
  SQLite databases. The declared source batch remains22 reference recordings,
 132 full FLAC stems and1,130 runtime assets; this update downloads no models.
- Private deployment reused the durable loopback8851 service and `/vgm-preview/`.
  The original practice handler remains mounted; the jam handler is beside it.
  Serve fingerprint stayed
  `sha256:fb9443106e955e5d86b802993dafa7981f917b0d0681ca256ecdf11846c6db28`,
  preserving69 unrelated handlers. No public Funnel exposure was introduced.
- Actual Tailnet desktop1440px/phone375px tests loaded Beneath the Mask with six
  verified instruments, opened Jam recording, chose Piano without muting it,
  observed zero microphone requests, no overflow and a clean console. Read-only
  context/list requests reached the durable jam API; no application writes were
  attempted by this deployed check. Source artwork and arm layout were inspected.
- Served app asset exactly matched the deployed local build, SHA-256
  `e74577d0ddc5c9de5d8eda45a27bf47a512484f002e72ad90f013911236a149c`.

Parent-task evidence files: `work/jam-checkpoint-final-check.log`,
`work/jam-staged-final-focused.log`, `work/jam-preview-receipt.json`,
`work/jam-route-preflight.json`, `work/jam-route-post.json`. Synthetic screenshots
live in `.test-artifacts/jam-capture/` and `.test-artifacts/jam-comments/`; real
preview screenshots are `work/jam-preview-{1440,375}.png`.

## Remaining human acceptance

On the deployed song page, use headphones. Set Piano20%, Bass150%,0.8× (the speed
control uses0.1× steps), choose played instrument Piano, enable the microphone,
record10–20s, Stop, save, reload and play with the recorded mix. Judge actual
mic sound and timing, using Earlier/Later if needed. Try a longer passage to
judge drift. Previous model examples used0.75×; this runnable packet uses the
normal UI's0.8× setting. Neither simulated capture nor phone-width geometry proves
acoustic alignment, stem isolation, sound quality or a physical phone microphone.

Accounts/MIDI, timed archive audio receipts and unfinished crash recovery remain
explicitly deferred in `JAMS.md`. Archive comments currently support untimed notes.
Keep this draft PR pending the real mic verdict. Main stays unchanged; the dirty
shared-core experiment remains preserved and unintegrated in this worktree.

## Generated-asset correction

GitHub run37611215402 passed all tests/build on Linux, then rejected the stale
committed assets/app.css in its existing rebuild-freshness check. Root had staged
only the rebuilt JavaScript while isolating the unrelated shared-core experiment.
The deployed private build already included the correct stylesheet. The correction
compares every tracked emitted asset against the verified build, stages the missing
CSS and retains the unrelated working JavaScript. Source behavior is unchanged;
all emitted asset comparisons pass. The published successor check remains the
final generated-output gate.
