// Real-browser lifecycle tests. They drive the built app in headless Chrome
// against a synthetic archive (tests/browser/fixture.mjs): generated WAV/WebM
// media, a fake YouTube iframe API backed by a real <video>, and a recorder
// for every Audio element. Screenshots land in .test-artifacts/browser/.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { SESSION_A, SESSION_B, createFixture, initScript } from "./browser/fixture.mjs";

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const name of [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ]) {
    try {
      return execSync(`command -v ${name}`, { stdio: "pipe" })
        .toString()
        .trim();
    } catch {
      /* try the next candidate */
    }
  }
  return "";
}

const executablePath = chromePath();
const artifacts = ".test-artifacts/browser";
const viewports = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
};
let browser, fixture, workdir;

before(async () => {
  if (!executablePath) return;
  await mkdir(artifacts, { recursive: true });
  workdir = await mkdtemp(join(tmpdir(), "vgm-browser-"));
  fixture = await createFixture(workdir);
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
});
after(async () => {
  await browser?.close();
  await fixture?.close();
  if (workdir) await rm(workdir, { recursive: true, force: true });
});

async function open(name, path, options = {}) {
  const context = await browser.newContext({
    viewport: viewports[name],
    hasTouch: name === "mobile",
    isMobile: name === "mobile",
    reducedMotion: options.reducedMotion,
  });
  await context.addInitScript(initScript);
  await context.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: fixture.youtubeApi,
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // Deliberately missing fixture media produce resource 404s; anything else counts.
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource")
    )
      errors.push(message.text());
  });
  page.errors = errors;
  page.shot = (label) =>
    page.screenshot({ path: join(artifacts, `${name}-${label}.png`) });
  await page.goto(`${fixture.origin}${path}`);
  await page.waitForSelector(".recording-row");
  return page;
}
const media = (page) => page.evaluate(() => window.__mediaState());
const live = async (page) => (await media(page)).filter((m) => m.src);
const playing = async (page) =>
  (await media(page)).filter((m) => m.src && !m.paused && !m.ended);
const heading = (page) => page.textContent(".player h2");
const status = (page) => page.textContent(".mode-status");
const waitStatus = (page, text) =>
  page.waitForFunction(
    (expected) => document.querySelector(".mode-status")?.textContent === expected,
    text,
  );
// Waits until exactly one element still holds a source, of the given kind,
// with the requested play state. Status text alone can lag a mode switch.
const waitLive = (page, kind, playing) =>
  page.waitForFunction(
    ([kind, playing]) => {
      const live = window.__mediaState().filter((m) => m.src);
      return (
        live.length === 1 &&
        live[0].kind === kind &&
        live[0].ready &&
        (playing === undefined || (!live[0].paused && !live[0].ended) === playing)
      );
    },
    [kind, playing],
  );
const rowButton = (page, caption) =>
  page.locator(".recording-title", { hasText: caption });
const assertOnlyLive = async (page, kind, sourceFragment) => {
  const sources = await live(page);
  assert.equal(sources.length, 1, JSON.stringify(sources));
  assert.equal(sources[0].kind, kind);
  assert.ok(
    sources[0].src.includes(sourceFragment),
    `${sources[0].src} should reference ${sourceFragment}`,
  );
};
const filterBySong = async (page, value) => {
  await page.fill("input[type=search]", value);
};

for (const name of Object.keys(viewports)) {
  test(`${name}: expanding after scrolling keeps the player heading and controls visible`, { skip: !executablePath }, async () => {
    const page = await open(name, '/');
    try {
      await page.evaluate(() => {
        for (const list of document.querySelectorAll('.recording-list')) {
          for (let i = 0; i < 25; i++) list.append(list.firstElementChild.cloneNode(true));
        }
        window.scrollTo(0, 600);
      });
      const previousScroll = await page.evaluate(() => window.scrollY);
      assert.ok(previousScroll > 400);
      await page.click('.expand-control');
      const visible = () => page.waitForFunction(() => {
        const heading = document.querySelector('.player-heading').getBoundingClientRect();
        const button = document.querySelector('.expand-control').getBoundingClientRect();
        const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
        const fixed = getComputedStyle(document.querySelector('.player')).position === 'fixed';
        return heading.top >= (fixed ? 0 : toolbar.bottom) && button.bottom <= innerHeight;
      }, null, { timeout: 1500 });
      await visible();
      assert.equal(await page.getAttribute('.expand-control', 'aria-expanded'), 'true');
      if (name === 'mobile') assert.equal(await page.evaluate(() => window.scrollY), previousScroll, 'mobile expansion preserves archive scroll');
      await page.shot('scrolled-expansion');
      for (const viewport of name === 'desktop' ? [viewports.mobile, viewports.desktop] : [viewports.desktop, viewports.mobile]) {
        await page.setViewportSize(viewport);
        await visible();
        // Native scroll anchoring may change the offset across layouts.
        assert.equal(await page.locator('.expand-control').evaluate(el => el === document.activeElement), true);
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.getAttribute('.expand-control', 'aria-expanded'), 'false');
      assert.equal(await page.locator('.expand-control').evaluate(el => el === document.activeElement), true);
      assert.equal(page.errors.length, 0, page.errors.join('\n'));
    } finally { await page.context().close(); }
  });
  test(`${name}: session jumps stay below filters and sort headings share the grouped ordering`, { skip: !executablePath }, async () => {
    const page = await open(name, '/');
    try {
      await page.evaluate(() => {
        for (const list of document.querySelectorAll('.recording-list')) {
          for (let i = 0; i < 15; i++) list.append(list.firstElementChild.cloneNode(true));
        }
      });
      await page.getByRole('navigation', { name: 'Jump to session' }).getByRole('button', { name: '31 May 2026' }).click();
      await page.waitForFunction((id) => {
        const band = document.getElementById(`heading-${id}`).closest('.session-band').getBoundingClientRect();
        const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
        return Math.abs(band.top - toolbar.bottom) < 1;
      }, SESSION_A, { timeout: 1500 });
      // Reload removes DOM-only layout stress before testing actual React order.
      await page.reload();
      await page.waitForSelector('.recording-row');
      const first = page.locator('.ledger-headings').first();
      await first.getByRole('button', { name: /Sort by Recording/ }).click();
      const titles = await page.locator('.session-group').evaluateAll(groups => groups.map(group => [...group.querySelectorAll('.recording-title')].map(el => el.textContent)));
      assert.deepEqual(titles, [['Delta missing audio', 'Echo broken video'], ['Alpha section take', 'Bravo full take', 'Charlie short audio']]);
      assert.equal(await page.locator('.ledger-headings button[aria-pressed="true"]').count(), 2);
      assert.equal(page.errors.length, 0, page.errors.join('\n'));
    } finally { await page.context().close(); }
  });
  test(`${name}: player shortcuts leave composition and consumed events alone`, { skip: !executablePath }, async () => {
    const page = await open(name, `/?session=${SESSION_A}`);
    try {
      await waitStatus(page, 'Paused');
      for (const key of [' ', 'ArrowLeft', 'ArrowRight']) {
        for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
          const consumed = await page.evaluate(({ key, options }) => {
            document.activeElement.blur();
            const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
            document.body.dispatchEvent(event);
            return event.defaultPrevented;
          }, { key, options });
          assert.equal(consumed, false, `${key}: ${JSON.stringify(options)}`);
        }
      }
      await page.evaluate(() => {
        const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        event.preventDefault();
        document.body.dispatchEvent(event);
      });
      assert.equal(await status(page), 'Paused', 'a consumed Space does not start playback');
      await page.click('.expand-control');
      for (const options of [{ isComposing: true }, { keyCode: 229 }, { consumed: true }]) {
        await page.evaluate((options) => {
          const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...options });
          if (options.consumed) event.preventDefault();
          document.body.dispatchEvent(event);
        }, options);
        assert.equal(await page.getAttribute('.expand-control', 'aria-expanded'), 'true');
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.getAttribute('.expand-control', 'aria-expanded'), 'false');
    } finally { await page.context().close(); }
  });
  test(`${name}: sort headings preserve direction and take numbers`, { skip: !executablePath }, async () => {
    const page = await open(name, `/?session=${SESSION_A}`);
    try {
      assert.equal(await page.locator('.sort-label select').count(), 0);
      const controls = page.locator('.ledger-headings');
      assert.equal(await controls.count(), 1);
      const takes = () => page.locator('.take-number').allTextContents();
      assert.deepEqual(await takes(), ['03', '02', '01']);
      await controls.getByRole('button', { name: /Sort by Take/ }).click();
      assert.deepEqual(await takes(), ['01', '02', '03']);
      await controls.getByRole('button', { name: /Sort by Recording/ }).click();
      assert.deepEqual(await page.locator('.recording-title').allTextContents(), ['Alpha section take', 'Bravo full take', 'Charlie short audio']);
      await controls.getByRole('button', { name: /Sort by Recording/ }).click();
      assert.deepEqual(await takes(), ['03', '02', '01']);
      await controls.getByRole('button', { name: /Sort by Time/ }).click();
      assert.deepEqual(await takes(), ['02', '01', '03']);
      await controls.getByRole('button', { name: /Sort by Time/ }).click();
      assert.deepEqual(await takes(), ['03', '01', '02']);
      assert.equal(await controls.getByRole('button', { name: /Sort by Time/ }).getAttribute('aria-pressed'), 'true');
      assert.equal(page.errors.length, 0, page.errors.join('\n'));
    } finally { await page.context().close(); }
  });
  test(`${name}: filters and session heading remain visible while scrolling and resizing`, { skip: !executablePath }, async () => {
    const page = await open(name, `/?session=${SESSION_A}`);
    try {
      // Layout stress uses copies of the existing synthetic rows; no archive/media changes.
      await page.evaluate(() => {
        const list = document.querySelector('.recording-list');
        for (let i = 0; i < 25; i++) list.append(list.firstElementChild.cloneNode(true));
        window.scrollTo(0, document.querySelector('.session-band').getBoundingClientRect().top + window.scrollY + 100);
      });
      const pinned = () => page.waitForFunction(() => {
        const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
        const band = document.querySelector('.session-band').getBoundingClientRect();
        return Math.abs(toolbar.top) < 1 && Math.abs(band.top - toolbar.bottom) < 1;
      }, null, { timeout: 1500 });
      await pinned();
      await page.setViewportSize(name === 'desktop' ? viewports.mobile : viewports.desktop);
      await pinned();
      const overlap = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overlap, false, 'no horizontal overflow after resize');
      await page.shot('sticky-ledger');
    } finally { await page.context().close(); }
  });
  test(`${name}: type-to-search leaves composing and consumed keys alone`, { skip: !executablePath }, async () => {
    const page = await open(name, `/?session=${SESSION_A}`);
    try {
      for (const options of [{ isComposing: true }, { keyCode: 229 }, { consumed: true }]) {
        await page.evaluate((options) => {
          document.activeElement.blur();
          const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true, ...options });
          if (options.consumed) event.preventDefault();
          document.body.dispatchEvent(event);
        }, options);
        assert.equal(await page.inputValue('input[type=search]'), '', JSON.stringify(options));
      }
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press('b');
      assert.equal(await page.inputValue('input[type=search]'), 'b');
      assert.equal(await page.locator('input[type=search]').evaluate(el => el === document.activeElement), true);
    } finally { await page.context().close(); }
  });
  test(
    `${name}: deep link restores the section, selection swaps the only live player`,
    { skip: !executablePath && "no Chrome executable found; set CHROME_PATH" },
    async () => {
      const page = await open(name, `/?session=${SESSION_A}#SYN_0001`);
      assert.equal(await heading(page), "Alpha section take");
      await waitStatus(page, "Paused");
      let state = await live(page);
      assert.equal(state.length, 1);
      assert.equal(state[0].kind, "youtube");
      assert.ok(Math.abs(state[0].time - 2) < 0.2, "video seeks to 0:02");
      assert.equal(await page.textContent(".transport .time"), "0:00");
      assert.equal(
        (await page.locator(".recording-row.selected").count()),
        1,
      );
      assert.equal(await page.locator(".recording-row").count(), 3);
      await page.shot("deep-link");

      await rowButton(page, "Bravo full take").click();
      await waitStatus(page, "Playing");
      assert.equal(await heading(page), "Bravo full take");
      await assertOnlyLive(page, "youtube", "video.");
      assert.equal((await playing(page)).length, 1);
      assert.equal(
        await page.evaluate(() => location.hash),
        "#SYN_0002",
        "selection is reflected in the shareable hash",
      );
      await page.shot("selected-playing");

      // Rapid selection: three clicks before any provider settles.
      await rowButton(page, "Alpha section take").click();
      await rowButton(page, "Charlie short audio").click();
      await rowButton(page, "Bravo full take").click();
      await waitStatus(page, "Playing");
      assert.equal(await heading(page), "Bravo full take");
      await assertOnlyLive(page, "youtube", "video.");
      const disposed = (await media(page)).filter((m) => !m.src);
      assert.ok(
        disposed.every((m) => m.paused && !m.attached),
        "disposed providers are paused and detached",
      );
      const fired = await page.evaluate(() => window.__fireStale());
      assert.ok(fired >= 3, `stale providers fired: ${fired}`);
      await page.waitForTimeout(150);
      assert.equal(await heading(page), "Bravo full take");
      assert.equal(await page.locator(".playback-error").count(), 0);
      assert.equal(await status(page), "Playing");
      assert.equal((await playing(page)).length, 1);
      assert.equal(page.errors.length, 0, page.errors.join("\n"));
      await page.context().close();
    },
  );

  test(
    `${name}: filters keep a valid selection alive, empty results release media`,
    { skip: !executablePath && "no Chrome executable found; set CHROME_PATH" },
    async () => {
      const page = await open(name, `/#SYN_0002`);
      await waitStatus(page, "Paused");
      await page.click(".play-button");
      await waitStatus(page, "Playing");
      const before = await live(page);
      await filterBySong(page, "Bravo");
      await page.waitForFunction(
        () => document.querySelectorAll(".recording-row").length === 1,
      );
      assert.equal(await heading(page), "Bravo full take");
      assert.equal(await status(page), "Playing");
      const during = await live(page);
      assert.deepEqual(
        during.map((m) => m.src),
        before.map((m) => m.src),
        "filtering around the active row does not rebuild its provider",
      );
      assert.equal((await media(page)).length, 1, "no extra element created");
      await page.shot("filtered-selection-kept");

      await filterBySong(page, "Charlie");
      await waitStatus(page, "Paused");
      assert.equal(await heading(page), "Charlie short audio");
      await assertOnlyLive(page, "audio", "SYN_0003.wav");
      assert.equal(
        await page.evaluate(() => location.hash),
        "#SYN_0003",
        "an invalidated selection moves the hash to the visible take",
      );

      await filterBySong(page, "zzz-no-match");
      await page.waitForSelector(".empty-state");
      assert.equal(await page.locator(".player").count(), 0);
      assert.equal((await live(page)).length, 0, "empty results release media");
      assert.equal((await playing(page)).length, 0);
      await page.shot("empty");
      await page.click("text=Clear filters");
      await page.waitForSelector(".player");
      assert.equal(page.errors.length, 0, page.errors.join("\n"));
      await page.context().close();
    },
  );

  test(
    `${name}: reload, hash navigation, back and forward restore selection and session`,
    { skip: !executablePath && "no Chrome executable found; set CHROME_PATH" },
    async () => {
      const page = await open(name, `/?session=${SESSION_B}#SYN_0005`);
      assert.equal(await heading(page), "Echo broken video");
      assert.equal(await page.locator(".recording-row").count(), 2);
      await page.reload();
      await page.waitForSelector(".player");
      assert.equal(await heading(page), "Echo broken video");
      assert.equal(await page.inputValue("select >> nth=0"), SESSION_B);

      await page.evaluate(() => {
        location.hash = "#SYN_0004";
      });
      await page.waitForFunction(
        () => document.querySelector(".player h2")?.textContent === "Delta missing audio",
      );
      await page.goBack();
      await page.waitForFunction(
        () => document.querySelector(".player h2")?.textContent === "Echo broken video",
      );
      await page.goForward();
      await page.waitForFunction(
        () => document.querySelector(".player h2")?.textContent === "Delta missing audio",
      );
      assert.equal(
        (await live(page)).length,
        1,
        "history navigation leaves exactly one provider",
      );
      // Cross-session deep link through history: session query must follow.
      await page.goto(`${fixture.origin}/?session=${SESSION_A}#SYN_0003`);
      await page.waitForSelector(".player");
      assert.equal(await heading(page), "Charlie short audio");
      await page.goBack();
      await page.waitForFunction(
        () => document.querySelector(".player h2")?.textContent === "Delta missing audio",
      );
      assert.equal(await page.inputValue("select >> nth=0"), SESSION_B);
      await page.shot("history");
      assert.equal(page.errors.length, 0, page.errors.join("\n"));
      await page.context().close();
    },
  );

  test(
    `${name}: offset handoff between video and audio, seek, section stop and replay`,
    { skip: !executablePath && "no Chrome executable found; set CHROME_PATH" },
    async () => {
      const page = await open(name, `/#SYN_0001`);
      await waitStatus(page, "Paused");
      await page.click(".play-button");
      await waitStatus(page, "Playing");
      await page.waitForFunction(
        () => window.__mediaState().some((m) => m.src && m.time > 2.5),
      );
      const videoTime = (await live(page))[0].time;
      await page.click(".media-switch button:has-text('Audio')");
      await waitLive(page, "audio", true);
      await waitStatus(page, "Playing");
      await assertOnlyLive(page, "audio", "SYN_0001.wav");
      const audio = (await live(page))[0];
      assert.ok(
        audio.time >= videoTime - 0.3 && audio.time < videoTime + 1.5,
        `audio resumed near ${videoTime}, got ${audio.time}`,
      );
      assert.equal((await playing(page)).length, 1);

      await page.click(".play-button");
      await waitStatus(page, "Paused");
      assert.equal((await playing(page)).length, 0);
      const seekBar = page.locator("input[aria-label='Seek within selected section']");
      await seekBar.evaluate((input) => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        setter.call(input, "0.5");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForFunction(() =>
        window.__mediaState().some((m) => m.src && Math.abs(m.time - 2.5) < 0.2),
      );
      assert.equal(await page.textContent(".transport .time"), "0:01");

      await page.click(".media-switch button:has-text('Video')");
      await waitLive(page, "youtube", false);
      await waitStatus(page, "Paused");
      await assertOnlyLive(page, "youtube", "video.");
      assert.ok(Math.abs((await live(page))[0].time - 2.5) < 0.3);

      // Section stop: playback halts at 0:05 and Play replays from 0:02.
      await page.click(".play-button");
      await waitLive(page, "youtube", true);
      await waitLive(page, "youtube", false);
      await waitStatus(page, "Paused");
      let stopped = (await live(page))[0];
      assert.ok(Math.abs(stopped.time - 5) < 0.3, `stopped at ${stopped.time}`);
      assert.equal(await page.textContent(".transport .time"), "0:03");
      await page.shot("section-end");
      await page.click(".play-button");
      await waitStatus(page, "Playing");
      const replay = (await live(page))[0];
      assert.ok(replay.time < 3, `replay restarted from the section, got ${replay.time}`);
      assert.equal(page.errors.length, 0, page.errors.join("\n"));
      await page.context().close();
    },
  );

  test(
    `${name}: natural end of track, failed audio and failed video`,
    { skip: !executablePath && "no Chrome executable found; set CHROME_PATH" },
    async () => {
      const page = await open(name, `/#SYN_0003`);
      await waitStatus(page, "Paused");
      await page.click(".play-button");
      await waitLive(page, "audio", true);
      await page.waitForFunction(() =>
        window.__mediaState().some((m) => m.src && m.ended),
      );
      await waitStatus(page, "Paused");
      const ended = (await live(page))[0];
      assert.ok(ended.time >= 2.7, `track ran to its end: ${ended.time}`);
      assert.equal(await page.textContent(".player-status"), "Selected take");
      await page.click(".play-button");
      await waitStatus(page, "Playing");
      assert.ok((await live(page))[0].time < 1, "Play after the end restarts");

      await rowButton(page, "Delta missing audio").click();
      await page.waitForSelector(".playback-error");
      assert.equal(await status(page), "Unavailable");
      assert.ok(await page.isDisabled(".play-button"));
      await assertOnlyLive(page, "audio", "SYN_0004-missing.wav");
      assert.equal((await playing(page)).length, 0);
      await page.shot("failed-audio");

      await rowButton(page, "Echo broken video").click();
      await page.waitForSelector(".playback-error");
      assert.equal(await status(page), "Unavailable");
      await assertOnlyLive(page, "youtube", "missing.webm");
      // A failed provider clears the play intent; audio loads paused and playable.
      await page.click(".media-switch button:has-text('Audio')");
      await waitLive(page, "audio", false);
      await waitStatus(page, "Paused");
      await assertOnlyLive(page, "audio", "SYN_0005.wav");
      assert.equal(await page.locator(".playback-error").count(), 0);
      await page.click(".play-button");
      await waitLive(page, "audio", true);
      await waitStatus(page, "Playing");
      await page.shot("failed-video-audio-fallback");

      // Navigating away tears down the page; nothing may keep playing.
      await page.goto("about:blank");
      await page.context().close();
    },
  );

  test(
    `${name}: keyboard transport, focus management and reduced motion`,
    { skip: !executablePath && "no Chrome executable found; set CHROME_PATH" },
    async () => {
      const page = await open(name, `/#SYN_0001`, { reducedMotion: "reduce" });
      await waitStatus(page, "Paused");
      assert.equal(
        await page.evaluate(() =>
          getComputedStyle(document.querySelector(".play-button")).transitionDuration,
        ),
        "0s",
        "reduced motion disables transitions",
      );
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.className), "skip-link");
      await page.shot("focus-skip-link");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement.id), "recordings");
      await page.waitForTimeout(100);
      assert.equal(
        await heading(page),
        "Alpha section take",
        "the skip link must not change the selected take",
      );
      await page.keyboard.press("Tab");
      assert.ok(
        await page.evaluate(() => document.activeElement.matches(".ledger button, .ledger select, .ledger input")),
        "tab order enters the ledger tools",
      );
      await page.shot("focus-ring");

      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press("Space");
      await waitStatus(page, "Playing");
      assert.equal((await playing(page)).length, 1);
      await page.keyboard.press("Space");
      await waitStatus(page, "Paused");
      const paused = (await live(page))[0].time;
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(
        (previous) => window.__mediaState().some((m) => m.src && m.time > previous + 1),
        paused,
      );
      assert.ok(Math.abs((await live(page))[0].time - 5) < 0.3, "arrow seeks clamp to the section end");
      await page.keyboard.press("ArrowLeft");
      await page.waitForFunction(() =>
        window.__mediaState().some((m) => m.src && Math.abs(m.time - 2) < 0.3),
      );

      // Typing a letter outside controls starts a search instead of stealing playback.
      await page.keyboard.press("b");
      assert.equal(await page.inputValue("input[type=search]"), "b");
      await page.keyboard.press("Space");
      assert.equal(await page.inputValue("input[type=search]"), "b ");
      assert.equal(await status(page), "Paused", "space inside the search field types");

      if (name === "desktop") {
        await page.click(".expand-control");
        assert.equal(await page.getAttribute(".expand-control", "aria-expanded"), "true");
        await page.shot("expanded");
        await page.evaluate(() => document.activeElement.blur());
        await page.keyboard.press("Escape");
        assert.equal(await page.getAttribute(".expand-control", "aria-expanded"), "false");
        assert.ok(
          await page.evaluate(() => document.activeElement.classList.contains("expand-control")),
          "Escape returns focus to the expand control",
        );
      }
      assert.equal(page.errors.length, 0, page.errors.join("\n"));
      await page.context().close();
    },
  );
}
