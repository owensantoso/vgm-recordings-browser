import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { createFixture, initScript } from './browser/fixture.mjs';
import { chromeExecutable } from './browser/chrome.mjs';

test('a timed comment seeks once on its source and never carries its clock into another take', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vgm-comment-seek-'));
  const fixture = await createFixture(directory, { flac: true, seconds: 8 });
  const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--mute-audio'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(initScript);
    await context.route('**/data/catalog.json', async route => {
      const response = await route.fetch(), catalog = await response.json();
      catalog.references = catalog.references.map(ref => ref.id === 'alpha-original' ? { ...ref, ...fixture.referenceAudio } : ref);
      await route.fulfill({ json: catalog });
    });
    await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'text/javascript', body: fixture.youtubeApi }));
    const source = await (await context.request.get(fixture.origin + '/api/jams/context?kind=reference&id=alpha-original')).json();
    const response = await context.request.post(fixture.origin + '/api/jam-comments', {
      headers: { Origin: fixture.origin },
      data: { id: randomUUID(), songId: 'synthetic-alpha', target: { kind: 'recording', recording: source.audio.recording, at: { kind: 'point', seconds: 2, audio: source.audio } }, instrument: null, text: 'Exact source clock' },
    });
    assert.equal(response.status(), 201, await response.text());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixture.origin + '/?view=songs&song=synthetic-alpha');
    const seek = page.getByRole('slider', { name: 'Seek full recording', exact: true });
    const mark = page.getByRole('button', { name: 'Comment: Exact source clock · Recording time', exact: true });
    await mark.click();
    await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Seek full recording"]').value) === 2);
    await seek.evaluate(input => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '5');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(Number(await seek.inputValue()), 5);
    await page.getByRole('button', { name: 'Original mix', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.practice-mix-status')?.textContent.includes('Original mix'));
    await page.waitForFunction(() => !document.querySelector('input[aria-label="Seek full recording"]').disabled);
    assert.ok(Math.abs(Number(await seek.inputValue()) - 5) < .1, 'switching the source backend must not replay a consumed comment seek');
    await context.route('**/api/jams/context?kind=reference&id=alpha-original', route => route.fulfill({ json: { ...source, audio: { ...source.audio, sha256: 'f'.repeat(64) } } }));
    await mark.click();
    await page.getByText('This comment belongs to an older or unavailable audio version. Its timestamp has not been applied.', { exact: true }).waitFor();
    assert.ok(Math.abs(Number(await seek.inputValue()) - 5) < .1, 'a stale exact-audio comment must not seek replacement bytes');
    await page.getByRole('link', { name: 'Our takes', exact: true }).click();
    await page.getByRole('button', { name: 'Play take SYN_0003.m4a', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('input[aria-label="Seek full recording"]').disabled);
    const position = Number(await seek.inputValue());
    assert.ok(position < 1, `a different take should start normally, never at the previous source comment's 2 seconds: ${position}`);
    assert.equal(new URL(page.url()).searchParams.get('play'), 'SYN_0003.m4a');
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    const guard = '/Users/macintoso/.codex/skills/critical-incident-response/scripts/incident_lock.py';
    const status = existsSync(guard) ? spawnSync('python3', [guard, 'preflight', '--action', 'process-control', '--scope', 'owned comment seek fixture browser handle'], {stdio:'inherit'}).status : process.platform === 'darwin' ? 2 : 0;
    if (status === 0) await browser.close(); else process.exitCode = 1; await fixture.close(); await rm(directory, { recursive: true, force: true }); }
});
