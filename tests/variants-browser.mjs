import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const address = 'http://127.0.0.1:5207';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'examples/vanilla', '--host', '127.0.0.1', '--port', '5207', '--strictPort'], { cwd: root, stdio: 'pipe' });
let serverOutput = '';
server.stderr.on('data', (data) => { serverOutput += data; });
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;background:#151d24;color:white;font:16px system-ui}main{max-width:1100px;margin:20px auto}.mount{height:620px;width:100%;border-radius:18px}#two{display:none}body.pair main{display:flex;gap:16px}body.pair .mount{display:block;width:calc(50% - 8px);height:540px}#outside{margin:12px}.preview,.detail{display:flex;align-items:center;justify-content:center;background:linear-gradient(130deg,#4a636d,#162d36);color:white;font:28px system-ui}.detail{background:#354667}@media(max-width:480px){main{margin:8px}.mount{height:640px}}
  </style></head><body><button id="outside">Application action</button><main><div id="one" class="mount"></div><div id="two" class="mount"></div></main><script type="module">
  import {createPrismDeck} from '/@fs${new URL('../packages/dom/dist/index.js', import.meta.url).pathname}';
  import '/@fs${new URL('../packages/dom/src/style.css', import.meta.url).pathname}';
  const items=Array.from({length:10000},(_,id)=>({id:'item-'+id,label:'Pane '+id}));window.initialItems=items;
  window.stats={};window.activations=[];window.selections=[];
  window.makeDeck=(name,overrides={})=>{
    const stats=window.stats[name]={created:0,disposed:0,detailCreated:0,detailDisposed:0};
    const deck=createPrismDeck(document.querySelector('#'+name),{
      items,getKey:item=>item.id,adapter:{getKey:item=>item.id,getLabel:item=>item.label},
      renderPane:item=>{stats.created++;const element=document.createElement('div');element.className='preview';element.textContent=item.label;return {element,dispose:()=>stats.disposed++};},
      onSelect:(item,index)=>window.selections.push({name,key:item.id,index}),
      onActivate:(item,index)=>window.activations.push({name,key:item.id,index}),
      ...overrides,
    });
    window[name]=deck;return deck;
  };
  window.detailRenderer=name=>(item)=>{
    const stats=window.stats[name];stats.detailCreated++;const element=document.createElement('div');element.className='detail';element.textContent='Inspect '+item.label;
    return {element,dispose:()=>stats.detailDisposed++};
  };
  window.makeDeck('one');
  </script></body></html>`;

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Variant test server exited early: ${serverOutput}`);
    try { ready = (await fetch(address)).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Variant test server starts: ${serverOutput}`);
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined, args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/variants-fixture.html', (route) => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(`${address}/variants-fixture.html`);
  await page.waitForFunction(() => window.one && document.querySelector('#one .prismdeck-pane'));

  const snapshot = (name = 'one') => page.evaluate((name) => window[name].controller.getSnapshot(), name);
  const settled = async (name = 'one', selected = true) => {
    await page.waitForFunction(({name,selected}) => {
      const deck = window[name];
      const state = deck.controller.getSnapshot();
      return selected
        ? state.selectedKey !== null && Number(deck.element.dataset.prismdeckSelectionProgress) === 1
        : state.selectedKey === null && Number(deck.element.dataset.prismdeckSelectionProgress) === 0;
    }, { name, selected });
  };
  const guides = (name = 'one') => page.evaluate((name) => {
    const deck = window[name].element;
    const visible = (kind) => [...deck.querySelectorAll('[data-prismdeck-guide="'+kind+'"]')].some((node) => {
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.querySelector('line,path,polyline');
    });
    return {prism:deck.dataset.prismdeckPrismLines, rails:deck.dataset.prismdeckTimelineRails, visiblePrism:visible('prism'), visibleRails:visible('rails')};
  }, name);
  const assertBudget = async (name = 'one') => {
    assert.ok(await page.locator(`#${name} .prismdeck-pane`).count() <= 40, `${name} keeps its pane budget during presentation`);
    const resources = await page.evaluate((name) => window.stats[name].created - window.stats[name].disposed, name);
    assert.ok(resources <= 40, `${name} keeps its live content budget during presentation`);
  };

  assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-variant'), 'A', 'Seamless Version A is the default');
  assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-selection-mode'), 'slide-out');
  assert.deepEqual(await guides(), {prism:'true',rails:'true',visiblePrism:true,visibleRails:true}, 'Version A projects the prism and timeline rails');
  await assertBudget();
  await page.evaluate(() => {
    window.original = document.querySelector('#one .prismdeck-pane.is-focused');
    window.originalWorld = JSON.parse(window.original.dataset.prismdeckWorldPosition);
    window.originalRotation = JSON.parse(window.original.dataset.prismdeckWorldRotation);
    window.createdBeforeSelect = window.stats.one.created;
  });
  // Use the actual visible hit surface, so transforms or an accidental guide overlay cannot hide a broken click path.
  await page.locator('#one .prismdeck-pane.is-focused .prismdeck-pane-select').click();
  await page.waitForFunction(() => {
    const progress = Number(window.one.element.dataset.prismdeckSelectionProgress);
    return progress > 0 && progress < 1;
  });
  await settled();
  assert.equal((await snapshot()).selectedKey, 'item-0');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Version A does not open a modal');
  assert.equal(await page.evaluate(() => document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane') === window.original), true, 'Slide-out moves the existing pane node');
  assert.equal(await page.evaluate(() => window.stats.one.created === window.createdBeforeSelect), true, 'Selection does not recreate pane resources');
  const extraction = await page.evaluate(() => {
    const pane = window.original;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(pane).transform);
    return {position:JSON.parse(pane.dataset.prismdeckWorldPosition),rotation:JSON.parse(pane.dataset.prismdeckWorldRotation),original:window.originalWorld,originalRotation:window.originalRotation,matrix:[matrix.m11,matrix.m12,matrix.m13,matrix.m21,matrix.m22,matrix.m23],extraction:pane.dataset.prismdeckExtraction};
  });
  assert.equal(extraction.position[0], extraction.original[0], 'Extraction retains the pane axis coordinate');
  assert.equal(extraction.position[1], extraction.original[1], 'Extraction retains world height');
  assert.notEqual(extraction.position[2], extraction.original[2], 'The selected pane extracts along its own horizontal surface');
  assert.deepEqual(extraction.rotation, extraction.originalRotation, 'Extraction preserves the parallel plane orientation');
  assert.deepEqual(extraction.rotation, [0,-Math.PI/2,0]);
  assert.ok(Math.abs(extraction.matrix[1]) < 0.001 && Math.abs(extraction.matrix[2]) < 0.001 && Math.abs(extraction.matrix[3]) < 0.001 && Math.abs(extraction.matrix[5]) < 0.001, 'Selected camera settles orthogonal to the pane');
  assert.ok(Math.abs(extraction.matrix[0]) > 0.99 && Math.abs(extraction.matrix[4]) > 0.99, 'Selected surface remains full-facing');
  assert.equal(await page.evaluate(() => window.activations.length), 0, 'Presenting a pane does not run optional application actions');
  await page.locator('#one .prismdeck-selection-viewport .prismdeck-pane-select').click();
  assert.deepEqual(await page.evaluate(() => window.activations), [{name:'one',key:'item-0',index:0}], 'A second activation runs the optional application action');
  assert.equal((await snapshot()).selectedKey, 'item-0', 'Application activation retains the selected pane');
  const beforeGuides = await page.evaluate(() => ({...window.stats.one,progress:window.one.element.dataset.prismdeckSelectionProgress}));
  await page.evaluate(() => window.one.update({prismLines:false}));
  await page.waitForFunction(() => window.one.element.dataset.prismdeckPrismLines === 'false');
  assert.deepEqual(await guides(), {prism:'false',rails:'true',visiblePrism:false,visibleRails:true});
  assert.equal(await page.evaluate(() => document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane') === window.original), true, 'Guide-only updates retain the original extracted pane');
  const afterGuides = await page.evaluate(() => ({...window.stats.one,progress:window.one.element.dataset.prismdeckSelectionProgress}));
  assert.deepEqual(afterGuides, beforeGuides, 'Guide-only updates preserve camera progress and content resources');
  await page.evaluate(() => window.one.update({prismLines:undefined}));
  await page.waitForFunction(() => window.one.element.dataset.prismdeckPrismLines === 'true');
  await assertBudget();
  await page.locator('#one .prismdeck-selection-back:visible').click();
  await settled('one', false);
  assert.equal(await page.evaluate(() => document.querySelector('#one .prismdeck-stage [data-prismdeck-key="item-0"]') === window.original), true, 'Back returns the same pane to the prism');
  assert.equal(await page.evaluate(() => window.stats.one.created === window.createdBeforeSelect), true, 'Returning to the prism reuses original resources');
  const focusAfterBack = await page.evaluate(() => ({restored:document.activeElement===window.one.element,active:document.activeElement?.outerHTML.slice(0,200)}));
  assert.equal(focusAfterBack.restored, true, `Back restores keyboard focus to the deck: ${focusAfterBack.active}`);
  await page.keyboard.press('Enter');
  await settled();
  await page.keyboard.press('Escape');
  await settled('one', false);

  // A presentation backdrop is local to its deck and dismisses the seamless view.
  await page.evaluate(() => window.one.controller.select());
  await settled();
  const presentation = await page.locator('#one .prismdeck-presentation').boundingBox();
  assert.ok(presentation);
  await page.mouse.click(presentation.x + 6, presentation.y + presentation.height / 2);
  await settled('one', false);

  await page.evaluate(() => window.one.update({variant:'B'}));
  await page.waitForFunction(() => window.one.element.dataset.prismdeckVariant === 'B');
  assert.equal(await page.locator('#one .prismdeck').getAttribute('data-prismdeck-selection-mode'), 'modal');
  assert.deepEqual(await guides(), {prism:'false',rails:'false',visiblePrism:false,visibleRails:false}, 'Version B starts with no projected guides');
  await page.locator('#one .prismdeck').focus();
  await page.keyboard.press('Enter');
  await settled();
  assert.equal(await page.locator('#one .prismdeck-dialog[open]').count(), 1, 'Version B opens the native modal');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('.prismdeck-dialog') !== null), true, 'Modal owns keyboard focus');
  await page.keyboard.press('Escape');
  await settled('one', false);
  assert.equal(await page.locator('#one .prismdeck-dialog[open]').count(), 0);

  // Individual switches override a preset without importing a different renderer.
  await page.evaluate(() => window.one.update({prismLines:true,selectionMode:'none'}));
  await page.waitForFunction(() => window.one.element.dataset.prismdeckSelectionMode === 'none');
  assert.deepEqual(await guides(), {prism:'true',rails:'false',visiblePrism:true,visibleRails:false});
  const selectedBefore = await page.evaluate(() => window.selections.length);
  const actionsBefore = await page.evaluate(() => window.activations.length);
  await page.locator('#one .prismdeck').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction((before) => window.selections.length === before + 1, selectedBefore);
  assert.equal((await snapshot()).selectedKey, 'item-0');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Event-only mode opens no native modal');
  assert.equal(await page.locator('#one .prismdeck-presentation:visible').count(), 0, 'Event-only mode opens no slide-out');
  assert.equal(await page.evaluate(() => window.activations.length), actionsBefore, 'Event-only selection does not run optional application actions');

  // Changes with a selected pane close the old presentation and apply the new mode live.
  await page.evaluate(() => window.one.update({variant:'A',selectionMode:'modal',prismLines:false,timelineRails:true}));
  await page.waitForFunction(() => document.querySelector('#one .prismdeck-dialog')?.open);
  assert.deepEqual(await guides(), {prism:'false',rails:'true',visiblePrism:false,visibleRails:true}, 'Guides and presentation can be configured independently of the preset');
  await page.evaluate(() => window.one.update({variant:'A',selectionMode:undefined,prismLines:undefined,timelineRails:undefined}));
  await settled();
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Switching to A removes the old native top layer');
  assert.equal(await page.locator('#one .prismdeck-presentation:visible').count(), 1);
  assert.equal((await snapshot()).selectedKey, 'item-0', 'Live mode updates retain selection');
  assert.deepEqual(await guides(), {prism:'true',rails:'true',visiblePrism:true,visibleRails:true});
  await page.evaluate(() => window.one.controller.dismiss());
  await settled('one', false);
  await assertBudget();

  // The controller remains authoritative when a host replaces items without using deck.update().
  await page.evaluate(() => window.one.controller.select(0));
  await settled();
  await page.evaluate(() => {
    window.replacementItems = window.one.controller.getItems().map((item) => ({...item,label:'Refreshed '+item.label}));
    window.one.controller.setItems(window.replacementItems);
  });
  await page.waitForFunction(() => document.querySelector('#one .prismdeck-selection-viewport .preview')?.textContent === 'Refreshed Pane 0');
  await settled();
  assert.equal((await snapshot()).selectedKey, 'item-0', 'Replacing a selected item retains its stable selection key');
  const refreshedPane = await page.locator('#one .prismdeck-selection-viewport .prismdeck-pane').boundingBox();
  assert.ok(refreshedPane && refreshedPane.width > 100 && refreshedPane.height > 50, 'Replacement selected content is visible in its presentation');
  await page.evaluate(() => {
    window.refreshedPane = document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane');
    window.one.update({prismLines:false});
  });
  await page.waitForFunction(() => window.one.element.dataset.prismdeckPrismLines === 'false');
  assert.equal(await page.evaluate(() => window.one.controller.getItems()[0] === window.replacementItems[0]), true, 'A presentation-only update retains items supplied directly to the controller');
  assert.equal(await page.evaluate(() => window.one.controller.getItems().length === window.replacementItems.length), true, 'Presentation options do not reset the controller collection');
  assert.equal(await page.evaluate(() => document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane') === window.refreshedPane), true, 'Guide updates retain refreshed selected content');
  assert.equal(await page.locator('#one .prismdeck-selection-viewport .preview').textContent(), 'Refreshed Pane 0');
  await page.evaluate(() => {
    window.one.controller.dismiss();
    window.one.controller.setItems(window.initialItems);
    window.one.update({prismLines:undefined});
  });
  await settled('one', false);

  // Detail content is lazy, replaces its own resources, and cleans up on dismiss/dispose.
  await page.evaluate(() => window.one.update({renderSelection:window.detailRenderer('one')}));
  assert.equal(await page.evaluate(() => window.stats.one.detailCreated), 0);
  await page.evaluate(() => window.one.controller.select(2));
  await settled();
  assert.equal(await page.locator('#one .prismdeck-pane-detail').textContent(), 'Inspect Pane 2');
  assert.equal(await page.evaluate(() => window.stats.one.detailCreated), 1);
  await page.evaluate(() => window.one.controller.select(3));
  await page.waitForFunction(() => document.querySelector('#one .prismdeck-pane-detail')?.textContent === 'Inspect Pane 3');
  assert.equal(await page.evaluate(() => window.stats.one.detailDisposed), 1, 'Changing selection disposes prior detail content');
  await page.evaluate(() => window.one.controller.dismiss());
  await settled('one', false);
  assert.equal(await page.evaluate(() => window.stats.one.detailCreated === window.stats.one.detailDisposed), true, 'Dismiss releases selection-only resources');
  assert.equal(await page.locator('#one .prismdeck-pane-detail').count(), 0);

  // Two modal instances must dismiss independently, and inactive decks must leave app keys alone.
  await page.evaluate(() => {
    document.body.classList.add('pair');
    window.one.update({variant:'B',renderSelection:undefined});
    window.makeDeck('two',{variant:'B'});
  });
  await page.waitForFunction(() => window.two && document.querySelector('#two .prismdeck-pane'));
  await page.evaluate(() => window.one.controller.select());
  await page.waitForFunction(() => document.querySelector('#one .prismdeck-dialog')?.open);
  await page.evaluate(() => window.two.controller.select());
  await page.waitForFunction(() => document.querySelector('#two .prismdeck-dialog')?.open);
  await page.keyboard.press('Escape');
  await settled('two', false);
  assert.notEqual((await snapshot()).selectedKey, null, 'Escape in the top modal does not dismiss another deck');
  assert.equal(await page.locator('#one .prismdeck-dialog[open]').count(), 1);
  await page.keyboard.press('Escape');
  await settled('one', false);
  await page.locator('#outside').focus();
  const beforeOutside = {one:await snapshot(),two:await snapshot('two')};
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  assert.equal((await snapshot()).focus, beforeOutside.one.focus);
  assert.equal((await snapshot('two')).focus, beforeOutside.two.focus);
  assert.equal(await page.locator('#outside').evaluate((node) => node === document.activeElement), true, 'Inactive modal instances preserve application focus');
  await page.evaluate(() => {
    window.two.dispose();
    document.body.classList.remove('pair');
    window.one.update({variant:'A',renderSelection:window.detailRenderer('one')});
  });

  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  // Let ResizeObserver deliver the new viewport before measuring a reduced-motion first frame.
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  await page.evaluate(() => window.one.controller.select());
  await settled();
  const mobile = await page.evaluate(() => {
    const deck = window.one.element.getBoundingClientRect();
    const pane = document.querySelector('#one .prismdeck-selection-viewport .prismdeck-pane').getBoundingClientRect();
    return {deck:{x:deck.x,y:deck.y,right:deck.right,bottom:deck.bottom},pane:{x:pane.x,y:pane.y,right:pane.right,bottom:pane.bottom,width:pane.width,height:pane.height}};
  });
  await mkdir(new URL('../test-results/', import.meta.url), {recursive:true});
  await page.screenshot({path:new URL('../test-results/variant-a-mobile.png', import.meta.url).pathname});
  assert.ok(mobile.pane.width > 100 && mobile.pane.height > 50, 'Mobile selection remains readable');
  assert.ok(mobile.pane.x >= mobile.deck.x - 1 && mobile.pane.right <= mobile.deck.right + 1 && mobile.pane.y >= mobile.deck.y - 1 && mobile.pane.bottom <= mobile.deck.bottom + 1, `Orthogonal selection fits inside a phone-sized deck: ${JSON.stringify(mobile)}`);
  await page.evaluate(() => window.one.controller.dismiss());
  await settled('one', false);
  // One animation frame is enough under reduced motion; this verifies the runtime preference, not a CSS screenshot.
  const reducedProgress = await page.evaluate(async () => {
    window.one.controller.select();
    await new Promise(requestAnimationFrame);
    return Number(window.one.element.dataset.prismdeckSelectionProgress);
  });
  assert.equal(reducedProgress, 1, 'Reduced motion skips the camera animation');
  await assertBudget();
  await page.evaluate(() => {
    window.one.update({variant:'B'});
  });
  await page.waitForFunction(() => document.querySelector('#one .prismdeck-dialog')?.open);
  await page.screenshot({path:new URL('../test-results/variant-b-mobile.png', import.meta.url).pathname});
  await page.evaluate(() => { window.one.dispose(); window.one.dispose(); });
  assert.equal(await page.locator('.prismdeck').count(), 0, 'Disposal removes both independent widgets');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Disposal closes active native modals');
  const resources = await page.evaluate(() => window.stats);
  for (const [name, stats] of Object.entries(resources)) {
    assert.equal(stats.created, stats.disposed, `${name} disposes every pane resource exactly once`);
    assert.equal(stats.detailCreated, stats.detailDisposed, `${name} disposes every selection resource exactly once`);
  }
  assert.equal(requests.some((url) => /packages\/three|node_modules.*three|three\.js|\/xr[.\/]/.test(url)), false, 'Neither presentation variant loads Three or XR');
  assert.deepEqual(errors, [], 'Both presentation variants produce no browser errors');
  console.log('Variant browser checks passed: A seamless same-node extraction, orthogonal camera, prism/rail guides, B native modal, independent overrides, live mode updates, detail cleanup, multi-instance focus, reduced motion, mobile fit, bounded resources, and zero Three/XR.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
