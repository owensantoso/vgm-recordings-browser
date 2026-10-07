# Practice visual correction — 8 October 2026

Owen rejected two visible behaviors: boosted instruments became lighter, and
shrinking title/artwork preserved the full sticky area. The previous fixed
header geometry was an agent assumption and is superseded by this correction.

The existing SongPage header remains the sole identity owner. Above 96 pixels
of main-pane scroll it uses smaller real artwork, title, gaps and tab spacing;
below 24 pixels it restores the expanded layout. Separate thresholds prevent
its own height adjustment from flipping the layout repeatedly. No placeholder
reserves the released height, no media owner remounts, and tab focus remains.
The compact layout changes immediately; reduced-motion users get the same
smaller area without a motion-only substitute.

Waveform ink uses one continuous scale across effective gain 0–200%:
`opacity = .18 + .82 * gain / 2`. Its fixed darker green does not lighten above
100%. Effective mute/solo still yields zero, stored gains remain intact, and
labels/sliders stay fully readable. Only waveform graphics change intensity.

Verification: `npm run typecheck` passed. `node --test
tests/practice-visuals.browser.mjs` passed with real headless Chrome at 1440 ×900,
375 ×812, and 1280 ×800 with reduced motion. Each ordinary title shrank from
141 to 105.5 CSS pixels, exposing another 35.5 pixels of timeline. The test also
covers a long phone title, upward/rapid reversal, threshold stability, focus
and node identity, image-failure fallback, no horizontal overflow, console
errors, monotonic 20/50/100/150/200% feedback, mute/solo and saved-gain retention.
Font readiness is awaited before geometry measurements.

Task-local screenshots and the measured receipt are under
`.test-artifacts/practice-visuals/`. Desktop and phone compact screenshots and
200% gain screenshots were visually inspected. This synthetic-media evidence
does not claim deployed or physical-phone acceptance; root integration owns
private-preview delivery and live source review.
