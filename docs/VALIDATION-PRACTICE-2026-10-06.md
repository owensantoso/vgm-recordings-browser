# Audio/practice candidate validation — 6 October 2026

`CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run check`
passed after the final source fixes: strict TypeScript; 30 domain/catalog/practice
tests; one React lifecycle test; 52 real-Chrome browser scenarios; production
catalog/build. Zero failed or skipped tests. Browser scenarios use generated
WAV/AAC/WebM and a fake YouTube API backed by actual native media decoding.

The new 16 scenarios cover private original audio, paused/playing Audio/Video
handoff, paused practice entry, exact source/range ownership, repeat through
browsing and empty search, same-source Play, source-change range cleanup and Back,
A/B drafts/Apply/default, semantic copy and denied-clipboard fallback, missing
assets, quarter-second bounds/restart, local-audio-only repeat, short-screen
control nonoverlap, original retention during delayed CSV loading, controlled
native ended handling, and ten rapid full-source wraps plus explicit Pause.

Fixed findings include stale practice parameters on search clear, audio's old
400 ms video-seek grace, stale manual-copy URL, unavailable audio allowing Repeat,
slider step rounding a 0.25-second range, quick Repeat overlapping phone mode
controls, needless original provider replacement on CSV hydration, and the
native-end/polling race. Explicit Pause clears intent synchronously; stale queued
native events check actual media state. The React test now excludes Repeat when
selecting the inactive playback mode.

Real media evidence: all 14 listening links downloaded without cookies/account
access; FFmpeg fully decoded each M4A; bytes, duration and SHA-256 retained in the
ignored receipt. Total 48,747,455 bytes. Private build verified 14 associations;
deployed private catalog and 14 byte-range responses passed. Public catalog has
null reference audio fields; ignored sources/receipt/private-dist remain outside
Git. All 22 archive media paths verified. Interface foundations adoption and the
11 declared continuity mappings validate (declared coverage, not certification).

Real private IAB playback: Beneath the Mask original audio played, retained the
58–66-second range while opening Sessions, continued inside the range beyond one
range duration and remained paused after Pause. No IAB warning/error console
messages. Phone-sized Chrome controls verified nonoverlap; current app geometry
fits. Older captured Chrome logs contain YouTube-related extension timeouts;
those are not application exceptions or evidence of this audio path failing.
Temporary Chrome viewport override reset.

Actual Opus 5.5 design review and GPT-6 Astra architecture review informed the
candidate. Original-first Verse/Chorus/Pre-chorus is confirmed product priority;
no named musical sections or bar/chord data have been fabricated. No separated
stems, Logic processing, hosted upload, model download or quality audition occurred.

Private delivery remains the retained worktree's durable LaunchAgent on port
8851 under the existing `/vgm-preview/` Tailnet route. Public main/GitHub Pages
remain unchanged; PR #2 stays draft. Final current-head CI evidence is recorded
in the task handoff after publication.

Limits: tests do not establish gapless/sample-accurate looping, audible musical
seam quality, physical iPhone/keyboard/safe-area behavior, YouTube reliability in
all regions, or human design acceptance. The exact native-end handler test holds
progress polling until a true ended event; normal ordering is separately covered
by fast-wrap stress. Original audio is available only on the private deployment.
