import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { createFixture, initScript } from './browser/fixture.mjs';
import { chromeExecutable } from './browser/chrome.mjs';

test('timeline comments keep exact source/instrument and mic clocks, with stacked aligned jams on desktop and phone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vgm-timeline-activity-'));
  const fixture = await createFixture(directory, { flac: true, seconds: 8 });
  const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--mute-audio'] });
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(initScript);
      await context.route('**/data/catalog.json', async route => { const response = await route.fetch(), catalog = await response.json(); catalog.references = catalog.references.map(ref => ref.id === 'alpha-original' ? { ...ref, ...fixture.referenceAudio } : ref); await route.fulfill({ json: catalog }); });
      await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'text/javascript', body: fixture.youtubeApi }));
      const source = await (await context.request.get(fixture.origin + '/api/jams/context?kind=reference&id=alpha-original')).json();
      const bytes = await readFile(join(directory, 'audio/SYN_0001.wav'));
      async function save(input) { const response = await context.request.post(fixture.origin + '/api/jams', { headers: { Origin: fixture.origin, 'Content-Type': 'audio/wav', 'X-Jam-Metadata': encodeURIComponent(JSON.stringify(input)) }, data: bytes }); assert.equal(response.status(), 201, await response.text()); return (await response.json()).jam; }
      const common = { schemaVersion: 1, captureId: randomUUID(), songId: 'synthetic-alpha', title: `Timeline piano ${width}`, instrument: { kind: 'custom', label: 'Piano' }, sections: [], captureEnd: 'stopped', backingMix: { schemaVersion: 1, source: source.audio, mode: 'original', playbackRate: .5, masterGain: 1, stems: null }, alignment: { source: source.audio, sourceAtCaptureZero: 1, sourceSecondsPerCaptureSecond: .5, clockBasis: 'observed-media-time', estimateProvenance: 'Synthetic timeline test', coverage: { micStart: 0, micEnd: 6, sourceStart: 1, sourceEnd: 4 }, correctionSeconds: .2, correctionReviewed: true } };
      const jam = await save(common);
      await save({ ...common, captureId: randomUUID(), title: `Timeline overlap ${width}` });
      await save({ ...common, captureId: randomUUID(), title: `Timeline free ${width}`, alignment: null, backingMix: null });
      const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(fixture.origin + '/?view=songs&song=synthetic-alpha');
      const controls = page.locator('.timeline-comment-toolbar');
      await controls.getByRole('button', { name: 'Comment mode', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('.timeline-comment-toolbar button')?.disabled === false);
      const bars = page.locator('.timeline-jam-bar');
      await bars.filter({ hasText: `Timeline piano ${width}` }).waitFor();
      assert.equal(await bars.filter({ hasText: 'Timeline free' }).count(), 0);
      const pianoBar = bars.filter({ hasText: `Timeline piano ${width}` });
      const overlapBar = bars.filter({ hasText: `Timeline overlap ${width}` });
      assert.notEqual(await pianoBar.evaluate(element => element.style.top), await overlapBar.evaluate(element => element.style.top));
      await controls.getByRole('button', { name: 'Comment at playhead', exact: true }).click();
      const pane = page.getByRole('complementary', { name: 'Timeline comment composer' });
      await pane.getByRole('textbox', { name: 'Timeline comment text' }).fill(`At playhead ${width}`);
      await pane.getByRole('button', { name: 'Save comment', exact: true }).click();
      await pane.getByText('Comment saved', { exact: true }).waitFor({timeout:5000}).catch(async error=>{console.error('Composer diagnostic',await page.locator('body').innerText());throw error;});
      await pane.getByRole('button', { name: 'Close timeline comments', exact: true }).click();
      await controls.getByRole('button', { name: 'Comment mode', exact: true }).click();
      const lane = page.locator('.instrument-lane').filter({ has: page.locator('strong', { hasText: 'Piano' }) }).locator('.waveform-lane');
      await lane.scrollIntoViewIfNeeded(); const box = await lane.boundingBox();
      await page.mouse.move(box.x + box.width * .25, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .5, box.y + box.height / 2); await page.mouse.up();
      await pane.getByRole('textbox', { name: 'Timeline comment text' }).fill(`Instrument range ${width}`);
      await pane.getByRole('button', { name: 'Save comment', exact: true }).click(); await pane.getByText('Comment saved', { exact: true }).waitFor({timeout:5000}).catch(async error=>{console.error('Composer diagnostic',await page.locator('body').innerText());throw error;});
      const notesResponse = await context.request.get(fixture.origin + '/api/jam-comments?' + new URLSearchParams({ target: JSON.stringify({ kind: 'recording', recording: source.audio.recording, at: null }), song: 'synthetic-alpha' }));
      const note = (await notesResponse.json()).comments.find(comment => comment.text === `Instrument range ${width}`);
      assert.equal(note.instrument.trackId, 'piano'); assert.equal(note.target.at.kind, 'range'); assert.equal(note.target.at.audio.sha256, source.audio.sha256); assert.ok(Math.abs(note.target.at.start - 2) < .1); assert.ok(Math.abs(note.target.at.end - 4) < .1);
      await pane.getByRole('button', { name: 'Close timeline comments', exact: true }).click();
      await pianoBar.scrollIntoViewIfNeeded(); const barBox = await pianoBar.boundingBox();
      await page.mouse.click(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
      await pane.getByRole('textbox', { name: 'Timeline comment text' }).fill(`Mic moment ${width}`);
      assert.match(await pane.innerText(), /Mic time/);
      await pane.getByRole('button', { name: 'Save comment', exact: true }).click(); await pane.getByText('Comment saved', { exact: true }).waitFor({timeout:5000}).catch(async error=>{console.error('Composer diagnostic',await page.locator('body').innerText());throw error;});
      const micResponse = await context.request.get(fixture.origin + '/api/jam-comments?' + new URLSearchParams({ target: JSON.stringify({ kind: 'recording', recording: { kind: 'jam', id: jam.id }, at: null }), song: 'synthetic-alpha' }));
      const micNote = (await micResponse.json()).comments.find(comment => comment.text === `Mic moment ${width}`);
      assert.equal(micNote.target.at.audio.sha256, jam.audio.sha256); assert.ok(Math.abs(micNote.target.at.seconds - 3.1) < .2);
      assert.equal(await page.locator('.workspace-main').evaluate(main => main.scrollWidth <= main.clientWidth + 1), true);
      // A draft is bound to its original target across navigation and reload.
      await pane.getByRole('button', { name: 'Close timeline comments', exact: true }).click();
      await controls.getByRole('button', { name: 'Comment at playhead', exact: true }).click();
      await pane.getByRole('textbox', { name: 'Timeline comment text' }).fill(`Scoped draft ${width}`);
      await page.goto(fixture.origin + '/?view=songs&song=unrecorded');
      await pane.getByRole('textbox', { name: 'Timeline comment text' }).waitFor();
      assert.equal(await pane.getByRole('textbox', { name: 'Timeline comment text' }).inputValue(), `Scoped draft ${width}`);
      assert.match(await pane.innerText(), /Synthetic original soundtrack/);
      await page.goto(fixture.origin + '/?view=songs&song=synthetic-alpha');
      await pane.getByRole('textbox', { name: 'Timeline comment text' }).waitFor();
      assert.equal(await pane.getByRole('textbox', { name: 'Timeline comment text' }).inputValue(), `Scoped draft ${width}`);
      // Clearing the text explicitly makes close non-destructive for this fixture.
      await pane.getByRole('textbox', { name: 'Timeline comment text' }).fill('');
      await pane.getByRole('button', { name: 'Close timeline comments', exact: true }).click();
      assert.deepEqual(errors, []); await context.close();
    }
  } finally {
    const guard = '/Users/macintoso/.codex/skills/critical-incident-response/scripts/incident_lock.py';
    const gate = existsSync(guard) ? spawnSync('python3', [guard, 'preflight', '--action', 'process-control', '--scope', 'owned timeline activity fixture browser handle'], { stdio: 'inherit' }).status : process.platform === 'darwin' ? 2 : 0;
    if (gate === 0) await browser.close(); else process.exitCode = 1;
    await fixture.close(); await rm(directory, { recursive: true, force: true });
  }
});
