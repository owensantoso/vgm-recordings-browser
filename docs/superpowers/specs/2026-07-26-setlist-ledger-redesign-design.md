# Setlist Ledger Archive Redesign

## Goal

Refresh the static recording archive so it feels like a purposeful rehearsal log rather than a generic card dashboard. Preserve the current compact browsing, playback, download, filtering, and deep-link workflows.

## Visual Direction

Use the approved "Setlist Ledger" direction:

- One continuous, near-white archive surface with ruled row rhythm.
- Editorial hierarchy using a serif display face, a plain system sans-serif for content, and monospace for dates, durations, file identifiers, and labels.
- Dark ink session bands, muted red take numbers and playback accents, and restrained teal selection/progress accents.
- Thumbnails are compact supporting markers on desktop and slightly larger on mobile.
- Avoid stacked cards, pill-heavy controls, gradients, ornamental textures, large shadows, and decorative animation.

Core color tokens:

- Ink: `#202624`
- Surface: `#fbfaf6`
- Page: `#f2f3ef`
- Rule: `#d8d7cf`
- Muted text: `#6f7672`
- Playback red: `#a53d34`
- Selection teal: `#197d73`

The visual style must maintain WCAG AA contrast for normal text. Focus indicators remain visible. Motion is limited to short state transitions and respects `prefers-reduced-motion`.

## Information Architecture

### Header

The header presents:

- `Music Jam Sessions` as the primary archive title.
- A small `Recording archive / 2026` label.
- A compact aggregate line for total takes and duration.
- The CSV export as a quiet utility action.

The current standalone summary card is removed. Its values are incorporated into the header and selected-session band.

### Filters

The caption filter is removed.

The remaining controls are:

- Search
- Session
- Media
- Sort

Desktop renders these in one ruled toolbar. Mobile places Search across the available width and keeps Session, Media, and Sort in a compact responsive row. Controls retain visible labels and at least 44px touch targets on mobile.

### Session Band

When a session is selected, a dark full-width band shows:

- Session date and label
- Visible recording count and duration
- Drive folder link
- YouTube playlist link

All Sessions uses a quieter archive-wide band without session resource links.

### Recording List

Desktop keeps a dense table-like list. Each row includes:

- Sequential display number within the current visible result
- Thumbnail
- Caption and source filename
- Song, franchise, and game
- Performer/instrument badges
- Duration and media availability

Selected and hover states use color blocking rather than shadows. Song and game labels remain clickable search filters.

Mobile uses full-width ledger rows instead of cards. Each row has a larger thumbnail, take number, song, game, duration, and compact performer information. Row height and thumbnail dimensions remain stable during loading.

Multi-select replaces the normal list heading with a single compact selection toolbar. Existing Select All Shown and download behavior remain unchanged.

## Selected Recording And Player

### Desktop

Preserve the two-pane workflow:

- Ledger list on the left
- Selected-take inspection pane on the right

The panes are separated by a rule and shared surface rather than appearing as independent cards. The inspection pane contains the existing video/audio modes, synchronized seek controls, embedded video or audio state, metadata, and link actions.

### Mobile

Selecting a recording reveals a persistent bottom player. Its collapsed state contains:

- Play/pause icon
- Song title
- Current and total time
- Seek bar
- Current Video or Audio mode
- Expand icon

Expanded state reveals the media preview, relevant/full seek bars, metadata, and actions. Minimize returns to the compact player without dismissing the selection. Existing playback position and playing/paused state survive switching between Video and Audio.

All existing keyboard controls remain:

- Space toggles play/pause outside editable controls.
- Left and Right Arrow seek five seconds.

## Session URL Contract

Session state is stored in the `session` query parameter:

```text
?session=2026-07-26-shimokitazawa-vgm-session
```

The existing recording hash remains:

```text
?session=2026-07-26-shimokitazawa-vgm-session#IMG_5944
```

Behavior:

- Initial load restores a valid session parameter before filtering rows.
- Selecting a session updates the query parameter while preserving the recording hash.
- Selecting All Sessions removes only the session parameter.
- Selecting a recording updates only the hash and preserves the session parameter.
- Copy Page Link includes both states.
- An unknown session ID falls back to All Sessions and removes the invalid parameter.
- Browser navigation and hash changes restore the corresponding visible session and recording.

## Responsive Behavior

Required verification widths:

- 375px mobile
- 768px tablet
- 1024px compact desktop
- 1440px wide desktop

There must be no horizontal page scrolling, overlapping text, hidden player controls, or content obscured by the mobile safe area. The persistent mobile player reserves enough body padding that the final recording remains reachable.

From 861px through 1199px, the inspection pane uses a 360px column. At 1200px and above, it can grow to 480px. At 860px and below, it becomes the persistent bottom player and expanded sheet.

## Implementation Scope

Expected files:

- `index.html`: remove caption filter and adjust semantic structure for the archive header, session band, and utility actions.
- `styles.css`: replace card-heavy presentation with the approved ledger design and responsive states.
- `app.js`: remove caption-filter logic, add session URL state, update summary/session rendering, and add any display-only row numbering required by the ledger.

The CSV schema, media files, YouTube integration, Drive links, playlist links, playback engines, seek logic, multi-select behavior, and download behavior remain unchanged.

## Verification

Automated/static checks:

- `node --check app.js`
- `git diff --check`
- CSV still loads all 22 records.
- No code references the removed caption filter.
- Session query parsing covers valid, missing, `all`, and invalid values.
- URL updates preserve the recording hash.

Browser checks:

- Both sessions restore correctly from a shared URL.
- May shows 13 recordings; July shows 9.
- Drive and YouTube session links are correct.
- Search, Media, Session, and Sort controls still filter correctly.
- Selecting a recording autoplays according to existing behavior.
- Video/audio switching preserves playback position and playing state.
- Mobile compact and expanded player states work.
- Multi-select, Select All Shown, and download links remain functional.
- Space and arrow keyboard controls remain functional.
- Layout and thumbnail loading are checked at all four required widths.

## Acceptance Criteria

- The archive clearly reads as a rehearsal ledger with restrained game-music personality.
- The primary archive view no longer looks like stacked cards.
- Session selection is shareable and restorable through the URL.
- The caption filter is gone.
- No existing media, download, filtering, selection, or playback behavior regresses.
