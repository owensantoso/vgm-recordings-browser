# Setlist Ledger Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the recording archive as the approved responsive Setlist Ledger, remove caption filtering, and make the selected session shareable through the URL.

**Architecture:** Preserve the current dependency-free static HTML/CSS/JavaScript application and its CSV-backed media model. Limit behavioral changes to session query-state ownership and display-only list numbering; preserve the existing playback, selection, download, Drive, and YouTube code paths.

**Tech Stack:** Semantic HTML5, vanilla CSS, vanilla browser JavaScript, Papa Parse-compatible CSV parsing, YouTube IFrame API, GitHub Pages.

---

### Task 1: Session URL State And Filter Cleanup

**Files:**
- Modify: `index.html`
- Modify: `app.js`

- [ ] **Step 1: Remove the caption control and element reference**

Delete the `#caption-filter` label from `index.html`, remove `captionFilter` from `els`, and remove it from the filter event registration.

The final listener list must be:

```js
[els.search, els.mediaFilter, els.sessionFilter, els.sort].forEach((input) => {
  input.addEventListener("input", applyFilters);
});
```

- [ ] **Step 2: Remove caption-filter matching without removing caption metadata**

Delete the `caption` local and `matchesCaption` branch from `applyFilters()`. Keep `hasMissingCaption()` because media tags still identify recordings without captions.

The filter return must become:

```js
const matchesSession = session === "all" || row.session_id === session;
return matchesQuery && matchesMedia && matchesSession;
```

- [ ] **Step 3: Add session query helpers**

Add these helpers alongside the existing hash helpers:

```js
function sessionFromUrl() {
  return new URL(window.location.href).searchParams.get("session") || "all";
}

function setUrlForSession(sessionId) {
  const url = new URL(window.location.href);
  if (!sessionId || sessionId === "all") url.searchParams.delete("session");
  else url.searchParams.set("session", sessionId);
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function restoreSessionFromUrl() {
  const requested = sessionFromUrl();
  const valid = [...els.sessionFilter.options].some((option) => option.value === requested);
  els.sessionFilter.value = valid ? requested : "all";
  if (!valid) setUrlForSession("all");
}
```

- [ ] **Step 4: Preserve the query string when setting a recording hash**

Replace `setUrlForFile()` with URL-object mutation:

```js
function setUrlForFile(file) {
  const url = new URL(window.location.href);
  url.hash = hashForFile(file);
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
```

`pageLinkForFile()` already starts from `window.location.href`, so it will include both query and hash.

- [ ] **Step 5: Restore and update session state**

After `populateSessionFilter()` in the CSV load path, call `restoreSessionFromUrl()` before `applyFilters()`.

Use a dedicated Session listener so URL state changes before filtering:

```js
els.sessionFilter.addEventListener("input", () => {
  setUrlForSession(els.sessionFilter.value);
  applyFilters();
});
```

Register the other controls separately:

```js
[els.search, els.mediaFilter, els.sort].forEach((input) => {
  input.addEventListener("input", applyFilters);
});
```

Add browser navigation restoration:

```js
window.addEventListener("popstate", () => {
  restoreSessionFromUrl();
  applyFilters();
});
```

- [ ] **Step 6: Verify URL behavior**

Run:

```bash
node --check app.js
rg -n "captionFilter|caption-filter|matchesCaption" app.js index.html
```

Expected:

- JavaScript syntax passes.
- `rg` returns no matches.
- A URL with a valid session restores that session.
- An invalid session falls back to All Sessions.
- Selecting a recording preserves `?session=...`.

- [ ] **Step 7: Commit behavioral changes**

```bash
git add app.js index.html
git commit -m "feat(filters): persist session selection in URL"
```

### Task 2: Ledger Markup And Rendering

**Files:**
- Modify: `index.html`
- Modify: `app.js`

- [ ] **Step 1: Restructure the archive header**

Replace the current heading block with:

```html
<div>
  <p class="archive-kicker">Recording archive · 2026</p>
  <h1>Music Jam Sessions</h1>
  <p class="subhead">Rehearsal videos, audio extracts, and session notes</p>
</div>
<div class="archive-utility">
  <p><strong id="archive-count">0</strong> takes · <strong id="archive-duration">0:00</strong></p>
  <a class="csv-link" href="data/recordings.csv">CSV export</a>
</div>
```

Add `archiveCount` and `archiveDuration` element references and populate them from all rows once CSV loading completes.

- [ ] **Step 2: Merge controls and session summary into continuous bands**

Keep Search as the first control and render Media, Session, and Sort in a three-column `.control-row`. Replace the tag-style session row with:

```html
<div class="session-row">
  <div>
    <span class="session-date" id="session-date">Archive index</span>
    <strong id="session-label">All sessions</strong>
  </div>
  <span id="session-stats" class="session-stats"></span>
  <nav class="session-links" aria-label="Session resources">
    <a id="session-drive" href="#" target="_blank" rel="noopener" hidden>Drive folder</a>
    <a id="session-playlist" href="#" target="_blank" rel="noopener" hidden>YouTube playlist</a>
  </nav>
</div>
```

Move the existing summary values into `sessionStats` and delete the standalone `.summary` section.

- [ ] **Step 3: Add take numbering to desktop rows**

Change the list mapping to receive an index:

```js
state.visible.map((row, index) => {
  const takeNumber = String(state.visible.length - index).padStart(2, "0");
  return `...`;
});
```

Add a `.take-number` cell before the thumbnail/file cell. Keep selection checkboxes in their own conditional column so selection mode remains accessible.

- [ ] **Step 4: Convert mobile cards into ledger rows**

Keep semantic `<article>` elements, but render this information order:

```html
<span class="take-number">09</span>
<img class="card-thumb" ...>
<div class="card-main">
  <strong>Yoshi Circuit</strong>
  <span class="duration">6:42</span>
</div>
<span class="recording-source">Mario Kart: Double Dash!! · IMG_5944</span>
<div class="recording-players">...</div>
```

Retain the existing selection checkbox, song filter buttons, media tags, and audio-player action in the DOM.

- [ ] **Step 5: Replace emoji instrument glyphs with inline icon shapes**

Keep the accessible labels and player initials. Render instrument-specific CSS classes:

```js
const instruments = [
  ["drums", "Drums", row.drums],
  ["piano", "Piano", row.piano],
  ["guitar", "Guitar", row.guitar],
  ["bass", "Bass", row.bass],
];
```

Each badge uses:

```html
<span class="instrument-badge instrument-drums" title="Drums: Jonathan" aria-label="Drums: Jonathan">
  <span class="instrument-icon" aria-hidden="true"></span>
  <span class="player-initial">J</span>
</span>
```

Use CSS icon shapes or existing familiar symbols, not emoji or D/P/G/B instrument labels.

- [ ] **Step 6: Update session rendering**

In `renderSummary()`, set:

```js
els.sessionStats.textContent =
  `${state.visible.length} ${state.visible.length === 1 ? "take" : "takes"} · ${formatTotal(totalDuration)}`;
els.sessionDate.textContent = sessionRow
  ? formatSessionDate(sessionRow.recorded_create_date)
  : "Archive index";
```

Add a deterministic date formatter based on `YYYY-MM-DD` source text without locale-dependent parsing.

- [ ] **Step 7: Verify rendering and commit**

Run:

```bash
node --check app.js
git diff --check
```

Open the local site and verify 22 archive rows, 13 May rows, and 9 July rows.

Commit:

```bash
git add app.js index.html
git commit -m "feat(archive): restructure recordings as a ledger"
```

### Task 3: Setlist Ledger Visual System

**Files:**
- Modify: `styles.css`
- Modify: `index.html`

- [ ] **Step 1: Replace global visual tokens**

Use:

```css
:root {
  color-scheme: light;
  --page: #f2f3ef;
  --paper: #fbfaf6;
  --ink: #202624;
  --muted: #6f7672;
  --rule: #d8d7cf;
  --rule-strong: #aeb3b0;
  --playback: #a53d34;
  --selection: #197d73;
  --selection-soft: #e1efec;
  --warning: #8a5a00;
}
```

Use system font stacks:

```css
--font-display: Georgia, "Times New Roman", serif;
--font-body: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-data: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
```

- [ ] **Step 2: Remove card presentation**

Remove panel shadows, rounded section containers, pill-heavy badges, and inter-section gaps. The main archive becomes one bordered `.archive-shell` or visually continuous group:

```css
.controls,
.list-wrap,
.detail {
  background: var(--paper);
  border-color: var(--rule);
  border-radius: 0;
  box-shadow: none;
}
```

Use borders and color blocking for hierarchy.

- [ ] **Step 3: Style desktop ledger and inspection pane**

Desktop requirements:

- 861–1199px: right pane 360px.
- 1200px+: right pane grows to at most 480px.
- 60px thumbnail width with fixed `aspect-ratio: 16 / 10`.
- Teal selected-row inset rule.
- Red serif take numbers.
- Dark full-width session band.
- Plain metadata definition rows without nested cards.

- [ ] **Step 4: Style the shared player**

Use a red square play/pause control, teal seek progress, stable tabular time labels, and underline/color-block Video/Audio modes. Keep the existing range-input thumb size large enough for touch.

The desktop inspection pane remains sticky. On mobile the detail panel remains fixed at the bottom, but remove the floating-card shadow and large rounded top corners.

- [ ] **Step 5: Style mobile ledger rows**

At `max-width: 860px`:

- Hide desktop table and show `.card-list`.
- Use 76px thumbnails.
- Use full-width rows separated by rules.
- Keep row text within the viewport using `min-width: 0`, ellipsis, and two-line clamping where needed.
- Reserve bottom padding for the compact player plus `env(safe-area-inset-bottom)`.
- Expanded player height is capped at `82dvh`.
- All interactive controls are at least 44px on their shortest axis.

- [ ] **Step 6: Add accessibility and motion rules**

Add:

```css
:focus-visible {
  outline: 2px solid var(--selection);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

Do not remove focus outlines elsewhere.

- [ ] **Step 7: Cache-bust updated assets and commit**

Update stylesheet and script query versions in `index.html`.

Run:

```bash
git diff --check
```

Commit:

```bash
git add styles.css index.html
git commit -m "style(archive): apply setlist ledger design"
```

### Task 4: Functional And Responsive Verification

**Files:**
- Modify only if verification exposes a defect: `app.js`, `index.html`, `styles.css`

- [ ] **Step 1: Run static checks**

```bash
node --check app.js
git diff --check
ruby -rcsv -e 't=CSV.read("data/recordings.csv", headers:true); abort unless t.size==22; puts t.size'
```

Expected: syntax passes, no whitespace errors, and `22`.

- [ ] **Step 2: Start the local server**

```bash
python3 -m http.server 8097
```

- [ ] **Step 3: Verify URL and filtering**

Check:

- `/?session=2026-05-31-shimokitazawa-first-vgm-session` shows 13.
- `/?session=2026-07-26-shimokitazawa-vgm-session` shows 9.
- Invalid session IDs resolve to All Sessions.
- Selecting All Sessions removes `session`.
- Selecting a recording preserves the session query and adds its hash.
- Search, Media, and Sort remain functional.

- [ ] **Step 4: Verify player and selection workflows**

Check:

- Selecting a video autoplays its YouTube embed.
- Selecting the audio-only recording autoplays audio and disables Video.
- Video/Audio switching preserves position and play/pause state.
- Space toggles playback.
- Left/Right Arrow seek five seconds.
- Same-row selection does not reload the player.
- Multi-select and Select All Shown work after filtering.

- [ ] **Step 5: Verify responsive presentation**

At 375, 768, 1024, and 1440px:

- No horizontal page overflow.
- No text or controls overlap.
- Thumbnails load at stable dimensions.
- Session links remain visible when applicable.
- Mobile compact player does not cover the final row.
- Expanded player remains usable and scrollable.
- Desktop inspection pane remains visible and correctly sized.

- [ ] **Step 6: Run a final diff review**

```bash
git status --short
git diff --check
git log -4 --oneline
```

Confirm only planned files changed and the worktree is clean after commits.

### Task 5: Publish And Verify GitHub Pages

**Files:**
- No source changes expected.

- [ ] **Step 1: Push the implementation**

```bash
git push origin main
```

- [ ] **Step 2: Wait for Pages**

```bash
gh run list --limit 1
gh run watch <run-id> --exit-status
```

Expected: Pages build and deployment completes successfully.

- [ ] **Step 3: Verify the live site**

Open:

```text
https://owensantoso.github.io/vgm-recordings-browser/
```

Repeat the July session URL, recording selection, player, and 375px mobile checks against production.

- [ ] **Step 4: Confirm clean source state**

```bash
git status --short
```

Expected: no output.
