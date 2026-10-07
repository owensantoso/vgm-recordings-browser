# Practice timeline revision — 8 October 2026

Scope: real sticky-height contraction, monotonic gain ink, aligned Jams row and
comments selected on the timeline. Work stays on `feat/song-repertoire`, draft
PR2; the older dirty shared-core experiment is preserved and excluded.

## Evidence and revisions

Header/gain browser checks at1440/375/reduced-motion verify one header/media owner,
focus retention, long phone title, scroll reversal and at least30px of reclaimed
height. Gain20/50/100/150/200% increases graphic opacity without lightening ink.
Labels, controls and saved gain survive mute/solo.

Independent implementation review identified and resolved:

- Context refresh no longer resets the composer after a comment save.
- Timed comment navigation is source-bound, consumed once, and validates exact
  audio hash/duration before seeking. Switching backend or take cannot reuse it.
- Header height is measured for the desktop composer's sticky offset.
- Nonempty draft text keeps its original target and label across navigation and
  tab reload; choosing another target requires saving or closing it.
- Timeline/replay share one corrected interval calculation bounded by both valid
  source and mic coverage. Fixed playback rate and correction map clocks explicitly.
- Custom instrument source notes remain on the Song lane; jam markers name the
  specific take. Short selections become points; fractional time inputs are valid.
- A narrow video-browsing layout clips the empty Jams message inside its lane,
  preventing horizontal overflow without changing the existing media owner.

Synthetic fixtures test source points, Piano ranges, exact stem revision,
0.5× corrected jam→mic timestamps, stacked overlaps, free/stale exclusion,
scoped draft navigation, stale audio rejection and save confirmation. No real
microphone or fabricated production comments/jams are used.

Archive timed context comes from canonical local audio mapping, contained regular
file, streamed SHA and measured ffprobe metadata. CSV duration is not authoritative.
Missing/invalid media permits untimed notes; changed bytes reject old timed writes.

## Remaining human evidence

Rendered geometry and synthetic clocks do not establish acoustic synchronization,
stem isolation, musical beat interpretation or physical phone keyboard behavior.
The prior real headphones/microphone recording acceptance remains pending.
BPM research is a recommendation; no guessed values were written to the catalogue.

## Final local automated result

Index-only source slice: strict TypeScript,120 domain/store/engine tests, one React
lifecycle test, and82 real Chrome browser cases pass with zero failures/skips.
Public/private builds pass;22 references and22 stem sets verify. All tracked
emitted assets are staged together. Archive path check verifies22 recordings.
The generic browser suite now uses the existing cross-platform Chrome helper;
missing a browser cannot silently skip the required suite on this Mac.
