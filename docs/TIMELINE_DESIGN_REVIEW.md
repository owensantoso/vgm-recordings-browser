# Independent timeline review — 8 October 2026

Object of study: the practice workspace corrections and direct timeline jam /
comment interaction. This is a bounded independent pre-implementation review;
rendered acceptance and microphone timing remain separate checks.

Reviewed `DESIGN.md`, `JAMS.md`, `JAM_DESIGN_PROPOSAL.md`, current
`PracticeWorkspace`, `JamLibrary`, `JamRecorder`, `jamData`, and the worker's
proposed seam. The maintained Visual Design Director and current preference
profile informed the critique. Primary purpose: Operate—practice a passage and
discuss that same audible event without leaving the score.

## Direction and material gates

The chosen direction fits the task: one continuous gain intensity scale, an
actually shorter sticky identity region, one aligned Jams lane, and composition
at the selected timeline point. A permanent right rail is not required by Owen's
tentative pane suggestion. A desktop composer beside the score and a nearby
mobile composer are appropriate if they preserve timeline access.

| Finding | Classification | Required response / verification |
| --- | --- | --- |
| Increasing gain above 100% made a light surface look faded | Confirmed implementation/taste defect | Use one monotonic darker/saturated scale from 0–200%; numeric percent and speaker state remain readable and authoritative. Check 0/20/50/100/150/200, mute and solo |
| Smaller artwork/title retained the old sticky height | Confirmed implementation defect | Measure actual sticky region height before/after scroll; it must release vertical space and leave the timeline accessible. Check long title, phone, text zoom and reduced motion |
| Comments are detached below editors | Confirmed task-flow defect | Timeline selection opens the composer beside the score desktop / directly attached mobile, focuses editable text, retains selected anchor and shows saved confirmation there |
| Drag/hover alone excludes keyboard and touch | Material accessibility risk | Visible Comment mode plus Add comment at playhead/range and labeled editable start/end fields; no context-menu-only gesture |
| Same song does not imply same recording or clock | Material identity risk | Name recording + Original/Mic clock + optional instrument in the composer before submission; never silently retarget after source navigation |
| One Jams row can visually imply every jam is time-aligned | Material data risk | Only the same exact backing source/hash and valid alignment enter the row; overlapping clips stack. Free/other-version jams remain discoverable in the existing list |

## Interaction contract reviewed with timeline worker

Normal timeline clicking remains seek. A labeled pressed Comment mode changes
click to point-comment selection and drag to range selection; explanatory hint
stays beside the mode. A keyboard user can anchor at the playhead without dragging
and edit seconds in the nearby form. Global left/right transport shortcuts must
not acquire an ambiguous second selection meaning; native text/number input
editing retains normal keys. Mobile must not require hover or drag to start.

Comment selection does not play or stop a second source. Source/instrument
gestures target the exact active reference/audio hash; jam gestures target the
mic recording/hash. A jam block opened in normal mode can select the jam paused;
an explicit playback control starts it. Free song/source comments remain possible
without inventing a timed anchor or instrument.

Existing comment markers must be focusable, named and distinguish point from
range. Selecting a marker reveals its content locally rather than navigating to
a page-bottom form. Instrument filtering cannot erase comments from the song;
at most it changes which marks are relevant to the current lane.

## Corrected alignment geometry

For a source coordinate `s`, jam mic coordinate is
`m = (s - sourceAtCaptureZero) / sourceSecondsPerCaptureSecond + correctionSeconds`.
The reverse is `s = sourceAtCaptureZero + (m - correctionSeconds) * rate`.
Use the saved fixed rate, not the current audition rate. Both the stored mic
coverage and stored source coverage bound a valid projection after correction.
Intersect those constraints and source duration before drawing or accepting a
pick; empty projections disappear from this timeline but retain mic-only access.
Do not turn the entire raw mic file, lead-in or encoder tail into an aligned clip.
Source-time selection on a jam must store the converted mic-clock target; never
store its source seconds under a jam audio hash. Range conversion follows the
same rule and preserves ascending endpoints.

## Alternatives and decision

A generic page-level comments panel would reuse less interaction code, but keeps
the disconnection Owen explicitly rejected. A forced always-open right pane
reduces useful width and mobile coherence without evidence it is preferred.
Adapt the existing persisted comments contract with a nearby composer and one
source-owned timeline overlay. No new schema or layout framework is justified.

## Verification packet

- Normal seek still works with mode off; Comment mode is visible and touch/
  keyboard can select playhead/range without dragging.
- Post a Piano point and a source range; save/reload markers and instrument scope.
- At 0.8× with nonzero correction, click an overlapping jam span and confirm
  Mic time stored versus Original time projected; out-of-coverage picks rejected.
- Free jam and another reference/hash do not appear falsely aligned; existing
  list and mic-only playback remain available.
- Navigation cannot silently retarget an unsaved comment; unavailable storage
  leaves text and anchor retryable.
- At 375 / 768 / 1440 widths, composer and sticky header permit timeline viewing;
  no page-wide overflow, trapped focus or waveform-label contrast loss.

Receipt: bounded material findings delivered to root and implementation worker
before major implementation. Verdict: direction supported with the above
identity, geometry and accessible activation gates; rendered result pending.
