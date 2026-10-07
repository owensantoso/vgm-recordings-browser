import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { createFixture, initScript } from './browser/fixture.mjs';
import { chromeExecutable } from './browser/chrome.mjs';

test('song, source-range/instrument and archive notes retain their clocks and reopen paused on desktop and phone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vgm-jam-comments-'));
  const fixture = await createFixture(directory, { flac:true, seconds:8 });
  const browser = await chromium.launch({ executablePath:chromeExecutable(), headless:true, args:['--mute-audio'] });
  await mkdir('.test-artifacts/jam-comments', {recursive:true});
  try {
    for (const width of [1440,375]) {
      const context = await browser.newContext({viewport:{width,height:900}});
      await context.addInitScript(initScript);
      await context.route('**/data/catalog.json', async route => {
        const response = await route.fetch(), catalog = await response.json();
        catalog.references = catalog.references.map(ref => ref.id === 'alpha-original' ? {...ref,...fixture.referenceAudio} : ref);
        await route.fulfill({json:catalog});
      });
      await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({contentType:'text/javascript',body:fixture.youtubeApi}));
      const page = await context.newPage(), errors=[];
      page.on('pageerror', error=>errors.push(error.message));
      await page.goto(fixture.origin+'/?view=songs&song=synthetic-alpha');
      const ui=page.getByRole('region',{name:'Jams and comments'});
      await ui.getByRole('textbox',{name:'Comment text'}).fill(`Song-wide ${width}`);
      await ui.getByRole('button',{name:'Add comment',exact:true}).click();
      await ui.locator('.jam-comments li').filter({hasText:`Song-wide ${width}`}).waitFor();
      await ui.getByRole('combobox',{name:'Comment target'}).selectOption('reference:alpha-original');
      await page.waitForFunction(()=>!document.querySelector('select[aria-label="Comment timing"] option[value="range"]').disabled);
      await ui.getByRole('combobox',{name:'Comment timing'}).selectOption('range');
      await ui.getByRole('spinbutton',{name:'Comment start seconds'}).fill('1');
      await ui.getByRole('spinbutton',{name:'Comment end seconds'}).fill('3');
      await ui.getByRole('combobox',{name:'Comment instrument'}).selectOption('piano');
      await ui.getByRole('textbox',{name:'Comment text'}).fill(`Piano source range ${width}`);
      await ui.getByRole('button',{name:'Add comment',exact:true}).click();
      const note=ui.locator('.jam-comments li').filter({hasText:`Piano source range ${width}`});
      await note.waitFor(); assert.match(await note.innerText(),/Recording 0:01–0:03.*Piano/);
      const href=await note.getByRole('link',{name:'Open this moment'}).getAttribute('href');
      assert.match(href,/clock=source/);assert.match(href,/at=1/);assert.match(href,/comment=/);
      await page.goto(href);
      const reopened=page.getByRole('region',{name:'Jams and comments'});
      await reopened.locator('.jam-comments .is-highlighted').waitFor();
      await page.waitForFunction(()=>document.querySelector('.time')?.textContent==='0:01');
      assert.equal(await page.getByRole('button',{name:'Play selected recording',exact:true}).count(),1);
      await reopened.getByRole('combobox',{name:'Comment target'}).selectOption('archive:SYN_0001.MOV');
      await reopened.getByRole('textbox',{name:'Comment text'}).fill(`Archive note ${width}`);
      await reopened.getByRole('button',{name:'Add comment',exact:true}).click();
      await reopened.locator('.jam-comments li').filter({hasText:`Archive note ${width}`}).waitFor();
      assert.equal(await page.locator('.workspace-main').evaluate(main=>main.scrollWidth<=main.clientWidth+1),true);
      await page.screenshot({path:`.test-artifacts/jam-comments/${width}.png`});
      assert.deepEqual(errors,[]); await context.close();
    }
  } finally { await browser.close();await fixture.close();await rm(directory,{recursive:true,force:true}); }
});

test('free and stale jam links stay visible across other-song playback and missing backing', async () => {
  const directory=await mkdtemp(join(tmpdir(),'vgm-jam-links-'));
  const fixture=await createFixture(directory,{flac:true,seconds:8});
  const browser=await chromium.launch({executablePath:chromeExecutable(),headless:true,args:['--mute-audio']});
  try {
    const context=await browser.newContext(); await context.addInitScript(initScript);
    await context.route('**/data/catalog.json',async route=>{const response=await route.fetch(),catalog=await response.json();catalog.references=catalog.references.map(ref=>ref.id==='alpha-original'?{...ref,...fixture.referenceAudio}:ref);await route.fulfill({json:catalog});});
    await context.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:fixture.youtubeApi}));
    const source=await (await context.request.get(fixture.origin+'/api/jams/context?kind=reference&id=alpha-original')).json();
    const bytes=await readFile(join(directory,'audio/SYN_0001.wav'));
    async function save(input){const response=await context.request.post(fixture.origin+'/api/jams',{headers:{Origin:fixture.origin,'Content-Type':'audio/wav','X-Jam-Metadata':encodeURIComponent(JSON.stringify(input))},data:bytes});assert.equal(response.status(),201,await response.text());return(await response.json()).jam;}
    const common={schemaVersion:1,songId:'synthetic-alpha',instrument:{kind:'stem',source:source.audio,stemSetId:source.stemSet.id,stemSetRevision:source.stemSet.revision,trackId:'piano',labelSnapshot:'Piano'},sections:[],captureEnd:'stopped'};
    const free=await save({...common,captureId:randomUUID(),title:'Free Piano jam',alignment:null,backingMix:null});
    const page=await context.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(fixture.origin+'/?view=songs&song=synthetic-alpha&tab=overview&play=ref:unrecorded-original');
    const card=page.locator('.jam-card').filter({hasText:'Free Piano jam'});await card.waitFor();
    await card.getByRole('button',{name:'Listen to mic',exact:true}).click();
    try { await page.locator('.jam-review h3').filter({hasText:'Free Piano jam'}).waitFor({timeout:10000}); }
    catch(error){await page.screenshot({path:'.test-artifacts/jam-comments/free-jam-failure.png'});console.error('Free jam diagnostic',await page.locator('body').innerText(),errors,page.url());throw error;}
    assert.equal(await page.getByRole('button',{name:'Mic only',exact:true}).isEnabled(),true);
    await page.goto(fixture.origin+`/?view=songs&song=synthetic-alpha&jam=${free.id}`);
    await page.locator('.jam-review h3').filter({hasText:'Free Piano jam'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Enable microphone',exact:true}).count(),0);
    const ui=page.getByRole('region',{name:'Jams and comments'});
    await ui.getByRole('combobox',{name:'Comment target'}).selectOption(`jam:${free.id}`);
    await page.waitForFunction(()=>!document.querySelector('select[aria-label="Comment timing"] option[value="point"]').disabled);
    await ui.getByRole('combobox',{name:'Comment timing'}).selectOption('point');
    await ui.getByRole('spinbutton',{name:'Comment start seconds'}).fill('1');
    await ui.getByRole('combobox',{name:'Comment instrument'}).selectOption('played');
    await ui.getByRole('textbox',{name:'Comment text'}).fill('Played piano mic moment');
    await ui.getByRole('button',{name:'Add comment',exact:true}).click();
    const micNote=ui.locator('.jam-comments li').filter({hasText:'Played piano mic moment'});await micNote.waitFor();
    assert.match(await micNote.innerText(),/Mic 0:01.*Piano/);
    const micLink=await micNote.getByRole('link',{name:'Open this moment'}).getAttribute('href');assert.match(micLink,/clock=mic/);
    await page.goto(micLink);await page.locator('.jam-review h3').filter({hasText:'Free Piano jam'}).waitFor();
    await page.locator('.jam-comments .is-highlighted').waitFor();
    await page.waitForFunction(()=>Math.abs(document.querySelector('.jam-review audio').currentTime-1)<.01);
    assert.equal(await page.locator('.jam-review audio').evaluate(audio=>audio.paused),true);
    const micUi=page.getByRole('region',{name:'Jams and comments'});
    await micUi.getByRole('combobox',{name:'Comment timing'}).selectOption('point');
    await micUi.getByRole('spinbutton',{name:'Comment start seconds'}).fill('2');
    await micUi.getByRole('textbox',{name:'Comment text'}).fill('Second mic moment');
    await micUi.getByRole('button',{name:'Add comment',exact:true}).click();
    const second=micUi.locator('.jam-comments li').filter({hasText:'Second mic moment'});await second.waitFor();
    await second.getByRole('link',{name:'Open this moment'}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('.jam-review audio').currentTime-2)<.01);
    await micUi.locator('.jam-comments li').filter({hasText:'Played piano mic moment'}).getByRole('link',{name:'Open this moment'}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('.jam-review audio').currentTime-1)<.01);
    assert.equal(await page.locator('.jam-review audio').evaluate(audio=>audio.paused),true);
    const stale=await save({...common,captureId:randomUUID(),title:'Retained stale overdub',backingMix:{schemaVersion:1,source:source.audio,mode:'original',playbackRate:.75,masterGain:1,stems:null},alignment:{source:source.audio,sourceAtCaptureZero:1,sourceSecondsPerCaptureSecond:.75,clockBasis:'observed-media-time',estimateProvenance:'Synthetic test observations',coverage:{micStart:0,micEnd:3,sourceStart:1,sourceEnd:3.25},correctionSeconds:0,correctionReviewed:false}});
    const catalogPath=join(directory,'data/catalog.json'),catalog=JSON.parse(await readFile(catalogPath,'utf8'));catalog.references=catalog.references.filter(ref=>ref.id!=='alpha-original');await writeFile(catalogPath,JSON.stringify(catalog));
    await page.goto(fixture.origin+`/?view=songs&song=synthetic-alpha&play=ref:alpha-original&jam=${stale.id}`);
    await page.locator('.jam-review h3').filter({hasText:'Retained stale overdub'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Mic only',exact:true}).isEnabled(),true);
    assert.equal(await page.getByRole('button',{name:'Play with recorded mix',exact:true}).isDisabled(),true);
    assert.deepEqual(errors,[]);await context.close();
  } finally{await browser.close();await fixture.close();await rm(directory,{recursive:true,force:true});}
});
