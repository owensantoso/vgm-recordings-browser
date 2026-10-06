# October 6 candidate validation

Candidate branch: `feat/song-repertoire`, stacked on migration PR #1 at
`4860dd69488d8b04193c96b6a21cd26778877d24`. The original migration and public
main are unchanged. The owner task is `01a110d2-c975-7873-aef2-3094481a921f`.

## Agent verification

- `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run check`
  passed: strict TypeScript; 13 domain/catalog tests; one React lifecycle
  scenario; 26 browser scenarios at 1280 and 375 CSS pixels; zero skips;
  production build and generated catalog.
- `node scripts/check-assets.mjs` verified all 22 takes' media paths.
- Interface Toolbox adoption and ten declared semantic-continuity mappings
  validated. This is scoped contract evidence, not complete range-scanner or
  usability coverage.
- SQL foreign keys, exact CSV/session coverage, deterministic JSON freshness,
  explicit membership, unrecorded songs, independent reference artists and
  rejection of executable reference URLs are exercised.
- Real candidate on the private production subpath exercised song search,
  joined detail, playback through Repertoire navigation, real local audio,
  actual YouTube Play/Pause and paused audio/video handoff.
- Rendered composition inspected at actual 375, 767, 1024 and 1440 CSS pixels.
  Actual viewport and document widths matched; no horizontal overflow was
  observed. 767 was the tablet width obtained through the installed browser's
  viewport/zoom combination, rather than pretending it was exactly 768.
- Root application console errors: none observed. Installed Chrome extensions
  emitted YouTube DOM timeout errors; those are not application exceptions.
- A durable loopback preview and one private Tailnet route were verified. All
  69 pre-existing Serve handlers were preserved; no public Funnel was enabled.

## Review findings resolved

Independent source review identified expanded-player obstruction during song
navigation and a missing committed-catalog freshness gate. Both were corrected.
A real YouTube reload exposed unrequested playback: `seekTo` starts playback
from a cued state. The candidate now cues paused positions, retains cued timing,
and clears play intent before section-stop seeks. The synthetic provider now
models the documented behavior. DOM tests explicitly assert initial pause;
browser coverage exercises paused handoff and stop/replay. Independent review
found no new lifecycle regression; actual provider verification remains separate
from that static finding.

See [Google's seekTo contract](https://developers.google.com/youtube/iframe_api_reference#seekTo).

## Human acceptance remains open

This is an agent-verified private candidate, not a human-accepted design or a
public deployment. The old migration preview still contains the cued-seek bug;
review the combined candidate before integrating both branches.

Physical iPhone keyboard/safe-area behavior, native input composition, actual
Drive downloads and the final GitHub Pages deployment still need evidence.
The detailed migration checklist remains in DESIGN.md. Repertoire ownership
(shared band versus private practice) and its first song membership have not
been confirmed. No private Song Practice Workbench data was imported.

Actual Claude Opus 5.5 independently compared three layout approaches; the
ledger plus rail was selected for this bounded candidate. Its model identity
was verified from provider response metadata, not simulated through a role.
