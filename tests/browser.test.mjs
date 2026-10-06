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
  if (options.practiceFailFirst) {
    let fail = true;
    await context.route('**/api/practice?*',route=>{if(fail){fail=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic sections unavailable.'})});}return route.continue();});
  }
  if (!options.practice) await context.route('**/api/practice**', route => route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Synthetic static build has no practice API.'})}));
  if (options.practice) await context.addInitScript(({failDecode})=>{
    const Original = window.AudioContext;
    window.__stemContexts=[];window.__stemStarts=[];window.__stemStops=[];window.__stemGains=[];
    window.AudioContext=class extends Original {
      constructor(options){super(options);this.testId=window.__stemContexts.length;window.__stemContexts.push(this);}
      createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source),stop=source.stop.bind(source),context=this;
        source.start=(when,offset,...rest)=>{window.__stemStarts.push({context:context.testId,when,offset,loop:source.loop,loopStart:source.loopStart,loopEnd:source.loopEnd});return start(when,offset,...rest);};
        source.stop=(...args)=>{window.__stemStops.push({context:context.testId,time:context.currentTime});return stop(...args);};return source;}
      createGain(){const gain=super.createGain(),target=gain.gain.setTargetAtTime.bind(gain.gain),context=this;
        gain.gain.setTargetAtTime=(value,when,tau)=>{window.__stemGains.push({context:context.testId,value,when});return target(value,when,tau);};return gain;}
      decodeAudioData(...args){if(failDecode)return Promise.reject(new DOMException('Synthetic decode failure','EncodingError'));return super.decodeAudioData(...args);}
    };
  },{failDecode:Boolean(options.failDecode)});
  let releaseStems;
  if(options.delayStems) {
    const pending=new Promise(resolve=>{releaseStems=resolve;});
    await context.route('**/reference-audio/stems/*.wav',async route=>{await pending;try{await route.continue();}catch{/* Replacement can abort the pending request. */}});
  }
  let releaseArchive;
  if(options.delayArchive) {
    const pending=new Promise(resolve=>{releaseArchive=resolve;});
    await context.route('**/data/recordings.csv',async route=>{await pending;await route.continue();});
  }
  if(options.nativeEnd) await context.addInitScript(()=>{
    // Let the real audio end once before progress polling can intercept B.
    // This isolates the native ended handler; other tests exercise normal polling.
    const interval=window.setInterval.bind(window);
    window.setInterval=(callback,delay,...args)=>interval(()=>{
      if(delay!==25 || window.__audioEvents?.some(event=>event.type==='ended'&&event.src.includes('reference-audio/')))callback(...args);
    },delay);
  });
  if(options.referenceAudio) {
    await context.route('**/data/catalog.json', async route=>{
      const response=await route.fetch(), catalog=await response.json();
      catalog.references=catalog.references.map(ref=>ref.id==='alpha-original'?{...ref,...fixture.referenceAudio,audio_file:options.referenceAudio==='missing'?'missing-reference.m4a':fixture.referenceAudio.audio_file}:ref);
      await route.fulfill({json:catalog});
    });
  }
  if(options.clipboard) await context.addInitScript(({denied})=>{
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedPractice=text;if(denied)throw new Error('Clipboard denied');}}});
  },{denied:options.clipboard==='denied'});
  await context.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: fixture.youtubeApi,
    }),
  );
  const page = await context.newPage();
  page.releaseArchive=releaseArchive;
  page.releaseStems=releaseStems;
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
        .getByRole("group", { name: "Playback options" })
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
        .getByRole("group", { name: "Playback options" })
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
        .getByRole("group", { name: "Playback options" })
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
        .getByRole("group", { name: "Playback options" })
        .getByRole("button", { name: "Video", exact: true })
        .click();
      await page.waitForSelector(".playback-error");
      await assertOnlyLive(page, "youtube", "missing.webm");
      await page
        .getByRole("group", { name: "Playback options" })
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
        .getByRole("group", { name: "Playback options" })
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

const privatePath = (extra='') => `/?view=songs&song=synthetic-alpha&play=ref%3Aalpha-original${extra}`;
const audioEvents = page => page.evaluate(()=>window.__audioEvents);
const refWrapCount = async (page,start) => (await audioEvents(page)).filter(event=>event.type==='seeking'&&event.src.includes('reference-audio/')&&Math.abs(event.time-start)<.05).length;
const waitRefWraps = (page,start,count) => page.waitForFunction(({start,count})=>window.__audioEvents.filter(event=>event.type==='seeking'&&event.src.includes('reference-audio/')&&Math.abs(event.time-start)<.05).length>=count,{start,count});
const expandPractice = async page => {
  if(await page.locator('.practice-controls').isVisible()) return;
  await page.getByRole('button',{name:'Expand player',exact:true}).click();
};
const collapsePractice = async page => {
  const control=page.getByRole('button',{name:'Collapse player',exact:true});
  if(await control.isVisible())await control.click();
};

for(const name of Object.keys(viewports)) {
  const privateScenario = (label,fn,options={}) => test(`${name}: private audio ${label}`,{skip:!executablePath},async()=>{
    const page=await open(name,privatePath(options.query||''),{referenceAudio:options.missing?'missing':true,clipboard:options.clipboard,nativeEnd:options.nativeEnd});
    try{await fn(page);noErrors(page);}catch(error){await page.shot('private-failure-'+label.replaceAll(/[^a-z0-9]+/gi,'-'));console.log(JSON.stringify({label,status:await status(page),media:await media(page),events:(await audioEvents(page)).slice(-8)}));throw error;}finally{await page.context().close();}
  });
  privateScenario('decodes local original and hands video back to audio paused or playing',async page=>{
    await waitLive(page,'audio',false);await assertOnlyLive(page,'audio','reference-audio/'+fixture.referenceAudio.audio_file);
    assert.equal(await heading(page),'Alpha Song');assert.match(await page.locator('.player-source').innerText(),/Original soundtrack/);
    assert.equal(await page.getByRole('group',{name:'Playback options'}).getByRole('button',{name:'Audio',exact:true}).getAttribute('aria-pressed'),'true');
    await page.click('.play-button');await waitLive(page,'audio',true);
    await page.waitForFunction(()=>window.__mediaState().some(m=>m.src&&m.kind==='audio'&&m.time>.35));
    const first=(await live(page))[0].time;
    await page.getByRole('group',{name:'Playback options'}).getByRole('button',{name:'Video',exact:true}).click();await waitLive(page,'youtube',true);
    assert.ok(Math.abs((await live(page))[0].time-first)<.8);
    await page.click('.play-button');await waitLive(page,'youtube',false);const paused=(await live(page))[0].time;
    await page.getByRole('group',{name:'Playback options'}).getByRole('button',{name:'Audio',exact:true}).click();await waitLive(page,'audio',false);
    assert.ok(Math.abs((await live(page))[0].time-paused)<.2);
    await page.click('.play-button');await waitLive(page,'audio',true);
    await page.getByRole('group',{name:'Playback options'}).getByRole('button',{name:'Video',exact:true}).click();await waitLive(page,'youtube',true);
    const running=(await live(page))[0].time;
    await page.getByRole('group',{name:'Playback options'}).getByRole('button',{name:'Audio',exact:true}).click();await waitLive(page,'audio',true);
    assert.ok(Math.abs((await live(page))[0].time-running)<.8);assert.equal((await playing(page)).length,1);
  });
  privateScenario('practice link is paused, repeats through browsing, and source changes clear the target',async page=>{
    await waitLive(page,'audio',false);assert.ok(Math.abs((await live(page))[0].time-.5)<.05);
    const quick=page.getByRole('button',{name:'Repeat selected excerpt',exact:true});assert.equal(await quick.getAttribute('aria-pressed'),'true');
    await waitRefWraps(page,.5,1);const baseline=await refWrapCount(page,.5);
    await page.click('.play-button');await waitLive(page,'audio',true);await waitRefWraps(page,.5,baseline+2);
    const providers=(await media(page)).length;
    await collapsePractice(page);await page.getByRole('button',{name:'Play original of Alpha Song',exact:true}).click();await waitLive(page,'audio',true);
    assert.equal((await media(page)).length,providers,'explicit Play of the same source retains its provider');assert.equal(new URL(page.url()).searchParams.get('t'),'0.5,1.25');
    await nav(page,'Repertoire');await filterBySong(page,'nothing-matches-fixture');
    assert.equal(await page.locator('.recording-row').count(),0);assert.equal(await quick.getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'Clear search',exact:true}).click();await nav(page,'Our takes');
    assert.equal((await media(page)).length,providers);assert.equal(new URL(page.url()).searchParams.get('t'),'0.5,1.25');
    await filterBySong(page,'Bravo');await playTake(page,'SYN_0002.MOV');await waitLive(page,'audio',true);
    assert.equal(new URL(page.url()).searchParams.has('t'),false);assert.equal(new URL(page.url()).searchParams.has('repeat'),false);
    await page.getByRole('button',{name:'Clear search',exact:true}).click();await page.goBack();
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('play')==='SYN_0002.MOV');
    assert.equal(new URL(page.url()).searchParams.get('play'),'SYN_0002.MOV');assert.equal(new URL(page.url()).searchParams.has('t'),false);assert.equal(new URL(page.url()).searchParams.has('repeat'),false);
    assert.equal(await quick.getAttribute('aria-pressed'),'false');
  },{query:'&t=0.5%2C1.25&repeat=1'});
  privateScenario('full-source native end repeats and disabling Repeat restores ordinary stop',async page=>{
    await waitLive(page,'audio',false);await page.waitForSelector('button[aria-label="Play take SYN_0001.MOV"]');await collapsePractice(page);const baseline=(await media(page)).length;await page.click('.play-button');await waitLive(page,'audio',true);
    await page.waitForFunction(()=>window.__audioEvents.some(event=>event.type==='ended'&&event.src.includes('reference-audio/')));
    await waitLive(page,'audio',true);assert.equal((await media(page)).length,baseline,'native end reuses its existing audio element');
    await page.getByRole('button',{name:'Repeat selected excerpt',exact:true}).click();
    assert.equal(new URL(page.url()).searchParams.has('repeat'),false);
    await waitLive(page,'audio',false);assert.ok((await live(page))[0].time>=2.35);
    assert.equal(await playLabel(page),'Play selected recording');
  },{query:'&t=0%2C2.5&repeat=1',nativeEnd:true});
  privateScenario('range controls validate drafts and copy the playing song target',async page=>{
    await waitLive(page,'audio',false);await expandPractice(page);
    const a=page.getByRole('spinbutton',{name:'A (seconds)',exact:true}),b=page.getByRole('spinbutton',{name:'B (seconds)',exact:true});
    await page.getByRole('button',{name:'Set A here',exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('t'),'0.5,1.25');
    await a.fill('1.5');await b.fill('1');await page.getByRole('button',{name:'Apply range',exact:true}).click();
    assert.match(await page.locator('.practice-error').innerText(),/B must come after A/);assert.equal(new URL(page.url()).searchParams.get('t'),'0.5,1.25');
    await a.fill('.75');await b.fill('1.5');await page.getByRole('button',{name:'Apply range',exact:true}).click();
    assert.equal(new URL(page.url()).searchParams.get('t'),'0.75,1.5');
    await page.getByRole('button',{name:'Use selected excerpt',exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('t'),'0,2.5');
    await a.fill('.5');await b.fill('1');await page.getByRole('button',{name:'Apply range',exact:true}).click();
    await collapsePractice(page);await nav(page,'Songs');await page.getByRole('link',{name:'Unrecorded Song',exact:true}).click();
    await expandPractice(page);await page.getByRole('button',{name:'Copy practice link',exact:true}).click();
    const copied=new URL(await page.evaluate(()=>window.__copiedPractice));assert.equal(copied.searchParams.get('play'),'ref:alpha-original');assert.equal(copied.searchParams.get('song'),'synthetic-alpha');assert.equal(copied.searchParams.get('t'),'0.5,1');assert.equal(copied.searchParams.get('repeat'),'1');
  },{query:'&t=0.5%2C1.25&repeat=1',clipboard:'capture'});
  privateScenario('missing asset is unavailable and video remains an explicit fallback',async page=>{
    await page.waitForSelector('.playback-error');assert.equal(await status(page),'Unavailable');assert.equal((await playing(page)).length,0);
    assert.equal(await page.getByRole('button',{name:'Repeat selected excerpt',exact:true}).isDisabled(),true,'failed local audio is not available for practice');
    await page.getByRole('group',{name:'Playback options'}).getByRole('button',{name:'Video',exact:true}).click();await waitLive(page,'youtube',false);assert.equal(await heading(page),'Alpha Song');
    assert.equal(await page.locator('.playback-error').count(),0);assert.equal(await page.getByRole('button',{name:'Repeat selected excerpt',exact:true}).isDisabled(),true,'video does not promise audio looping');
  },{missing:true});
}

test('private practice quarter-second loop restarts without a stale seek grace interval and stays paused at B',{skip:!executablePath},async()=>{
  const page=await open('desktop',privatePath('&t=1%2C1.25&repeat=1'),{referenceAudio:true});
  try{
    await waitLive(page,'audio',false);await waitRefWraps(page,1,1);
    await page.evaluate(()=>{window.__rangeSamples=[];window.__rangeTimer=setInterval(()=>{for(const m of window.__mediaState())if(m.src.includes('reference-audio/')&&!m.paused)window.__rangeSamples.push(m.time);},5);});
    const baseline=await refWrapCount(page,1);await page.click('.play-button');await waitLive(page,'audio',true);await waitRefWraps(page,1,baseline+3);
    await page.click('.play-button');await waitLive(page,'audio',false);await seek(page,.25);
    await page.waitForTimeout(500);assert.equal(await playLabel(page),'Play selected recording');assert.ok(Math.abs((await live(page))[0].time-1.25)<.03,JSON.stringify({media:await media(page),slider:await page.locator('input[aria-label="Seek within selected section"]').inputValue()}));
    await page.click('.play-button');await waitLive(page,'audio',true);const restarted=await refWrapCount(page,1);await waitRefWraps(page,1,restarted+2);
    const max=await page.evaluate(()=>Math.max(...window.__rangeSamples));assert.ok(max<1.35,`quarter-second range overshot to ${max}`);
    assert.equal((await media(page)).length,1);noErrors(page);
  }finally{await page.context().close();}
});

test('private practice invalid direct ranges stay with the exact source and denied clipboard shows the attempted semantic link',{skip:!executablePath},async()=>{
  const page=await open('desktop',privatePath('&t=2%2C1&repeat=1'),{referenceAudio:true,clipboard:'denied'});
  try{
    await waitLive(page,'audio',false);assert.equal(await heading(page),'Alpha Song');assert.match(await page.locator('.practice-link-error').innerText(),/B must come after A/);assert.equal(await page.getByRole('button',{name:'Repeat selected excerpt',exact:true}).getAttribute('aria-pressed'),'false');
    await expandPractice(page);await page.getByRole('spinbutton',{name:'A (seconds)',exact:true}).fill('.25');await page.getByRole('spinbutton',{name:'B (seconds)',exact:true}).fill('1');await page.getByRole('button',{name:'Apply range',exact:true}).click();
    await nav(page,'Songs');await page.getByRole('link',{name:'Unrecorded Song',exact:true}).click();await page.getByRole('button',{name:'Copy practice link',exact:true}).click();
    const link=page.locator('.manual-copy-link');await link.waitFor();const href=new URL(await link.getAttribute('href'));
    assert.equal(href.searchParams.get('play'),'ref:alpha-original');assert.equal(href.searchParams.get('song'),'synthetic-alpha');assert.equal(href.searchParams.get('t'),'0.25,1');assert.equal(href.searchParams.has('repeat'),false);noErrors(page);
  }finally{await page.context().close();}
});

test('private practice repeats only local audio and video plays the selected excerpt once',{skip:!executablePath},async()=>{
  const page=await open('desktop',privatePath('&t=0.5%2C1.25&repeat=1'),{referenceAudio:true});
  try{
    await waitLive(page,'audio',false);
    await page.getByRole('group',{name:'Playback options'}).getByRole('button',{name:'Video',exact:true}).click();await waitLive(page,'youtube',false);
    const quick=page.getByRole('button',{name:'Repeat selected excerpt',exact:true});assert.equal(await quick.isDisabled(),true);assert.equal(await quick.getAttribute('aria-pressed'),'false');
    await page.click('.play-button');await waitLive(page,'youtube',true);await waitLive(page,'youtube',false);
    assert.ok(Math.abs((await live(page))[0].time-1.25)<.1);
    await page.waitForTimeout(350);assert.equal(await playLabel(page),'Play selected recording');assert.equal((await playing(page)).length,0);
    await page.getByRole('group',{name:'Playback options'}).getByRole('button',{name:'Audio',exact:true}).click();await waitLive(page,'audio',false);
    assert.equal(await quick.getAttribute('aria-pressed'),'true');const baseline=await refWrapCount(page,.5);
    await page.click('.play-button');await waitLive(page,'audio',true);await waitRefWraps(page,.5,baseline+2);assert.equal((await live(page)).length,1);noErrors(page);
  }finally{await page.context().close();}
});

test('private practice quick Repeat and transport remain genuinely reachable in short-height layouts',{skip:!executablePath},async()=>{
  const page=await open('mobile',privatePath(),{referenceAudio:true});
  try{
    await waitLive(page,'audio',false);
    for(const width of [375,767]){
      await page.setViewportSize({width,height:375});
      const quick=page.getByRole('button',{name:'Repeat selected excerpt',exact:true}), rect=await quick.boundingBox();
      assert.ok(rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width&&rect.y+rect.height<=375,JSON.stringify(rect));
      const buttons=[quick,page.getByRole('group',{name:'Playback options'}).getByRole('button',{name:'Audio',exact:true}),page.getByRole('group',{name:'Playback options'}).getByRole('button',{name:'Video',exact:true}),page.locator('.play-button')];
      const boxes=await Promise.all(buttons.map(button=>button.boundingBox()));
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(a&&b);assert.ok(Math.min(a.x+a.width,b.x+b.width)<=Math.max(a.x,b.x)||Math.min(a.y+a.height,b.y+b.height)<=Math.max(a.y,b.y),`controls overlap at ${width}: ${JSON.stringify(boxes)}`);}
      await quick.click();assert.equal(await quick.getAttribute('aria-pressed'),'true');await page.click('.play-button');await waitLive(page,'audio',true);
      await page.click('.play-button');await waitLive(page,'audio',false);await quick.click();assert.equal(await quick.getAttribute('aria-pressed'),'false');
      await noOverflow(page);await page.shot(`practice-short-${width}`);
    }
    noErrors(page);
  }finally{await page.context().close();}
});

test('private practice original survives delayed archive hydration with the same playing backend',{skip:!executablePath},async()=>{
  const page=await open('desktop',privatePath('&t=.5%2C1.25&repeat=1'),{referenceAudio:true,delayArchive:true});
  try{
    await waitLive(page,'audio',false);await page.click('.play-button');await waitLive(page,'audio',true);
    const count=(await media(page)).length;assert.equal(count,1);
    page.releaseArchive();await page.waitForSelector('button[aria-label="Play take SYN_0001.MOV"]');await waitLive(page,'audio',true);
    assert.equal((await media(page)).length,count,'archive data cannot reconstruct a reference backend');
    const baseline=await refWrapCount(page,.5);await waitRefWraps(page,.5,baseline+2);assert.equal(await heading(page),'Alpha Song');noErrors(page);
  }finally{page.releaseArchive();await page.context().close();}
});

test('private practice fast full-source repetitions survive native end and timer ordering',{skip:!executablePath},async()=>{
  const page=await open('desktop',privatePath('&t=0%2C2.5&repeat=1'),{referenceAudio:true});
  try{
    await waitLive(page,'audio',false);await page.waitForSelector('button[aria-label="Play take SYN_0001.MOV"]');
    await page.evaluate(()=>{window.__media.find(element=>element.dataset.kind==='audio'&&element.getAttribute('src')) .playbackRate=16;});
    const initial=await refWrapCount(page,0), count=(await media(page)).length;
    await page.click('.play-button');await waitLive(page,'audio',true);
    await waitRefWraps(page,0,initial+10);
    await waitLive(page,'audio',true);assert.equal((await media(page)).length,count);assert.equal((await playing(page)).length,1);
    await page.click('.play-button');await waitLive(page,'audio',false);await page.waitForTimeout(250);assert.equal((await playing(page)).length,0,'explicit Pause wins over pending native or polling wraps');noErrors(page);
  }catch(error){console.log(JSON.stringify({status:await status(page),media:await media(page),events:(await audioEvents(page)).slice(-15)}));throw error;}
  finally{await page.context().close();}
});

const stemState = page => page.evaluate(()=>({contexts:window.__stemContexts.map(context=>({state:context.state,time:context.currentTime,rate:context.sampleRate})),starts:window.__stemStarts,stops:window.__stemStops,gains:window.__stemGains}));
const stemsButton = page => page.getByRole('button',{name:'Stems',exact:true});
const sectionRow = (page,label) => page.locator('.section-row').filter({has:page.getByRole('button',{name:`Play ${label}`,exact:true})});
const savedSection = async (label,start,end) => {
  const response=await fetch(fixture.origin+'/api/practice',{method:'POST',headers:{'Content-Type':'application/json',Origin:fixture.origin},body:JSON.stringify({sourceId:'ref:alpha-original',sourceHash:fixture.sourceHash,label,start,end})});
  assert.equal(response.status,201);return (await response.json()).section;
};
const setDraftRange = async (page,start,end) => {
  await page.getByRole('spinbutton',{name:'A (seconds)',exact:true}).fill(String(start));
  await page.getByRole('spinbutton',{name:'B (seconds)',exact:true}).fill(String(end));
  await page.getByRole('button',{name:'Apply range',exact:true}).click();
};
const pilotScenario = (label,fn,options={}) => test(`practice pilot: ${label}`,{skip:!executablePath},async()=>{
  const page=await open(options.mobile?'mobile':'desktop',privatePath(options.query||'&t=.75%2C1.5'),{referenceAudio:true,practice:true,clipboard:'capture',failDecode:options.failDecode});
  try{await waitLive(page,'audio',false);await expandPractice(page);await page.locator('.source-sections').waitFor();await page.getByRole('button',{name:'Add section',exact:true}).waitFor();await fn(page);noErrors(page);}catch(error){await page.shot('pilot-failure-'+label.replaceAll(/[^a-z0-9]+/gi,'-'));console.log(JSON.stringify({label,url:page.url(),status:await status(page),stem:await stemState(page),text:await page.locator('.player-extra').innerText().catch(()=>''),media:await media(page)}));throw error;}finally{await page.context().close();}
});

pilotScenario('sections save, rename by stable UUID, reopen paused and manual ranges replace semantic targets',async page=>{
  await page.getByRole('button',{name:'Add section',exact:true}).click();
  await page.getByRole('textbox',{name:'Section name',exact:true}).fill('Synthetic verse');
  assert.equal(await page.getByRole('spinbutton',{name:'Original start (seconds)',exact:true}).inputValue(),'0.75');
  await page.getByRole('button',{name:'Create section',exact:true}).click();
  const row=sectionRow(page,'Synthetic verse');await row.waitFor();
  await row.getByRole('button',{name:'Play Synthetic verse',exact:true}).click();
  await page.waitForFunction(()=>new URL(location.href).searchParams.has('section'));
  const id=new URL(page.url()).searchParams.get('section');assert.match(id,/^[0-9a-f-]{36}$/);assert.equal(new URL(page.url()).searchParams.has('t'),false);
  const quick=page.getByRole('button',{name:'Repeat selected excerpt',exact:true});
  if(await quick.getAttribute('aria-pressed')!=='true')await quick.click();
  if(await status(page)!=='Playing')await page.click('.play-button');
  await waitLive(page,'audio',true);const providers=(await media(page)).length;
  await row.getByRole('button',{name:'Edit Synthetic verse',exact:true}).click();
  await page.getByRole('textbox',{name:'Section name',exact:true}).fill('Synthetic verse renamed');
  await page.getByRole('button',{name:'Update section',exact:true}).click();
  const renamed=sectionRow(page,'Synthetic verse renamed');await renamed.waitFor();
  assert.equal(new URL(page.url()).searchParams.get('section'),id);
  await waitLive(page,'audio',true);assert.equal((await media(page)).length,providers,'rename leaves the transport intact');
  await renamed.getByRole('button',{name:'Copy Synthetic verse renamed link',exact:true}).click();
  const copied=await page.evaluate(()=>window.__copiedPractice);assert.equal(new URL(copied).searchParams.get('section'),id);
  await page.reload();await page.waitForSelector('.workspace-main h1');await waitLive(page,'audio',false);await expandPractice(page);
  await sectionRow(page,'Synthetic verse renamed').waitFor();assert.equal(new URL(page.url()).searchParams.get('section'),id);
  assert.ok(Math.abs((await live(page))[0].time-.75)<.08);
  await setDraftRange(page,.8,1.4);assert.equal(new URL(page.url()).searchParams.has('section'),false);assert.equal(new URL(page.url()).searchParams.get('t'),'0.8,1.4');
});

pilotScenario('six stems use one clock, gains preserve playback, loops survive browsing and Pause wins',async page=>{
  const quick=page.getByRole('button',{name:'Repeat selected excerpt',exact:true});await quick.click();
  await stemsButton(page).click();await page.locator('.stem-mixer').waitFor();await waitStatus(page,'Paused');
  assert.equal((await playing(page)).length,0,'full mix stops before stems');
  assert.equal((await stemState(page)).contexts.filter(context=>context.state!=='closed').length,1);
  await page.click('.play-button');await waitStatus(page,'Playing');
  await page.waitForFunction(()=>window.__stemStarts.length>=6);
  const initial=await stemState(page),starts=initial.starts.slice(-6);assert.equal(new Set(starts.map(start=>start.context)).size,1);assert.equal(new Set(starts.map(start=>start.when)).size,1);assert.equal(new Set(starts.map(start=>start.offset)).size,1);assert.ok(starts.every(start=>start.loop));
  const count=initial.starts.length;
  await page.getByRole('slider',{name:'Vocals volume',exact:true}).evaluate(input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'35');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.getByRole('button',{name:'Solo Vocals',exact:true}).click();await page.getByRole('button',{name:'Solo Bass',exact:true}).click();await page.getByRole('button',{name:'Mute Vocals',exact:true}).click();
  assert.equal((await stemState(page)).starts.length,count,'gain, mute and multi-solo do not restart tracks');
  assert.deepEqual((await stemState(page)).gains.slice(-6).map(gain=>gain.value),[0,0,1,0,0,0],'mute wins, multiple solos retain independent state');
  await collapsePractice(page);await nav(page,'Sessions');await filterBySong(page,'no-pilot-matches');await page.waitForTimeout(1800);
  assert.equal(await status(page),'Playing');assert.equal((await stemState(page)).starts.length,count,'loop and browsing reuse scheduled source nodes');
  await page.click('.play-button');await waitStatus(page,'Paused');await page.waitForTimeout(300);assert.equal(await status(page),'Paused');assert.equal((await stemState(page)).stops.length,count);assert.equal((await playing(page)).length,0);
});

pilotScenario('named ranges crossing stem coverage stay intact with an explicit error',async page=>{
  const section=await savedSection('Outside stem coverage',0,.75);
  await page.reload();await waitLive(page,'audio',false);await expandPractice(page);
  await sectionRow(page,section.label).getByRole('button',{name:`Play ${section.label}`,exact:true}).click();
  await page.waitForFunction(id=>new URL(location.href).searchParams.get('section')===id,section.id);
  const original=page.url();await stemsButton(page).click();
  await page.getByText(/cover.*(?:only|source)|outside.*(?:coverage|excerpt)|section.*outside/i).first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get('section'),section.id);assert.equal(new URL(page.url()).searchParams.has('t'),false);assert.equal((await stemState(page)).starts.length,0);
  assert.equal(await stemsButton(page).getAttribute('aria-pressed'),'false');assert.equal(new URL(original).searchParams.get('section'),section.id);
});

pilotScenario('failed stem decoding closes its context and leaves an explicit full-mix fallback',async page=>{
  await stemsButton(page).click();await page.getByText(/decode failure|could not.*stem|cannot.*stem|unable.*stem/i).first().waitFor();
  await page.waitForFunction(()=>window.__stemContexts.length>0&&window.__stemContexts.every(context=>context.state==='closed'));
  assert.equal((await stemState(page)).starts.length,0);assert.equal((await playing(page)).length,0);
  await page.getByRole('group',{name:'Playback options'}).getByRole('button',{name:'Audio',exact:true}).click();await waitLive(page,'audio',false);
  await page.click('.play-button');await waitLive(page,'audio',true);
},{failDecode:true});

pilotScenario('phone section drafts and six mixer rows remain reachable without overflow',async page=>{
  await page.getByRole('button',{name:'Add section',exact:true}).click();
  const field=page.getByRole('textbox',{name:'Section name',exact:true});await field.fill('Phone rehearsal section');assert.ok(await field.evaluate(input=>parseFloat(getComputedStyle(input).fontSize)>=16));
  await page.getByRole('button',{name:'Create section',exact:true}).click();await sectionRow(page,'Phone rehearsal section').waitFor();
  await stemsButton(page).click();await page.locator('.stem-mixer').waitFor();
  await page.getByRole('button',{name:'Mute Other',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Mute Other',exact:true}).getAttribute('aria-pressed'),'true');
  await noOverflow(page);const geometry=await page.locator('.player-extra').evaluate(panel=>({width:panel.clientWidth,scrollWidth:panel.scrollWidth,rect:panel.getBoundingClientRect().toJSON(),overflows:[...panel.querySelectorAll('*')].filter(element=>element.getBoundingClientRect().right>panel.getBoundingClientRect().right+.5).map(element=>({tag:element.tagName,class:element.className,text:element.textContent.slice(0,60),rect:element.getBoundingClientRect().toJSON()}))}));assert.equal(geometry.scrollWidth>geometry.width,false,JSON.stringify(geometry));await page.shot('practice-pilot-phone');
},{mobile:true});


test('practice pilot: replacing a source during stem loading aborts it without hidden starts',{skip:!executablePath},async()=>{
  const page=await open('desktop',privatePath('&t=.75%2C1.5'),{referenceAudio:true,practice:true,delayStems:true});
  try{
    await waitLive(page,'audio',false);await expandPractice(page);
    const requested=page.waitForRequest('**/reference-audio/stems/*.wav');await stemsButton(page).click();await requested;
    await collapsePractice(page);await nav(page,'Our takes');await playTake(page,'SYN_0002.MOV');await waitLive(page,'audio',true);
    page.releaseStems();await page.waitForFunction(()=>window.__stemContexts.every(context=>context.state==='closed'));
    assert.equal((await stemState(page)).starts.length,0);assert.equal(await heading(page),'Bravo full take');assert.equal((await playing(page)).length,1);noErrors(page);
  }finally{page.releaseStems();await page.context().close();}
});


test('practice pilot: API retry resolves a pending section but cannot override newer manual intent',{skip:!executablePath},async()=>{
  const section=await savedSection('Retry section',.75,1.5);
  for(const replace of ['retry','range','repeat']){
    const page=await open('desktop',privatePath('&section='+section.id+'&repeat=1'),{referenceAudio:true,practice:true,practiceFailFirst:true});
    try{
      await waitLive(page,'audio',false);await expandPractice(page);await page.getByText('Synthetic sections unavailable.',{exact:true}).waitFor();
      if(replace==='range')await setDraftRange(page,.8,1.4);
      if(replace==='repeat')await page.getByRole('button',{name:'Repeat selected excerpt',exact:true}).click();
      await page.getByRole('button',{name:'Reload sections',exact:true}).click();
      await sectionRow(page,section.label).waitFor();await page.waitForTimeout(100);
      const url=new URL(page.url());assert.equal(await status(page),'Paused');
      if(replace==='range'){assert.equal(url.searchParams.has('section'),false);assert.equal(url.searchParams.get('t'),'0.8,1.4');assert.equal(await page.getByRole('spinbutton',{name:'A (seconds)',exact:true}).inputValue(),'0.8');}
      else if(replace==='repeat'){assert.equal(url.searchParams.has('section'),false);assert.equal(url.searchParams.get('t'),'0,2.5');assert.equal(url.searchParams.get('repeat'),'1');assert.equal(await page.getByRole('spinbutton',{name:'A (seconds)',exact:true}).inputValue(),'0');}
      else{assert.equal(url.searchParams.get('section'),section.id);assert.equal(url.searchParams.has('t'),false);assert.equal(await page.getByRole('spinbutton',{name:'A (seconds)',exact:true}).inputValue(),'0.75');}
      noErrors(page);
    }finally{await page.context().close();}
  }
});
