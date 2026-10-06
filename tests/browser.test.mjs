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
import {
  SESSION_A,
  SESSION_B,
  createFixture,
  initScript,
} from "./browser/fixture.mjs";

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
  page.setDefaultTimeout(6000);
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
  await page.waitForSelector(".workspace-main h1");
  return page;
}
const media = (page) => page.evaluate(() => window.__mediaState());
const live = async (page) => (await media(page)).filter((m) => m.src);
const playing = async (page) =>
  (await media(page)).filter((m) => m.src && !m.paused && !m.ended);
const heading = (page) => page.textContent(".player-song");
const status = (page) => page.textContent(".mode-status");
const waitStatus = (page, text) =>
  page.waitForFunction(
    (expected) =>
      document.querySelector(".mode-status")?.textContent === expected,
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
        (playing === undefined ||
          ((!live[0].paused && !live[0].ended) === playing &&
            document.querySelector(".mode-status")?.textContent ===
              (playing ? "Playing" : "Paused")))
      );
    },
    [kind, playing],
  );
const rowButton = (page, file) =>
  page.getByRole("button", { name: `Play take ${file}`, exact: true });
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

const playTake = (page, file) => rowButton(page, file).click();
const nav = (page, name) =>
  page
    .getByRole("navigation", { name: "Music workspace" })
    .getByRole("link", { name, exact: name !== "Songs" })
    .click();
const playLabel = (page) => page.getAttribute(".play-button", "aria-label");
const transportTime = (page) =>
  page.locator(".transport .time").first().textContent();
const seek = async (page, value) =>
  page
    .locator('input[aria-label="Seek within selected section"]')
    .evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
const noErrors = (page) => assert.deepEqual(page.errors, []);
const noOverflow = async (page) =>
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.querySelector(".workspace-main").scrollWidth >
          document.querySelector(".workspace-main").clientWidth,
    ),
    false,
    "no horizontal overflow",
  );

for (const name of Object.keys(viewports)) {
  const scenario = (label, fn) =>
    test(`${name}: ${label}`, { skip: !executablePath }, async () => {
      const page = await open(name, "/?view=recordings");
      try {
        await fn(page);
        noErrors(page);
      } catch (error) {
        await page.shot("failure-" + label.replaceAll(/[^a-z0-9]+/gi, "-"));
        console.log(
          JSON.stringify(
            await page.evaluate(() => ({
              viewport: [innerWidth, innerHeight],
              player: document
                .querySelector(".persistent-player")
                ?.getBoundingClientRect()
                .toJSON(),
              buttons: [
                ...document.querySelectorAll(".media-switch button"),
              ].map((el) => ({
                text: el.textContent,
                rect: el.getBoundingClientRect().toJSON(),
              })),
            })),
          ),
        );
        throw error;
      } finally {
        await page.context().close();
      }
    });
  scenario(
    "song identities and independent musical metadata connect originals and our takes",
    async (page) => {
      await nav(page, "Songs");
      await page.getByRole("link", { name: "Alpha Song", exact: true }).click();
      assert.equal(await page.locator(".recording-row").count(), 2);
      assert.match(
        await page.locator(".song-summary").innerText(),
        /2 takes · 2 sessions/,
      );
      assert.match(
        await page.locator(".song-summary").innerText(),
        /Reference C minor · 120 BPM/,
      );
      assert.match(
        await page
          .locator(".recording-row")
          .filter({
            has: page.getByRole("button", {
              name: "Play take SYN_0001.MOV",
              exact: true,
            }),
          })
          .innerText(),
        /Played D minor · 108.5 BPM/,
      );
      assert.equal(
        await page
          .getByRole("link", {
            name: "Open Synthetic original soundtrack on YouTube",
          })
          .getAttribute("href"),
        "https://www.youtube.com/watch?v=Fixture0001",
      );
      await page
        .getByRole("button", {
          name: "Play original of Alpha Song",
          exact: true,
        })
        .click();
      await waitLive(page, "youtube", true);
      assert.equal(await heading(page), "Alpha Song");
      assert.match(
        await page.locator(".player-source").innerText(),
        /Original soundtrack/,
      );
      await page.waitForFunction(
        () => document.querySelector(".transport input").max === "6",
      );
      assert.equal(
        await page.locator(".transport .time").last().innerText(),
        "0:06",
        "provider duration populates a reference with no persisted duration",
      );
      await playTake(page, "SYN_0001.MOV");
      await waitLive(page, "audio", true);
      assert.match(
        await page.locator(".player-source").innerText(),
        /Our take/,
      );
      await nav(page, "Repertoire");
      assert.match(
        await page.locator(".catalog-empty").innerText(),
        /No repertoire selected/,
      );
      assert.equal(await heading(page), "Alpha Song");
      await nav(page, "Songs");
      await page
        .getByRole("link", { name: "Unrecorded Song", exact: true })
        .click();
      assert.equal(await page.locator(".recording-row").count(), 0);
      assert.match(
        await page.locator(".song-content").innerText(),
        /No takes recorded yet/,
      );
      await page.locator(".song-identity summary").click();
      assert.match(
        await page.locator(".song-identity").innerText(),
        /Not recorded/,
      );
      await page.shot("song-detail");
      await noOverflow(page);
    },
  );
  scenario(
    "global search, empty results and media chips never replace live playback",
    async (page) => {
      await playTake(page, "SYN_0002.MOV");
      await waitLive(page, "audio", true);
      const sources = await live(page),
        total = (await media(page)).length;
      await page
        .getByRole("searchbox", { name: "Search music library" })
        .fill("Bravo");
      assert.equal(await page.locator(".recording-row").count(), 1);
      await page
        .getByRole("searchbox", { name: "Search music library" })
        .fill("no-matching-fixture");
      await page.waitForSelector(".empty-state");
      assert.equal(await heading(page), "Bravo full take");
      assert.equal(await playLabel(page), "Pause selected recording");
      await page
        .getByRole("button", { name: "Clear search", exact: true })
        .click();
      await page
        .getByRole("group", { name: "Media filter" })
        .getByRole("button", { name: "Audio only", exact: true })
        .click();
      assert.equal(await page.locator(".recording-row").count(), 2);
      assert.equal(await heading(page), "Bravo full take");
      await nav(page, "Sessions");
      await page
        .getByRole("link", { name: "31 May 2026", exact: true })
        .click();
      await page
        .getByRole("group", { name: "Media filter" })
        .getByRole("button", { name: "Audio only", exact: true })
        .click();
      assert.equal(await page.locator(".recording-row").count(), 1);
      await page
        .getByRole("group", { name: "Media filter" })
        .getByRole("button", { name: "Has video", exact: true })
        .click();
      assert.equal(await page.locator(".recording-row").count(), 2);
      assert.deepEqual(
        (await live(page)).map((m) => m.src),
        sources.map((m) => m.src),
      );
      assert.equal(
        (await media(page)).length,
        total,
        "browsing never rebuilds the provider",
      );
      await nav(page, "Sessions");
      await page.getByRole("link", { name: "1 Aug 2026", exact: true }).click();
      await page
        .getByRole("group", { name: "Media filter" })
        .getByRole("button", { name: "Has video", exact: true })
        .click();
      assert.equal(await page.locator(".recording-row").count(), 0);
      assert.match(
        await page.locator(".empty-state").innerText(),
        /No matching takes/,
      );
      assert.equal(await heading(page), "Bravo full take");
      assert.equal((await media(page)).length, total);
    },
  );
  scenario(
    "legacy deep links reload paused and rapid explicit selection disposes stale providers",
    async (page) => {
      await page.goto(`${fixture.origin}/?session=${SESSION_A}#SYN_0001`);
      await waitLive(page, "audio", false);
      assert.equal(await heading(page), "Alpha Song");
      assert.equal(await page.locator(".recording-row").count(), 3);
      assert.ok(Math.abs((await live(page))[0].time - 2) < 0.2);
      await page.reload();
      await waitLive(page, "audio", false);
      assert.equal(await playLabel(page), "Play selected recording");
      await page
        .getByRole("group", { name: "Playback mode" })
        .getByRole("button", { name: "Video", exact: true })
        .click();
      await waitLive(page, "youtube", false);
      await playTake(page, "SYN_0002.MOV");
      await playTake(page, "SYN_0003.m4a");
      await playTake(page, "SYN_0001.MOV");
      await playTake(page, "SYN_0002.MOV");
      await waitLive(page, "audio", true);
      assert.equal(await heading(page), "Bravo full take");
      assert.equal(
        new URL(page.url()).searchParams.get("play"),
        "SYN_0002.MOV",
      );
      assert.ok(
        (await media(page))
          .filter((m) => !m.src)
          .every((m) => m.paused && !m.attached),
      );
      assert.ok((await page.evaluate(() => window.__fireStale())) >= 1);
      await page.waitForTimeout(150);
      assert.equal(await heading(page), "Bravo full take");
      assert.equal(await status(page), "Playing");
      assert.equal((await playing(page)).length, 1);
    },
  );
  scenario(
    "audio/video handoff preserves section position, seeking, stop and replay",
    async (page) => {
      await page.goto(`${fixture.origin}/#SYN_0001`);
      await waitLive(page, "audio", false);
      await page.click(".play-button");
      await waitLive(page, "audio", true);
      await page.waitForFunction(() =>
        window.__mediaState().some((m) => m.src && m.time > 2.5),
      );
      const before = (await live(page))[0].time;
      await page
        .getByRole("group", { name: "Playback mode" })
        .getByRole("button", { name: "Video", exact: true })
        .click();
      await waitLive(page, "youtube", true);
      assert.ok(Math.abs((await live(page))[0].time - before) < 1);
      await page.click(".play-button");
      await waitLive(page, "youtube", false);
      await seek(page, 0.5);
      await page.waitForFunction(() =>
        window
          .__mediaState()
          .some((m) => m.src && Math.abs(m.time - 2.5) < 0.2),
      );
      assert.equal(await transportTime(page), "0:01");
      await page
        .getByRole("group", { name: "Playback mode" })
        .getByRole("button", { name: "Audio", exact: true })
        .click();
      await waitLive(page, "audio", false);
      await waitStatus(page, "Paused");
      assert.ok(
        Math.abs((await live(page))[0].time - 2.5) < 0.3,
        JSON.stringify(await media(page)),
      );
      await page.click(".play-button");
      await waitLive(page, "audio", true);
      await waitLive(page, "audio", false);
      assert.ok(Math.abs((await live(page))[0].time - 5) < 0.3);
      assert.equal(await transportTime(page), "0:03");
      await page.click(".play-button");
      await waitLive(page, "audio", true);
      assert.ok((await live(page))[0].time < 3);
      await page.shot("section-playback");
    },
  );
  scenario(
    "natural end, failed audio, failed video and audio fallback",
    async (page) => {
      await playTake(page, "SYN_0003.m4a");
      await waitLive(page, "audio", true);
      await page.waitForFunction(() =>
        window.__mediaState().some((m) => m.src && m.ended),
      );
      await waitStatus(page, "Paused");
      await page.click(".play-button");
      await waitLive(page, "audio", true);
      assert.ok((await live(page))[0].time < 1);
      await playTake(page, "SYN_0004.m4a");
      await page.waitForSelector(".playback-error");
      assert.equal(await status(page), "Unavailable");
      assert.ok(await page.isDisabled(".play-button"));
      await assertOnlyLive(page, "audio", "SYN_0004-missing.wav");
      assert.equal((await playing(page)).length, 0);
      await playTake(page, "SYN_0005.MOV");
      await waitLive(page, "audio", true);
      await page
        .getByRole("group", { name: "Playback mode" })
        .getByRole("button", { name: "Video", exact: true })
        .click();
      await page.waitForSelector(".playback-error");
      await assertOnlyLive(page, "youtube", "missing.webm");
      await page
        .getByRole("group", { name: "Playback mode" })
        .getByRole("button", { name: "Audio", exact: true })
        .click();
      await waitLive(page, "audio", false);
      await waitStatus(page, "Paused");
      assert.equal(await page.locator(".playback-error").count(), 0);
      await page.click(".play-button");
      await waitLive(page, "audio", true);
    },
  );
  scenario(
    "search hidden metadata, scopes, clear and browser history retain context",
    async (page) => {
      await nav(page, "Songs");
      await page.getByRole("link", { name: "Alpha Song", exact: true }).click();
      await filterBySong(page, "Hidden Composer");
      assert.match(
        await page.locator(".matched-context").innerText(),
        /Hidden Composer/,
      );
      assert.equal(await page.locator(".song-row").count(), 1);
      await page
        .getByRole("group", { name: "Search scope" })
        .getByRole("button", { name: "Takes 0", exact: true })
        .click();
      assert.equal(await page.locator(".song-row").count(), 0);
      await page
        .getByRole("group", { name: "Search scope" })
        .getByRole("button", { name: "Songs 1", exact: true })
        .click();
      assert.equal(await page.locator(".song-row").count(), 1);
      await page
        .getByRole("button", { name: "Clear search", exact: true })
        .click();
      assert.equal(await page.locator("h1").innerText(), "Alpha Song");
      await filterBySong(page, "Cy");
      await page
        .getByRole("button", { name: "Play take SYN_0003.m4a", exact: true })
        .click();
      await waitLive(page, "audio", true);
      await page
        .getByRole("button", { name: "Clear search", exact: true })
        .click();
      assert.equal(await page.locator("h1").innerText(), "Alpha Song");
      assert.equal(
        new URL(page.url()).searchParams.get("play"),
        "SYN_0003.m4a",
      );
      await filterBySong(page, "Synthetic Second Session");
      await page
        .getByRole("link", {
          name: "2026-07-26 Synthetic Second Session",
          exact: true,
        })
        .click();
      assert.equal(await page.locator("h1").innerText(), "26 Jul 2026");
      await page.goBack();
      assert.equal(
        await page.getByRole("searchbox").inputValue(),
        "Synthetic Second Session",
      );
      await page
        .getByRole("button", { name: "Clear search", exact: true })
        .click();
      assert.equal(await page.locator("h1").innerText(), "Alpha Song");
    },
  );
  scenario(
    "normal Back changes browsing without restoring an older play token",
    async (page) => {
      await nav(page, "Songs");
      await page
        .getByRole("button", {
          name: "Play original of Alpha Song",
          exact: true,
        })
        .click();
      await waitLive(page, "youtube", true);
      await nav(page, "Our takes");
      await playTake(page, "SYN_0002.MOV");
      await waitLive(page, "audio", true);
      await nav(page, "Sessions");
      await page.goBack();
      await page.waitForFunction(
        () => document.querySelector("h1")?.textContent === "Takes",
      );
      assert.equal(await heading(page), "Bravo full take");
      await page.goBack();
      await page.waitForFunction(
        () => document.querySelector("h1")?.textContent === "Songs",
      );
      assert.equal(await heading(page), "Bravo full take");
      assert.equal(
        new URL(page.url()).searchParams.get("play"),
        "SYN_0002.MOV",
      );
      await page.reload();
      await waitLive(page, "audio", false);
      assert.equal(await heading(page), "Bravo full take");
    },
  );
  scenario(
    "legacy hash cannot overwrite a newer take on normal route Back",
    async (page) => {
      await page.goto(`${fixture.origin}/#SYN_0001`);
      await waitLive(page, "audio", false);
      await nav(page, "Songs");
      await nav(page, "Our takes");
      await playTake(page, "SYN_0002.MOV");
      await waitLive(page, "audio", true);
      await page.goBack();
      await page.waitForFunction(
        () => document.querySelector("h1")?.textContent === "Songs",
      );
      await page.goBack();
      await page.waitForFunction(
        () => document.querySelector("h1")?.textContent === "Takes",
      );
      assert.equal(await heading(page), "Bravo full take");
      assert.equal(
        new URL(page.url()).searchParams.get("play"),
        "SYN_0002.MOV",
      );
      assert.equal(new URL(page.url()).hash, "");
    },
  );
  scenario(
    "direct search clears to the library and typed deletion preserves latest playback",
    async (page) => {
      await page.goto(`${fixture.origin}/?view=search&q=Bravo`);
      await page.waitForSelector(".search-results");
      await playTake(page, "SYN_0002.MOV");
      await waitLive(page, "audio", true);
      await page.getByRole("searchbox").fill("");
      assert.equal(await page.locator("h1").innerText(), "Songs");
      assert.equal(
        new URL(page.url()).searchParams.get("play"),
        "SYN_0002.MOV",
      );
      await page.reload();
      await waitLive(page, "audio", false);
      assert.equal(await heading(page), "Bravo full take");
      await filterBySong(page, "Fixture Artist");
      assert.equal(await page.locator(".song-row").count(), 1);
      assert.match(
        await page.locator(".matched-context").innerText(),
        /Fixture Artist/,
      );
    },
  );
  scenario(
    "Escape in the focused global search preserves an expanded playing reference",
    async (page) => {
      await page.goto(`${fixture.origin}/?view=songs&layout=dock`);
      await page.waitForSelector(".song-row");
      await page
        .getByRole("button", {
          name: "Play original of Alpha Song",
          exact: true,
        })
        .click();
      await waitLive(page, "youtube", true);
      if (
        (await page.getAttribute(".expand-control", "aria-expanded")) ===
        "false"
      )
        await page.click(".expand-control");
      const before = (await media(page)).length;
      await filterBySong(page, "Alpha");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("h1").innerText(), "Songs");
      assert.equal(
        await page.getAttribute(".expand-control", "aria-expanded"),
        "true",
      );
      assert.equal(await playLabel(page), "Pause selected recording");
      assert.equal((await media(page)).length, before);
    },
  );
  scenario(
    "sessions are a page and media/sort chips retain canonical take numbers",
    async (page) => {
      assert.equal(await page.locator("select").count(), 0);
      await nav(page, "Sessions");
      assert.equal(await page.locator(".sessions-list li").count(), 3);
      await page
        .getByRole("link", { name: "31 May 2026", exact: true })
        .click();
      const controls = page.locator(".ledger-headings");
      assert.equal(await controls.count(), 1);
      assert.deepEqual(await page.locator(".take-number").allTextContents(), [
        "03",
        "02",
        "01",
      ]);
      await controls
        .getByRole("button", { name: "Sort by Take", exact: true })
        .click();
      assert.deepEqual(await page.locator(".take-number").allTextContents(), [
        "01",
        "02",
        "03",
      ]);
      await controls
        .getByRole("button", { name: "Sort by Song", exact: true })
        .click();
      assert.deepEqual(await page.locator(".take-number").allTextContents(), [
        "01",
        "02",
        "03",
      ]);
      await controls
        .getByRole("button", { name: "Sort by Time", exact: true })
        .click();
      assert.deepEqual(await page.locator(".take-number").allTextContents(), [
        "02",
        "01",
        "03",
      ]);
      await page
        .getByRole("group", { name: "Media filter" })
        .getByRole("button", { name: "Audio only", exact: true })
        .click();
      assert.equal(await page.locator(".recording-row").count(), 1);
      await page
        .getByRole("group", { name: "Media filter" })
        .getByRole("button", { name: "Has video", exact: true })
        .click();
      assert.equal(await page.locator(".recording-row").count(), 2);
      await page.shot("session-chips");
    },
  );
  scenario(
    "keyboard composition, global slash search, transport and reduced motion",
    async (page) => {
      await page.goto(`${fixture.origin}/#SYN_0001`);
      await waitLive(page, "audio", false);
      for (const key of [" ", "ArrowLeft", "ArrowRight", "/"])
        for (const options of [
          { isComposing: true },
          { keyCode: 229 },
          { consumed: true },
        ]) {
          const consumed = await page.evaluate(
            ({ key, options }) => {
              document.activeElement.blur();
              const event = new KeyboardEvent("keydown", {
                key,
                bubbles: true,
                cancelable: true,
                ...options,
              });
              if (options.consumed) event.preventDefault();
              document.body.dispatchEvent(event);
              return event.defaultPrevented;
            },
            { key, options },
          );
          assert.equal(consumed, Boolean(options.consumed));
          assert.equal(await playLabel(page), "Play selected recording");
        }
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press("Space");
      await waitLive(page, "audio", true);
      await page.keyboard.press("Space");
      await waitLive(page, "audio", false);
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() =>
        window.__mediaState().some((m) => m.src && Math.abs(m.time - 5) < 0.3),
      );
      await page.keyboard.press("ArrowLeft");
      await page.waitForFunction(() =>
        window.__mediaState().some((m) => m.src && Math.abs(m.time - 2) < 0.3),
      );
      await page.keyboard.press("/");
      assert.equal(
        await page
          .getByRole("searchbox")
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await page.keyboard.type("Bravo ");
      assert.equal(await page.getByRole("searchbox").inputValue(), "Bravo ");
      assert.equal(await status(page), "Paused");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("h1").innerText(), "Takes");
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page
          .locator(".play-button")
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0s",
      );
    },
  );
  scenario(
    "player geometry is stable across routes and responsive resizing retains provider identity",
    async (page) => {
      await playTake(page, "SYN_0002.MOV");
      await waitLive(page, "audio", true);
      await page.click(".play-button");
      await waitLive(page, "audio", false);
      const total = (await media(page)).length;
      const geometry = () => page.locator(".persistent-player").boundingBox();
      const before = await geometry();
      await nav(page, "Songs");
      assert.deepEqual(await geometry(), before);
      await nav(page, "Our takes");
      assert.deepEqual(await geometry(), before);
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1024, height: 800 },
        { width: 768, height: 900 },
        { width: 375, height: 812 },
      ]) {
        await page.setViewportSize(viewport);
        await noOverflow(page);
        const rect = await geometry();
        if (viewport.width >= 1280) {
          assert.equal(rect.y, 0);
          assert.ok(Math.abs(rect.x + rect.width - viewport.width) < 1);
        } else {
          assert.ok(Math.abs(rect.y + rect.height - viewport.height) < 1);
        }
        assert.equal((await media(page)).length, total);
        assert.equal(await heading(page), "Bravo full take");
        await page.shot(`responsive-${viewport.width}`);
      }
      await page.goto(
        `${fixture.origin}/?view=recordings&play=SYN_0002.MOV&layout=dock`,
      );
      await waitLive(page, "audio", false);
      await page.setViewportSize({ width: 1440, height: 900 });
      const dock = await geometry();
      assert.ok(dock.y > 700);
      await noOverflow(page);
      await page.shot("forced-dock");
    },
  );
  scenario(
    "skip link and final take remain reachable above the persistent player",
    async (page) => {
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.className),
        "skip-link",
      );
      await page.keyboard.press("Enter");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "main-content",
      );
      await page.evaluate(() => {
        const list = document.querySelector(".recording-list");
        for (let i = 0; i < 25; i++)
          list.append(list.lastElementChild.cloneNode(true));
        const main = document.querySelector(".workspace-main");
        main.scrollTop = main.scrollHeight;
      });
      const last = await page
        .locator(".recording-list")
        .last()
        .locator(".recording-row")
        .last()
        .boundingBox();
      const player = await page.locator(".persistent-player").boundingBox();
      assert.ok(
        last.y >= 0 &&
          last.y + last.height <=
            (name === "mobile" ? player.y : viewports[name].height),
        "last row not hidden beneath dock",
      );
      await noOverflow(page);
      await page.shot("final-row");
    },
  );
  scenario(
    "closing video hands a take to audio and pauses a reference until reopened",
    async (page) => {
      await page.goto(
        `${fixture.origin}/?view=recordings&play=SYN_0001.MOV&layout=dock`,
      );
      await waitLive(page, "audio", false);
      await page.click(".play-button");
      await waitLive(page, "audio", true);
      await page
        .getByRole("group", { name: "Playback mode" })
        .getByRole("button", { name: "Video", exact: true })
        .click();
      await waitLive(page, "youtube", true);
      const position = (await live(page))[0].time;
      await page
        .getByRole("button", { name: "Close video", exact: true })
        .click();
      await waitLive(page, "audio", true);
      assert.ok(
        Math.abs((await live(page))[0].time - position) < 1,
        "take keeps its musical position during video close",
      );
      await nav(page, "Songs");
      await page
        .getByRole("button", {
          name: "Play original of Alpha Song",
          exact: true,
        })
        .click();
      await waitLive(page, "youtube", true);
      const count = (await media(page)).length;
      await page
        .getByRole("button", { name: "Close video", exact: true })
        .click();
      await waitLive(page, "youtube", false);
      assert.equal(
        await page.locator(".player.video-open").count(),
        0,
        "reference video is hidden only after pausing",
      );
      await page.click(".play-button");
      await waitLive(page, "youtube", true);
      assert.equal(await page.locator(".player.video-open").count(), 1);
      assert.equal(
        (await media(page)).length,
        count,
        "reopening preserves the provider",
      );
    },
  );
  scenario(
    "song references remain usable when the archive CSV fails",
    async (page) => {
      await page
        .context()
        .route("**/data/recordings.csv", (route) =>
          route.fulfill({ status: 503, body: "unavailable" }),
        );
      await page.goto(`${fixture.origin}/?view=songs&song=unrecorded`);
      await page.waitForSelector(".load-error");
      assert.equal(await page.locator("h1").innerText(), "Unrecorded Song");
      assert.match(
        await page.locator(".load-error").innerText(),
        /Could not load/,
      );
      await page
        .getByRole("button", {
          name: "Play original of Unrecorded Song",
          exact: true,
        })
        .click();
      await waitLive(page, "youtube", true);
      assert.equal(await heading(page), "Unrecorded Song");
      assert.equal(await page.locator(".recording-row").count(), 0);
    },
  );
}

test(
  "responsive video browsing reserves usable space and keeps genuine source controls reachable",
  { skip: !executablePath },
  async () => {
    const page = await open("desktop", "/?view=songs");
    try {
      await page
        .getByRole("button", {
          name: "Play original of Alpha Song",
          exact: true,
        })
        .click();
      await waitLive(page, "youtube", true);
      await page.click(".play-button");
      await waitLive(page, "youtube", false);
      for (const width of [375, 768, 1024, 1440]) {
        await page.setViewportSize({
          width,
          height: width === 375 ? 812 : 900,
        });
        const providers = (await media(page)).length;
        const sources = (await live(page)).map((item) => item.src);
        await nav(page, "Songs");
        await noOverflow(page);
        await page
          .getByRole("link", { name: "Alpha Song", exact: true })
          .click();
        await noOverflow(page);
        assert.equal(await heading(page), "Alpha Song");
        assert.equal(
          (await media(page)).length,
          providers,
          "resizing and route changes retain the original provider",
        );
        assert.deepEqual(
          (await live(page)).map((item) => item.src),
          sources,
        );
        const video = await page.locator(".youtube-host").boundingBox();
        assert.ok(
          video && video.width >= 200 && video.height >= 200,
          `visible video at ${width}: ${JSON.stringify(video)}`,
        );
        assert.ok(
          video.y >= 0 && video.y + video.height <= (width === 375 ? 812 : 900),
          "video stays inside the viewport",
        );
        await nav(page, "Our takes");
        await noOverflow(page);
        assert.equal((await media(page)).length, providers);
        // Normal pointer actions prove the video does not cover the take control.
        await playTake(page, "SYN_0002.MOV");
        await waitLive(page, "audio", true);
        assert.equal(await heading(page), "Bravo full take");
        await noOverflow(page);
        await nav(page, "Songs");
        await page
          .getByRole("link", { name: "Alpha Song", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Play original of Alpha Song",
            exact: true,
          })
          .click();
        await waitLive(page, "youtube", true);
        await page.click(".play-button");
        await waitLive(page, "youtube", false);
        assert.equal(
          (await live(page)).length,
          1,
          "switching back leaves only one provider",
        );
        await noOverflow(page);
        await page.shot(`video-browsing-${width}`);
      }
      noErrors(page);
    } finally {
      await page.context().close();
    }
  },
);

test(
  "delayed YouTube readiness cannot restart a closed original invisibly",
  { skip: !executablePath },
  async () => {
    const page = await open("mobile", "/?view=songs");
    let releaseApi;
    const gate = new Promise((resolve) => {
      releaseApi = resolve;
    });
    let requested;
    const request = new Promise((resolve) => {
      requested = resolve;
    });
    try {
      await page
        .context()
        .route("https://www.youtube.com/iframe_api", async (route) => {
          requested();
          await gate;
          await route.fulfill({
            contentType: "text/javascript",
            body: fixture.youtubeApi,
          });
        });
      await page
        .getByRole("button", {
          name: "Play original of Alpha Song",
          exact: true,
        })
        .click();
      await request;
      await waitStatus(page, "Loading…");
      assert.equal(
        await page.evaluate(() => Boolean(window.YT)),
        false,
        "provider has not initialized",
      );
      await page
        .getByRole("button", { name: "Close video", exact: true })
        .click();
      assert.equal(await page.locator(".player.video-open").count(), 0);
      releaseApi();
      await waitLive(page, "youtube", false);
      assert.equal(await playLabel(page), "Play selected recording");
      assert.equal(
        await page.locator(".player.video-open").count(),
        0,
        "late readiness leaves the panel closed",
      );
      assert.equal(
        (await playing(page)).length,
        0,
        "no hidden original begins playing",
      );
      await page.click(".play-button");
      await waitLive(page, "youtube", true);
      assert.equal(
        await page.locator(".player.video-open").count(),
        1,
        "explicit Play reveals the video",
      );
      assert.equal((await live(page)).length, 1);
      noErrors(page);
    } finally {
      releaseApi();
      await page.context().close();
    }
  },
);

test(
  "short-height video retains a visible frame, usable browsing and accessible transport",
  { skip: !executablePath },
  async () => {
    const page = await open("mobile", "/?view=songs");
    try {
      await page
        .getByRole("button", {
          name: "Play original of Alpha Song",
          exact: true,
        })
        .click();
      await waitLive(page, "youtube", true);
      await page.click(".play-button");
      await waitLive(page, "youtube", false);
      for (const width of [767, 375]) {
        await page.setViewportSize({ width, height: 375 });
        const count = (await media(page)).length;
        await nav(page, "Songs");
        await page
          .getByRole("link", { name: "Alpha Song", exact: true })
          .click();
        await noOverflow(page);
        const frame = await page.locator(".youtube-host").boundingBox();
        const main = await page.locator(".workspace-main").boundingBox();
        const transport = await page.locator(".play-button").boundingBox();
        assert.ok(
          frame && frame.width >= 200 && frame.height >= 200,
          `short frame at ${width}: ${JSON.stringify(frame)}`,
        );
        assert.ok(frame.y >= 0 && frame.y + frame.height <= 375);
        assert.ok(
          main && main.height > 100,
          `usable main area: ${JSON.stringify(main)}`,
        );
        assert.ok(
          transport &&
            transport.y >= 0 &&
            transport.y + transport.height <= 375,
        );
        assert.equal(
          (await media(page)).length,
          count,
          "resize and browsing retain the provider",
        );
        await page.click(".play-button");
        await waitLive(page, "youtube", true);
        await page.click(".play-button");
        await waitLive(page, "youtube", false);
        await nav(page, "Our takes");
        await noOverflow(page);
        await playTake(page, "SYN_0002.MOV");
        await waitLive(page, "audio", true);
        assert.equal(await heading(page), "Bravo full take");
        await nav(page, "Songs");
        await page
          .getByRole("link", { name: "Alpha Song", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Play original of Alpha Song",
            exact: true,
          })
          .click();
        await waitLive(page, "youtube", true);
        await page.click(".play-button");
        await waitLive(page, "youtube", false);
        await noOverflow(page);
        await page.shot(`short-video-${width}`);
      }
      noErrors(page);
    } catch (error) {
      await page.shot("short-video-failure");
      console.log(
        JSON.stringify(
          await page.evaluate(() => ({
            viewport: [innerWidth, innerHeight],
            main: document
              .querySelector(".workspace-main")
              ?.getBoundingClientRect()
              .toJSON(),
            scrollWidth: document.querySelector(".workspace-main")?.scrollWidth,
            overflows: [...document.querySelectorAll(".workspace-main *")]
              .filter(
                (el) =>
                  el.getBoundingClientRect().right >
                  document
                    .querySelector(".workspace-main")
                    .getBoundingClientRect().right,
              )
              .map((el) => ({
                tag: el.tagName,
                class: el.className,
                text: el.textContent.slice(0, 60),
                right: el.getBoundingClientRect().right,
              })),
            video: document
              .querySelector(".youtube-host")
              ?.getBoundingClientRect()
              .toJSON(),
            transport: document
              .querySelector(".play-button")
              ?.getBoundingClientRect()
              .toJSON(),
          })),
        ),
      );
      throw error;
    } finally {
      await page.context().close();
    }
  },
);

test(
  "a cover never borrows original musical metadata and a take retains its own values",
  { skip: !executablePath },
  async () => {
    const page = await open(
      "desktop",
      "/?view=songs&song=synthetic-alpha&layout=dock",
    );
    const expand = async () => {
      if (
        (await page.getAttribute(".expand-control", "aria-expanded")) ===
        "false"
      )
        await page.click(".expand-control");
    };
    try {
      await page
        .getByRole("button", {
          name: "Play original of Alpha Song",
          exact: true,
        })
        .click();
      await waitLive(page, "youtube", true);
      await expand();
      assert.match(
        await page.locator(".player-musical").innerText(),
        /C minor/,
      );
      assert.match(
        await page.locator(".player-musical").innerText(),
        /120 BPM/,
      );
      await page
        .getByRole("button", { name: "Play cover of Alpha Song", exact: true })
        .click();
      await waitLive(page, "youtube", true);
      await expand();
      const cover = await page.locator(".player-musical").innerText();
      assert.equal(
        (cover.match(/Not recorded/g) || []).length,
        2,
        "cover key and tempo remain independently unknown",
      );
      assert.doesNotMatch(cover, /C minor|120 BPM/);
      await playTake(page, "SYN_0001.MOV");
      await waitLive(page, "audio", true);
      await expand();
      const take = await page.locator(".player-musical").innerText();
      assert.match(take, /D minor/);
      assert.match(take, /108.5 BPM/);
      assert.doesNotMatch(take, /C minor|120 BPM/);
      noErrors(page);
    } finally {
      await page.context().close();
    }
  },
);
