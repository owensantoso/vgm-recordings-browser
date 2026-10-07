import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createFixture, initScript } from "./browser/fixture.mjs";
import { chromeExecutable } from './browser/chrome.mjs';

const chrome = chromeExecutable();
// Targeted real-browser geometry/feedback check. Synthetic media, no mic access.
test("practice artwork stays one owner through sticky contraction; effective gain only changes waveform graphics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vgm-practice-visuals-"));
  const fixture = await createFixture(directory, { flac: true, seconds: 8 });
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--mute-audio"] });
  await mkdir(".test-artifacts/practice-visuals", { recursive: true });
  try {
    for (const [name, viewport, reducedMotion] of [
      ["desktop", { width: 1440, height: 900 }, "no-preference"],
      ["phone", { width: 375, height: 812 }, "no-preference"],
      ["reduced", { width: 1280, height: 800 }, "reduce"],
    ]) {
      const context = await browser.newContext({ viewport, reducedMotion });
      const errors = [];
      await context.addInitScript(initScript);
      await context.route("**/data/catalog.json", async route => {
        const response = await route.fetch(), catalog = await response.json();
        catalog.references = catalog.references.map(ref => ref.id === "alpha-original" ? { ...ref, ...fixture.referenceAudio } : ref);
        await route.fulfill({ json: catalog });
      });
      await context.route("https://www.youtube.com/iframe_api", route => route.fulfill({ contentType: "text/javascript", body: fixture.youtubeApi }));
      // A deterministic decoded image, so image failures cannot mask geometry.
      await context.route("https://i.ytimg.com/**", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhQGAWjR9awAAAABJRU5ErkJggg==", "base64") }));
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(fixture.origin + "/?view=songs&song=synthetic-alpha");
      await page.locator(".instrument-lane").last().waitFor();
      await page.waitForFunction(() => !document.querySelector('input[aria-label="Vocals volume"]').disabled);
      assert.equal(await page.locator(".practice-song-identity .song-thumbnail").count(), 1);
      assert.match(await page.locator(".practice-song-identity img").getAttribute("src"), /Fixture0001/);
      const geometry = () => page.evaluate(() => {
        const header = document.querySelector(".practice-song-header"), artwork = header.querySelector(".song-thumbnail"), main = document.querySelector(".workspace-main");
        return { headerHeight: header.getBoundingClientRect().height, top: header.getBoundingClientRect().top, mainTop: main.getBoundingClientRect().top, artWidth: artwork.getBoundingClientRect().width, scoreOffset: document.querySelector(".practice-score").offsetTop, sameOwner: !window.__identityOwner || window.__identityOwner === header, gain: document.querySelector(".instrument-lane").dataset.effectiveGain };
      });
      await page.evaluate(() => { window.__identityOwner = document.querySelector(".practice-song-header"); });
      const start = await geometry();
      await page.screenshot({ path: `.test-artifacts/practice-visuals/${name}-expanded.png` });
      const scroll = async value => {
        await page.locator(".workspace-main").evaluate((main, top) => { main.scrollTop = top; }, value);
        await page.waitForTimeout(60);
        return geometry();
      };
      const middle = await scroll(48), compact = await scroll(180);
      assert.ok(start.artWidth > middle.artWidth && middle.artWidth > compact.artWidth);
      assert.equal(start.headerHeight, compact.headerHeight, "reserved header geometry cannot move the score");
      assert.equal(start.scoreOffset, compact.scoreOffset);
      assert.equal(compact.sameOwner, true);
      assert.ok(Math.abs(compact.top - compact.mainTop) <= 1, "identity stays at the main scroll edge: " + JSON.stringify({name,start,middle,compact}));
      await page.screenshot({ path: `.test-artifacts/practice-visuals/${name}-compact.png` });
      const reverse = await scroll(48);
      assert.ok(Math.abs(reverse.artWidth - middle.artWidth) < .1);
      await scroll(180); const restored = await scroll(0);
      assert.ok(Math.abs(restored.artWidth - start.artWidth) < .1, "rapid reversal restores the same artwork");
      const gain = page.getByRole("slider", { name: "Vocals volume", exact: true });
      const lane = page.locator(".instrument-lane").filter({ has: gain });
      const visual = () => lane.evaluate(row => ({ gain: Number(row.dataset.effectiveGain), opacity: Number(getComputedStyle(row.querySelector(".waveform-lane path")).opacity), filter: getComputedStyle(row.querySelector(".waveform-lane path")).filter, controlsOpacity: getComputedStyle(row.querySelector(".instrument-controls")).opacity }));
      const levels = [];
      for (const value of [20, 50, 100, 150, 200]) {
        await gain.evaluate((input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(value)); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }, value);
        await page.waitForTimeout(130);
        levels.push(await visual());
      }
      assert.deepEqual(levels.map(level => level.gain), [.2, .5, 1, 1.5, 2]);
      assert.ok(levels[0].opacity < levels[1].opacity && levels[1].opacity < levels[2].opacity);
      assert.match(levels[2].filter, /brightness\(1\)/);
      assert.match(levels[4].filter, /brightness\(1.35\)/);
      assert.ok(levels.every(level => level.controlsOpacity === "1"), "labels and controls remain fully readable");
      await lane.getByRole("button", { name: "Mute Vocals", exact: true }).click();
      assert.equal((await visual()).gain, 0);
      await lane.getByRole("button", { name: "Unmute Vocals", exact: true }).click();
      await page.getByRole("button", { name: "Solo Drums", exact: true }).click();
      assert.equal((await visual()).gain, 0, "a non-solo lane represents its effective silence");
      assert.equal(await gain.inputValue(), "200", "solo does not lose the saved gain");
      await page.getByRole("button", { name: "Solo Drums", exact: true }).click();
      assert.equal((await visual()).gain, 2);
      assert.equal(await page.locator(".workspace-main").evaluate(main => main.scrollWidth <= main.clientWidth + 1), true);
      await page.locator(".practice-song-identity img").evaluate(image => image.dispatchEvent(new Event("error")));
      assert.equal(await page.locator(".practice-song-identity img").count(), 0);
      assert.equal(await page.locator(".practice-song-identity .song-thumbnail > svg").count(), 1);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); await fixture.close(); await rm(directory, { recursive: true, force: true }); }
});
