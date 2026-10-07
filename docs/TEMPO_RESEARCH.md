# Tempo acquisition — 8 October 2026

Status: researched recommendation, not an implemented analysis pipeline. No
catalogue tempo values, audio files or Logic projects were changed in this pass.

BPM means beats per minute: the pulse rate, not playback speed. A tempo value
does not establish the first downbeat, time signature, bar numbers or sections.
Those require an independently reviewed beat/bar map. Our existing seconds
clock and loops should continue to work without any BPM.

## Best immediate route

Use the already-installed Logic Pro Smart Tempo on an exact reference recording
in a separate analysis project, with audio following/stretching disabled. Apple
documents automatic analysis, refinement by beat/downbeat hints, a metronome
preview, and explicit double/half-tempo correction. This adds no model download
or new package. The source asset must remain unchanged: analysis is not an
instruction to adapt the song to the project's default 120 BPM.
[Apple Smart Tempo](https://support.apple.com/en-gb/102165).

For a small set of originals, analyze one representative track, audition the
click at the beginning, middle and end, and retain a candidate until reviewed.
Our existing drums stems may make the pulse easier to assess, but separation
artifacts and subdivisions can also mislead; compare against the original.
If the result drifts, retain a tempo map or variable-tempo status rather than
pretending one global number can create a reliable bar grid.

## Free automated alternatives

| Route | Useful capability | Current fit |
| --- | --- | --- |
| aubio | Command-line overall tempo and beat timestamps; no neural model needed for these functions | Best small future batch candidate; executable/module not found in inspected runtimes |
| librosa | Onset-strength correlation plus beat tracking; accepts fixed or time-varying tempo input | Established analysis option, but its scientific Python dependencies are not currently present here |
| Logic Smart Tempo | Already installed; visual hints, preview and half/double correction | Best zero-install route now; GUI workflow, not a claimed unattended API |

aubio's official CLI distinguishes `tempo` (overall BPM) from `beat` (beat
locations). Its detection output is a candidate, not verified notation.
[aubio command-line documentation](https://aubio.org/manual/latest/cli.html).

librosa describes onset measurement, tempo correlation and selecting compatible
onset peaks. Its API supports a time-varying tempo array; we should not collapse
variable material solely to a mean. It is not an automatic arrangement or
downbeat transcription system.
[librosa beat tracking](https://librosa.org/doc/main/api/generated/librosa.beat.beat_track.html).

## Lookups and provenance

An official score, composer publication or source release can supply a useful
tempo marking. A search-result BPM from a differently titled upload, cover or
remix is only a lead. Store the cited exact version and whether the value was
looked up, measured, tapped or human-reviewed. A song's display BPM can refer to
its chosen reference, but must not rewrite all takes or other reference versions.
Playback at 0.8× changes the heard pulse rate; it must not overwrite original BPM.

Common uncertainties are half/double pulse interpretation, intros without a
stable beat, rubato and tempo changes, loop edits and uploads with changed speed.
When candidates disagree, show candidates or leave unknown; never select a
number simply because it is nearest 120.

## Local evidence and bounded next step

Default Homebrew Python: no numpy, scipy, librosa, aubio, Essentia or soundfile
modules. Bundled Codex Python: numpy present; scipy, librosa, aubio, Essentia and
soundfile absent. No aubio command was found. No installation, allocation-heavy
decode, custom detector or GUI analysis was attempted.

Recommended next step: a Logic analysis pilot for Beneath the Mask, with click
checks and an exact source/hash receipt; promote its BPM only after confirmation.
Then choose whether the small native aubio installation is worth batch automation
under the storage guard. Do not add a downloaded neural model for this need.
