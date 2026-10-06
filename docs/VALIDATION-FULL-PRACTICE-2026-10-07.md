# Full-song original practice — October 7

## Implemented scope

Beneath the Mask now opens a main-page Practice workspace with one persistent
Player clock, real stem waveforms, source sections, timed chord/note editing,
A/B loops and paused deep links. Audio selects instruments automatically;
Original mix remains available for comparison and optional Video has one
provider. Song rows use original YouTube artwork with a fallback. Instrument
icons, stateful speaker/muted icons, slim gain sliders, scoped wheel adjustment,
hover preview and global Space/arrow transport implement Owen's subsequent
feedback. No musical boundaries, chords or bar grids are guessed.

## Media and memory evidence

Actual Logic Pro 12.3.1 GUI processed the full task-owned original with Separate
All Stems. Each of the six outputs has 12,254,508 stereo frames at 44.1 kHz,
16-bit, exactly 277.88 seconds. All outputs and 60 frame-aligned FLAC chunks
match verified receipt hashes/dimensions. The waveform file contains 1,800
measured min/max bins for each instrument.

Raw six-track PCM occupies 294,108,192 bytes; full FLAC files occupy 60,875,976
bytes, and the chunk playback files 61,314,149 bytes. Full FLAC plus chunks are
retained (122,190,125 bytes); the task-owned Logic project still retains its raw
outputs. Private builds symlink assets rather than copy them. No new model,
hosted upload or replacement of an unrelated Logic project was used.

The engine loads shared current/next groups and, where needed, loop-start. Three
30-second six-track groups occupy about 182 MiB of decoded float audio, below
the 300 MiB cap including pending reservations. This measures bounded audio
buffers, not total browser or physical iPhone memory. Full-song whole-buffer
loading would need about 561 MiB and is avoided.

A native Chrome codec probe decoded a 30-second 160 kbps MP3 bass file (601,382
bytes) and lossless FLAC file (822,910 bytes) to the same 1,323,000 frames,
44.1 kHz stereo. Lossy encoding was evaluated; current playback remains FLAC.
Two-second raw stem recombinations at source 50, 180 and 265 seconds have
zero-lag correlations 0.999893, 0.999913 and 0.999911. This supports timing/mix
consistency, not isolated-instrument separation quality.

## Automated and live verification

The complete command is `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run check`.
Before the speed/library increment, the complete command exited 0: strict TypeScript, 75 domain/catalog/store/
engine tests, one React lifecycle test, 63 Chrome browser scenarios and production
build pass with zero failures/skips.
One React lifecycle test passes, preserving a provider while browsing songs,
Overview and an empty search. Deferred native-play regression checks intentional
Pause before its play event, rejected canceled/older starts, surviving newer play
intent and genuine active rejection. Browser rapid Space checks exposed an
unconditional native play-promise error; backend epochs and eager intent now
filter cancellation while preserving genuine errors. Astra reviewed this fix. The Chrome browser suite checks actual synthetic
WAV/FLAC decoding, one synchronized six-track context through chunk boundaries,
loops, network/decode/abort failures, fallback and source/hash ownership. Private
SQLite section/chord/note saves, revisions, reloads and copied links are covered.

Polish checks verify stateful mute, ±2% wheel input with endpoint clamping and
no page scroll, a fractional hover preview without seeking, global Space and
±5-second arrows across button/range focus, source-edge clamping, and text/native
video protection. Responsive fixtures include 375-pixel width and 375-pixel
short-window video layouts. A real video containing-block bug and inherited
phone/footer styles were corrected; overlays no longer block source fallback.

The actual private Tailnet browser decoded the real six-stem FLAC chunks,
played and looped source 28–32 across the first chunk boundary, toggled mute/solo,
paused with focused buttons, and stopped at source 277.88. A separate task-owned
browser tab verified the polished current-state mute icon, focused Space/arrow
controls and wheel gain (100%→98%). Console had no warnings/errors. The user tab
was preserved; the temporary tab was closed. The normal viewport was restored
after responsive review. A 416-pixel actual in-app render and 375-pixel synthetic
fixtures are distinct from physical phone acceptance.

Private build verifies 14 original/reference audio receipts and one full stem
set. Archive path validation verifies all 22 takes. Public build inspection
confirms null reference audio and no downloaded originals, stems or private DB.
Existing durable service com.owen.vgm-music-preview remains on 127.0.0.1:8851;
/vgm-preview reuses the idempotent Tailnet route. Live CSS matches private build.
No unrelated Serve handlers or public-main state were changed.

## Remaining acceptance and deferred scope

Owen must judge full-song instrument bleed/artifacts, loop sound and UI feel.
Physical phone audio/memory/keyboard behavior remains unverified. User-entered
source-time chords/notes ship; bars/staff notation, automatic musical analysis,
friend accounts/permissions and annotation alignment onto cover takes do not.
The feature branch and draft PR remain separate from public main. The initial
GitHub run exposed a missing FFmpeg dependency on the Ubuntu runner; the check
workflow now installs the synthetic-media encoder before running the suite,
and the fixture reports spawn errors without masking them with a TypeError.

## Speed and library increment

Original pitch is the confirmed requirement. The transport has a 0.5–2× speed
control with 0.1× audio wheel/keyboard steps, 1×/last-speed click toggle and
bracket/backslash shortcuts. Native audio preserves pitch; stems share one
SoundTouchJS processor after the synchronized mix. Video steps through
provider-supported rates and displays only the confirmed rate. Manual take
thumbnail/Play now opens Video when present; paused source links remain paused.

Songs/Repertoire lists are capped at 1,160 pixels without constraining the
practice timeline. Sticky take headers include sourced session name/location.
Footage thumbnails remain primary; smaller original artwork links to the song.
The secondary art is hidden on narrow screens to preserve take-title space.

Actual Chrome processor probes held a 440 Hz input at the 439.45 Hz Fourier
analysis bin for 0.5, 0.8, 1, 1.2 and 2×. Suspended creation/reset, 0.25-second
loops at 0.5/2×, end drain, Pause during drain and destroy during context closure
passed without processor errors. Non-1× adds 200 ms processing preroll; 1×
bypasses processing. These probes support pitch/lifecycle correctness, not
subjective music quality or physical-phone CPU suitability.

A separate real Tailnet tab played the six full-song FLAC stems at 0.8×,
retained mute/solo through speed toggles, looped original seconds 28–32 across
the chunk boundary, and kept paused intent while toggling 1×/0.8×. It also
played the real Yoshi Circuit take from its footage thumbnail in Video, showed
confirmed 0.75× for the requested 0.8×, and stepped to 1×. No console warnings
or errors were observed. User-owned tab state was preserved.

The later karaoke pitch changer is documented as deferred: whole semitones for
pitched stems, percussion unchanged by default, reviewed classification for
mixed Other material. No pitch changer ships in this increment.

Final local complete check exited 0 with strict TypeScript, 88 domain/store/
engine/helper tests, one React lifecycle test, 68 Chrome browser scenarios and
production build; zero failures/skips. New browser cases cover native preserved
pitch/rate, wheel and shortcuts, remembered-speed toggling, provider-owned
Video rate changes, actual FLAC/worklet loops, paused source clocks, retained
mixes, thumbnail Video playback, delayed catalog session context, wide song
list bounds and narrow/short layouts. Superseded engine reset failures and
retired processor errors/timeouts have focused positive/negative regressions;
current failures remain visible. The CI duration assertion now checks the
measured provider duration within tolerance, allowing the encoded container's
small tail instead of demanding a literal six-second string.
